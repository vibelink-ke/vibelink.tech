import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { withTenant } from './db.js';
import { issueVoucherAccess } from './radius.js';
import { normPhone } from './loyalty.js';
import { speedPanel } from './speedtest.js';

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

const lastNine = (p) => { const d = String(p ?? '').replace(/[^0-9]/g, ''); return d.length >= 9 ? d.slice(-9) : null; };
const shownPhone = (p) => (String(p ?? '').startsWith('254') ? `0${String(p).slice(3)}` : String(p ?? ''));

/**
 * The home (PPPoE or static) account a phone number belongs to, when it belongs to exactly one. A number on two accounts
 * (a landlord's, say) gets none: paying from the wrong account would be worse than not offering it.
 */
export async function homeAccountFor(q, tenantId, phone) {
  const n = lastNine(phone);
  if (!n) return null;
  const { rows } = await q.query(
    `select account_code, min(name) as name, (array_agg(id order by id))[1] as subscriber_id from subscribers
      where tenant_id=$1 and service <> 'hotspot' and account_code is not null
        and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = $2
      group by account_code`, [tenantId, n]);
  return rows.length === 1 ? rows[0] : null;
}

/** What a home account can spend: its pooled wallet less what its lines still owe on invoices. */
export async function accountAvailable(q, tenantId, accountCode, lock = false) {
  if (lock) {
    // The same row lock a payment settling on this account takes (payments/apply.js), so the two never interleave.
    await q.query(
      `insert into account_wallets (tenant_id, account_code, balance) values ($1,$2,0)
       on conflict (tenant_id, account_code) do update set balance = account_wallets.balance`, [tenantId, accountCode]);
  }
  const { rows: [w] } = await q.query(`select balance from account_wallets where tenant_id=$1 and account_code=$2${lock ? ' for update' : ''}`, [tenantId, accountCode]);
  const { rows: [o] } = await q.query(
    `select coalesce(sum(i.amount - i.paid), 0) as owed from invoices i join subscribers s on s.id = i.subscriber_id
      where s.tenant_id=$1 and s.account_code=$2 and i.status in ('open','partial')`, [tenantId, accountCode]);
  return { balance: Number(w?.balance ?? 0), available: money(Number(w?.balance ?? 0) - Number(o?.owed ?? 0)) };
}

/**
 * Buy a bundle with money already held: from the visitor's own wallet, or from the home account their number belongs to.
 * The balance is checked under a lock, the code made, the money taken and the history written, all in one transaction.
 *
 * buyer: the signed-in phone (254...), or null when a home customer buys from their portal.
 * account: { account_code, subscriber_id } when paying from a home account.
 * ownPhone: the home customer's own number, when buyer is null.
 * toPhone: someone else's number, for a bundle sent to them. Their code waits for them to sign in, and is texted to them.
 */
