import { issueVoucherAccess } from './radius.js';
import { withTenant } from './db.js';

/**
 * Loyalty points for hotspot visitors.
 *
 * A visitor is known by their phone number, from the M-Pesa payment that bought their code. Each hotspot purchase earns
 * points at a rate the tenant sets (one point per N shillings). Points are spent on rewards the tenant defines: a free
 * bundle for a number of points. Everything is per tenant, and every change to a balance leaves a row in the ledger, so
 * a balance can always be explained.
 *
 * Off by default. Turning it on changes nothing already earned or sold.
 */

/** 0712 345 678 / +254712345678 / 254712345678 all become 254712345678, so one person is one account. */
export const normPhone = (p) => {
  const d = String(p ?? '').replace(/[^0-9]/g, '');
  return d.length >= 9 ? `254${d.slice(-9)}` : null;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Award points for one applied hotspot payment. Called inside the payment's own transaction, so it runs behind a
 * savepoint: if anything here goes wrong (the loyalty tables not migrated yet, say) only this step is undone and the
 * payment itself is never affected. Idempotent per payment. Answers { earned, total } or null when nothing was earned.
 */
export async function awardForPayment(c, tenantId, { paymentId, phone, amount }) {
  const ph = normPhone(phone);
  if (!ph) return null;
  await c.query('savepoint loyalty_award');
  try {
    const { rows: [s] } = await c.query('select enabled, kes_per_point from loyalty_settings where tenant_id=$1', [tenantId]);
    const points = s?.enabled ? Math.floor(Number(amount) / Math.max(1, Number(s.kes_per_point))) : 0;
    if (points <= 0) { await c.query('release savepoint loyalty_award'); return null; }
    const ins = await c.query(
      `insert into loyalty_ledger (tenant_id, phone, delta, reason, payment_id) values ($1,$2,$3,'purchase',$4)
       on conflict (payment_id) do nothing returning id`, [tenantId, ph, points, paymentId]);
    if (!ins.rows[0]) { await c.query('release savepoint loyalty_award'); return null; }
    const { rows: [a] } = await c.query(
      `insert into loyalty_accounts (tenant_id, phone, points, lifetime_points, last_earned_at) values ($1,$2,$3,$3,now())
       on conflict (tenant_id, phone) do update
         set points = loyalty_accounts.points + $3, lifetime_points = loyalty_accounts.lifetime_points + $3, last_earned_at = now()
       returning points`, [tenantId, ph, points]);
    await c.query('release savepoint loyalty_award');
    return { earned: points, total: a.points };
  } catch (e) {
    await c.query('rollback to savepoint loyalty_award').catch(() => {});
    console.warn('loyalty award skipped:', e.message);
    return null;
  }
}

/** The sentence added to the voucher SMS when points were earned. */
export const pointsLine = (r) => (r ? ` You earned ${plural(r.earned, 'loyalty point')} — total ${r.total}.` : '');

/** points by normalised phone, for a set of numbers; empty if the tables are not there yet. */
export async function pointsFor(pool, tenantId, phones) {
  const list = [...new Set(phones.map(normPhone).filter(Boolean))];
  if (!list.length) return new Map();
  try {
    const { rows } = await pool.query('select phone, points from loyalty_accounts where tenant_id=$1 and phone = any($2::text[])', [tenantId, list]);
    return new Map(rows.map((r) => [r.phone, r.points]));
  } catch { return new Map(); }
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function registerLoyalty(app, { pool, requirePermission, wrap }) {
  const guard = (fn) => wrap(async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  });

  app.get('/api/loyalty', requirePermission('loyalty.view'), guard(async (req, res) => {
    const t = req.tenant.id;
    const { rows: [s] } = await pool.query('select enabled, kes_per_point from loyalty_settings where tenant_id=$1', [t]);
    const { rows: rewards } = await pool.query(
      `select r.id, r.plan_id, r.points_cost, p.title as plan_title, p.price as plan_price
         from loyalty_rewards r join plans p on p.id = r.plan_id where r.tenant_id=$1 order by r.points_cost`, [t]);
    const { rows: members } = await pool.query(
      `select phone, points, lifetime_points, last_earned_at from loyalty_accounts where tenant_id=$1
        order by points desc, last_earned_at desc nulls last limit 2000`, [t]);
    res.json({ enabled: !!s?.enabled, kesPerPoint: s?.kes_per_point ?? 10, rewards, members });
  }));

  app.put('/api/loyalty/settings', requirePermission('loyalty.manage'), guard(async (req, res) => {
    const kes = Math.round(Number(req.body?.kesPerPoint));
    if (!(kes >= 1 && kes <= 100000)) throw new HttpError(400, 'Enter how many shillings earn one point (1 or more).');
    await pool.query(
      `insert into loyalty_settings (tenant_id, enabled, kes_per_point) values ($1,$2,$3)
       on conflict (tenant_id) do update set enabled = excluded.enabled, kes_per_point = excluded.kes_per_point`,
      [req.tenant.id, !!req.body?.enabled, kes]);
    res.json({ ok: true });
  }));

  app.post('/api/loyalty/rewards', requirePermission('loyalty.manage'), guard(async (req, res) => {
    const cost = Math.round(Number(req.body?.pointsCost));
    if (!(cost >= 1 && cost <= 10000000)) throw new HttpError(400, 'Enter how many points the reward costs.');
    const { rows: [plan] } = await pool.query("select id from plans where id=$1 and tenant_id=$2 and service='hotspot'", [req.body?.planId, req.tenant.id]);
    if (!plan) throw new HttpError(400, 'Pick a hotspot bundle for the reward.');
    const { rows: [r] } = await pool.query(
      'insert into loyalty_rewards (tenant_id, plan_id, points_cost) values ($1,$2,$3) returning id', [req.tenant.id, plan.id, cost]);
    res.json({ ok: true, id: r.id });
  }));

  app.delete('/api/loyalty/rewards/:id', requirePermission('loyalty.manage'), guard(async (req, res) => {
    const { rowCount } = await pool.query('delete from loyalty_rewards where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!rowCount) throw new HttpError(404, 'Not found');
    res.json({ ok: true });
  }));

  app.get('/api/loyalty/ledger', requirePermission('loyalty.view'), guard(async (req, res) => {
    const ph = normPhone(req.query.phone);
    if (!ph) throw new HttpError(400, 'Give a phone number.');
    const { rows } = await pool.query(
      `select delta, reason, note, created_at from loyalty_ledger where tenant_id=$1 and phone=$2 order by created_at desc, id desc limit 50`,
      [req.tenant.id, ph]);
    res.json(rows);
  }));

  /** Add or take away points by hand, with a note saying why. A balance never goes below zero. */
  app.post('/api/loyalty/adjust', requirePermission('loyalty.manage'), guard(async (req, res) => {
    const ph = normPhone(req.body?.phone);
    const delta = Math.round(Number(req.body?.delta));
    const note = String(req.body?.note ?? '').trim().slice(0, 200);
    if (!ph) throw new HttpError(400, 'Give a valid phone number.');
    if (!delta || Math.abs(delta) > 10000000) throw new HttpError(400, 'Enter a number of points to add or take away.');
    const out = await withTenant(req.tenant.id, async (c) => {
      await c.query('insert into loyalty_accounts (tenant_id, phone) values ($1,$2) on conflict do nothing', [req.tenant.id, ph]);
      const { rows: [a] } = await c.query('select points from loyalty_accounts where tenant_id=$1 and phone=$2 for update', [req.tenant.id, ph]);
      if (a.points + delta < 0) throw new HttpError(409, `They only have ${a.points} point(s).`);
      const { rows: [u] } = await c.query(
        `update loyalty_accounts set points = points + $3, lifetime_points = lifetime_points + greatest($3, 0)
          where tenant_id=$1 and phone=$2 returning points`, [req.tenant.id, ph, delta]);
      await c.query(
        `insert into loyalty_ledger (tenant_id, phone, delta, reason, note, created_by) values ($1,$2,$3,'adjust',$4,$5)`,
        [req.tenant.id, ph, delta, note || null, req.session?.staff_id ?? null]);
      return u.points;
    });
    res.json({ ok: true, points: out });
  }));

  /** Spend points on a reward: a free bundle, made into a code and texted to the visitor. */
  app.post('/api/loyalty/redeem', requirePermission('loyalty.manage'), guard(async (req, res) => {
    const ph = normPhone(req.body?.phone);
    if (!ph) throw new HttpError(400, 'Give a valid phone number.');
    const out = await withTenant(req.tenant.id, async (c) => {
      const { rows: [rw] } = await c.query(
        `select r.id, r.plan_id, r.points_cost, p.title from loyalty_rewards r join plans p on p.id = r.plan_id
          where r.id=$1 and r.tenant_id=$2`, [req.body?.rewardId, req.tenant.id]);
      if (!rw) throw new HttpError(404, 'That reward no longer exists.');
      const { rows: [a] } = await c.query('select points from loyalty_accounts where tenant_id=$1 and phone=$2 for update', [req.tenant.id, ph]);
      if (!a || a.points < rw.points_cost) throw new HttpError(409, `Not enough points: ${a?.points ?? 0} of the ${rw.points_cost} needed.`);
      // A free code whose clock starts when they first sign in, so it can be texted and used later.
      const v = await issueVoucherAccess(c, req.tenant.id, rw.plan_id, ph, null, { startOnLogin: true });
      const { rows: [u] } = await c.query(
        'update loyalty_accounts set points = points - $3 where tenant_id=$1 and phone=$2 returning points', [req.tenant.id, ph, rw.points_cost]);
      await c.query(
        `insert into loyalty_ledger (tenant_id, phone, delta, reason, voucher_id, note, created_by) values ($1,$2,$3,'redeem',$4,$5,$6)`,
        [req.tenant.id, ph, -rw.points_cost, v.id, rw.title, req.session?.staff_id ?? null]);
      return { code: v.code, title: rw.title, remaining: u.points };
    });

    const sms = await import('./sms.js');
    const org = await sms.orgVars(req.tenant.id);
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    const link = req.tenant.subdomain ? ` Tap to connect: https://${req.tenant.subdomain}.${root}/hotspot/login.html?code=${out.code}` : '';
    const body = `${org.company || req.tenant.name || 'WiFi'}: your reward is ready — a free ${out.title}. Your code is ${out.code}.${link} Points left: ${out.remaining}.`;
    const sent = await sms.send(req.tenant.id, ph, 'custom', { ...org, body }).catch(() => null);
    res.json({ ok: true, code: out.code, remaining: out.remaining, smsSent: sent?.ok === true });
  }));
}
