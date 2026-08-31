import { withTenant, pool } from '../db.js';
import { activateSubscriber, issueVoucherAccess } from '../radius.js';
import { send } from '../sms.js';

/**
 * PPPoE billing cycles land on a shared midnight rather than whatever minute
 * the customer happened to pay at — every account's clock ends up on the
 * same daily boundary, which is what lets jobs.js process a clean nightly
 * batch instead of a trickle of expiries scattered across all 24 hours.
 * Always rounds *up*: a customer never loses paid-for time to the rounding,
 * only ever gains the remainder of the day they paid into.
 */
export function ceilToMidnight(d) {
  const r = new Date(d);
  if (r.getHours() === 0 && r.getMinutes() === 0 && r.getSeconds() === 0 && r.getMilliseconds() === 0) return r;
  r.setHours(24, 0, 0, 0);
  return r;
}

/**
 * A tenant's own money, held by the platform between collecting it (their
 * customers pay into the platform's paybill, for a tenant with none of
 * their own — see tenants.platform_collect_enabled) and settling it out to
 * them (jobs.js's settleTenants, via daraja.js's b2c()). One open
 * ('pending') row per tenant at a time — settlements_one_pending_per_tenant
 * enforces that in the schema — accrued into as payments come in, and
 * closed out (a fresh 'pending' row starts from zero) once the payout job
 * pays it and Safaricom's b2c-result webhook confirms it.
 */
export async function accrueSettlement(tenantId, amount) {
  if (!(amount > 0)) return;
  await pool.query(
    `insert into settlements (tenant_id, amount, status)
     values ($1, $2, 'pending')
     on conflict (tenant_id) where status='pending'
     do update set amount = settlements.amount + excluded.amount`,
    [tenantId, amount]);
}

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
      const r = await settleSubscriber(c, tenantId, target.id, tx.amount, paymentId, target.invoiceId ?? null);
      await activateSubscriber(c, tenantId, target.id);
      await send(tenantId, tx.phone, 'receipt', { amount: tx.amount, code: tx.ref, ...r });
      return { paymentId, applied: true, ...r };
    }

    const v = await issueVoucherAccess(c, tenantId, target.planId, tx.phone, target.mac);
    await c.query("update payments set status='applied', voucher_id=$2, applied_at=now() where id=$1", [paymentId, v.id]);

    // Which site this was bought at, for payment-monitoring-by-site — the
    // ordinary "buy a code, type it in" purchase carries this now too (via
    // the login page's own ?router=), not just the tv-buy flow below.
    // Best-effort: a purchase from a page with no known router, or one
    // cached from before this existed, simply has nothing to attribute.
    if (target.routerId) {
      await c.query('update vouchers set router_id=$2 where id=$1', [v.id, target.routerId]);
    }

    /**
     * The device itself, bound on the router right now — not left for the
     * guest to submit a login form, because the whole point of the "pick a
     * device, pay direct" flow (POST /hotspot/tv-buy) is a TV that has no
     * way to submit one. Best-effort and never fatal: the voucher and its code
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
      // What actually identifies this binding when an operator is looking
      // straight at the router (Winbox: IP -> Hotspot -> IP Bindings/Hosts,
      // since a bypassed device is real to look at there — it just never
      // shows under Active, which only ever lists devices that went through
      // hotspot's own login, and bypass is specifically what skips that).
      // A hardcoded "auto" told nobody which of a dozen identical-looking
      // rows was which customer; the voucher code always does, and the
      // guest's own device name does better still, when they gave one.
      const routerComment = target.label ? `${v.code} — ${target.label}` : v.code;
      await bindDeviceOnRouter(target.routerId, target.mac, v.plan_id, routerComment)
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
async function settleSubscriber(c, tenantId, subId, amount, paymentId, invoiceId = null) {
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
  // A specific invoice — the portal's own "pay this invoice" flow, or the
  // staff STK push when raised against one — wins over the usual "earliest
  // due" default; it must still belong to this subscriber and still be
  // outstanding, since neither side re-checks that between the STK prompt
  // going out and this callback landing.
  const { rows: [inv] } = await c.query(
    invoiceId
      ? "select * from invoices where id=$2 and subscriber_id=$1 and status in ('open','partial')"
      : "select * from invoices where subscriber_id=$1 and status in ('open','partial') order by due_date limit 1",
    invoiceId ? [subId, invoiceId] : [subId]
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
    // Hotspot vouchers are short (minutes/hours) and are meant to expire at
    // the literal moment paid for — only PPPoE's day-scale plans get pushed
    // onto the shared midnight boundary.
    if (sub.service === 'pppoe') expires = ceilToMidnight(expires);
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

  if (sub.referred_by) await creditReferral(c, tenantId, sub, subId, amount, paymentId);

  return { expires, partial: !full, balance: credit };
}

/**
 * One-time commission, on the client's first applied payment only — the
 * unique (subscriber_id) constraint on referral_commissions is what makes
 * that a database guarantee rather than something this function has to get
 * right on its own every time it's called; on conflict do nothing is the
 * whole enforcement.
 */
async function creditReferral(c, tenantId, sub, subId, amount, paymentId) {
  const { rows: [already] } = await c.query(
    "select 1 from payments where subscriber_id=$1 and status='applied' and id<>$2", [subId, paymentId]);
  if (already) return;   // a prior payment already applied — this is not the first

  const { rows: [ref] } = await c.query(
    'select id, commission_type, commission_rate from referrers where id=$1', [sub.referred_by]);
  if (!ref) return;   // referrer was deleted since — nothing to credit

  const commission = ref.commission_type === 'percent'
    ? (Number(amount) * Number(ref.commission_rate)) / 100
    : Number(ref.commission_rate);
  if (!(commission > 0)) return;

  await c.query(
    `insert into referral_commissions (tenant_id, referrer_id, subscriber_id, payment_id, basis_amount, amount)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (subscriber_id) do nothing`,
    [tenantId, ref.id, subId, paymentId, amount, commission]);
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
async function bindDeviceOnRouter(routerId, mac, planId, comment) {
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
      mac, downKbps: plan?.rate_down ?? 2000, upKbps: plan?.rate_up ?? 1000, comment: comment ?? 'auto',
    });
  } finally {
    ros.close(conn);
  }
}