export async function spend(tenantId, { buyer = null, account = null, planId, mac = null, routerId = null, toPhone = null, ownPhone = null, by = null }) {
  const to = toPhone ? normPhone(toPhone) : buyer;
  if (toPhone && !to) throw new HttpError(400, 'Enter the phone number to send the bundle to.');
  if (!to) throw new HttpError(400, 'There is no phone number on this account to send the code to. Enter one.');
  // A bundle for any number other than the buyer's own (the signed-in phone, or the phone on the home account) is a gift.
  const gift = to !== (buyer ?? (ownPhone ? normPhone(ownPhone) : null));
  return withTenant(tenantId, async (c) => {
    const { rows: [plan] } = await c.query(
      "select id, title, price from plans where id=$1 and tenant_id=$2 and service='hotspot' and active", [planId, tenantId]);
    if (!plan) throw new HttpError(404, 'That bundle is no longer on sale.');
    const price = money(plan.price);

    let balance;
    if (account) {
      const a = await accountAvailable(c, tenantId, account.account_code, true);
      if (a.available < price) throw new HttpError(409, `Not enough on account ${account.account_code}: ${a.available} can be spent and this bundle costs ${price}.`);
      balance = a.balance;
    } else {
      const { rows: [w] } = await c.query('select balance from visitor_wallets where tenant_id=$1 and phone=$2 for update', [tenantId, buyer]);
      balance = Number(w?.balance ?? 0);
      if (balance < price) throw new HttpError(409, `Not enough in your wallet: you have ${balance} and this bundle costs ${price}. Top up ${money(price - balance)} more.`);
    }

    // The phone buying, when the login page told us which one it is: the code is tied to it so the router signs it in by itself.
    // Never for a bundle sent to someone else (the address is the sender's), and a device that already has a running code is left as it is.
    let device = !gift && isMac(String(mac ?? '').toUpperCase()) ? String(mac).toUpperCase() : null;
    if (device) {
      const { rows: [busy] } = await c.query(
        "select 1 from vouchers where tenant_id=$1 and mac=$2::macaddr and status='in_use' and expires_at > now() limit 1", [tenantId, device]);
      if (busy) device = null;
    }
    const v = await issueVoucherAccess(c, tenantId, plan.id, to, device, { startOnLogin: !device });
    if (routerId && !gift) {
      const { rows: [r] } = await c.query('select id from routers where id::text=$1 and tenant_id=$2', [String(routerId), tenantId]);
      if (r) await c.query('update vouchers set router_id=$2 where id=$1', [v.id, r.id]);
    }
    const note = gift ? `${plan.title} sent to ${shownPhone(to)}` : plan.title;
    let after;
    if (account) {
      const { rows: [u] } = await c.query(
        'update account_wallets set balance = balance - $3, updated_at = now() where tenant_id=$1 and account_code=$2 returning balance',
        [tenantId, account.account_code, price]);
      after = Number(u.balance);
      await c.query(
        `insert into activity_log (tenant_id, subscriber_id, account_code, actor, action, detail) values ($1,$2,$3,$4,'Hotspot bundle from wallet',$5)`,
        [tenantId, account.subscriber_id, account.account_code, by ?? (buyer ? shownPhone(buyer) : 'customer'),
          `${note}, code ${v.code}. ${price} taken from the account wallet, ${after} left.`]);
    } else {
      const { rows: [u] } = await c.query(
        'update visitor_wallets set balance = balance - $3, updated_at = now() where tenant_id=$1 and phone=$2 returning balance', [tenantId, buyer, price]);
      after = Number(u.balance);
      await c.query(
        `insert into visitor_wallet_ledger (tenant_id, phone, delta, balance_after, reason, voucher_id, plan_id, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`, [tenantId, buyer, -price, after, gift ? 'gift' : 'purchase', v.id, plan.id, note]);
    }
    return { code: v.code, title: plan.title, price, balance: after, to, gift, source: account ? 'account' : 'wallet', expiresAt: v.expires_at ?? null };
  });
}

