import { withTenant } from '../db.js';
import { activateSubscriber, issueVoucherAccess } from '../radius.js';
import { send } from '../sms.js';

/**
 * The single funnel every channel goes through.
 * Idempotent: unique (tenant_id, provider, provider_ref) makes a replayed webhook a no-op.
 *
 * tx = { provider, ref, amount, phone, name, rawAccount, payload, target }
 * target = { type:'subscriber', id } | { type:'hotspot', planId, mac } | null (=> matcher)
 */
export async function applyPayment(tenantId, tx) {
  return withTenant(tenantId, async (c) => {
    const ins = await c.query(
      `insert into payments (tenant_id, provider, provider_ref, amount, payer_phone, payer_name, raw_account, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (tenant_id, provider, provider_ref) do nothing
       returning id`,
      [tenantId, tx.provider, tx.ref, tx.amount, tx.phone, tx.name, tx.rawAccount, tx.payload ?? {}]
    );
    if (!ins.rows[0]) return { duplicate: true };
    const paymentId = ins.rows[0].id;

    let target = tx.target ?? (await match(c, tenantId, tx));
    if (!target) {
      await c.query("update payments set status='unmatched' where id=$1", [paymentId]);
      return { paymentId, unmatched: true };
    }

    if (target.type === 'subscriber') {
      const r = await settleSubscriber(c, tenantId, target.id, tx.amount, paymentId);
      await activateSubscriber(c, tenantId, target.id);
      await send(tenantId, tx.phone, 'receipt', { amount: tx.amount, code: tx.ref, ...r });
      return { paymentId, applied: true, ...r };
    }

    const v = await issueVoucherAccess(c, tenantId, target.planId, tx.phone, target.mac);
    await c.query("update payments set status='applied', voucher_id=$2, applied_at=now() where id=$1", [paymentId, v.id]);
    await send(tenantId, tx.phone, 'voucher', { code: v.code, expires: v.expires_at });
    return { paymentId, applied: true, voucher: v };
  });
}

/** Extend service, handle partial payment as pro-rated days + credit. */
async function settleSubscriber(c, tenantId, subId, amount, paymentId) {
  const { rows: [sub] } = await c.query(
    'select s.*, p.price, p.duration_min from subscribers s join plans p on p.id=s.plan_id where s.id=$1',
    [subId]
  );
  const { rows: [inv] } = await c.query(
    "select * from invoices where subscriber_id=$1 and status in ('open','partial') order by due_date limit 1",
    [subId]
  );
  const available = Number(amount) + Number(sub.credit);
  const price = Number(inv?.amount ?? sub.price);
  const full = available >= price;
  const minutes = full ? sub.duration_min : Math.floor(sub.duration_min * (available / price));
  const base = new Date(Math.max(Date.now(), new Date(sub.expires_at ?? Date.now()).getTime()));
  const expires = new Date(base.getTime() + minutes * 60000);
  const leftover = full ? available - price : 0;

  await c.query("update subscribers set expires_at=$2, status='active', credit=$3 where id=$1",
    [subId, expires, leftover]);
  if (inv) {
    await c.query(
      "update invoices set paid=paid+$2, status=case when paid+$2 >= amount then 'paid' else 'partial' end where id=$1",
      [inv.id, amount]
    );
  }
  await c.query("update payments set status='applied', subscriber_id=$2, invoice_id=$3, applied_at=now() where id=$1",
    [paymentId, subId, inv?.id ?? null]);
  return { expires, partial: !full, balance: full ? 0 : price - available };
}

/** Fuzzy match for till/typo'd references. Learns the payer phone on success. */
async function match(c, tenantId, tx) {
  if (tx.rawAccount) {
    const norm = String(tx.rawAccount).toUpperCase().replace(/[^A-Z0-9]/g, '')
      .replace(/O/g, '0').replace(/[IL]/g, '1');
    /**
     * One account number can now carry several lines — a house and a shop, or
     * a landlord's flats. M-Pesa gives us the account number and nothing else,
     * so the payment cannot say which line it is for.
     *
     * It goes to the one expiring soonest. That is what the customer almost
     * always means: the line that is about to go off, or already has. Paying
     * for a line that still has three weeks while another sits expired would
     * be the wrong guess every time.
     */
    const { rows } = await c.query(
      `select id, expires_at, similarity(upper(replace(account_code,'-','')), $2) as score
       from subscribers where tenant_id=$1
       order by score desc, expires_at asc nulls first
       limit 1`,
      [tenantId, norm]
    );
    if (rows[0] && rows[0].score > 0.75) return { type: 'subscriber', id: rows[0].id };
  }
  if (tx.phone) {
    // Same rule when matching on the payer's number: the soonest to expire.
    const { rows } = await c.query(
      `select id from subscribers where tenant_id=$1 and phone=$2
        order by expires_at asc nulls first limit 1`,
      [tenantId, tx.phone]);
    if (rows[0]) return { type: 'subscriber', id: rows[0].id };
  }
  // Amount exactly equals a hotspot plan price -> sell that bundle to the payer's number.
  const { rows: plans } = await c.query(
    "select id from plans where tenant_id=$1 and service='hotspot' and price=$2 and active limit 1",
    [tenantId, tx.amount]
  );
  if (plans[0] && tx.phone) return { type: 'hotspot', planId: plans[0].id, mac: null };
  return null;
}
