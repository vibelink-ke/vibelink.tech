import { issueVoucherAccess } from './radius.js';
import crypto from 'node:crypto';
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

/**
 * Spend points on a reward: checks the balance under a lock, makes the free code (its clock starts at first sign-in, so
 * it can be used later), takes the points off and writes the ledger row, all in one transaction. Used by staff
 * redeeming for someone and by a visitor redeeming for themselves.
 */
async function spendPoints(tenantId, ph, rewardId, staffId = null) {
  return withTenant(tenantId, async (c) => {
    const { rows: [rw] } = await c.query(
      `select r.id, r.plan_id, r.points_cost, p.title from loyalty_rewards r join plans p on p.id = r.plan_id
        where r.id=$1 and r.tenant_id=$2`, [rewardId, tenantId]);
    if (!rw) throw new HttpError(404, 'That reward no longer exists.');
    const { rows: [a] } = await c.query('select points from loyalty_accounts where tenant_id=$1 and phone=$2 for update', [tenantId, ph]);
    if (!a || a.points < rw.points_cost) throw new HttpError(409, `Not enough points: ${a?.points ?? 0} of the ${rw.points_cost} needed.`);
    const v = await issueVoucherAccess(c, tenantId, rw.plan_id, ph, null, { startOnLogin: true });
    const { rows: [u] } = await c.query(
      'update loyalty_accounts set points = points - $3 where tenant_id=$1 and phone=$2 returning points', [tenantId, ph, rw.points_cost]);
    await c.query(
      `insert into loyalty_ledger (tenant_id, phone, delta, reason, voucher_id, note, created_by) values ($1,$2,$3,'redeem',$4,$5,$6)`,
      [tenantId, ph, -rw.points_cost, v.id, rw.title, staffId]);
    return { code: v.code, title: rw.title, remaining: u.points };
  });
}

export function registerLoyalty(app, { pool, requirePermission, wrap }) {
  const guard = (fn) => wrap(async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  });

  app.get('/api/loyalty', requirePermission('loyalty.view'), guard(async (req, res) => {
    const t = req.tenant.id;
    const { rows: [s] } = await pool.query('select enabled, kes_per_point, self_serve from loyalty_settings where tenant_id=$1', [t]);
    const { rows: rewards } = await pool.query(
      `select r.id, r.plan_id, r.points_cost, p.title as plan_title, p.price as plan_price
         from loyalty_rewards r join plans p on p.id = r.plan_id where r.tenant_id=$1 order by r.points_cost`, [t]);
    const { rows: members } = await pool.query(
      `select phone, points, lifetime_points, last_earned_at from loyalty_accounts where tenant_id=$1
        order by points desc, last_earned_at desc nulls last limit 2000`, [t]);
    res.json({ enabled: !!s?.enabled, kesPerPoint: s?.kes_per_point ?? 10, selfServe: !!s?.self_serve, rewards, members });
  }));

  app.put('/api/loyalty/settings', requirePermission('loyalty.manage'), guard(async (req, res) => {
    const kes = Math.round(Number(req.body?.kesPerPoint));
    if (!(kes >= 1 && kes <= 100000)) throw new HttpError(400, 'Enter how many shillings earn one point (1 or more).');
    await pool.query(
      `insert into loyalty_settings (tenant_id, enabled, kes_per_point, self_serve) values ($1,$2,$3,$4)
       on conflict (tenant_id) do update set enabled = excluded.enabled, kes_per_point = excluded.kes_per_point, self_serve = excluded.self_serve`,
      [req.tenant.id, !!req.body?.enabled, kes, !!req.body?.selfServe]);
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
    const out = await spendPoints(req.tenant.id, ph, req.body?.rewardId, req.session?.staff_id ?? null);

    const sms = await import('./sms.js');
    const org = await sms.orgVars(req.tenant.id);
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    const link = req.tenant.subdomain ? ` Tap to connect: https://${req.tenant.subdomain}.${root}/hotspot/login.html?code=${out.code}` : '';
    const body = `${org.company || req.tenant.name || 'WiFi'}: your reward is ready — a free ${out.title}. Your code is ${out.code}.${link} Points left: ${out.remaining}.`;
    const sent = await sms.send(req.tenant.id, ph, 'custom', { ...org, body }).catch(() => null);
    res.json({ ok: true, code: out.code, remaining: out.remaining, smsSent: sent?.ok === true });
  }));
}

/** Whether visitors of this tenant may check and redeem their own points (the login page shows the panel only then). */
export async function selfServeOn(pool, tenantId) {
  try {
    const { rows: [r] } = await pool.query('select enabled, self_serve from loyalty_settings where tenant_id=$1', [tenantId]);
    return !!(r?.enabled && r?.self_serve);
  } catch { return false; }
}

