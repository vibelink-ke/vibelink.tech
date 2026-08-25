import { withTenant, pool } from '../db.js';
import { activateSubscriber, issueVoucherAccess } from '../radius.js';
import { send } from '../sms.js';

/**
 * The single funnel every channel goes through.
 * Idempotent: unique (tenant_id, provider, provider_ref) makes a replayed webhook a no-op.
 *
 * tx = { provider, ref, amount, phone, name, rawAccount, payload, target }
 * target = { type:'subscriber', id } | { type:'hotspot', planId, mac, routerId? } | null (=> matcher)
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

    /**
     * The device itself, bound on the router right now — not left for the
     * guest to submit a login form, because the whole point of the "pick a
     * device, pay direct" flow (POST /hotspot/tv-buy) is a TV that has no
     * way to submit one. routerId only ever arrives from that flow; the
     * ordinary "buy a code, type it in" purchase never sets it, so this is
     * a no-op there. Best-effort and never fatal: the voucher and its code
     * already exist by this point, and the SMS below still gives a human a
     * way to type the code in by hand if the router push fails here — a
     * guest who paid is never left with literally nothing to show for it.
     *
     * The voucher_devices row is not optional bookkeeping — it is the only
     * thing that makes this device visible or accountable at all afterward.
     * jobs.js's expireAndSuspend finds every device to unbind by joining
     * voucher_devices to routers; without a row here, an ip-bound TV had a
     * static bypass on the router that nothing ever removed, so it kept
     * working long after the voucher it was paid through had expired — the
     * router had no concept of "this voucher's time is up," only "this MAC
     * is bypassed," and nothing was telling it otherwise. The vouchers list
     * also has nowhere else to learn a device is attached at all, which is
     * why one never showed as active despite genuinely being online. Only
     * written once the bind above has actually succeeded — a row claiming a
     * binding that was never made would tell expiry cleanup to unbind
     * something that was never bound.
     */
    if (target.mac && target.routerId) {
      await bindDeviceOnRouter(target.routerId, target.mac, v.plan_id)
        .then(() => c.query(
          `insert into voucher_devices (voucher_id, mac, router_id, label) values ($1,$2,$3,$4)
           on conflict (voucher_id, mac) do update set label=coalesce(excluded.label, voucher_devices.label)`,
          [v.id, target.mac, target.routerId, target.label ?? null]))
        .catch((e) => {
          console.error('auto-bind device', target.mac, 'on', target.routerId, '—', e.message);
        });
    }

    // {link} is a tap target for the same code, for a guest who would rather
    // not retype a 6-digit code on a phone keyboard, or whose device dropped
    // back to the sign-in page and just needs one tap to get back on.
    const { rows: [t] } = await c.query('select subdomain from tenants where id=$1', [tenantId]);
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    const link = t?.subdomain
      ? `https://${t.subdomain}.${root}/hotspot/login.html?code=${encodeURIComponent(v.code)}`
      : '';
    // v.expires_at arrives as a real JS Date — interpolated raw into a
    // template it prints as its full toString(), timezone offset and all
    // ("Thu Aug 20 2026 18:30:00 GMT+0300 (East Africa Time)"), which reads
    // like a jumble of numbers in a text message. A guest needs a day and a
    // time, not a timezone name.
    const expires = v.expires_at
      ? new Date(v.expires_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    await send(tenantId, tx.phone, 'voucher', { code: v.code, expires, link });
    return { paymentId, applied: true, voucher: v };
  });
}

