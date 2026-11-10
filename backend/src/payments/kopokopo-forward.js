import axios from 'axios';
import express from 'express';
import { config, pool } from '../db.js';
import { accessToken } from './kopokopo.js';

/**
 * Hotspot money collected on the PLATFORM's KopoKopo till for a tenant (hotspot payment method 'platform_kopokopo'), sent on to that
 * tenant's own till, paybill or bank.
 *
 * KopoKopo cannot make an STK prompt on one till pay into another business (there is no equivalent of Daraja's PartyB), so the money
 * lands in the platform's KopoKopo balance first. Each tenant's takings build up in one 'pending' row here and are sent on with
 * KopoKopo's own Send Money API, from the same till, every few minutes once they reach the minimum. Nothing here touches the paybill
 * or the settlements table: this money never goes near them.
 *
 * A forward can never go out twice. The row is marked 'processing' BEFORE KopoKopo is called; only a clear refusal (an HTTP 4xx) puts
 * the money back to be sent again. Anything unclear (a timeout, a 5xx, no id returned) is left 'processing' for the platform owner to
 * settle by hand (mark it paid, or send it again), because KopoKopo may have accepted it.
 */
const BASE = 'https://api.kopokopo.com';
const enabled = () => process.env.PLATFORM_KOPOKOPO_ENABLED === 'true';
const MIN_KES = () => Math.max(1, Number(process.env.PLATFORM_KOPOKOPO_MIN ?? 100) || 100);
// What KopoKopo charges the platform for each transfer, taken out of the forward so the platform is not out of pocket. 0 = the platform absorbs it.
const FEE_KES = () => Math.max(0, Number(process.env.PLATFORM_KOPOKOPO_FEE ?? 0) || 0);

async function ownerTenantId() {
  const { rows: [o] } = await pool.query('select tenant_id from staff where is_super_admin and tenant_id is not null limit 1');
  return o?.tenant_id ?? null;
}

/** Where a tenant's money goes: the till, paybill or bank they registered under Payment gateways → Till / Bank. Null when there is none. */
export async function destinationFor(tenantId) {
  const { rows: [pb] } = await pool.query(
    `select shortcode, credentials from tenant_payment_config
      where tenant_id=$1 and provider='piggyback_till' and scope='tenant' order by is_default desc, id limit 1`, [tenantId]);
  const number = String(pb?.shortcode ?? '').replace(/[^0-9]/g, '');
  if (!number) return null;
  const c = pb.credentials ?? {};
  const type = ['till', 'paybill', 'bank'].includes(c.dest_type) ? c.dest_type : 'till';
  const account = type === 'till' ? null : (String(c.account ?? '').trim() || null);
  if (type !== 'till' && !account) return null;
  return { type, number, account, label: type === 'till' ? `till ${number}` : `${type === 'bank' ? (c.bank || 'bank') : 'paybill'} ${number}, account ${account}` };
}

/** A confirmed payment's amount joins the tenant's pending forward. */
export async function accrueForward(tenantId, amount) {
  if (!(amount > 0)) return;
  await pool.query(
    `insert into kk_forwards (tenant_id, amount) values ($1, $2)
     on conflict (tenant_id) where status='pending' do update set amount = kk_forwards.amount + excluded.amount`,
    [tenantId, amount]);
}