// One-time codes and short sign-ins, in memory: a single API process is what runs here, and both are only minutes old.
const OTP_TTL_MS = 10 * 60 * 1000;
const otps = new Map();       // "tenant:phone" -> { code, exp, tries, sent: [timestamps] }
const sessions = new Map();   // token -> { tenantId, phone, exp }
const prune = () => {
  const now = Date.now();
  for (const [k, v] of otps) if (v.exp < now && (!v.sent.length || v.sent.at(-1) < now - 15 * 60 * 1000)) otps.delete(k);
  for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
};

/**
 * What a visitor does on the hotspot login page: enter their number, get a code by SMS, enter it, see their points and
 * spend them. The SMS code is what proves the number is theirs — without it anybody could spend somebody else's points
 * by typing their number. A code is only sent to a number that actually has points (so the tenant's SMS credit cannot
 * be drained by typing random numbers), at most three times per number per 15 minutes, and a code allows five tries.
 * Nothing about a balance is shown before the code is entered. Off unless the tenant switches it on.
 */
export function registerLoyaltyPublic(app, { pool, tenantByHost, wrap, smsLib = null }) {
  const tenantOf = async (req) => {
    const t = await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
    if (!t) throw new HttpError(404, 'Unknown network');
    if (!(await selfServeOn(pool, t.id))) throw new HttpError(404, 'Loyalty points are not available here.');
    return t;
  };
  const guard = (fn) => wrap(async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  });

  app.post('/hotspot/loyalty/otp', guard(async (req, res) => {
    prune();
    const t = await tenantOf(req);
    const ph = normPhone(req.body?.phone);
    if (!ph) throw new HttpError(400, 'Enter a valid phone number.');
    const generic = { ok: true, message: 'If that number has loyalty points, a code has been sent to it by SMS.' };

    const key = `${t.id}:${ph}`;
    const now = Date.now();
    const rec = otps.get(key) ?? { code: null, exp: 0, tries: 0, sent: [] };
    rec.sent = rec.sent.filter((x) => x > now - 15 * 60 * 1000);
    if (rec.sent.length >= 3) throw new HttpError(429, 'Too many codes requested for this number. Try again in a few minutes.');

    const { rows: [a] } = await pool.query('select points from loyalty_accounts where tenant_id=$1 and phone=$2', [t.id, ph]);
    if (!a || a.points <= 0) return res.json(generic);       // said the same either way

    rec.code = String(Math.floor(100000 + Math.random() * 900000));
    rec.exp = now + OTP_TTL_MS;
    rec.tries = 0;
    rec.sent.push(now);
    otps.set(key, rec);

    const sms = smsLib ?? await import('./sms.js');
    const org = await sms.orgVars(t.id);
    const r = await sms.send(t.id, ph, 'custom', { ...org, body: `${org.company || t.name || 'WiFi'}: your loyalty code is ${rec.code}. It works for 10 minutes. Do not share it.` }).catch(() => null);
    if (r?.ok === false) { rec.sent.pop(); throw new HttpError(502, 'We could not send the code. Try again shortly.'); }
    res.json(generic);
  }));

  app.post('/hotspot/loyalty/verify', guard(async (req, res) => {
    prune();
    const t = await tenantOf(req);
    const ph = normPhone(req.body?.phone);
    const code = String(req.body?.otp ?? '').trim();
    const rec = ph ? otps.get(`${t.id}:${ph}`) : null;
    if (!rec || !rec.code || rec.exp < Date.now()) throw new HttpError(400, 'That code has expired. Ask for a new one.');
    if (rec.tries >= 5) { rec.code = null; throw new HttpError(429, 'Too many wrong tries. Ask for a new code.'); }
    rec.tries += 1;
    if (code !== rec.code) throw new HttpError(400, 'That code is not right.');
    rec.code = null;

    const token = crypto.randomBytes(18).toString('base64url');
    sessions.set(token, { tenantId: t.id, phone: ph, exp: Date.now() + OTP_TTL_MS });
    res.json({ token, ...(await balanceFor(pool, t.id, ph)) });
  }));

  app.post('/hotspot/loyalty/redeem', guard(async (req, res) => {
    prune();
    const t = await tenantOf(req);
    const sess = sessions.get(String(req.body?.token ?? ''));
    if (!sess || sess.tenantId !== t.id || sess.exp < Date.now()) throw new HttpError(401, 'Your session ended. Get a new code to continue.');
    const out = await spendPoints(t.id, sess.phone, req.body?.rewardId, null);
    res.json({ ok: true, code: out.code, title: out.title, remaining: out.remaining });
  }));
}

async function balanceFor(pool, tenantId, ph) {
  const { rows: [a] } = await pool.query('select points from loyalty_accounts where tenant_id=$1 and phone=$2', [tenantId, ph]);
  const { rows: rewards } = await pool.query(
    `select r.id, r.points_cost, p.title from loyalty_rewards r join plans p on p.id = r.plan_id where r.tenant_id=$1 order by r.points_cost`, [tenantId]);
  return { points: a?.points ?? 0, rewards };
}