/**
 * Extend service by however many full periods the payment plus whatever
 * was already sitting as credit adds up to; anything left under a full
 * period's price stays as visible wallet credit rather than converting
 * immediately into a sliver of extra time.
 *
 * This used to pro-rate a partial payment into minutes on the spot and
 * reset credit to 0 — so a KES 1 payment against a KES 1,500 plan bought
 * a few minutes of service and vanished from the balance entirely, with
 * nothing to show for it except a payment-history row. A customer paying
 * in small amounts over several days had no way to see what they'd
 * already put in; every partial payment before the one that finally
 * tipped the balance over the plan price looked, from the wallet, like it
 * had done nothing at all. Now it accumulates instead, and service only
 * extends once enough of it adds up to actually cover a period — which is
 * also why status only moves to 'active' when that happens, not on every
 * payment regardless of size: a partial payment does not yet entitle
 * anyone to service, only to a bigger balance.
 */
async function settleSubscriber(c, tenantId, subId, amount, paymentId) {
  /**
   * `for update` on the subscriber row — without it, two payments landing
   * close together (a portal STK and an operator keying in the same
   * transaction manually, or a retry racing the original) both read the
   * same starting credit/expires_at, compute independently, and the second
   * UPDATE overwrites the first's instead of building on it. The first
   * payment's own `payments`/`invoices` rows still look correct — this is
   * already inside applyPayment's transaction (withTenant), so the lock
   * just makes the second call wait for the first to commit and read its
   * result, rather than a customer who paid twice only having it counted
   * once. The invoice update below already does this correctly on its own
   * (`paid=paid+$2`, atomic) — this brings the subscriber row's
   * credit/expires_at up to the same standard.
   */
  const { rows: [sub] } = await c.query(
    'select s.*, p.price, p.duration_min from subscribers s join plans p on p.id=s.plan_id where s.id=$1 for update of s',
    [subId]
  );
  const { rows: [inv] } = await c.query(
    "select * from invoices where subscriber_id=$1 and status in ('open','partial') order by due_date limit 1",
    [subId]
  );
  const available = Number(amount) + Number(sub.credit);
  const price = Number(inv?.amount ?? sub.price);
  const periods = Math.floor(available / price);
  const full = periods >= 1;

  let expires = sub.expires_at;
  const credit = full ? available - periods * price : available;
  if (full) {
    const minutes = periods * sub.duration_min;
    const base = new Date(Math.max(Date.now(), new Date(sub.expires_at ?? Date.now()).getTime()));
    expires = new Date(base.getTime() + minutes * 60000);
  }

  await c.query(
    `update subscribers set expires_at=$2, credit=$3${full ? ", status='active'" : ''} where id=$1`,
    [subId, expires, credit]);
  if (inv) {
    await c.query(
      "update invoices set paid=paid+$2, status=case when paid+$2 >= amount then 'paid' else 'partial' end where id=$1",
      [inv.id, amount]
    );
  }
  await c.query("update payments set status='applied', subscriber_id=$2, invoice_id=$3, applied_at=now() where id=$1",
    [paymentId, subId, inv?.id ?? null]);
  return { expires, partial: !full, balance: credit };
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

/**
 * IP-bind a device on a specific router the moment its plan is paid for —
 * the router-facing half of ros.bindDeviceByMac, called from here rather
 * than from the route that took the payment because a webhook callback and
 * a route handler both need it and neither should duplicate it.
 */
async function bindDeviceOnRouter(routerId, mac, planId) {
  const { rows: [r] } = await pool.query(
    'select host, api_port, service_user, service_password_enc from routers where id=$1',
    [routerId]);
  if (!r?.service_user || !r.service_password_enc) throw new Error('router not configured for the billing system');

  const { rows: [plan] } = await pool.query('select rate_down, rate_up from plans where id=$1', [planId]);

  const ros = await import('../routeros.js');
  const secrets = await import('../secrets.js');
  const password = secrets.decrypt(r.service_password_enc);
  const conn = await ros.connect({
    host: String(r.host).split('/')[0], port: r.api_port ?? 8728,
    user: r.service_user, password, timeoutSec: 8,
  });
  try {
    await ros.bindDeviceByMac(conn, {
      mac, downKbps: plan?.rate_down ?? 2000, upKbps: plan?.rate_up ?? 1000, comment: 'auto',
    });
  } finally {
    ros.close(conn);
  }
}
