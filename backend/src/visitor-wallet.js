import crypto from 'node:crypto';
import { withTenant } from './db.js';
import { issueVoucherAccess } from './radius.js';
import { normPhone } from './loyalty.js';

/**
 * A wallet for hotspot visitors: pay now, use it later.
 *
 * A visitor is known by their phone number. They put money in by M-Pesa (the same prompt, till or paybill a bundle is
 * bought with), and spend it on bundles whenever they connect, with no prompt and no waiting for a payment. Every
 * change to a balance leaves a row in the ledger, so a balance can always be explained.
 *
 * Putting money in needs no sign-in: the M-Pesa prompt goes to the number being topped up, and that number is the one
 * credited. Spending does: a phone number is not a secret, so the visitor proves the number is theirs with a code sent
 * to it by SMS, once per device. The device then holds a sign-in that lasts 60 days.
 *
 * On unless the tenant turns it off. Turning it off stops top-ups; money already in a wallet can still be spent.
 */

const SESSION_DAYS = 60;
const OTP_TTL_MS = 10 * 60 * 1000;
const otps = new Map();   // "tenant:phone" -> { code, exp, tries, sent: [timestamps] }
const prune = () => {
  const now = Date.now();
  for (const [k, v] of otps) if (v.exp < now && (!v.sent.length || v.sent.at(-1) < now - 15 * 60 * 1000)) otps.delete(k);
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const money = (n) => Math.round(Number(n) * 100) / 100;
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const isMac = (m) => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(m) && m !== '00:00:00:00:00:00';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * The tenant's wallet rules. The wallet is on unless the tenant has turned it off, so a tenant who has never opened the settings has it.
 * Off when the tables are not there yet, so nothing is offered that could not work.
 */
export async function walletSettings(pool, tenantId) {
  try {
    const { rows: [s] } = await pool.query('select enabled, min_topup, max_topup from visitor_wallet_settings where tenant_id=$1', [tenantId]);
    return { enabled: s ? !!s.enabled : true, minTopup: Number(s?.min_topup ?? 10), maxTopup: Number(s?.max_topup ?? 5000) };
  } catch { return { enabled: false, minTopup: 10, maxTopup: 5000 }; }
}

/**
 * Checks a top-up before the M-Pesa prompt goes out. Answers { amount } or { status, error }.
 * Used by POST /hotspot/buy, which sends the prompt through whichever gateway the tenant takes hotspot money on.
 */
export async function topupRequest(pool, tenantId, body) {
  const s = await walletSettings(pool, tenantId);
  if (!s.enabled) return { status: 404, error: 'The wallet is not available here.' };
  const amount = Math.round(Number(body?.amount));
  if (!(amount >= s.minTopup)) return { status: 400, error: `The least you can put in is ${s.minTopup}.` };
  if (amount > s.maxTopup) return { status: 400, error: `The most you can put in at once is ${s.maxTopup}.` };
  if (!normPhone(body?.phone)) return { status: 400, error: 'Enter a valid phone number.' };
  return { amount };
}

/** Marks the M-Pesa prompt just sent as a wallet top-up, so the money is put in the wallet when it arrives. */
export async function markTopup(pool, tenantId, checkoutId) {
  await pool.query(
    `update stk_requests set purpose = coalesce(purpose, '{}'::jsonb) || '{"wallet_topup": true}'::jsonb
      where checkout_id=$2 and (tenant_id=$1 or purpose->>'tenant_id'=$1::text)`, [tenantId, String(checkoutId)]);
}

/**
 * Put an arrived top-up into the wallet. Runs inside the payment's own transaction (payments/apply.js): if this fails,
 * the payment is kept as unmatched with the reason, for a person to deal with. A payment is credited once.
 */
export async function creditTopup(c, tenantId, { paymentId, phone, amount }) {
  const ph = normPhone(phone);
  if (!ph) throw new Error('wallet top-up with no phone number to credit');
  const amt = money(amount);
  if (!(amt > 0)) throw new Error('wallet top-up with no amount');
  const { rows: [w] } = await c.query(
    `insert into visitor_wallets (tenant_id, phone, balance) values ($1,$2,$3)
     on conflict (tenant_id, phone) do update set balance = visitor_wallets.balance + $3, updated_at = now()
     returning balance`, [tenantId, ph, amt]);
  await c.query(
    `insert into visitor_wallet_ledger (tenant_id, phone, delta, balance_after, reason, payment_id) values ($1,$2,$3,$4,'topup',$5)`,
    [tenantId, ph, amt, w.balance, paymentId]);
  return { phone: ph, amount: amt, balance: Number(w.balance) };
}

/** Buy a bundle with wallet money: balance checked under a lock, the code made, the money taken and the ledger written, all in one transaction. */
async function spend(tenantId, ph, { planId, mac, routerId }) {
  return withTenant(tenantId, async (c) => {
    const { rows: [plan] } = await c.query(
      "select id, title, price from plans where id=$1 and tenant_id=$2 and service='hotspot' and active", [planId, tenantId]);
    if (!plan) throw new HttpError(404, 'That bundle is no longer on sale.');
    const price = money(plan.price);
    const { rows: [w] } = await c.query('select balance from visitor_wallets where tenant_id=$1 and phone=$2 for update', [tenantId, ph]);
    const balance = Number(w?.balance ?? 0);
    if (balance < price) throw new HttpError(409, `Not enough in your wallet: you have ${balance} and this bundle costs ${price}. Top up ${money(price - balance)} more.`);

    // The phone buying, when the login page told us which one it is: the code is tied to it so the router signs it in by itself.
    // A device that already has a running code is left as it is (the address comes from a public request).
    let device = isMac(String(mac ?? '').toUpperCase()) ? String(mac).toUpperCase() : null;
    if (device) {
      const { rows: [busy] } = await c.query(
        "select 1 from vouchers where tenant_id=$1 and mac=$2::macaddr and status='in_use' and expires_at > now() limit 1", [tenantId, device]);
      if (busy) device = null;
    }
    const v = await issueVoucherAccess(c, tenantId, plan.id, ph, device);
    if (routerId) {
      const { rows: [r] } = await c.query('select id from routers where id::text=$1 and tenant_id=$2', [String(routerId), tenantId]);
      if (r) await c.query('update vouchers set router_id=$2 where id=$1', [v.id, r.id]);
    }
    const { rows: [u] } = await c.query(
      'update visitor_wallets set balance = balance - $3, updated_at = now() where tenant_id=$1 and phone=$2 returning balance', [tenantId, ph, price]);
    await c.query(
      `insert into visitor_wallet_ledger (tenant_id, phone, delta, balance_after, reason, voucher_id, plan_id, note)
       values ($1,$2,$3,$4,'purchase',$5,$6,$7)`, [tenantId, ph, -price, u.balance, v.id, plan.id, plan.title]);
    return { code: v.code, title: plan.title, price, balance: Number(u.balance), expiresAt: v.expires_at ?? null };
  });
}

const guardWith = (wrap) => (fn) => wrap(async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** Staff side: the rules, every wallet and its history, and corrections by hand. */
export function registerVisitorWallet(app, { pool, requirePermission, wrap }) {
  const guard = guardWith(wrap);

  app.get('/api/visitor-wallets', requirePermission('visitor_wallets.view'), guard(async (req, res) => {
    const t = req.tenant.id;
    const s = await walletSettings(pool, t);
    const { rows: wallets } = await pool.query(
      `select w.phone, w.balance, w.updated_at,
              coalesce((select sum(l.delta) from visitor_wallet_ledger l where l.tenant_id=w.tenant_id and l.phone=w.phone and l.reason='topup'), 0) as paid_in,
              coalesce((select -sum(l.delta) from visitor_wallet_ledger l where l.tenant_id=w.tenant_id and l.phone=w.phone and l.reason='purchase'), 0) as spent
         from visitor_wallets w where w.tenant_id=$1 order by w.updated_at desc limit 2000`, [t]);
    const { rows: [sum] } = await pool.query('select coalesce(sum(balance),0) as held, count(*)::int as n from visitor_wallets where tenant_id=$1', [t]);
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    res.json({
      ...s, wallets, held: Number(sum.held), count: sum.n,
      link: req.tenant.subdomain ? `https://${req.tenant.subdomain}.${root}/hotspot/wallet` : null,
    });
  }));

  app.put('/api/visitor-wallets/settings', requirePermission('visitor_wallets.manage'), guard(async (req, res) => {
    const min = Math.round(Number(req.body?.minTopup));
    const max = Math.round(Number(req.body?.maxTopup));
    if (!(min >= 1)) throw new HttpError(400, 'Enter the least a visitor can put in (1 or more).');
    if (!(max >= min && max <= 150000)) throw new HttpError(400, 'The most a visitor can put in at once must be at least the smallest amount, and no more than 150,000.');
    await pool.query(
      `insert into visitor_wallet_settings (tenant_id, enabled, min_topup, max_topup) values ($1,$2,$3,$4)
       on conflict (tenant_id) do update set enabled = excluded.enabled, min_topup = excluded.min_topup, max_topup = excluded.max_topup`,
      [req.tenant.id, !!req.body?.enabled, min, max]);
    res.json({ ok: true });
  }));

  app.get('/api/visitor-wallets/ledger', requirePermission('visitor_wallets.view'), guard(async (req, res) => {
    const ph = normPhone(req.query.phone);
    if (!ph) throw new HttpError(400, 'Give a phone number.');
    const { rows } = await pool.query(
      `select l.delta, l.balance_after, l.reason, l.note, l.created_at, p.provider_ref as mpesa_code, v.code as voucher_code, s.name as staff_name
         from visitor_wallet_ledger l
         left join payments p on p.id = l.payment_id
         left join vouchers v on v.id = l.voucher_id
         left join staff s on s.id = l.created_by
        where l.tenant_id=$1 and l.phone=$2 order by l.created_at desc, l.id desc limit 100`, [req.tenant.id, ph]);
    res.json(rows);
  }));

  /** Add or take away money by hand, with a note saying why (a refund given in cash, a top-up that went to the wrong number). Never below zero. */
  app.post('/api/visitor-wallets/adjust', requirePermission('visitor_wallets.manage'), guard(async (req, res) => {
    const ph = normPhone(req.body?.phone);
    const delta = money(req.body?.delta);
    const note = String(req.body?.note ?? '').trim().slice(0, 200);
    if (!ph) throw new HttpError(400, 'Give a valid phone number.');
    if (!delta || Math.abs(delta) > 150000) throw new HttpError(400, 'Enter an amount to add or take away.');
    if (!note) throw new HttpError(400, 'Say why, so the history explains it.');
    const balance = await withTenant(req.tenant.id, async (c) => {
      await c.query('insert into visitor_wallets (tenant_id, phone) values ($1,$2) on conflict do nothing', [req.tenant.id, ph]);
      const { rows: [w] } = await c.query('select balance from visitor_wallets where tenant_id=$1 and phone=$2 for update', [req.tenant.id, ph]);
      if (Number(w.balance) + delta < 0) throw new HttpError(409, `They only have ${Number(w.balance)} in the wallet.`);
      const { rows: [u] } = await c.query(
        'update visitor_wallets set balance = balance + $3, updated_at = now() where tenant_id=$1 and phone=$2 returning balance', [req.tenant.id, ph, delta]);
      await c.query(
        `insert into visitor_wallet_ledger (tenant_id, phone, delta, balance_after, reason, note, created_by) values ($1,$2,$3,$4,'adjust',$5,$6)`,
        [req.tenant.id, ph, delta, u.balance, note, req.session?.staff_id ?? null]);
      return Number(u.balance);
    });
    res.json({ ok: true, balance });
  }));
}

/** What the visitor's own page talks to. Everything is scoped to the tenant the address belongs to. */
export function registerVisitorWalletPublic(app, { pool, tenantByHost, wrap, loginLimiter, pollLimiter, smsLib = null }) {
  const guard = guardWith(wrap);
  const pass = (req, res, next) => next();
  const slow = loginLimiter ?? pass;
  const poll = pollLimiter ?? pass;
  const tenantOf = async (req) => {
    const t = await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
    if (!t) throw new HttpError(404, 'Unknown network');
    return t;
  };
  const apiBaseOf = (t) => {
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    return t.subdomain ? `https://${t.subdomain}.${root}` : '';
  };
  /** The signed-in visitor of this request, or a 401. */
  const visitorOf = async (req, t) => {
    const token = String(req.body?.token ?? '');
    if (token.length < 20) throw new HttpError(401, 'Sign in to continue.');
    const { rows: [s] } = await pool.query(
      'select phone from visitor_wallet_sessions where token_hash=$1 and tenant_id=$2 and expires_at > now()', [hashToken(token), t.id]);
    if (!s) throw new HttpError(401, 'Your sign-in has ended. Sign in again.');
    return s.phone;
  };
  const account = async (t, ph, routerId) => {
    const { rows: [w] } = await pool.query('select balance from visitor_wallets where tenant_id=$1 and phone=$2', [t.id, ph]);
    const { rows: plans } = await pool.query(
      `select id, title, price, duration_min from plans p
        where tenant_id=$1 and service='hotspot' and active and visible and device_class <> 'tv'
          and (not exists (select 1 from plan_sites ps where ps.plan_id = p.id)
               or exists (select 1 from plan_sites ps where ps.plan_id = p.id and ps.router_id::text = $2))
        order by price limit 40`, [t.id, routerId ? String(routerId) : '']);
    const { rows: history } = await pool.query(
      `select l.delta, l.balance_after, l.reason, l.note, l.created_at, v.code, v.status as code_status, v.expires_at
         from visitor_wallet_ledger l left join vouchers v on v.id = l.voucher_id
        where l.tenant_id=$1 and l.phone=$2 order by l.created_at desc, l.id desc limit 20`, [t.id, ph]);
    const s = await walletSettings(pool, t.id);
    return { phone: ph, balance: Number(w?.balance ?? 0), plans, history, topups: s.enabled, minTopup: s.minTopup, maxTopup: s.maxTopup };
  };

  app.get('/hotspot/wallet', wrap(async (req, res) => {
    const t = await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
    if (!t) return res.status(404).type('text').send('Unknown network');
    const s = await walletSettings(pool, t.id);
    res.type('html').send(walletPage({
      company: t.name ?? 'WiFi', currency: String(t.currency ?? 'KES').trim(), apiBase: apiBaseOf(t),
      topups: s.enabled, minTopup: s.minTopup, maxTopup: s.maxTopup,
    }));
  }));

  // So the page can be put on the phone's home screen and opened like an app.
  app.get('/hotspot/wallet.webmanifest', wrap(async (req, res) => {
    const t = await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
    const name = `${t?.name ?? 'WiFi'} wallet`;
    res.type('application/manifest+json').send(JSON.stringify({
      name, short_name: name.slice(0, 12), start_url: '/hotspot/wallet', scope: '/hotspot/', display: 'standalone',
      background_color: '#f5f6f3', theme_color: '#0f7a5f',
      icons: [{ src: '/api/public/favicon', sizes: 'any', purpose: 'any' }],
    }));
  }));

  app.post('/hotspot/wallet/otp', slow, guard(async (req, res) => {
    prune();
    const t = await tenantOf(req);
    const ph = normPhone(req.body?.phone);
    if (!ph) throw new HttpError(400, 'Enter a valid phone number.');
    const generic = { ok: true, message: 'If that number has a wallet, a code has been sent to it by SMS.' };

    const key = `${t.id}:${ph}`;
    const now = Date.now();
    const rec = otps.get(key) ?? { code: null, exp: 0, tries: 0, sent: [] };
    rec.sent = rec.sent.filter((x) => x > now - 15 * 60 * 1000);
    if (rec.sent.length >= 3) throw new HttpError(429, 'Too many codes requested for this number. Try again in a few minutes.');

    // Only a number that has put money in is texted, so typing random numbers cannot use up the SMS balance. The answer is the same either way.
    const { rows: [w] } = await pool.query('select 1 from visitor_wallets where tenant_id=$1 and phone=$2', [t.id, ph]);
    if (!w) return res.json(generic);

    rec.code = String(crypto.randomInt(100000, 1000000));
    rec.exp = now + OTP_TTL_MS;
    rec.tries = 0;
    rec.sent.push(now);
    otps.set(key, rec);

    const sms = smsLib ?? await import('./sms.js');
    const org = await sms.orgVars(t.id);
    const r = await sms.send(t.id, ph, 'custom', { ...org, body: `${org.company || t.name || 'WiFi'}: your wallet code is ${rec.code}. It works for 10 minutes. Do not share it.` }).catch(() => null);
    if (r?.ok === false) { rec.sent.pop(); throw new HttpError(502, 'We could not send the code. Try again shortly.'); }
    res.json(generic);
  }));

  app.post('/hotspot/wallet/verify', slow, guard(async (req, res) => {
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

    const token = crypto.randomBytes(24).toString('base64url');
    await pool.query(
      `insert into visitor_wallet_sessions (token_hash, tenant_id, phone, expires_at) values ($1,$2,$3, now() + make_interval(days => $4))`,
      [hashToken(token), t.id, ph, SESSION_DAYS]);
    pool.query('delete from visitor_wallet_sessions where expires_at < now()').catch(() => {});
    res.json({ token, ...(await account(t, ph, req.body?.routerId)) });
  }));

  app.post('/hotspot/wallet/me', guard(async (req, res) => {
    const t = await tenantOf(req);
    const ph = await visitorOf(req, t);
    res.json(await account(t, ph, req.body?.routerId));
  }));

  app.post('/hotspot/wallet/buy', slow, guard(async (req, res) => {
    const t = await tenantOf(req);
    const ph = await visitorOf(req, t);
    const out = await spend(t.id, ph, { planId: String(req.body?.planId ?? ''), mac: req.body?.mac, routerId: req.body?.routerId });
    res.json({ ok: true, ...out });
  }));

  app.post('/hotspot/wallet/signout', guard(async (req, res) => {
    const t = await tenantOf(req);
    await pool.query('delete from visitor_wallet_sessions where token_hash=$1 and tenant_id=$2', [hashToken(String(req.body?.token ?? '')), t.id]);
    res.json({ ok: true });
  }));

  /** Has the top-up arrived? Polled by the page while the visitor enters their M-Pesa PIN. Says nothing but the state of the one prompt it started. */
  app.get('/hotspot/wallet/topup/:checkoutId', poll, guard(async (req, res) => {
    const t = await tenantOf(req);
    const { rows: [r] } = await pool.query(
      `select status, result_desc, amount from stk_requests where checkout_id=$2 and (tenant_id=$1 or purpose->>'tenant_id'=$1::text)`,
      [t.id, req.params.checkoutId]);
    if (!r) return res.json({ status: 'unknown' });
    const { rows: [done] } = await pool.query(
      `select 1 from payments p join visitor_wallet_ledger l on l.payment_id = p.id
        where p.tenant_id=$1 and p.payload->>'checkoutId'=$2 limit 1`, [t.id, req.params.checkoutId]);
    res.json({ status: r.status, detail: r.result_desc ?? null, amount: Number(r.amount), credited: !!done });
  }));
}

/** The visitor's page: one file, no build step, works on the walled garden and from anywhere else, and can be added to the home screen. */
export function walletPage({ company = 'WiFi', currency = 'KES', apiBase = '', topups = true, minTopup = 10, maxTopup = 5000 }) {
  const cfg = JSON.stringify({ api: apiBase, cur: String(currency || 'KES').slice(0, 3).toUpperCase(), topups, min: minTopup, max: maxTopup }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f7a5f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<title>${esc(company)} wallet</title>
<link rel="manifest" href="${esc(apiBase)}/hotspot/wallet.webmanifest">
${apiBase ? `<link rel="icon" href="${esc(apiBase)}/api/public/favicon"><link rel="apple-touch-icon" href="${esc(apiBase)}/api/public/favicon">` : ''}
<style>
  :root { --ink:#161a17; --muted:#6f766b; --line:rgba(128,128,128,.25); --green:#0f7a5f; --bg:#f5f6f3; --card:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink); padding:16px;
         font:14.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:440px; margin:0 auto; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:10px; }
  h1 { margin:4px 0 2px; font-size:19px; }
  h2 { margin:0 0 4px; font-size:15.5px; }
  .sub { margin:0 0 12px; color:var(--muted); font-size:13.5px; }
  label { display:block; margin:10px 0 4px; font-size:12.5px; font-weight:600; color:var(--muted); }
  input { width:100%; padding:10px 11px; font-size:16px; border:1px solid var(--line); border-radius:9px; background:#fafbf9; color:var(--ink); }
  button { width:100%; margin-top:10px; padding:11px; font-size:15px; font-weight:600; color:#fff; background:var(--green);
           border:0; border-radius:9px; cursor:pointer; }
  button.plain { color:var(--green); background:transparent; border:1px solid var(--line); }
  button.small { width:auto; margin:0; padding:8px 14px; font-size:13.5px; white-space:nowrap; }
  button:disabled { opacity:.55; cursor:default; }
  .bal { background:var(--green); color:#fff; border:0; }
  .bal .n { font-size:32px; font-weight:700; letter-spacing:-.02em; }
  .bal .who { opacity:.85; font-size:13px; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:0; }
  .t { font-weight:600; }
  .m { color:var(--muted); font-size:12.5px; }
  .note { margin:10px 0 0; font-size:13.5px; color:var(--muted); }
  .err { margin:10px 0 0; padding:9px 11px; border-radius:8px; font-size:14px; color:#8a2d16; background:#fdece5; border:1px solid #f3c7b6; }
  .ok { margin:10px 0 0; padding:9px 11px; border-radius:8px; font-size:14px; color:#0b5a46; background:#e8f3ee; border:1px solid #bfe0d2; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .chips button { width:auto; margin:0; padding:7px 12px; font-size:13.5px; }
  .code { font:700 22px/1.2 ui-monospace,Menlo,Consolas,monospace; letter-spacing:.06em; }
  a.btn { display:block; margin-top:10px; padding:11px; text-align:center; font-weight:600; color:#fff; background:var(--green); border-radius:9px; text-decoration:none; }
  .foot { text-align:center; font-size:12.5px; color:var(--muted); margin:14px 0; }
  .foot a { color:var(--green); }
  .hide { display:none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(company)} wallet</h1>
  <p class="sub">Pay now, use it whenever you connect. No M-Pesa prompt each time.</p>

  <div id="signedIn" class="hide">
    <div class="card bal">
      <div class="who" id="who"></div>
      <div class="n" id="balance"></div>
      <div class="who">in your wallet</div>
    </div>

    <div class="card hide" id="bought">
      <h2 id="boughtTitle"></h2>
      <p class="sub">Your code</p>
      <div class="code" id="boughtCode"></div>
      <a class="btn" id="boughtLink" href="#">Connect now</a>
      <p class="note">On the WiFi already? Tap Connect now. Otherwise keep this code and enter it on the WiFi sign-in page.</p>
    </div>

    <div class="card">
      <h2>Buy a bundle</h2>
      <p class="sub">Paid from your wallet.</p>
      <div id="plans"></div>
      <div id="buyMsg"></div>
    </div>

    <div class="card" id="topupIn">
      <h2>Top up</h2>
      <p class="sub">An M-Pesa prompt comes to your phone.</p>
      <label for="amtIn">Amount (<span class="cur"></span>)</label>
      <input id="amtIn" type="number" inputmode="numeric" min="1">
      <div class="chips" id="chipsIn"></div>
      <button id="payIn">Top up with M-Pesa</button>
      <div id="payInMsg"></div>
    </div>

    <div class="card">
      <h2>History</h2>
      <div id="history"></div>
    </div>
    <div class="foot"><a href="#" id="signOut">Sign out on this phone</a></div>
  </div>

  <div id="signedOut" class="hide">
    <div class="card" id="topupOut">
      <h2>Put money in</h2>
      <p class="sub">Enter your number and an amount. An M-Pesa prompt comes to that phone, and the money is kept in its wallet.</p>
      <label for="phoneOut">Your phone number (M-Pesa)</label>
      <input id="phoneOut" type="tel" inputmode="tel" placeholder="07xx xxx xxx" autocomplete="tel" maxlength="20">
      <label for="amtOut">Amount (<span class="cur"></span>)</label>
      <input id="amtOut" type="number" inputmode="numeric" min="1">
      <div class="chips" id="chipsOut"></div>
      <button id="payOut">Pay with M-Pesa</button>
      <div id="payOutMsg"></div>
    </div>

    <div class="card">
      <h2>Use your wallet</h2>
      <p class="sub">Sign in with the number you paid with. We text it a code, once on this phone.</p>
      <div id="step1">
        <label for="phoneIn">Your phone number</label>
        <input id="phoneIn" type="tel" inputmode="tel" placeholder="07xx xxx xxx" autocomplete="tel" maxlength="20">
        <button id="sendCode">Send me a code</button>
      </div>
      <div id="step2" class="hide">
        <label for="otp">The 6-digit code we texted you</label>
        <input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
        <button id="verify">Sign in</button>
        <button class="plain" id="back">Use another number</button>
      </div>
      <div id="signMsg"></div>
    </div>
  </div>

  <div class="foot">Add this page to your home screen to open it like an app.</div>
</div>
<script>
(function () {
  var C = ${cfg};
  var $ = function (id) { return document.getElementById(id); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} } };
  var q = new URLSearchParams(location.search);
  // Which site and which phone, when the WiFi sign-in page sent the visitor here. Kept for this visit only (it survives a reload, not a new
  // opening of the page): a code bought for a known phone starts running at once, which is wrong for somebody buying from home for later.
  var visit = { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
                set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };
  var routerId = q.get('router') || visit.get('vw_router') || '';
  var mac = (q.get('mac') || visit.get('vw_mac') || '').toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) mac = '';
  if (q.get('router')) visit.set('vw_router', routerId);
  if (q.get('mac') && mac) visit.set('vw_mac', mac);
  var token = store.get('vw_token');
  var me = null;

  var money = function (n) { return C.cur + ' ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 }); };
  var shown = function (p) { p = String(p || ''); return p.indexOf('254') === 0 ? '0' + p.slice(3) : p; };
  var msg = function (el, kind, text) { el.innerHTML = ''; if (!text) return; var d = document.createElement('div'); d.className = kind; d.textContent = text; el.appendChild(d); };
  var call = function (method, path, body) {
    return fetch(C.api + path, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; } return j; }); });
  };
  var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };
  each('.cur', function (el) { el.textContent = C.cur; });

  var chips = function (boxId, inputId) {
    var box = $(boxId);
    [50, 100, 200, 500, 1000].filter(function (a) { return a >= C.min && a <= C.max; }).forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'plain'; b.textContent = a;
      b.onclick = function () { $(inputId).value = a; }; box.appendChild(b);
    });
  };
  chips('chipsIn', 'amtIn'); chips('chipsOut', 'amtOut');
  if (!C.topups) {
    $('topupIn').className = 'card hide';
    $('topupOut').innerHTML = '<h2>Put money in</h2><p class="sub">Top-ups are not open here at the moment. Money already in a wallet can still be used.</p>';
  }

  var when = function (iso) { return new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var connectUrl = function (code) { return C.api + '/hotspot/login.html?code=' + encodeURIComponent(code) + (routerId ? '&siteRouter=' + encodeURIComponent(routerId) : '') + (mac ? '&mac=' + encodeURIComponent(mac) : ''); };

  function render() {
    $('signedIn').className = me ? '' : 'hide';
    $('signedOut').className = me ? 'hide' : '';
    if (!me) return;
    $('who').textContent = shown(me.phone);
    $('balance').textContent = money(me.balance);
    var plans = $('plans'); plans.innerHTML = '';
    if (!me.plans.length) plans.innerHTML = '<p class="note">No bundles on sale right now.</p>';
    me.plans.forEach(function (p) {
      var row = document.createElement('div'); row.className = 'row';
      var left = document.createElement('div');
      var t = document.createElement('div'); t.className = 't'; t.textContent = p.title;
      var m = document.createElement('div'); m.className = 'm';
      var short = Number(p.price) - me.balance;
      m.textContent = money(p.price) + (short > 0 ? ' · top up ' + money(short) + ' more' : '');
      left.appendChild(t); left.appendChild(m);
      var b = document.createElement('button'); b.className = 'small'; b.textContent = 'Buy'; b.disabled = short > 0;
      b.onclick = function () { buy(p, b); };
      row.appendChild(left); row.appendChild(b); plans.appendChild(row);
    });
    var h = $('history'); h.innerHTML = '';
    if (!me.history.length) h.innerHTML = '<p class="note">Nothing yet.</p>';
    me.history.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'row';
      var left = document.createElement('div');
      var t = document.createElement('div'); t.className = 't';
      t.textContent = r.reason === 'topup' ? 'Top-up' : r.reason === 'purchase' ? (r.note || 'Bundle') : 'Adjusted' + (r.note ? ': ' + r.note : '');
      var m = document.createElement('div'); m.className = 'm'; m.textContent = when(r.created_at);
      left.appendChild(t); left.appendChild(m);
      if (r.code && (r.code_status === 'unused' || r.code_status === 'in_use')) {
        var a = document.createElement('a'); a.href = connectUrl(r.code); a.textContent = 'Code ' + r.code + ' · connect'; a.style.color = '#0f7a5f'; a.style.fontSize = '12.5px';
        left.appendChild(a);
      }
      var amt = document.createElement('div'); amt.className = 't'; amt.style.whiteSpace = 'nowrap';
      amt.style.color = Number(r.delta) < 0 ? '#8a2d16' : '#0f7a5f';
      amt.textContent = (Number(r.delta) > 0 ? '+' : '') + Number(r.delta).toLocaleString('en-KE');
      row.appendChild(left); row.appendChild(amt); h.appendChild(row);
    });
  }

  function refresh() {
    if (!token) { me = null; render(); return Promise.resolve(); }
    return call('POST', '/hotspot/wallet/me', { token: token, routerId: routerId }).then(function (j) { me = j; render(); })
      .catch(function (e) { if (e.status === 401) { token = null; store.set('vw_token', null); } me = null; render(); });
  }

  function buy(p, btn) {
    if (!window.confirm('Buy ' + p.title + ' for ' + money(p.price) + ' from your wallet?')) return;
    btn.disabled = true; msg($('buyMsg'), '', '');
    call('POST', '/hotspot/wallet/buy', { token: token, planId: p.id, mac: mac, routerId: routerId }).then(function (j) {
      $('bought').className = 'card';
      $('boughtTitle').textContent = j.title + ' is ready';
      $('boughtCode').textContent = j.code;
      $('boughtLink').href = connectUrl(j.code);
      window.scrollTo(0, 0);
      return refresh();
    }).catch(function (e) { btn.disabled = false; msg($('buyMsg'), 'err', e.message); if (e.status === 401) refresh(); });
  }

  // One top-up at a time: send the prompt, then ask every few seconds whether the money has arrived.
  function topup(phone, amountEl, btn, out) {
    var amount = Math.round(Number(amountEl.value));
    if (!phone) return msg(out, 'err', 'Enter your phone number.');
    if (!(amount >= C.min)) return msg(out, 'err', 'The least you can put in is ' + money(C.min) + '.');
    if (amount > C.max) return msg(out, 'err', 'The most you can put in at once is ' + money(C.max) + '.');
    btn.disabled = true; msg(out, 'ok', 'Sending the M-Pesa prompt…');
    call('POST', '/hotspot/buy', { wallet: true, phone: phone, amount: amount, routerId: routerId }).then(function (j) {
      if (j.redirectUrl) { location.href = j.redirectUrl; return; }
      msg(out, 'ok', j.note || 'Check your phone and enter your M-Pesa PIN.');
      var tries = 0;
      var tick = function () {
        tries += 1;
        call('GET', '/hotspot/wallet/topup/' + encodeURIComponent(j.checkoutId)).then(function (s) {
          if (s.credited) {
            btn.disabled = false; amountEl.value = '';
            if (token) { msg(out, 'ok', money(amount) + ' added to your wallet.'); return refresh(); }
            msg(out, 'ok', money(amount) + ' is in the wallet of ' + phone + '. Sign in below to use it.');
            $('phoneIn').value = phone;
            return;
          }
          if (s.status === 'failed') { btn.disabled = false; return msg(out, 'err', 'The payment did not go through' + (s.detail ? ': ' + s.detail : '.') ); }
          if (tries >= 50) { btn.disabled = false; return msg(out, 'err', 'We have not seen the payment yet. If M-Pesa took the money it will be added by itself; open this page again in a minute.'); }
          setTimeout(tick, 3000);
        }).catch(function () { if (tries >= 50) { btn.disabled = false; return; } setTimeout(tick, 4000); });
      };
      setTimeout(tick, 4000);
    }).catch(function (e) { btn.disabled = false; msg(out, 'err', e.message); });
  }
  $('payOut').onclick = function () { topup($('phoneOut').value.trim(), $('amtOut'), $('payOut'), $('payOutMsg')); };
  $('payIn').onclick = function () { topup(shown(me.phone), $('amtIn'), $('payIn'), $('payInMsg')); };

  $('sendCode').onclick = function () {
    var phone = $('phoneIn').value.trim();
    if (!phone) return msg($('signMsg'), 'err', 'Enter your phone number.');
    $('sendCode').disabled = true;
    call('POST', '/hotspot/wallet/otp', { phone: phone }).then(function (j) {
      $('step1').className = 'hide'; $('step2').className = ''; msg($('signMsg'), 'ok', j.message); $('otp').focus();
    }).catch(function (e) { msg($('signMsg'), 'err', e.message); }).then(function () { $('sendCode').disabled = false; });
  };
  $('back').onclick = function () { $('step2').className = 'hide'; $('step1').className = ''; msg($('signMsg'), '', ''); };
  $('verify').onclick = function () {
    $('verify').disabled = true;
    call('POST', '/hotspot/wallet/verify', { phone: $('phoneIn').value.trim(), otp: $('otp').value.trim(), routerId: routerId }).then(function (j) {
      token = j.token; store.set('vw_token', token); me = j; $('otp').value = ''; msg($('signMsg'), '', '');
      $('step2').className = 'hide'; $('step1').className = ''; render();
    }).catch(function (e) { msg($('signMsg'), 'err', e.message); }).then(function () { $('verify').disabled = false; });
  };
  $('signOut').onclick = function (ev) {
    ev.preventDefault();
    if (!window.confirm('Sign out on this phone? Your money stays in the wallet.')) return;
    call('POST', '/hotspot/wallet/signout', { token: token }).catch(function () {});
    token = null; store.set('vw_token', null); me = null; render();
  };

  refresh();
})();
</script>
</body>
</html>`;
}