/** Money that did not go: back to the tenant's pending balance (merged into it if one has started since), to be sent again later. */
async function putBack(id, error) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [f] } = await c.query("select * from kk_forwards where id=$1 and status='processing' for update", [id]);
    if (!f) { await c.query('rollback'); return; }
    const note = String(error ?? 'not sent').slice(0, 300);
    const { rows: [pend] } = await c.query("select id from kk_forwards where tenant_id=$1 and status='pending' for update", [f.tenant_id]);
    if (pend) {
      await c.query("update kk_forwards set amount = amount + $2, retry_at = now() + interval '1 hour', error=$3 where id=$1", [pend.id, f.amount, note]);
      await c.query("update kk_forwards set status='failed', error=$2, settled_at=now() where id=$1", [f.id, note]);
    } else {
      await c.query(
        "update kk_forwards set status='pending', k2_id=null, fee=0, sent_at=null, retry_at = now() + interval '1 hour', error=$2 where id=$1", [f.id, note]);
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function sendOne(row, cfg) {
  const dest = await destinationFor(row.tenant_id);
  if (!dest) {
    await pool.query("update kk_forwards set retry_at = now() + interval '1 hour', error=$2 where id=$1 and status='pending'",
      [row.id, 'No till, paybill or bank registered to send this to (Payment gateways → Till / Bank).']);
    return;
  }
  const fee = FEE_KES();
  const net = Math.floor(Number(row.amount) - fee);
  if (!(net > 0)) return;
  const sent = net + fee;                                 // what leaves this row; any cents stay behind as the next pending row
  const rest = Math.round((Number(row.amount) - sent) * 100) / 100;

  // Claimed before anything is sent: from here it can only be confirmed, refused, or left for a person.
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rowCount } = await c.query(
      "update kk_forwards set status='processing', amount=$2, fee=$3, sent_at=now(), destination=$4, error=null, retry_at=null where id=$1 and status='pending'",
      [row.id, sent, fee, dest.label]);
    if (!rowCount) { await c.query('rollback'); return; }
    if (rest > 0) await c.query('insert into kk_forwards (tenant_id, amount) values ($1,$2)', [row.tenant_id, rest]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  const destination = dest.type === 'till'
    ? { type: 'till', till_number: dest.number }
    : { type: 'paybill', paybill_number: dest.number, paybill_account_number: dest.account };
  try {
    const res = await axios.post(`${BASE}/api/v2/send_money`, {
      destinations: [{ ...destination, nickname: String(row.name ?? 'Tenant').slice(0, 40), amount: net, description: 'Hotspot collections', favourite: true }],
      source_identifier: String(cfg.shortcode),
      currency: 'KES',
      metadata: { forward_id: row.id },
      _links: { callback_url: `${process.env.BASE_URL}/webhooks/kopokopo/send-money` },
    }, { headers: { Authorization: `Bearer ${await accessToken(cfg)}`, Accept: 'application/json' }, timeout: 30000 });
    const k2 = String(res.headers?.location ?? '').split('/').filter(Boolean).pop() ?? res.data?.data?.id ?? null;
    if (!k2) {
      await pool.query("update kk_forwards set error='KopoKopo accepted the request but returned no id: check the till statement, then mark it paid or send it again' where id=$1", [row.id]);
      return;
    }
    await pool.query('update kk_forwards set k2_id=$2 where id=$1', [row.id, k2]);
    console.log(`kk-forward: KES ${net} to ${row.name} (${dest.label}) sent, ${k2}`);
  } catch (e) {
    const status = e?.response?.status;
    const said = e?.response?.data?.error_message ?? e?.response?.data?.error_description ?? e?.message ?? 'not sent';
    if (status >= 400 && status < 500) {
      // KopoKopo refused it outright, so nothing moved.
      await putBack(row.id, `KopoKopo refused it: ${typeof said === 'string' ? said : JSON.stringify(said)}`);
      console.error(`kk-forward: ${row.name} refused (${status}):`, said);
    } else {
      await pool.query('update kk_forwards set error=$2 where id=$1',
        [row.id, `No clear answer from KopoKopo (${String(said).slice(0, 160)}): check the till statement, then mark it paid or send it again`]);
      console.error(`kk-forward: ${row.name} unclear:`, said);
    }
  }
}

/** Ask KopoKopo what became of a forward, and record it. Only a clear result changes anything. */
async function settle(row, cfg) {
  const { data } = await axios.get(`${BASE}/api/v2/send_money/${encodeURIComponent(row.k2_id)}`,
    { headers: { Authorization: `Bearer ${await accessToken(cfg)}`, Accept: 'application/json' }, timeout: 20000 });
  const a = data?.data?.attributes ?? {};
  const moves = (a.transfer_batches ?? []).flatMap((b) => b.disbursements ?? []);
  const text = (e) => (e == null ? '' : typeof e === 'string' ? e : JSON.stringify(e));
  const bad = /fail|reject|declin|cancel|revers|error/i;
  if (/^processed$/i.test(String(a.status)) && moves.length && moves.every((m) => /^transferred$/i.test(String(m.status)))) {
    await pool.query("update kk_forwards set status='paid', reference=$2, settled_at=now(), error=null where id=$1 and status='processing'",
      [row.id, moves.map((m) => m.transaction_reference).filter(Boolean).join(', ') || row.k2_id]);
    return 'paid';
  }
  if (bad.test(String(a.status)) || moves.some((m) => bad.test(String(m.status)))) {
    await putBack(row.id, `KopoKopo: ${text(a.errors) || moves.map((m) => text(m.errors)).filter(Boolean).join('; ') || a.status}`);
    return 'failed';
  }
  return 'waiting';
}

let running = false;
/** Every few minutes: send what has reached the minimum, and collect the result of what was sent. */
export async function runForwards() {
  if (!enabled() || running) return;
  running = true;
  try {
    const owner = await ownerTenantId();
    const cfg = owner ? await config(owner, 'kopokopo') : null;
    if (!cfg?.shortcode) return;

    const { rows: sent } = await pool.query(
      "select id, k2_id from kk_forwards where status='processing' and k2_id is not null and sent_at < now() - interval '2 minutes' limit 50");
    for (const r of sent) await settle(r, cfg).catch((e) => console.error('kk-forward: status', r.k2_id, e.message));

    const { rows: due } = await pool.query(
      `select f.id, f.tenant_id, f.amount, t.name from kk_forwards f join tenants t on t.id = f.tenant_id
        where f.status='pending' and f.amount >= $1 and (f.retry_at is null or f.retry_at <= now())
          and t.deleted_at is null and t.status not in ('readonly', 'suspended')
          -- one at a time per tenant: nothing new goes while an earlier one is still unanswered
          and not exists (select 1 from kk_forwards p where p.tenant_id = f.tenant_id and p.status='processing')
        order by f.created_at limit 50`, [MIN_KES() + FEE_KES()]);
    for (const r of due) await sendOne(r, cfg).catch((e) => console.error('kk-forward:', r.name, e.message));

    // A forward with no answer for an hour: the platform owner is told, once.
    const { rows: stuck } = await pool.query(
      `select f.id, f.amount, t.name from kk_forwards f join tenants t on t.id = f.tenant_id
        where f.status='processing' and not f.stuck_notified and f.sent_at < now() - interval '1 hour'`);
    if (stuck.length) {
      const { notifyOwner } = await import('../jobs.js');
      for (const s of stuck) {
        await notifyOwner(owner, `A KopoKopo forward of KES ${Number(s.amount).toLocaleString('en-KE')} to ${s.name} has had no result for an hour. Check it under Payments → Settlements.`,
          { url: '/payments?tab=settlements', title: 'KopoKopo forward not confirmed' }).catch(() => {});
        await pool.query('update kk_forwards set stuck_notified=true where id=$1', [s.id]);
      }
    }
  } finally {
    running = false;
  }
}

/** The platform owner settles a forward KopoKopo never answered: it was paid (with the reference), or it goes back to be sent again. */
export async function resolveForward(id, action, reference) {
  if (action === 'paid') {
    const { rowCount } = await pool.query(
      "update kk_forwards set status='paid', reference=$2, settled_at=now(), error=null where id=$1 and status='processing'",
      [id, String(reference ?? '').trim().slice(0, 60) || 'marked paid by hand']);
    return rowCount > 0;
  }
  const { rows: [f] } = await pool.query("select id from kk_forwards where id=$1 and status='processing'", [id]);
  if (!f) return false;
  await putBack(id, 'Put back by the platform owner to be sent again');
  await pool.query("update kk_forwards set retry_at=null where tenant_id=(select tenant_id from kk_forwards where id=$1) and status='pending'", [id]);
  return true;
}

export const router = express.Router();

/**
 * KopoKopo's result for a forward. The body is not trusted for anything but the id: the outcome is read back from KopoKopo itself
 * (settle), with our own token, so a forged call here can at most make us look a real forward up early.
 */
router.post('/send-money', express.json(), async (req, res) => {
  res.status(200).end();
  const id = String(req.body?.data?.id ?? '');
  if (!id) return;
  try {
    const { rows: [row] } = await pool.query("select id, k2_id from kk_forwards where k2_id=$1 and status='processing'", [id]);
    if (!row) return;
    const owner = await ownerTenantId();
    const cfg = owner ? await config(owner, 'kopokopo') : null;
    if (cfg) await settle(row, cfg);
  } catch (e) {
    console.error('kk-forward webhook:', id, e.message);
  }
});