/** Text a bought code to the phone it is for. Never fails the purchase: the code is already shown on screen. */
export async function textCode(tenantId, out, { from = null, smsLib = null } = {}) {
  try {
    const sms = smsLib ?? await import('./sms.js');
    const org = await sms.orgVars(tenantId);
    const { pool } = await import('./db.js');
    const { rows: [t] } = await pool.query('select name, subdomain from tenants where id=$1', [tenantId]);
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    const link = t?.subdomain ? ` Connect: https://${t.subdomain}.${root}/hotspot/login.html?code=${encodeURIComponent(out.code)}` : '';
    const company = org.company || t?.name || 'WiFi';
    const body = out.gift
      ? `${company}: ${from ? shownPhone(from) : 'Someone'} sent you a ${out.title} WiFi bundle. Your code is ${out.code}. It starts when you first connect.${link}`
      : `${company}: your ${out.title} code is ${out.code}.${link}`;
    const r = await sms.send(tenantId, out.to, 'custom', { ...org, body });
    return r?.ok !== false;
  } catch { return false; }
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
              coalesce((select -sum(l.delta) from visitor_wallet_ledger l where l.tenant_id=w.tenant_id and l.phone=w.phone and l.reason in ('purchase','gift')), 0) as spent
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
    // A home customer's number: their home account's wallet can pay for hotspot bundles too.
    const acct = await homeAccountFor(pool, t.id, ph).catch(() => null);
    const home = acct ? { account: acct.account_code, name: acct.name, available: (await accountAvailable(pool, t.id, acct.account_code)).available } : null;
    return { phone: ph, balance: Number(w?.balance ?? 0), plans, history, home, topups: s.enabled, minTopup: s.minTopup, maxTopup: s.maxTopup };
  };

  app.get('/hotspot/wallet', wrap(async (req, res) => {
    const t = await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
    if (!t) return res.status(404).type('text').send('Unknown network');
    const s = await walletSettings(pool, t.id);
    res.type('html').send(walletPage({
      company: t.name ?? 'WiFi', currency: String(t.currency ?? 'KES').trim(), apiBase: apiBaseOf(t),
      topups: s.enabled, minTopup: s.minTopup, maxTopup: s.maxTopup, supportPhone: t.support_phone ?? null,
    }));
  }));

  // So the page can be put on the phone's home screen and opened like an app.
  app.get('/hotspot/wallet.webmanifest', wrap(async (req, res) => {
    const t = await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
    const name = `${t?.name ?? 'WiFi'} wallet`;
    res.type('application/manifest+json').send(JSON.stringify({
      name, short_name: name.slice(0, 12), start_url: '/hotspot/wallet', scope: '/hotspot/', display: 'standalone',
      background_color: '#f5f6f3', theme_color: '#0f7a5f',
      icons: [
        { src: '/hotspot/wallet-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/hotspot/wallet-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    }));
  }));

  // The app icon: a WiFi mark on the wallet's green, drawn here so every network has one without uploading anything.
  app.get('/hotspot/wallet-icon-:size.png', (req, res) => {
    const size = req.params.size === '512' ? 512 : 192;
    res.set('Cache-Control', 'public, max-age=604800').type('image/png').send(wifiIcon(size));
  });

  // What makes the page installable as an app. It passes every request straight to the network: nothing is kept offline,
  // so a balance or a code shown is always the real one.
  app.get('/hotspot/wallet-sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache').type('application/javascript').send(
      [
        "self.addEventListener('install', function () { self.skipWaiting(); });",
        "self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });",
        "self.addEventListener('fetch', function () {});",
      ].join('\n'));
  });

  app.post('/hotspot/wallet/otp', slow, guard(async (req, res) => {
    prune();
    const t = await tenantOf(req);
    const ph = normPhone(req.body?.phone);
    if (!ph) throw new HttpError(400, 'Enter a valid phone number.');
    const generic = { ok: true, message: 'If that number has a wallet or a home account with us, a code has been sent to it by SMS.' };

    const key = `${t.id}:${ph}`;
    const now = Date.now();
    const rec = otps.get(key) ?? { code: null, exp: 0, tries: 0, sent: [] };
    rec.sent = rec.sent.filter((x) => x > now - 15 * 60 * 1000);
    if (rec.sent.length >= 3) throw new HttpError(429, 'Too many codes requested for this number. Try again in a few minutes.');

    // Only a number that has put money in is texted, so typing random numbers cannot use up the SMS balance. The answer is the same either way.
    const { rows: [w] } = await pool.query('select 1 from visitor_wallets where tenant_id=$1 and phone=$2', [t.id, ph]);
    if (!w && !(await homeAccountFor(pool, t.id, ph).catch(() => null))) return res.json(generic);

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
    // Paid from the visitor's wallet, or from the home account their number belongs to; for themselves, or sent to another number.
    let acct = null;
    if (req.body?.source === 'account') {
      acct = await homeAccountFor(pool, t.id, ph);
      if (!acct) throw new HttpError(404, 'This number is not on a home account.');
    }
    const toPhone = String(req.body?.toPhone ?? '').trim() || null;
    const out = await spend(t.id, { buyer: ph, account: acct, planId: String(req.body?.planId ?? ''), mac: req.body?.mac, routerId: req.body?.routerId, toPhone });
    const texted = out.gift || acct ? await textCode(t.id, out, { from: ph, smsLib }) : false;
    res.json({ ok: true, ...out, texted });
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

/** A PNG drawn pixel by pixel: the wallet's green with a white WiFi mark. Small enough to need no image library. */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const icons = new Map();
export function wifiIcon(size) {
  if (icons.has(size)) return icons.get(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2, cy = size * 0.66, t = size * 0.065;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      const up = dy < 0 && Math.abs(dx) <= -dy * 1.05;
      const white = d <= t * 1.1 || (up && [0.15, 0.27, 0.39].some((r) => Math.abs(d - r * size) <= t / 2));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = white ? 255 : 15; raw[o + 1] = white ? 255 : 122; raw[o + 2] = white ? 255 : 95; raw[o + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  icons.set(size, png);
  return png;
}

/**
 * The visitor's page: one file, no build step. It works on the walled garden and from anywhere else, and installs on the phone
 * like an app. Signed in, it opens on the balance and a row of shortcuts: recharge, buy, send a bundle, my codes, install, help.
 */
export function walletPage({ company = 'WiFi', currency = 'KES', apiBase = '', topups = true, minTopup = 10, maxTopup = 5000, supportPhone = null }) {
  const cfg = JSON.stringify({ api: apiBase, cur: String(currency || 'KES').slice(0, 3).toUpperCase(), topups, min: minTopup, max: maxTopup, help: supportPhone || '' }).replace(/</g, '\\u003c');
  const sp = speedPanel({ apiBase, source: 'wallet' });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f7a5f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${esc(company)}">
<meta name="mobile-web-app-capable" content="yes">
<title>${esc(company)} wallet</title>
<link rel="manifest" href="/hotspot/wallet.webmanifest">
<link rel="icon" type="image/png" href="/hotspot/wallet-icon-192.png">
<link rel="apple-touch-icon" href="/hotspot/wallet-icon-192.png">
<style>
  :root { --ink:#161a17; --muted:#6f766b; --line:rgba(128,128,128,.25); --green:#0f7a5f; --soft:#e8f3ee; --bg:#f5f6f3; --card:#fff; --red:#8a2d16; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
         padding:max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
         font:14.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:440px; margin:0 auto; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:10px; scroll-margin-top:12px; }
  h1 { margin:4px 0 2px; font-size:19px; }
  h2 { margin:0 0 4px; font-size:15.5px; }
  .sub { margin:0 0 12px; color:var(--muted); font-size:13.5px; }
  label { display:block; margin:10px 0 4px; font-size:12.5px; font-weight:600; color:var(--muted); }
  input, select { width:100%; padding:10px 11px; font-size:16px; border:1px solid var(--line); border-radius:9px; background:#fafbf9; color:var(--ink); font-family:inherit; }
  button { width:100%; margin-top:10px; padding:11px; font-size:15px; font-weight:600; color:#fff; background:var(--green);
           border:0; border-radius:9px; cursor:pointer; font-family:inherit; }
  button.plain { color:var(--green); background:transparent; border:1px solid var(--line); }
  button.small { width:auto; margin:0; padding:8px 14px; font-size:13.5px; white-space:nowrap; }
  button:disabled { opacity:.55; cursor:default; }
  button:focus-visible, a:focus-visible { outline:2px solid var(--green); outline-offset:2px; }
  .bal { background:var(--green); color:#fff; border:0; }
  .bal .n { font-size:32px; font-weight:700; letter-spacing:-.02em; }
  .bal .who { opacity:.85; font-size:13px; }
  .bal .home { margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,.25); font-size:13px; }
  .acts { display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-bottom:10px; }
  .acts button { margin:0; padding:11px 2px; background:var(--card); color:var(--ink); border:1px solid var(--line); font-size:12.5px; font-weight:600;
                 display:flex; flex-direction:column; align-items:center; gap:6px; }
  .acts svg { width:22px; height:22px; stroke:var(--green); fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:0; }
  .t { font-weight:600; }
  .m { color:var(--muted); font-size:12.5px; }
  .note { margin:10px 0 0; font-size:13.5px; color:var(--muted); }
  .err { margin:10px 0 0; padding:9px 11px; border-radius:8px; font-size:14px; color:var(--red); background:#fdece5; border:1px solid #f3c7b6; }
  .ok { margin:10px 0 0; padding:9px 11px; border-radius:8px; font-size:14px; color:#0b5a46; background:var(--soft); border:1px solid #bfe0d2; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .chips button { width:auto; margin:0; padding:7px 12px; font-size:13.5px; }
  .src { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px; }
  .src button { margin:0; padding:9px 6px; font-size:13px; background:transparent; color:var(--ink); border:1px solid var(--line); text-align:left; line-height:1.3; }
  .src button[aria-pressed="true"] { border-color:var(--green); background:var(--soft); color:#0b5a46; }
  .src b { display:block; font-size:14px; }
  .code { font:700 22px/1.2 ui-monospace,Menlo,Consolas,monospace; letter-spacing:.06em; }
  a.btn { display:block; margin-top:10px; padding:11px; text-align:center; font-weight:600; color:#fff; background:var(--green); border-radius:9px; text-decoration:none; }
  a.link { color:var(--green); font-size:12.5px; font-weight:600; }
  .help { font-size:18px; font-weight:700; user-select:all; }
  .foot { text-align:center; font-size:12.5px; color:var(--muted); margin:14px 0; }
  .foot a { color:var(--green); }
  .hide { display:none !important; }
  ${sp.css}
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
      <div class="home hide" id="homeLine"></div>
    </div>

    <div class="acts" role="navigation" aria-label="Shortcuts">
      <button type="button" data-go="recharge" id="actRecharge"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Recharge</button>
      <button type="button" data-go="buy"><svg viewBox="0 0 24 24"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/></svg>Buy</button>
      <button type="button" data-go="send"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-3-7-7-1z"/></svg>Send</button>
      <button type="button" data-go="codes"><svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10h8M8 14h5"/></svg>My codes</button>
      <button type="button" data-go="speed"><svg viewBox="0 0 24 24"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/></svg>Speed test</button>
      <button type="button" data-go="historyCard"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2"/></svg>History</button>
      <button type="button" data-go="install" class="installAct"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Install</button>
      <button type="button" data-go="help"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5M12 16.5v.01"/></svg>Help</button>
    </div>

    <div class="card hide" id="bought">
      <h2 id="boughtTitle"></h2>
      <p class="sub" id="boughtSub">Your code</p>
      <div class="code" id="boughtCode"></div>
      <a class="btn" id="boughtLink" href="#">Connect now</a>
      <p class="note" id="boughtNote">On the WiFi already? Tap Connect now. Otherwise keep this code and enter it on the WiFi sign-in page.</p>
    </div>

    <div class="card" id="buy">
      <h2>Buy a bundle</h2>
      <p class="sub">For this phone. Its time starts when you connect.</p>
      <div class="src hide" id="srcBuy"></div>
      <div id="plans"></div>
      <div id="buyMsg"></div>
    </div>

    <div class="card" id="send">
      <h2>Send a bundle</h2>
      <p class="sub">Buy a bundle for someone else. We text them the code.</p>
      <div class="src hide" id="srcSend"></div>
      <label for="sendPlan">Bundle</label>
      <select id="sendPlan"></select>
      <label for="sendTo">Their phone number</label>
      <input id="sendTo" type="tel" inputmode="tel" placeholder="07xx xxx xxx" maxlength="20" autocomplete="off">
      <button id="sendBtn">Send the bundle</button>
      <div id="sendMsg"></div>
    </div>

    <div class="card" id="recharge">
      <h2>Recharge</h2>
      <p class="sub">An M-Pesa prompt comes to your phone.</p>
      <label for="amtIn">Amount (<span class="cur"></span>)</label>
      <input id="amtIn" type="number" inputmode="numeric" min="1">
      <div class="chips" id="chipsIn"></div>
      <button id="payIn">Recharge with M-Pesa</button>
      <div id="payInMsg"></div>
    </div>

    <div class="card" id="codes">
      <h2>My codes</h2>
      <p class="sub">Codes you bought that can still be used.</p>
      <div id="codeList"></div>
    </div>

    <div class="card" id="speed">
      <h2>Speed test</h2>
      ${sp.html}
    </div>

    <div class="card" id="historyCard">
      <h2>History</h2>
      <div id="history"></div>
    </div>
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
      <p class="sub">Sign in with the number you paid with, or the number on your home internet account. We text it a code, once on this phone.</p>
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

  <div class="card hide" id="install">
    <h2>Install the app</h2>
    <p class="sub" id="installText">Keep the wallet on your home screen and open it like any other app.</p>
    <button id="installBtn">Install</button>
  </div>

  <div class="card" id="help">
    <h2>Help</h2>
    <div id="helpBody"></div>
    <a class="link" href="/hotspot/login.html">Go to the WiFi sign-in page</a>
  </div>

  <div class="foot hide" id="outFoot"><a href="#" id="signOut">Sign out on this phone</a></div>
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
  var source = store.get('vw_source') === 'account' ? 'account' : 'wallet';

  var money = function (n) { return C.cur + ' ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 }); };
  var shown = function (p) { p = String(p || ''); return p.indexOf('254') === 0 ? '0' + p.slice(3) : p; };
  var msg = function (el, kind, text) { el.innerHTML = ''; if (!text) return; var d = document.createElement('div'); d.className = kind; d.textContent = text; el.appendChild(d); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var call = function (method, path, body) {
    return fetch(C.api + path, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; } return j; }); });
  };
  Array.prototype.forEach.call(document.querySelectorAll('.cur'), function (e) { e.textContent = C.cur; });

  // ── shortcuts ──
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) {
    b.addEventListener('click', function () {
      var go = b.getAttribute('data-go');
      if (go === 'install') return install();
      var target = $(go); if (!target) return;
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      var first = target.querySelector('input, select'); if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 350);
    });
  });

  // ── install as an app ──
  var deferred = null;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/hotspot/wallet-sw.js', { scope: '/hotspot/' }).catch(function () {});
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; showInstall(); });
  window.addEventListener('appinstalled', function () { standalone = true; showInstall(); });
  function showInstall() {
    var on = !standalone;
    $('install').className = on ? 'card' : 'card hide';
    Array.prototype.forEach.call(document.querySelectorAll('.installAct'), function (b) { b.classList.toggle('hide', !on); });
    if (!on) return;
    if (deferred) { $('installText').textContent = 'Keep the wallet on your home screen and open it like any other app.'; $('installBtn').className = ''; }
    else if (ios) { $('installText').textContent = 'In Safari, tap the Share button, then "Add to Home Screen".'; $('installBtn').className = 'hide'; }
    else { $('installText').textContent = 'Open your browser menu (the three dots) and choose "Install app" or "Add to Home screen".'; $('installBtn').className = 'hide'; }
  }
  function install() {
    if (deferred) { deferred.prompt(); deferred.userChoice.then(function () { deferred = null; showInstall(); }); return; }
    showInstall(); $('install').scrollIntoView({ block: 'start' });
  }
  $('installBtn').onclick = install;
  showInstall();

  // ── help ──
  (function () {
    var h = $('helpBody');
    if (C.help) {
      h.appendChild(el('p', 'sub', 'Call or WhatsApp us on'));
      h.appendChild(el('div', 'help', shown(C.help)));
      var a = el('a', 'link', 'Call now'); a.href = 'tel:' + C.help; a.style.display = 'inline-block'; a.style.margin = '6px 0 10px';
      h.appendChild(a);
    } else h.appendChild(el('p', 'sub', 'Ask at the shop or the place that gave you this WiFi.'));
    h.appendChild(el('p', 'note', 'Paid and the money is not showing? It usually arrives within a minute. Your code from a bundle is also sent by SMS.'));
  })();

  var chips = function (boxId, inputId) {
    var box = $(boxId);
    [50, 100, 200, 500, 1000].filter(function (a) { return a >= C.min && a <= C.max; }).forEach(function (a) {
      var b = el('button', 'plain', String(a)); b.type = 'button';
      b.onclick = function () { $(inputId).value = a; }; box.appendChild(b);
    });
  };
  chips('chipsIn', 'amtIn'); chips('chipsOut', 'amtOut');
  if (!C.topups) {
    $('recharge').className = 'card hide'; $('actRecharge').className = 'hide';
    $('topupOut').innerHTML = '<h2>Put money in</h2><p class="sub">Top-ups are not open here at the moment. Money already in a wallet can still be used.</p>';
  }

  var when = function (iso) { return new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var connectUrl = function (code) { return C.api + '/hotspot/login.html?code=' + encodeURIComponent(code) + (routerId ? '&siteRouter=' + encodeURIComponent(routerId) : '') + (mac ? '&mac=' + encodeURIComponent(mac) : ''); };
  var funds = function () { return source === 'account' && me.home ? me.home.available : me.balance; };

  // "Pay from": the wallet, or the home account this number belongs to. Shown only to a home customer.
  function renderSource(box) {
    box.innerHTML = '';
    if (!me.home) { box.className = 'src hide'; return; }
    box.className = 'src';
    [['wallet', 'Wallet', me.balance], ['account', 'Home account ' + me.home.account, me.home.available]].forEach(function (o) {
      var b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(source === o[0]));
      b.appendChild(el('span', 'm', o[1])); b.appendChild(el('b', null, money(o[2])));
      b.onclick = function () { source = o[0]; store.set('vw_source', source); render(); };
      box.appendChild(b);
    });
  }

  function render() {
    $('signedIn').className = me ? '' : 'hide';
    $('signedOut').className = me ? 'hide' : '';
    $('outFoot').className = me ? 'foot' : 'foot hide';
    if (!me) return;
    if (!me.home) source = 'wallet';
    $('who').textContent = shown(me.phone);
    $('balance').textContent = money(me.balance);
    var hl = $('homeLine');
    if (me.home) { hl.className = 'home'; hl.textContent = 'Home account ' + me.home.account + ': ' + money(me.home.available) + ' can pay for bundles too'; }
    else hl.className = 'home hide';
    renderSource($('srcBuy')); renderSource($('srcSend'));

    var plans = $('plans'); plans.innerHTML = '';
    if (!me.plans.length) plans.appendChild(el('p', 'note', 'No bundles on sale right now.'));
    me.plans.forEach(function (p) {
      var row = el('div', 'row'); var left = el('div');
      left.appendChild(el('div', 't', p.title));
      var short = Number(p.price) - funds();
      left.appendChild(el('div', 'm', money(p.price) + (short > 0 ? ' · ' + money(short) + ' short' : '')));
      var b = el('button', 'small', 'Buy'); b.disabled = short > 0;
      b.onclick = function () { buy(p, null, b, $('buyMsg')); };
      row.appendChild(left); row.appendChild(b); plans.appendChild(row);
    });

    var sel = $('sendPlan'); var keep = sel.value; sel.innerHTML = '';
    me.plans.forEach(function (p) { var o = el('option', null, p.title + ' · ' + money(p.price)); o.value = p.id; sel.appendChild(o); });
    if (keep) sel.value = keep;

    var codes = $('codeList'); codes.innerHTML = '';
    var live = me.history.filter(function (r) { return r.code && (r.code_status === 'unused' || r.code_status === 'in_use') && r.reason === 'purchase'; });
    if (!live.length) codes.appendChild(el('p', 'note', 'No codes yet. A bundle you buy shows here until it runs out.'));
    live.forEach(function (r) {
      var row = el('div', 'row'); var left = el('div');
      left.appendChild(el('div', 't', r.note || 'Bundle'));
      left.appendChild(el('div', 'm', r.code_status === 'in_use' ? (r.expires_at ? 'Running until ' + when(r.expires_at) : 'Running') : 'Not used yet · starts when you connect'));
      var code = el('div', 'code', r.code); code.style.fontSize = '16px'; left.appendChild(code);
      var a = el('a', 'link', 'Connect'); a.href = connectUrl(r.code);
      row.appendChild(left); row.appendChild(a); codes.appendChild(row);
    });

    var h = $('history'); h.innerHTML = '';
    if (!me.history.length) h.appendChild(el('p', 'note', 'Nothing yet.'));
    me.history.forEach(function (r) {
      var row = el('div', 'row'); var left = el('div');
      left.appendChild(el('div', 't', r.reason === 'topup' ? 'Recharge' : r.reason === 'purchase' || r.reason === 'gift' ? (r.note || 'Bundle') : 'Adjusted' + (r.note ? ': ' + r.note : '')));
      left.appendChild(el('div', 'm', when(r.created_at)));
      var amt = el('div', 't', (Number(r.delta) > 0 ? '+' : '') + Number(r.delta).toLocaleString('en-KE'));
      amt.style.whiteSpace = 'nowrap'; amt.style.color = Number(r.delta) < 0 ? '#8a2d16' : '#0f7a5f';
      row.appendChild(left); row.appendChild(amt); h.appendChild(row);
    });
  }

  function refresh() {
    if (!token) { me = null; render(); return Promise.resolve(); }
    return call('POST', '/hotspot/wallet/me', { token: token, routerId: routerId }).then(function (j) { me = j; render(); })
      .catch(function (e) { if (e.status === 401) { token = null; store.set('vw_token', null); } me = null; render(); });
  }

  function buy(p, toPhone, btn, out) {
    var from = source === 'account' && me.home ? 'home account ' + me.home.account : 'your wallet';
    var question = toPhone ? 'Send ' + p.title + ' (' + money(p.price) + ') to ' + toPhone + ', paid from ' + from + '?' : 'Buy ' + p.title + ' for ' + money(p.price) + ' from ' + from + '?';
    if (!window.confirm(question)) return;
    btn.disabled = true; msg(out, '', '');
    call('POST', '/hotspot/wallet/buy', { token: token, planId: p.id, mac: mac, routerId: routerId, source: source, toPhone: toPhone || undefined }).then(function (j) {
      if (j.gift) {
        msg(out, 'ok', p.title + ' sent to ' + shown(j.to) + '.' + (j.texted ? ' They will get the code by SMS.' : ' The SMS could not be sent: give them this code: ' + j.code));
        $('sendTo').value = ''; btn.disabled = false;
        return refresh();
      }
      $('bought').className = 'card';
      $('boughtTitle').textContent = j.title + ' is ready';
      $('boughtCode').textContent = j.code;
      $('boughtLink').href = connectUrl(j.code);
      window.scrollTo(0, 0);
      return refresh();
    }).catch(function (e) { btn.disabled = false; msg(out, 'err', e.message); if (e.status === 401) refresh(); });
  }

  $('sendBtn').onclick = function () {
    var p = me.plans.filter(function (x) { return x.id === $('sendPlan').value; })[0];
    var to = $('sendTo').value.trim();
    if (!p) return msg($('sendMsg'), 'err', 'Pick a bundle.');
    if (to.replace(/[^0-9]/g, '').length < 9) return msg($('sendMsg'), 'err', 'Enter their phone number.');
    if (Number(p.price) > funds()) return msg($('sendMsg'), 'err', 'Not enough: ' + money(funds()) + ' and this bundle costs ' + money(p.price) + '.');
    buy(p, to, $('sendBtn'), $('sendMsg'));
  };

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
          if (s.status === 'failed') { btn.disabled = false; return msg(out, 'err', 'The payment did not go through' + (s.detail ? ': ' + s.detail : '.')); }
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
${sp.js}
</script>
</body>
</html>`;
}
