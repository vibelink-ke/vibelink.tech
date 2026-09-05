import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import util from 'node:util';
import dns from 'node:dns';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool, tenantByHost } from './db.js';
import { router as daraja } from './payments/daraja.js';
import { router as kopokopo } from './payments/kopokopo.js';
import { router as bank } from './payments/bankstk.js';
import { router as manual } from './payments/manual.js';
import * as kk from './payments/kopokopo.js';
import * as mpesa from './payments/daraja.js';
import { startJobs, payoutTenantNow } from './jobs.js';
import { providerNames } from './sms.js';
import * as auth from './auth.js';
import { requirePermission, loadPermissions, savePermissions, PERMISSION_META } from './permissions.js';
import axios from 'axios';

/**
 * Every outbound call to Safaricom, KopoKopo, a bank's STK endpoint, or any
 * of the SMS gateways (daraja.js, kopokopo.js, bankstk.js, sms.js) shares
 * this one axios module — importing "axios" anywhere in the process returns
 * the same default instance — so setting the timeout here once covers all
 * of them, rather than passing `{ timeout }` at every individual call site
 * and hoping a future one remembers to.
 *
 * None of those calls set a timeout of their own before this. A gateway
 * that stops answering — not erroring, just never replying — left the
 * request hanging with nothing to time it out: the guest's STK push, the
 * cashier's manual match, the SMS send behind a payment receipt, all
 * blocked on a socket that might never close, tying up the request handler
 * (and, for anything running inside a transaction, the database connection
 * underneath it) for as long as the far end feels like staying silent.
 */
axios.defaults.timeout = 15000;

// A crash used to be invisible: the process died, the proxy answered 502 with an
// empty body, the container restarted, and nothing was written down. Say what
// happened before going, so the next one takes minutes rather than an evening.
process.on('uncaughtException', (e) => {
  console.error('FATAL uncaught exception —', e?.stack ?? e);
  process.exit(1);   // let the restart policy replace us, but on the record
});
process.on('unhandledRejection', (e) => {
  console.error('FATAL unhandled rejection —', e?.stack ?? e);
  process.exit(1);
});

const app = express();
/**
 * No conditional GETs on this API.
 *
 * Express's default ETag support means every JSON response carries a
 * content hash, and the app's fetch client sends it straight back on the
 * next request — the browser gets a 304 with no body and is left to serve
 * whatever it has cached instead. That is fine for a stylesheet. It is not
 * fine for a dashboard: a customer added, a payment applied, a status
 * change, none of it can be trusted to show up if the byte-identical
 * response from ten minutes ago happens to satisfy the conditional check
 * (a browser cache is not a reliable proof that the data hasn't moved), and
 * a cache that has been evicted or is simply missing turns that 304 into
 * nothing at all — every screen quietly empty with no error to explain why.
 * Every response here is either already small or genuinely needs to be
 * current; there is nothing worth this trade for either kind.
 */
app.set('etag', false);
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
// KopoKopo's webhook needs the exact raw bytes to verify its HMAC signature
// against — capturing it here, once, for every request is cheap and correct.
// It used to be captured by a second express.json({verify}) mounted only on
// that router, but this global parser runs first and already consumes the
// body stream, so that second parser's verify callback never fired and
// req.rawBody was always undefined — which crashed the whole process the
// moment KOPOKOPO_WEBHOOK_SECRET was actually set (crypto.Hmac.update()
// does not accept undefined) and took every tenant down with it, not just
// that one webhook.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Caddy is the only thing in front of this process; without this, IP-based
// rate limiting keys on Caddy's own address instead of the real client, and
// express-rate-limit refuses to run at all once it sees X-Forwarded-For
// without a trust setting — logging a warning on every single request.
app.set('trust proxy', 1);

/**
 * The hotspot login page is not served from this app's own origin — it is
 * downloaded onto the ROUTER by /tool/fetch and served from the router's own
 * IP (its hotspot-address), because that is the only address a guest device
 * can reach before it has authenticated. That page still needs to call back
 * to /hotspot/buy and /chat/* on the tenant's real domain to start a
 * purchase or open live chat — a genuine cross-origin fetch from the
 * browser's point of view, silently blocked with no CORS headers, and
 * caught only as "Could not reach the billing system from here" client-side
 * with no server-side error to find. The rest of the app is intentionally
 * same-origin only (the admin app and API share an origin); this opens
 * exactly the two path prefixes that must not be, and nothing else —
 * neither carries a session cookie, so nothing here becomes readable
 * cross-origin that was not already meant to be public.
 */
app.use((req, res, next) => {
  if (req.path.startsWith('/hotspot/') || req.path.startsWith('/chat/')) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  next();
});

/**
 * Liveness/readiness for whatever watches this container — Docker's own
 * `healthcheck:`, an uptime monitor, a load balancer. /api/platform/health
 * already exists but is superAdminOnly and answers with disk/memory figures
 * that are nobody's business but the platform owner's; nothing before this
 * commit could ask "is this process actually able to serve a request" without
 * a session. No auth on purpose — this reports nothing beyond up/down, the
 * same as the trust boundary a plain TCP health probe already has anyway.
 *
 * Actually touches the database rather than only answering 200 unconditionally
 * — a process that is running but whose pool is exhausted or whose database
 * is unreachable is not actually healthy, and the whole point of a check like
 * this is catching exactly that case before an operator's own monitoring does.
 */
app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

/**
 * Nothing in the stack previously bounded request rate anywhere, so a login
 * form or the hotspot STK-purchase endpoint could be hammered without limit —
 * credential stuffing on one side, running up a tenant's Daraja/KopoKopo API
 * call volume on the other. `standardHeaders`/`legacyHeaders: false` keeps the
 * response shape unchanged for existing clients; only 429s are new behavior.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});
const stkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many payment attempts. Try again in a few minutes.' },
});
// The guest's own page polls this every few seconds while waiting on M-Pesa,
// so the ceiling is generous — this exists to stop someone using the poll
// endpoint to brute-force checkoutId values, not to slow down a real wait.
//
// Keyed by IP like every rate limiter here, which is the wrong key for this
// specific family of routes: every guest at a hotspot site shares the one
// public IP their router's own NAT presents to us, so this ceiling is really
// a per-site budget, not a per-guest one. 4000/minute is sized for a busy
// site's worth of guests polling every few seconds at once, not for one
// person's wait — raise it further, not the window, if a bigger site still
// hits it.
const pollLimiter = rateLimit({
  windowMs: 60 * 1000, max: 4000, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many status checks. Try again shortly.' },
});

/**
 * Which build is actually running.
 *
 * `git pull` does not replace a running container, and the symptom of forgetting
 * `--build` is a 404 on a route that exists in the source — which reads as a bug
 * rather than a stale deploy. Several days went into questions this answers in
 * one request.
 *
 * The fingerprint is of this file: it changes whenever the API does, needs
 * nothing baked in at build time, and no git inside the image.
 */
const BUILD = {
  startedAt: new Date().toISOString(),
  source: (() => {
    try {
      const file = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
      return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
    } catch {
      return 'unknown';
    }
  })(),
};

// Deliberately public and above the tenant resolver: it carries nothing private,
// and needing to authenticate to ask "is the new code live?" defeats the point.
app.get('/api/version', (_req, res) => res.json(BUILD));

// Express 4 does not await handlers, so a rejected async handler becomes an
// unhandled rejection — which on Node 22+ terminates the process. One DB blip
// would take the whole API down. Route every rejection into next() instead, once,
// here, so it applies to every handler defined below without per-route ceremony.
for (const method of ['use', 'get', 'post', 'put', 'patch', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (...args) =>
    original(
      ...args.map((h) =>
        typeof h === 'function' && h.length < 4
          ? function asyncSafe(req, res, next) {
              return Promise.resolve(h(req, res, next)).catch(next);
            }
          : h
      )
    );
}

// Webhooks (no auth; verified per provider, idempotent downstream)
app.use('/webhooks/daraja', daraja);
app.use('/webhooks/kopokopo', kopokopo);
app.use('/webhooks/bank', bank);
app.use('/webhooks/forwarder', manual);

/**
 * Turn a thrown error into something a human can act on.
 * pg raises an AggregateError with an empty `message` when it cannot reach the
 * server (one sub-error per resolved address), which would otherwise surface in
 * the UI as a blank red banner.
 */
function describe(e) {
  const parts = e instanceof AggregateError ? (e.errors ?? []) : [e];
  const codes = new Set(parts.map((x) => x?.code).filter(Boolean));
  if (codes.has('ECONNREFUSED'))
    return 'Cannot reach the database. Is it up?  docker compose up -d';
  if (codes.has('42P01')) return 'Database tables are missing. Run: npm run migrate';
  if (codes.has('28P01') || codes.has('3D000'))
    return 'Database rejected the credentials in DATABASE_URL.';
  return e?.message || parts.map((x) => x?.message).filter(Boolean).join('; ') || `${e?.code ?? 'unknown error'}`;
}

/** Wrap an async handler so a rejected promise becomes a 500 instead of a hung socket. */
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    const msg = describe(e);
    console.error(req.method, req.path, '→', msg);
    if (!res.headersSent) res.status(500).json({ error: msg });
  });

// ── authentication ────────────────────────────────
// Mounted before tenant resolution: signing in is how you find out which tenant
// you belong to, so these routes cannot require one.

app.get('/api/auth/session', wrap(async (req, res) => {
  const s = await auth.readSession(auth.sessionToken(req));
  res.json(s ? auth.publicSession(s) : null);
}));

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  // `identifier` is the email-or-username field; `email` stays accepted so an
  // older client keeps working.
  const { identifier, email, password, remember = true } = req.body;
  const who = String(identifier ?? email ?? '').trim();
  if (!who || !password) return res.status(400).json({ error: 'Enter your email or username and password.' });

  /**
   * Scoped to whichever tenant this hostname belongs to, when one resolves.
   *
   * Email and username are unique across the whole platform, not per tenant,
   * so this query used to match on identity alone — valid credentials for a
   * DIFFERENT tenant than the subdomain you were sitting on still signed you
   * in, just into that other tenant's portal, rendered under this one's
   * hostname with nothing to say the two did not match. A subdomain is that
   * tenant's own front door; credentials that do not belong to it must fail
   * here exactly like a wrong password would, not open somebody else's.
   *
   * Falls back to an unscoped lookup only when no tenant resolves from the
   * hostname at all (the platform apex, local dev without DEV_TENANT) —
   * there is no tenant's door to enforce there, and this stays how anybody
   * ever reaches one to begin with.
   */
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);

  const { rows: [acct] } = await pool.query(
    `select st.*, t.status as tenant_status, t.subdomain from staff st
     join tenants t on t.id = st.tenant_id
     where (lower(st.email) = lower($1) or lower(st.username) = lower($1))
       and ($2::uuid is null or st.tenant_id = $2)`,
    [who, tenant?.id ?? null]);

  // Same message for "no such account" and "wrong password" would be friendlier to
  // attackers only marginally here, and the design shows distinct copy — keep the
  // design's wording but verify against a dummy hash so timing does not leak.
  // A real account that exists for a DIFFERENT tenant lands here too, by design:
  // "no account" is the honest answer for this hostname, not "wrong password".
  if (!acct) {
    await auth.verifyPassword(password, null);
    return res.status(401).json({ error: 'No account found for that email or username. Create one first.' });
  }
  if (!(await auth.verifyPassword(password, acct.password_hash)))
    return res.status(401).json({ error: 'That password is not correct.' });
  if (acct.tenant_status === 'suspended')
    return res.status(402).json({ error: 'This account is suspended. Contact support@vibelink.co.ke.' });

  const { token, expiresAt } = await auth.createSession(acct.id, acct.tenant_id, { remember });
  auth.setSessionCookie(res, token, expiresAt);
  await pool.query('update staff set last_seen = now() where id = $1', [acct.id]);
  auth.pruneSessions();
  auth.pruneHandoffs();

  const s = await auth.readSession(token);

  // Only reached when no tenant resolved from this hostname above (the apex,
  // local dev) — send them on to their own portal rather than leaving them
  // signed in on a domain that owns no tenant at all.
  let redirectTo = null;
  const root = process.env.ROOT_DOMAIN?.trim();
  if (!tenant && root && s.subdomain && req.hostname !== `${s.subdomain}.${root}`) {
    const handoff = await auth.createHandoff(token);
    redirectTo = `https://${s.subdomain}.${root}/api/auth/handoff?token=${encodeURIComponent(handoff)}`;
  }

  res.json({ ...auth.publicSession(s), redirectTo });
}));

/** Provisions a tenant plus its owner in one transaction. */
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { company, subdomain, name, email, phone, password, terms, username } = req.body;
  const sub = String(subdomain ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const user = String(username ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '') || null;

  if (!company) return res.status(400).json({ error: 'Enter your ISP name.' });
  if (!sub) return res.status(400).json({ error: 'Choose a portal subdomain.' });
  if (!name) return res.status(400).json({ error: 'Enter your full name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email ?? '')))
    return res.status(400).json({ error: 'Enter a valid work email.' });
  if (String(password ?? '').length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!terms) return res.status(400).json({ error: 'Accept the terms to continue.' });

  const { rows: [dupeEmail] } = await pool.query('select 1 from staff where lower(email)=lower($1)', [String(email).trim()]);
  if (dupeEmail) return res.status(409).json({ error: 'That email already has an account — sign in instead.' });
  if (user) {
    const { rows: [dupeUser] } = await pool.query('select 1 from staff where lower(username)=lower($1)', [user]);
    if (dupeUser) return res.status(409).json({ error: `The username "${user}" is taken. Try another.` });
  }
  const { rows: [dupeSub] } = await pool.query('select 1 from tenants where subdomain=$1', [sub]);
  if (dupeSub) return res.status(409).json({ error: `${sub}.vibelink.tech is taken. Try another.` });

  const password_hash = await auth.hashPassword(password);
  const c = await pool.connect();
  let tenant, staff;
  try {
    await c.query('begin');
    ({ rows: [tenant] } = await c.query(
      `insert into tenants (name, subdomain, status, support_phone) values ($1,$2,'trial',$3) returning *`,
      [company, sub, phone ?? null]));
    ({ rows: [staff] } = await c.query(
      `insert into staff (tenant_id, name, phone, email, username, role, password_hash)
       values ($1,$2,$3,$4,$5,'owner',$6) returning *`,
      [tenant.id, name, phone ?? sub, String(email).trim(), user, password_hash]));
    await c.query(
      `insert into hotspot_settings (tenant_id, walled_garden) values ($1,$2) on conflict do nothing`,
      [tenant.id, [`${sub}.${(process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase()}`]]);
    await c.query('commit');

    // Starter help articles, after the commit and never fatal: a new ISP should
    // not be turned away because seeding content failed, and the account is
    // already theirs by this point.
    const { seedTenant } = await import('./seed-tenant.js');
    await seedTenant(tenant.id).catch((e) => console.error('seedTenant', tenant.id, e.message));
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }

  const { token, expiresAt } = await auth.createSession(staff.id, tenant.id, { remember: true });
  auth.setSessionCookie(res, token, expiresAt);
  const s = await auth.readSession(token);

  // Send them to their own portal. Signup happens on the apex, but every screen
  // resolves its tenant from the hostname, so staying here would leave them
  // looking at whichever tenant owns the apex.
  let redirectTo = null;
  const root = process.env.ROOT_DOMAIN?.trim();
  if (root && req.hostname !== `${sub}.${root}`) {
    const handoff = await auth.createHandoff(token);
    redirectTo = `https://${sub}.${root}/api/auth/handoff?token=${encodeURIComponent(handoff)}`;
  }

  res.json({ ...auth.publicSession(s), redirectTo });
}));

/**
 * Adopt a session minted on another hostname.
 *
 * Only ever reachable with a ticket that the apex just issued, is good for a
 * minute, and works once. On success it sets this host's own cookie and bounces
 * to the app, so the address bar ends up clean rather than carrying the token.
 */
app.get('/api/auth/handoff', wrap(async (req, res) => {
  const sessionToken = await auth.consumeHandoff(req.query.token);
  if (!sessionToken) return res.redirect(302, '/?handoff=expired');

  const s = await auth.readSession(sessionToken);
  if (!s) return res.redirect(302, '/?handoff=expired');

  // Match the cookie to whatever life the session has left, rather than
  // re-deriving it and risking a cookie that outlives the row behind it.
  const { rows: [row] } = await pool.query(
    'select expires_at from admin_sessions where token = $1', [sessionToken]);
  auth.setSessionCookie(res, sessionToken, new Date(row.expires_at));
  res.redirect(302, '/');
}));

/**
 * "I forgot my password" for a staff sign-in — distinct from /portal/recover,
 * which is the customer-facing equivalent. Sends both channels because losing
 * the one account that can reach Settings → Email is exactly the situation
 * this exists for, and a staff row does not always have a working phone.
 *
 * Always answers the same way regardless of a match, for the same reason the
 * customer version does: which emails/usernames exist is not a free list to
 * hand back through this door.
 */
app.post('/api/auth/forgot', loginLimiter, wrap(async (req, res) => {
  const who = String(req.body?.identifier ?? '').trim();
  const generic = { ok: true, message: 'If that account exists, a reset link has been sent to it.' };
  if (!who) return res.json(generic);

  const { rows: [acct] } = await pool.query(
    `select st.id, st.email, st.phone, st.tenant_id, t.subdomain, t.name as tenant_name from staff st
     join tenants t on t.id = st.tenant_id
     where lower(st.email) = lower($1) or lower(st.username) = lower($1)`, [who]);
  if (!acct) return res.json(generic);

  const token = await auth.createLoginToken(acct.id, 'reset');
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  const link = `https://${acct.subdomain}.${root}/reset-password?token=${token}`;
  // Falls back to "Vibelink" only for the very rare tenant row missing a
  // name — every ISP on the platform has staff whose password-reset mail
  // should say their own company, not the platform running underneath it.
  const brand = acct.tenant_name || 'Vibelink';

  if (acct.email) {
    const email = await import('./email.js');
    email.sendSystem(acct.tenant_id, acct.email, `Reset your ${brand} password`,
      `Reset your password: ${link}\n\nThis link expires in 30 minutes and works once. `
      + 'If you did not request this, ignore it.').catch(() => {});
  }
  if (acct.phone) {
    const sms = await import('./sms.js');
    sms.send(acct.tenant_id, acct.phone, 'custom',
      { body: `${brand} password reset: ${link} (valid 30 min)` }).catch(() => {});
  }
  auth.pruneLoginTokens();
  res.json(generic);
}));

app.post('/api/auth/reset', wrap(async (req, res) => {
  const { token, password } = req.body ?? {};
  if (String(password ?? '').length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const staffId = await auth.consumeLoginToken(token, 'reset');
  if (!staffId) return res.status(400).json({ error: 'That reset link is invalid or has expired.' });

  await pool.query('update staff set password_hash=$2 where id=$1', [staffId, await auth.hashPassword(password)]);
  // A password reset is also a reason nothing signed in with the old one should stay signed in.
  await pool.query('delete from admin_sessions where staff_id=$1', [staffId]);
  res.json({ ok: true });
}));

/**
 * What /accept-invite shows before asking for anything — just enough to
 * greet the right person by name and tenant, and to tell a dead link apart
 * from one that hasn't been opened yet. Never reveals the staff row's own
 * details beyond its first name and the company inviting them.
 */
app.get('/api/auth/invite-info', wrap(async (req, res) => {
  const staffId = await auth.peekLoginToken(String(req.query.token ?? ''), 'invite');
  if (!staffId) return res.status(400).json({ error: 'That invite link is invalid or has expired.' });
  const { rows: [s] } = await pool.query(
    `select st.name, t.name as tenant_name from staff st join tenants t on t.id = st.tenant_id where st.id=$1`, [staffId]);
  res.json({ name: s?.name ?? null, tenant: s?.tenant_name ?? 'Vibelink' });
}));

/**
 * Where an invite link actually lands: choose a username and a first
 * password in one step. The username check runs before the token is
 * consumed — a taken username is a fixable mistake, and burning a
 * one-time invite link over it would mean asking whoever sent the invite
 * to send another.
 */
app.post('/api/auth/accept-invite', wrap(async (req, res) => {
  const { token, username, password } = req.body ?? {};
  if (String(password ?? '').length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const uname = String(username ?? '').trim();
  if (!uname) return res.status(400).json({ error: 'Choose a username.' });

  const staffId = await auth.peekLoginToken(token, 'invite');
  if (!staffId) return res.status(400).json({ error: 'That invite link is invalid or has expired.' });

  const { rows: [clash] } = await pool.query(
    'select 1 from staff where lower(username)=lower($1) and id<>$2', [uname, staffId]);
  if (clash) return res.status(409).json({ error: 'That username is already taken — pick another.' });

  const consumed = await auth.consumeLoginToken(token, 'invite');
  if (!consumed) return res.status(400).json({ error: 'That invite link is invalid or has expired.' });

  await pool.query('update staff set username=$2, password_hash=$3 where id=$1',
    [staffId, uname, await auth.hashPassword(password)]);
  res.json({ ok: true });
}));

/**
 * Passwordless sign-in: emails a one-use link instead of asking for a
 * password at all. Email only, unlike /api/auth/forgot — a texted link this
 * short-lived (15 min) that also signs someone in is a heavier thing to trust
 * to SMS, which several providers deliver minutes late.
 */
app.post('/api/auth/magic-link', loginLimiter, wrap(async (req, res) => {
  const who = String(req.body?.identifier ?? '').trim();
  const generic = { ok: true, message: 'If that account exists, a sign-in link has been sent to its email.' };
  if (!who) return res.json(generic);

  const { rows: [acct] } = await pool.query(
    `select st.id, st.email, st.tenant_id, t.subdomain, t.name as tenant_name from staff st
     join tenants t on t.id = st.tenant_id
     where lower(st.email) = lower($1) or lower(st.username) = lower($1)`, [who]);
  if (!acct?.email) return res.json(generic);

  const token = await auth.createLoginToken(acct.id, 'magic');
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  const link = `https://${acct.subdomain}.${root}/api/auth/magic?token=${token}`;
  const brand = acct.tenant_name || 'Vibelink';

  const email = await import('./email.js');
  email.sendSystem(acct.tenant_id, acct.email, `Your ${brand} sign-in link`,
    `Sign in: ${link}\n\nThis link expires in 15 minutes and works once. `
    + 'If you did not request this, ignore it.').catch(() => {});
  auth.pruneLoginTokens();
  res.json(generic);
}));

/** Where the link in that email actually lands: redeem the token, set the cookie, go to the dashboard. */
app.get('/api/auth/magic', wrap(async (req, res) => {
  const staffId = await auth.consumeLoginToken(req.query.token, 'magic');
  if (!staffId) return res.redirect(302, '/?magicError=1');

  const { rows: [acct] } = await pool.query('select tenant_id from staff where id=$1', [staffId]);
  const { token, expiresAt } = await auth.createSession(staffId, acct.tenant_id, { remember: true });
  auth.setSessionCookie(res, token, expiresAt);
  await pool.query('update staff set last_seen = now() where id = $1', [staffId]);
  res.redirect(302, '/');
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  const token = auth.sessionToken(req);
  if (token) await auth.destroySession(token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
}));

/**
 * Caddy's on-demand TLS gate. Must sit above the tenant resolver, which 404s
 * anything it cannot place — including this request, which carries no tenant of
 * its own.
 *
 * Tenants are subdomains, so the set of hostnames needing a certificate is not
 * known ahead of time and grows every time someone signs up. Caddy asks here
 * before issuing: 200 to proceed, anything else to refuse. Without the check an
 * attacker could point any DNS name at the server and burn through Let's
 * Encrypt's rate limit for the domain.
 */
app.get('/internal/tls-check', wrap(async (req, res) => {
  const domain = String(req.query.domain ?? '').toLowerCase().trim();
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();

  // Only ever our own zone; a stray CNAME from elsewhere must not earn a cert.
  if (domain !== root && !domain.endsWith(`.${root}`)) return res.status(404).end();

  /**
   * The root domain always gets a certificate.
   *
   * It used to qualify by accident: tenantByHost matched on the first label, so
   * vibelink.tech resolved to the tenant whose subdomain is "vibelink". Fixing
   * that — the root belongs to no tenant — stopped this answering for the root
   * as well, and Caddy stopped serving TLS on the platform's own domain:
   * ERR_SSL_PROTOCOL_ERROR on the front page, the signup flow and the hotspot
   * preview, all from a change that was about tenant isolation.
   *
   * The root and www are ours by definition and need no tenant to prove it.
   */
  if (domain === root || domain === `www.${root}`) return res.status(200).end();

  const tenant = await tenantByHost(domain);
  return tenant ? res.status(200).end() : res.status(404).end();
}));

/**
 * The captive-portal login page.
 *
 * Mounted above the tenant resolver because it must answer in two situations the
 * resolver cannot both serve:
 *
 *   <tenant>.vibelink.tech/hotspot/login  the real page, as guests see it, and
 *                                         what the router downloads
 *   vibelink.tech/hotspot/login           the root domain, which belongs to no
 *                                         tenant — a preview, so the page can be
 *                                         looked at without joining a hotspot
 *
 * The resolver 404s anything on the root domain, which is right for tenant data
 * and wrong here.
 *
 * Public by necessity: the only automated caller is a RouterOS box running
 * /tool/fetch, which has no session and cannot acquire one. It carries a company
 * name and prices already advertised to every guest on the network.
 *
 * Both /hotspot/login and /hotspot/login.html work. RouterOS fetches the second;
 * people type the first.
 */
app.get(['/hotspot/login', '/hotspot/login.html'], wrap(async (req, res) => {
  const { loginPage } = await import('./hotspot-portal.js');
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);

  if (!tenant) {
    // The root domain. Nobody's hotspot, so show what one looks like rather than
    // a 404 — this is the address an operator will try first to see the page.
    return res.type('html').send(loginPage({
      company: 'Vibelink',
      preview: true,
      plans: [
        { title: '1 Hour', price: 20, duration_min: 60, rate_down: 3000 },
        { title: '1 Day', price: 100, duration_min: 1440, rate_down: 5000 },
        { title: '1 Week', price: 500, duration_min: 10080, rate_down: 8000 },
      ],
      portalUrl: null,
      supportPhone: null,
    }));
  }

  const { rows: plans } = await pool.query(
    `select id, title, price, duration_min, rate_down from plans
      where tenant_id=$1 and service='hotspot' and active order by price limit 6`,
    [tenant.id]);

  // Branding and behaviour the operator controls from Hotspot -> Settings.
  // redirect_url was configurable there but never read here — set, saved,
  // and silently ignored by the page it was meant to change.
  const { rows: [hs] } = await pool.query(
    'select banner_headline, banner_subtext, template, redirect_url, multi_device from hotspot_settings where tenant_id=$1',
    [tenant.id]);

  res.type('html').send(loginPage({
    company: tenant.name ?? 'WiFi',
    plans,
    supportPhone: tenant.support_phone ?? null,
    portalUrl: tenant.subdomain ? `https://${tenant.subdomain}.${root}` : null,
    headline: hs?.banner_headline ?? null,
    subtext: hs?.banner_subtext ?? null,
    template: hs?.template ?? 'sleek',
    redirectUrl: hs?.redirect_url ?? null,
    // ?tv=1 for a set-top box or smart TV: same page, sized to be read from a
    // sofa and typed with a remote.
    tvMode: req.query.tv === '1',
    // Only the copy destined for the router carries RouterOS template syntax.
    // A person opening this in a browser gets a page with no raw $(...) in it.
    // Historically this was a bare "1" — a boolean, not an id. Configure now
    // passes the router's real id instead (the two purposes turn out to be
    // one signal: only a router-fetched copy needs to know which router it
    // is), so any truthy value still means "fetched by a router" and the
    // value itself, when it isn't just the old literal "1", is that router's
    // id — passed straight through unvalidated; /hotspot/buy is where an id
    // that doesn't belong to this tenant actually gets rejected.
    forRouter: !!req.query.router,
    // siteRouter carries the same id through the meta-refresh redirect below
    // (loginPage's routerRedirect) without ever setting forRouter — that
    // redirect target is fetched by a guest's own browser, not RouterOS, so
    // it must never re-trigger the very redirect that sent it here.
    routerId: req.query.router && req.query.router !== '1' ? String(req.query.router)
      : req.query.siteRouter ? String(req.query.siteRouter) : null,
    // The tap-to-connect link in the payment SMS — see notifyVoucher in
    // apply.js. Digits/letters/hyphen only: this becomes the literal RADIUS
    // username on submit, so anything else is dropped rather than trusted.
    prefillCode: /^[A-Za-z0-9-]{1,20}$/.test(String(req.query.code ?? '')) ? req.query.code : null,
    // Where the login form falls back to when this copy was fetched directly
    // from us rather than proxied by RouterOS (see submitHotspotLogin in
    // hotspot-portal.js) — the router's own hotspot DNS name, always
    // reachable in plain HTTP directly on the LAN with no interception
    // trickery needed. Must match the dnsName applyHotspotServer actually
    // pushed (routeros.js, `${subdomain}.spot`, falling back to the same
    // 'billing.spot' default when a tenant has no subdomain yet).
    hotspotDns: tenant.subdomain ? `${tenant.subdomain}.spot` : 'billing.spot',
  }));
}));

/**
 * Just enough to brand the sign-in screen before anyone has signed in.
 *
 * AuthGate has no session yet at that point — no staff row, no tenant_id,
 * nothing — but the hostname alone already says which ISP this is
 * (<subdomain>.vibelink.tech), the same fact /hotspot/login already relies
 * on to brand the captive portal pre-login. Ahead of the generic
 * tenant-resolution middleware and its session lookup/suspension check on
 * purpose: this is one cosmetic string, not a gate anything should have to
 * pass through, and a suspended tenant's own staff still deserve to see
 * their own company name on the screen they need to log in from.
 */
app.get('/api/public/brand', wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'unknown tenant' });
  const { rows: [row] } = await pool.query('select favicon_mime from tenants where id=$1', [tenant.id]);
  res.json({ name: tenant.name ?? null, hasFavicon: !!row?.favicon_mime });
}));

/**
 * The actual bytes for the above. Same pre-middleware placement and the
 * same reasoning — a tab icon has to load on the sign-in screen too, before
 * there is any session to gate it behind, and it has to load for a
 * suspended tenant's own staff the same as their company name does.
 *
 * Cached for a day: an operator who just uploaded a new one can hard-refresh
 * to see it immediately, and everyone else's browser tab catches up within a
 * day rather than this being fetched fresh on every single page load.
 */
app.get('/api/public/favicon', wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).end();
  const { rows: [row] } = await pool.query(
    'select favicon, favicon_mime from tenants where id=$1', [tenant.id]);
  if (!row?.favicon_mime) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.type(row.favicon_mime).send(row.favicon);
}));

/** "Adding a TV or console?" — see devicesPage() for what this actually does. */
app.get('/hotspot/devices', wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  const { devicesPage } = await import('./hotspot-portal.js');
  res.type('html').send(devicesPage({
    company: tenant?.name ?? 'WiFi',
    apiBase: tenant?.subdomain ? `https://${tenant.subdomain}.${root}` : '',
  }));
}));

/**
 * Where a login lands when the operator has not set Hotspot -> Settings ->
 * "Redirect after login".
 *
 * The fallback used to be RouterOS's own $(link-orig) — wherever the guest's
 * browser was originally headed. That is only reliable when the guest was
 * genuinely intercepted mid-request; a guest who opened the portal directly
 * (typed the hotspot DNS name, used a bookmark, tapped the SMS link below)
 * has no "original" request to return to, and $(link-orig) then points back
 * at the login page itself — a login that "succeeds" and reloads the same
 * sign-in form, which reads exactly like the redirect not happening at all.
 * A page on our own walled-garden-reachable host always resolves, so this
 * replaces link-orig as the default rather than depending on it.
 */
app.get('/hotspot/connected', wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  const iconTag = tenant?.subdomain
    ? `<link rel="icon" href="https://${tenant.subdomain}.${root}/api/public/favicon">` : '';
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connected</title>
${iconTag}
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f5f6f3;color:#161a17;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:20px}
.card{max-width:360px;text-align:center;background:#fff;border:1px solid rgba(128,128,128,.25);
border-radius:14px;padding:34px 26px}
h1{margin:0 0 8px;font-size:22px}p{margin:0;color:#8a9186;font-size:14.5px}</style>
</head><body><div class="card">
<h1>You're connected</h1>
<p>${tenant?.name ? `Enjoy your internet from ${tenant.name}.` : 'Enjoy your internet.'}</p>
</div></body></html>`);
}));

/**
 * Buy a bundle from the captive portal, with no account.
 *
 * A hotspot guest has no login and never will — they pick a bundle, get an
 * M-Pesa prompt, and receive a code. Public for the same reason the page is:
 * they are standing on the walled garden with no session and no way to get one.
 *
 * The purchase itself goes through the same funnel as every other payment, so a
 * voucher is issued and texted by the code that already does that. Nothing here
 * grants access on its own — access follows the money arriving.
 */
app.post('/hotspot/buy', stkLimiter, wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  const planId = String(req.body?.planId ?? '');
  let phone = String(req.body?.phone ?? '').trim();
  if (!phone) return res.status(400).json({ error: 'Enter the M-Pesa number to pay from' });

  // 07xx, +2547xx and 2547xx all arrive; Daraja wants the last form.
  phone = phone.replace(/[^0-9+]/g, '').replace(/^\+?(?:254)?0?/, '254');
  if (!/^254[17]\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'That does not look like a Kenyan mobile number' });
  }

  // Which physical router served this guest's login page — embedded in the
  // page itself at Configure time (see the `?router=` on the pushed login
  // URL) and echoed back here by the page's own JS. Optional and
  // best-effort: a page cached from before this existed, or a login served
  // some other way, simply has nothing to say and the sale still goes
  // through — this only ever adds attribution, never blocks a purchase.
  // Verified against this tenant, not trusted outright, same reasoning as
  // every other id the portal hands back to itself.
  let routerId = String(req.body?.routerId ?? '').trim() || null;
  if (routerId) {
    const { rows: [r] } = await pool.query(
      'select id from routers where id=$1 and tenant_id=$2', [routerId, tenant.id]);
    if (!r) routerId = null;
  }

  const { rows: [plan] } = await pool.query(
    `select id, title, price from plans
      where id=$1 and tenant_id=$2 and service='hotspot' and active`,
    [planId, tenant.id]);
  if (!plan) return res.status(404).json({ error: 'That bundle is no longer on sale' });

  const { config } = await import('./db.js');
  /**
   * Which gateway actually takes the payment is the operator's own choice —
   * Hotspot -> Settings -> "Payment method" — not a fixed priority order.
   * This used to always prefer KopoKopo whenever it happened to be
   * configured, so a tenant who set up both gateways and picked "M-Pesa
   * Paybill" in settings (say, because KopoKopo's till has a lower limit,
   * or they simply prefer Daraja) had every hotspot sale silently routed
   * through KopoKopo anyway — the setting was saved, shown as selected, and
   * never once read here.
   */
  const { rows: [hs] } = await pool.query(
    'select payment_method from hotspot_settings where tenant_id=$1', [tenant.id]);
  const method = hs?.payment_method ?? 'kopokopo';

  let kk = null, daraja = null, piggyback = null;
  if (method === 'kopokopo') kk = await config(tenant.id, 'kopokopo');
  else if (method === 'paybill') daraja = await config(tenant.id, 'daraja');
  else if (method === 'piggyback') {
    const { rows: [pb] } = await pool.query(
      "select shortcode from tenant_payment_config where tenant_id=$1 and provider='piggyback_till'",
      [tenant.id]);
    piggyback = pb ?? null;
  } else {
    return res.status(503).json({
      error: `Hotspot payment method "${method}" does not support in-page STK push. `
        + 'Pick KopoKopo or M-Pesa Paybill in Hotspot → Settings.',
    });
  }
  /**
   * PartyB-override STK push only works against Safaricom for an app with
   * aggregator/API-partner approval — without it, every one of these pushes
   * would be dispatched, then rejected or misrouted by Safaricom, which
   * looks to a guest exactly like "the popup never came" for money that may
   * still have moved. Fails closed until that approval is confirmed and this
   * is flipped on, rather than letting a tenant configure a till that quietly
   * does not work the moment a real guest tries to pay it.
   */
  if (method === 'piggyback' && process.env.PIGGYBACK_TILL_ENABLED !== 'true') {
    return res.status(503).json({
      error: 'Buy Goods till (via platform) is not live yet — pending Safaricom aggregator approval. '
        + 'Pick another payment method in Hotspot → Settings for now.',
    });
  }
  if (method === 'piggyback' && !piggyback) {
    return res.status(503).json({
      error: 'Hotspot is set to take payments via your own till, but no till number has been registered yet. '
        + 'Add it under Hotspot → Settings → Payment gateways.',
    });
  }
  // No gateway of the tenant's own — same fallback PPPoE already gets via
  // stkPushForSubscriber: route through the platform owner's paybill instead
  // of leaving the guest with a hard failure, when the tenant opted into it.
  const usePlatformCollect = !kk && !daraja && !piggyback && !!tenant.platform_collect_enabled;
  if (!kk && !daraja && !piggyback && !usePlatformCollect) {
    return res.status(503).json({
      error: `Hotspot is set to take payments via ${method === 'kopokopo' ? 'KopoKopo' : 'M-Pesa Paybill'}, `
        + 'but that gateway is not configured yet. Ask the operator to finish Settings → Payment gateways.',
    });
  }

  try {
    let checkoutId;
    if (kk) {
      const gw = await import('./payments/kopokopo.js');
      checkoutId = await gw.stkPush(tenant.id, {
        phone, amount: Number(plan.price), planId: plan.id, mac: null, routerId, service: 'hotspot',
      });
    } else if (piggyback) {
      const { rows: [owner] } = await pool.query(
        "select tenant_id from staff where is_super_admin and tenant_id is not null limit 1");
      if (!owner) return res.status(503).json({ error: 'The platform Daraja app is not set up yet — ask the platform owner.' });
      const gw = await import('./payments/daraja.js');
      const r = await gw.stkPush(owner.tenant_id, {
        phone, amount: Number(plan.price),
        accountRef: 'HOTSPOT', description: plan.title,
        till: piggyback.shortcode,
      });
      checkoutId = r.CheckoutRequestID;
      if (!checkoutId) {
        return res.status(502).json({ error: r.errorMessage ?? r.ResponseDescription ?? 'The payment gateway did not respond' });
      }
      // Scoped to the real tenant, not the owner: the money never touches the
      // platform's own balance (PartyB was this tenant's till), so this is an
      // ordinary hotspot purpose — no `type`, no settlement/commission — same
      // shape as the plain daraja branch below, just dispatched through a
      // different app's credentials.
      await pool.query(
        `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
         values ($1,'daraja',$2,$3,$4,$5)
         on conflict (tenant_id, provider, checkout_id) do nothing`,
        [tenant.id, checkoutId, phone, Number(plan.price), { plan_id: plan.id, router_id: routerId }]);
    } else if (usePlatformCollect) {
      const { rows: [owner] } = await pool.query(
        "select tenant_id from staff where is_super_admin and tenant_id is not null limit 1");
      if (!owner) return res.status(503).json({ error: 'Platform collection is not set up yet — ask the platform owner.' });
      const gw = await import('./payments/daraja.js');
      const r = await gw.stkPush(owner.tenant_id, {
        phone, amount: Number(plan.price),
        accountRef: `${tenant.subdomain}-HOTSPOT`.slice(0, 20), description: plan.title,
        platformCollect: true,
      });
      checkoutId = r.CheckoutRequestID;
      if (!checkoutId) {
        return res.status(502).json({ error: r.errorMessage ?? r.ResponseDescription ?? 'The payment gateway did not respond' });
      }
      await pool.query(
        `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
         values ($1,'daraja',$2,$3,$4,$5)
         on conflict (tenant_id, provider, checkout_id) do nothing`,
        [owner.tenant_id, checkoutId, phone, Number(plan.price), {
          type: 'platform_collect', tenant_id: tenant.id, plan_id: plan.id, router_id: routerId,
          commissionPct: Number(tenant.settlement_commission_pct ?? 5),
        }]);
    } else {
      const gw = await import('./payments/daraja.js');
      const r = await gw.stkPush(tenant.id, {
        phone, amount: Number(plan.price),
        accountRef: 'HOTSPOT', description: plan.title,
      });
      checkoutId = r.CheckoutRequestID;
      if (!checkoutId) {
        return res.status(502).json({ error: r.errorMessage ?? r.ResponseDescription ?? 'The payment gateway did not respond' });
      }
      /**
       * `plan_id`, not `hotspot_plan_id` — handleStkResult in daraja.js reads
       * `p.plan_id` off this row (`target: ... : { type: 'hotspot',
       * planId: p.plan_id, mac: p.mac }`), and the two names never matched.
       *
       * Every guest who paid a tenant's hotspot through Daraja — anyone
       * without KopoKopo configured, since that is the only other channel
       * this route offers — was charged, the callback found this row, and
       * `issueVoucherAccess` was then called with planId=undefined. No
       * voucher, no SMS, and the only trace was a caught, unlogged-to-anyone
       * exception: handleStkResult's caller only does `.catch(console.error)`.
       * The portal page kept polling forever, because the status it read back
       * was 'success' with no code — which the page's own JS does not
       * recognise as either finished or failed, so it just sits on "Check
       * your phone and enter your M-Pesa PIN" after the phone has already
       * been charged. That is what "the popup does not work, on payment"
       * actually was: not the popup, and not KopoKopo — Daraja hotspot sales,
       * silently, for as long as this key mismatch existed.
       *
       * KopoKopo's own stkPush already writes `plan_id` correctly, which is
       * how this was found: the two gateways' inserts sat a few lines apart
       * using different names for the same thing.
       */
      await pool.query(
        `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
         values ($1,'daraja',$2,$3,$4,$5)
         on conflict (tenant_id, provider, checkout_id) do nothing`,
        [tenant.id, checkoutId, phone, Number(plan.price), { plan_id: plan.id, router_id: routerId }]);
    }
    res.json({ checkoutId, phone, amount: Number(plan.price), plan: plan.title });
  } catch (e) {
    res.status(502).json({ error: e.response?.data?.errorMessage ?? e.message });
  }
}));

/**
 * Has it been paid, and what is the code?
 *
 * Polled by the portal page while the guest is looking at their handset. Scoped
 * to the checkout id they were given, and returns only their own voucher.
 */
app.get('/hotspot/buy/:checkoutId', pollLimiter, wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  // Platform-collect dispatches through the platform owner's own Daraja app
  // (see the piggyback/platform-collect branches of POST /hotspot/buy), so
  // the row this inserted lives under owner.tenant_id, not this tenant's —
  // only purpose.tenant_id says who it was actually for. Scoping strictly to
  // tenant_id here meant this guest's own poll could never find their own
  // row: the payment succeeded and a voucher was issued, but this always
  // returned 'unknown' before ever reaching the query that would have found
  // it, so the page never learned its own payment had gone through.
  const { rows: [r] } = await pool.query(
    `select checkout_id, status, result_desc from stk_requests
      where checkout_id=$2 and (tenant_id=$1 or purpose->>'tenant_id'=$1::text)`,
    [tenant.id, req.params.checkoutId]);
  if (!r) return res.json({ status: 'unknown' });

  // The voucher is reached through the payment the callback applied, so a code
  // only ever appears once the money actually arrived.
  //
  // payload->>'checkoutId', not provider_ref: applyPayment stores the
  // gateway's own transaction reference there (an M-Pesa receipt number for
  // Daraja, KopoKopo's own reference) — a real, useful value, just never the
  // checkout id this page is polling with. handleStkResult always tucks the
  // checkout id into payload specifically so it could be found again, but
  // nothing here was ever reading it from there — every hotspot purchase's
  // payment row existed, correctly linked to its voucher, and this query
  // still came up empty every time, on a plain string mismatch.
  const { rows: [v] } = await pool.query(
    `select v.code, v.expires_at
       from payments p join vouchers v on v.id = p.voucher_id
      where p.tenant_id=$1 and p.payload->>'checkoutId'=$2`, [tenant.id, req.params.checkoutId]);

  res.json({ status: r.status, detail: r.result_desc ?? null, code: v?.code ?? null });
}));

/**
 * Whether a voucher a guest is already using is still good — polled by the
 * page itself after it shows "Paid," which is the only point nothing was
 * watching before. jobs.js's expireAndSuspend also flips in_use vouchers
 * past their expiry, but only every 5 minutes; a guest sitting on this page
 * deserves better than up to 5 minutes of "connected" reading true after it
 * stopped being true. The update here is the same one-liner, run inline
 * so a poll is also the moment the status becomes accurate, not just the
 * moment it gets checked.
 */
app.get('/hotspot/voucher-status', pollLimiter, wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  const code = String(req.query.code ?? '').trim();
  if (!code) return res.status(400).json({ error: 'no code' });

  await pool.query(
    `update vouchers set status='expired'
      where tenant_id=$1 and code=$2 and status='in_use' and expires_at < now()`,
    [tenant.id, code]);

  const { rows: [v] } = await pool.query(
    'select status, expires_at from vouchers where tenant_id=$1 and code=$2', [tenant.id, code]);
  if (!v) return res.json({ status: 'unknown' });
  res.json({ status: v.status, expiresAt: v.expires_at });
}));

/**
 * "Does this MAC already have paid time left?" — the login page calls this
 * on load and auto-submits if so, which is the actual fix for a guest
 * getting the sign-in form again after their router loses power.
 *
 * The router's own answer to that ("has this device logged in before?") is
 * add-mac-cookie, and that table lives in RAM: RouterOS forgets it on
 * reboot, which is a documented MikroTik limitation, not something this
 * router push got wrong. Driving it from our own database instead means the
 * guest is recognised again the moment the billing system is reachable,
 * with no dependency on what state the router's own cookie table survived a
 * power cut in.
 */
app.get('/hotspot/voucher-for-mac', pollLimiter, wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  const mac = String(req.query.mac ?? '').trim().toLowerCase();
  if (!mac || mac === '00:00:00:00:00:00') return res.json({ code: null });

  await pool.query(
    `update vouchers set status='expired'
      where tenant_id=$1 and status='in_use' and expires_at is not null and expires_at < now()`,
    [tenant.id]);

  // A second device (see /hotspot/nearby-devices below) shares the same
  // code as the voucher it was added to, so this has to recognise its MAC
  // too — not just the one the voucher was originally bought from.
  const { rows: [v] } = await pool.query(
    `select v.code from vouchers v
      where v.tenant_id=$1 and lower(v.mac::text)=$2 and v.status='in_use'
        and (v.expires_at is null or v.expires_at > now())
      union all
      select v.code from voucher_devices d
      join vouchers v on v.id = d.voucher_id
      where v.tenant_id=$1 and lower(d.mac::text)=$2 and v.status='in_use'
        and (v.expires_at is null or v.expires_at > now())
      limit 1`,
    [tenant.id, mac]);
  res.json({ code: v?.code ?? null });
}));

/**
 * Shared by both device-adding routes: find the guest's own voucher and the
 * router it is actually online through right now — everything after this
 * needs both, and getting the router wrong means reading the wrong box's
 * host list entirely.
 */
async function voucherAndRouter(tenantId, code) {
  const { rows: [v] } = await pool.query(
    `select * from vouchers where tenant_id=$1 and code=$2 and status='in_use'
       and (expires_at is null or expires_at > now())`,
    [tenantId, code]);
  if (!v) return { error: 'That code is not an active voucher.' };

  const { rows: [session] } = await pool.query(
    `select host(nasipaddress) as nas from radacct
      where username=$1 and acctstoptime is null
      order by acctstarttime desc limit 1`, [code]);
  if (!session?.nas) return { error: 'That device does not look connected right now — try again once it is online.' };

  const { rows: [r] } = await pool.query(
    `select id, name, host, api_port, service_user, service_password_enc
       from routers where tenant_id=$1 and host(host)=$2`, [tenantId, session.nas]);
  if (!r?.service_user || !r.service_password_enc) {
    return { error: 'This router has not been configured for the billing system yet.' };
  }
  return { voucher: v, router: r };
}

/**
 * Everything the "Adding a TV or console?" page needs to sell a bundle
 * straight to a device that was never going to type a code in — every
 * device currently seen on any of this tenant's hotspot routers, and every
 * bundle on sale, in one call, before any payment has happened at all.
 *
 * Every one of the tenant's hotspot-capable routers is queried and merged
 * rather than picking "the" router, because nothing about this request says
 * which physical site the guest is standing at. In practice a MAC only ever
 * shows up on the one router it is actually near — hotspot sites are
 * separate physical locations, not bridged together — so merging is safe;
 * router_id travels with each device so the purchase below knows which box
 * to bind it on once it is chosen. One unreachable router logs and is
 * skipped rather than blanking the whole list for every other site.
 */
app.get('/hotspot/tv-options', pollLimiter, wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  const { rows: plans } = await pool.query(
    `select id, title, price, duration_min, rate_down from plans
      where tenant_id=$1 and service='hotspot' and active order by price limit 6`,
    [tenant.id]);

  const { rows: routers } = await pool.query(
    `select id, host, api_port, service_user, service_password_enc from routers
      where tenant_id=$1 and role in ('hotspot','both') and service_user is not null`,
    [tenant.id]);

  // Whatever name this device was given last time it was bought for — a
  // returning TV should not read back as "Unknown device" or a bare MAC
  // just because this is a fresh trip through the buy flow rather than the
  // same browser tab as before; the router has no memory of the name at
  // all, only we do. distinct on (mac): a device can carry a different
  // label across several past purchases if it was renamed, and the most
  // recent one someone actually typed is the one worth showing.
  const { rows: knownLabels } = await pool.query(
    `select distinct on (d.mac) d.mac, d.label
       from voucher_devices d
       join vouchers v on v.id = d.voucher_id
      where v.tenant_id=$1 and d.label is not null
      order by d.mac, d.added_at desc`,
    [tenant.id]);
  const labelByMac = new Map(knownLabels.map((r) => [String(r.mac).toUpperCase(), r.label]));

  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const devices = [];
  for (const r of routers) {
    try {
      const password = secrets.decrypt(r.service_password_enc);
      const conn = await ros.connect({
        host: String(r.host).split('/')[0], port: r.api_port ?? 8728,
        user: r.service_user, password, timeoutSec: 8,
      });
      try {
        const found = await ros.nearbyDevices(conn);
        for (const d of found) {
          devices.push({ ...d, routerId: r.id, knownLabel: labelByMac.get(String(d.mac).toUpperCase()) ?? null });
        }
      } finally {
        ros.close(conn);
      }
    } catch (e) {
      console.error('tv-options: could not read router', r.id, e.message);
    }
  }

  res.json({ devices, plans });
}));

/**
 * Pay for a bundle and a device in one step — no voucher code changes
 * hands at any point. The device is bound on its router the moment the
 * payment applies (see apply.js's bindDeviceOnRouter), which is the entire
 * point for a TV: nothing here ever asks it to submit anything.
 */
app.post('/hotspot/tv-buy', stkLimiter, wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  const mac = String(req.body?.mac ?? '').trim().toUpperCase();
  const routerId = String(req.body?.routerId ?? '').trim();
  const planId = String(req.body?.planId ?? '');
  // Guest-chosen, shown back to them and to the operator wherever this
  // device turns up (vouchers list, expiry logs) — "Living room TV" beats
  // hunting for a MAC address later. Length-capped, not otherwise
  // validated: it is display text, never interpreted as anything.
  const label = String(req.body?.label ?? '').trim().slice(0, 60) || null;
  let phone = String(req.body?.phone ?? '').trim();
  if (!mac || !routerId) return res.status(400).json({ error: 'Pick a device from the list first.' });
  if (!phone) return res.status(400).json({ error: 'Enter the M-Pesa number to pay from' });

  phone = phone.replace(/[^0-9+]/g, '').replace(/^\+?(?:254)?0?/, '254');
  if (!/^254[17]\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'That does not look like a Kenyan mobile number' });
  }

  const { rows: [plan] } = await pool.query(
    `select id, title, price from plans
      where id=$1 and tenant_id=$2 and service='hotspot' and active`,
    [planId, tenant.id]);
  if (!plan) return res.status(404).json({ error: 'That bundle is no longer on sale' });

  const { rows: [router] } = await pool.query(
    `select id, host, api_port, service_user, service_password_enc from routers
      where id=$1 and tenant_id=$2`, [routerId, tenant.id]);
  if (!router?.service_user) return res.status(404).json({ error: 'That router is not set up for this yet.' });

  // Re-checked against the router's own list, not trusted from the request —
  // same reasoning as /hotspot/nearby-devices/bind below: the tv-options GET
  // is a convenience list, not a permission slip, and paying for a MAC
  // nobody actually saw on this network would be a free-access hole.
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  try {
    const password = secrets.decrypt(router.service_password_enc);
    const conn = await ros.connect({
      host: String(router.host).split('/')[0], port: router.api_port ?? 8728,
      user: router.service_user, password, timeoutSec: 8,
    });
    let devices;
    try { devices = await ros.nearbyDevices(conn); } finally { ros.close(conn); }
    if (!devices.some((d) => d.mac === mac)) {
      return res.status(404).json({ error: 'That device is not currently on this network — refresh and try again.' });
    }
  } catch (e) {
    return res.status(502).json({ error: `Could not reach the router: ${e.message}` });
  }

  const { config } = await import('./db.js');
  const { rows: [hs] } = await pool.query('select payment_method from hotspot_settings where tenant_id=$1', [tenant.id]);
  const method = hs?.payment_method ?? 'kopokopo';

  let kk = null, daraja = null, piggyback = null;
  if (method === 'kopokopo') kk = await config(tenant.id, 'kopokopo');
  else if (method === 'paybill') daraja = await config(tenant.id, 'daraja');
  else if (method === 'piggyback') {
    const { rows: [pb] } = await pool.query(
      "select shortcode from tenant_payment_config where tenant_id=$1 and provider='piggyback_till'",
      [tenant.id]);
    piggyback = pb ?? null;
  } else {
    return res.status(503).json({
      error: `Hotspot payment method "${method}" does not support in-page STK push. `
        + 'Pick KopoKopo or M-Pesa Paybill in Hotspot → Settings.',
    });
  }
  /**
   * PartyB-override STK push only works against Safaricom for an app with
   * aggregator/API-partner approval — without it, every one of these pushes
   * would be dispatched, then rejected or misrouted by Safaricom, which
   * looks to a guest exactly like "the popup never came" for money that may
   * still have moved. Fails closed until that approval is confirmed and this
   * is flipped on, rather than letting a tenant configure a till that quietly
   * does not work the moment a real guest tries to pay it.
   */
  if (method === 'piggyback' && process.env.PIGGYBACK_TILL_ENABLED !== 'true') {
    return res.status(503).json({
      error: 'Buy Goods till (via platform) is not live yet — pending Safaricom aggregator approval. '
        + 'Pick another payment method in Hotspot → Settings for now.',
    });
  }
  if (method === 'piggyback' && !piggyback) {
    return res.status(503).json({
      error: 'Hotspot is set to take payments via your own till, but no till number has been registered yet. '
        + 'Add it under Hotspot → Settings → Payment gateways.',
    });
  }
  // Same platform-paybill fallback as /hotspot/buy above.
  const usePlatformCollect = !kk && !daraja && !piggyback && !!tenant.platform_collect_enabled;
  if (!kk && !daraja && !piggyback && !usePlatformCollect) {
    return res.status(503).json({
      error: `Hotspot is set to take payments via ${method === 'kopokopo' ? 'KopoKopo' : 'M-Pesa Paybill'}, `
        + 'but that gateway is not configured yet. Ask the operator to finish Settings → Payment gateways.',
    });
  }

  try {
    let checkoutId;
    if (kk) {
      const gw = await import('./payments/kopokopo.js');
      checkoutId = await gw.stkPush(tenant.id, {
        phone, amount: Number(plan.price), planId: plan.id, mac, routerId: router.id, label, service: 'hotspot',
      });
    } else if (piggyback) {
      const { rows: [owner] } = await pool.query(
        "select tenant_id from staff where is_super_admin and tenant_id is not null limit 1");
      if (!owner) return res.status(503).json({ error: 'The platform Daraja app is not set up yet — ask the platform owner.' });
      const gw = await import('./payments/daraja.js');
      const r = await gw.stkPush(owner.tenant_id, {
        phone, amount: Number(plan.price),
        accountRef: 'HOTSPOT', description: plan.title,
        till: piggyback.shortcode,
      });
      checkoutId = r.CheckoutRequestID;
      if (!checkoutId) {
        return res.status(502).json({ error: r.errorMessage ?? r.ResponseDescription ?? 'The payment gateway did not respond' });
      }
      await pool.query(
        `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
         values ($1,'daraja',$2,$3,$4,$5)
         on conflict (tenant_id, provider, checkout_id) do nothing`,
        [tenant.id, checkoutId, phone, Number(plan.price), { plan_id: plan.id, mac, router_id: router.id, label }]);
    } else if (usePlatformCollect) {
      const { rows: [owner] } = await pool.query(
        "select tenant_id from staff where is_super_admin and tenant_id is not null limit 1");
      if (!owner) return res.status(503).json({ error: 'Platform collection is not set up yet — ask the platform owner.' });
      const gw = await import('./payments/daraja.js');
      const r = await gw.stkPush(owner.tenant_id, {
        phone, amount: Number(plan.price),
        accountRef: `${tenant.subdomain}-HOTSPOT`.slice(0, 20), description: plan.title,
        platformCollect: true,
      });
      checkoutId = r.CheckoutRequestID;
      if (!checkoutId) {
        return res.status(502).json({ error: r.errorMessage ?? r.ResponseDescription ?? 'The payment gateway did not respond' });
      }
      await pool.query(
        `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
         values ($1,'daraja',$2,$3,$4,$5)
         on conflict (tenant_id, provider, checkout_id) do nothing`,
        [owner.tenant_id, checkoutId, phone, Number(plan.price), {
          type: 'platform_collect', tenant_id: tenant.id, plan_id: plan.id, mac, router_id: router.id, label,
          commissionPct: Number(tenant.settlement_commission_pct ?? 5),
        }]);
    } else {
      const gw = await import('./payments/daraja.js');
      const r = await gw.stkPush(tenant.id, {
        phone, amount: Number(plan.price),
        accountRef: 'HOTSPOT', description: plan.title,
      });
      checkoutId = r.CheckoutRequestID;
      if (!checkoutId) {
        return res.status(502).json({ error: r.errorMessage ?? r.ResponseDescription ?? 'The payment gateway did not respond' });
      }
      await pool.query(
        `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
         values ($1,'daraja',$2,$3,$4,$5)
         on conflict (tenant_id, provider, checkout_id) do nothing`,
        [tenant.id, checkoutId, phone, Number(plan.price), { plan_id: plan.id, mac, router_id: router.id, label }]);
    }
    res.json({ checkoutId, phone, amount: Number(plan.price), plan: plan.title });
  } catch (e) {
    res.status(502).json({ error: e.response?.data?.errorMessage ?? e.message });
  }
}));

/**
 * Devices on the same hotspot that have not logged in yet — a TV or console
 * a guest cannot type a code into themselves, found from a device that can:
 * their own already-connected phone. Only reachable with a real, currently
 * active voucher code, which is the same proof of purchase the code itself
 * already is; nothing here is guessable the login form was not already.
 */
app.get('/hotspot/nearby-devices', pollLimiter, wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  const code = String(req.query.code ?? '').trim();
  if (!code) return res.status(400).json({ error: 'no code' });

  const { rows: [hs] } = await pool.query('select multi_device from hotspot_settings where tenant_id=$1', [tenant.id]);

  const found = await voucherAndRouter(tenant.id, code);
  if (found.error) return res.status(404).json({ error: found.error });

  const { rows: existing } = await pool.query(
    `select mac from voucher_devices where voucher_id=$1
     union all select $2::macaddr`, [found.voucher.id, found.voucher.mac]);
  const taken = new Set(existing.map((r) => String(r.mac).toUpperCase()).filter(Boolean));
  /**
   * This used to require multi_device to be on at all — but this list is a
   * MAC-picker for whichever device the guest is registering, not the
   * device-sharing feature itself. A single-device code still only ever
   * bought one device's worth of access; a TV that cannot type a code
   * benefits from picking it off a list exactly as much whether or not
   * sharing is enabled, it just gets one slot instead of three. 3 mirrors
   * the shared-users the router push already gives a multi_device voucher
   * (see the sharedUsers ternary elsewhere) — the device list must not
   * offer more devices than the router will actually let authenticate at
   * once, in either case.
   */
  const limit = hs?.multi_device ? 3 : 1;
  const slotsLeft = Math.max(0, limit - taken.size);

  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const r = found.router;
  try {
    const password = secrets.decrypt(r.service_password_enc);
    const conn = await ros.connect({
      host: String(r.host).split('/')[0], port: r.api_port ?? 8728,
      user: r.service_user, password, timeoutSec: 8,
    });
    let devices;
    try { devices = await ros.nearbyDevices(conn); } finally { ros.close(conn); }
    res.json({ devices: devices.filter((d) => !taken.has(d.mac)), slotsLeft });
  } catch (e) {
    res.status(502).json({ error: `Could not read the router: ${e.message}` });
  }
}));

/** Add one of those devices to the same voucher, so it authenticates with the same code. */
app.post('/hotspot/nearby-devices/bind', stkLimiter, wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  const code = String(req.body?.code ?? '').trim();
  const mac = String(req.body?.mac ?? '').trim().toUpperCase();
  const label = String(req.body?.label ?? '').trim().slice(0, 60) || null;
  if (!code || !mac) return res.status(400).json({ error: 'code and mac are required' });

  const { rows: [hs] } = await pool.query('select multi_device from hotspot_settings where tenant_id=$1', [tenant.id]);

  const found = await voucherAndRouter(tenant.id, code);
  if (found.error) return res.status(404).json({ error: found.error });

  // Same limit as the list above: 3 slots when sharing is on, 1 when it's
  // not — a single-device code registering its one device through the MAC
  // picker instead of typing it in, not an extra device beyond what was paid for.
  const limit = hs?.multi_device ? 3 : 1;
  const { rows: [{ count }] } = await pool.query(
    'select count(*)::int from voucher_devices where voucher_id=$1', [found.voucher.id]);
  if (count + 1 >= limit) {   // +1 for the voucher's own original device
    return res.status(409).json({ error: 'This code already has as many devices as it can take.' });
  }

  const { rows: [plan] } = await pool.query(
    'select rate_down, rate_up from plans where id=$1', [found.voucher.plan_id]);

  // Re-read the router's own host list rather than trusting the mac the
  // client sent — the earlier GET is a convenience list, not a permission
  // slip, and binding a mac nobody actually saw on this network would let
  // a guest grant free access to any device whose address they could guess.
  //
  // The bind itself needs no code at all once this confirms the device is
  // real — see bindDeviceByMac. That is deliberate: a shared voucher code
  // is a secret that can be typed into a second device by anyone who reads
  // it off a receipt or overhears it, which is exactly the "code sharing"
  // this is meant to close. A MAC bypass has nothing to type anywhere.
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const r = found.router;
  try {
    const password = secrets.decrypt(r.service_password_enc);
    const conn = await ros.connect({
      host: String(r.host).split('/')[0], port: r.api_port ?? 8728,
      user: r.service_user, password, timeoutSec: 8,
    });
    try {
      const devices = await ros.nearbyDevices(conn);
      if (!devices.some((d) => d.mac === mac)) {
        return res.status(404).json({ error: 'That device is not currently on this network.' });
      }
      // Same identification the direct-buy flow's binding carries — code
      // plus whatever name the guest gave it, so this device reads the same
      // way on the router itself (Winbox: IP -> Hotspot -> IP Bindings)
      // regardless of which of the two flows actually bound it.
      await ros.bindDeviceByMac(conn, {
        mac, downKbps: plan?.rate_down ?? 2000, upKbps: plan?.rate_up ?? 1000,
        comment: label ? `${found.voucher.code} — ${label}` : found.voucher.code,
      });
    } finally {
      ros.close(conn);
    }
  } catch (e) {
    return res.status(502).json({ error: `Could not add that device on the router: ${e.message}` });
  }

  // Kept for expiry bookkeeping only now — not for authentication, which the
  // ip-binding above already handles entirely on its own. router_id is what
  // lets expiry cleanup find its way back to this exact box later.
  await pool.query(
    `insert into voucher_devices (voucher_id, mac, router_id, label) values ($1,$2,$3,$4)
     on conflict (voucher_id, mac) do update set router_id = excluded.router_id,
       label = coalesce(excluded.label, voucher_devices.label)`,
    [found.voucher.id, mac, r.id, label]);
  res.json({ ok: true });
}));

/**
 * A public help center — every published kb_articles row for this tenant,
 * reachable without signing in at all. Existed only inside the admin app
 * before this (GET /api/kb-articles, behind a staff session), which meant a
 * customer could never actually be pointed at it — the chat_offline
 * auto-reply linking here is the reason this exists now, but it stands on
 * its own too (a "how do I..." page worth bookmarking, not just a fallback
 * for when nobody's online).
 */
app.get('/help', wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).send('Unknown network');

  const { rows: articles } = await pool.query(
    `select title, category, body from kb_articles
      where tenant_id=$1 and published order by category nulls last, title`,
    [tenant.id]);

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const byCategory = new Map();
  for (const a of articles) {
    const cat = a.category || 'General';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(a);
  }

  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tenant.name)} — Help</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px 16px 60px; color: #17231d; background: #fafaf7; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 14px; margin-bottom: 24px; }
  input[type=search] { width: 100%; box-sizing: border-box; padding: 11px 14px; border: 1px solid #ddd; border-radius: 10px; font-size: 15px; margin-bottom: 20px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #888; margin: 24px 0 8px; }
  details { background: #fff; border: 1px solid #e6e6e0; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
  summary { font-weight: 600; cursor: pointer; }
  .body { margin-top: 8px; font-size: 14.5px; line-height: 1.6; white-space: pre-wrap; }
  .empty { color: #888; text-align: center; padding: 40px 0; }
</style></head><body>
<h1>${esc(tenant.name)} — Help</h1>
<div class="sub">Common answers, any time — no need to wait for a reply.</div>
${articles.length ? '<input type="search" id="q" placeholder="Search…" onkeyup="filter()">' : ''}
<div id="list">
${articles.length === 0 ? '<div class="empty">Nothing published yet.</div>' : [...byCategory.entries()].map(([cat, items]) => `
  <h2>${esc(cat)}</h2>
  ${items.map((a) => `<details class="art" data-t="${esc(a.title.toLowerCase())}">
    <summary>${esc(a.title)}</summary>
    <div class="body">${esc(a.body)}</div>
  </details>`).join('')}
`).join('')}
</div>
<script>
function filter(){
  var q=document.getElementById('q').value.toLowerCase();
  document.querySelectorAll('.art').forEach(function(el){
    el.style.display = el.dataset.t.indexOf(q) === -1 ? 'none' : '';
  });
}
</script>
</body></html>`);
}));

/**
 * Live chat for people with no account.
 *
 * A hotspot guest has not paid yet and a customer may not have a portal
 * password, so neither can be asked to sign in before asking a question — and
 * the question is often why they cannot. These routes sit beside /hotspot/* for
 * the same reason: reachable from the walled garden, before any session exists.
 *
 * A token returned at the start is what proves this browser owns the
 * conversation. Without it the chat id alone would let anyone read somebody
 * else's by guessing.
 */
app.post('/chat/start', wrap(async (req, res) => {
  const tenant = await tenantByHost(req.hostname)
    ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  if (!tenant) return res.status(404).json({ error: 'Unknown network' });

  const name = String(req.body?.name ?? '').trim().slice(0, 60) || 'Guest';
  const phone = String(req.body?.phone ?? '').replace(/[^0-9+]/g, '').slice(0, 15) || null;
  const token = crypto.randomBytes(24).toString('base64url');

  const { rows: [chat] } = await pool.query(
    `insert into live_chats (tenant_id, visitor_ref, status, token, display_name, last_visitor_at)
     values ($1,$2,'waiting',$3,$4, now()) returning id`,
    [tenant.id, phone ?? 'anonymous', token, name]);

  // An immediate acknowledgment when nobody's actually around to answer —
  // the standard shape for this (see the WhatsApp/live-chat research this
  // was built from): confirm the message arrived and set an expectation,
  // rather than a visitor typing into what looks like silence. Checked
  // against staff.last_seen, kept current by the app's own presence
  // heartbeat rather than only the moment someone last logged in.
  if (phone) {
    const { rows: [online] } = await pool.query(
      "select exists(select 1 from staff where tenant_id=$1 and last_seen > now() - interval '2 minutes') as any",
      [tenant.id]);
    if (!online.any) {
      const sms = await import('./sms.js');
      const org = await sms.orgVars(tenant.id);
      const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();

      // The single most common thing a chat opens with is "am I still
      // active / what do I owe" — if this visitor is a signed-in customer,
      // answer that directly rather than making them wait for a human to
      // say what the system already knows. Best-effort: no session at all
      // (an anonymous hotspot guest, or someone not signed in) just skips
      // this, same as a wrong/expired portal cookie would.
      let accountStatus = '';
      try {
        const session = await portalSession(req);
        if (session) {
          const days = session.expires_at
            ? Math.ceil((new Date(session.expires_at).getTime() - Date.now()) / 86400000) : null;
          accountStatus = ` Your account ${session.account_code} is ${session.status}`
            + (days == null ? '.' : days > 0 ? `, ${days} day(s) left.` : ', expired.');
        }
      } catch { /* no session — skip the account line, not the whole auto-reply */ }

      // Only when the tenant has actually published something — a link to
      // an empty help page is worse than no link at all.
      const { rows: [kb] } = await pool.query(
        'select 1 from kb_articles where tenant_id=$1 and published limit 1', [tenant.id]);
      const helpLink = kb && tenant.subdomain ? ` Common answers: https://${tenant.subdomain}.${root}/help.` : '';

      sms.send(tenant.id, phone, 'chat_offline', {
        company: org.company, support_phone: org.supportPhone,
        account_status: accountStatus, help_link: helpLink,
      }).catch((e) => console.error('chat_offline auto-reply failed', e.message));
    }
  }

  res.json({ chatId: chat.id, token });
}));

/** One message from the visitor. */
app.post('/chat/:id/message', wrap(async (req, res) => {
  const body = String(req.body?.body ?? '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Type a message first' });

  const { rows: [chat] } = await pool.query(
    "select id, tenant_id, status from live_chats where id=$1 and token=$2",
    [req.params.id, String(req.body?.token ?? '')]);
  if (!chat) return res.status(404).json({ error: 'That conversation has ended' });
  if (chat.status === 'closed') return res.status(409).json({ error: 'That conversation was closed' });

  await pool.query(
    "insert into chat_messages (tenant_id, chat_id, sender, body) values ($1,$2,'visitor',$3)",
    [chat.tenant_id, chat.id, body]);
  await pool.query('update live_chats set last_visitor_at=now() where id=$1', [chat.id]);
  res.json({ ok: true });
}));

/**
 * Everything said so far, or everything since a given id.
 *
 * Polled rather than pushed. A websocket would be better for a busy support
 * desk and worse here: this has to survive a captive portal, a phone that
 * sleeps, and a network the guest has not paid for yet.
 */
app.get('/chat/:id', wrap(async (req, res) => {
  const { rows: [chat] } = await pool.query(
    'select id, tenant_id, status from live_chats where id=$1 and token=$2',
    [req.params.id, String(req.query.token ?? '')]);
  if (!chat) return res.status(404).json({ error: 'That conversation has ended' });

  const { rows } = await pool.query(
    `select id, sender, body, created_at from chat_messages
      where chat_id=$1 and id > $2 order by id limit 200`,
    [chat.id, Number(req.query.since) || 0]);

  res.json({ status: chat.status, messages: rows });
}));

/**
 * FreeRADIUS post-auth hook: starts the clock when voucher_expiry = 'login'.
 *
 * Two separate bugs here, previously: sites-available/billing's post-auth
 * section never actually called this at all — it set a control attribute
 * (Tmp-String-0) that goes nowhere, described in a comment as "tell the app
 * a voucher has been used" while doing nothing of the kind. startVoucherClock
 * existed, was fully correct, and was simply never invoked by anything, for
 * any tenant, ever — 'login' is hotspot_settings' own default, so this was
 * not an edge case. And this route used to sit after the generic tenant-
 * resolution middleware further down, which requires req.tenant to resolve
 * from the request's *hostname* — fine for a browser on a tenant's own
 * subdomain, meaningless for FreeRADIUS calling this internally with no
 * tenant subdomain to send as a Host header at all. Fixed by moving the
 * route above that middleware (same reason /chat/* and /portal/* already
 * live up here) and resolving tenant_id from the voucher code itself —
 * which this needs anyway, since a code is only unique per tenant.
 *
 * Fires on every successful auth, not only hotspot ones (FreeRADIUS's
 * post-auth section has no way to tell PPPoE and hotspot apart before this
 * runs) — a PPPoE username simply matches no voucher and this is a no-op,
 * same as it already was for a 'creation'-mode or already-started voucher.
 *
 * The only thing stopping a stranger from hitting this is Caddy simply
 * never proxying /radius/* from the public listener — correct, but a single
 * point of failure: one wildcard `handle` block in the Caddyfile and this
 * becomes a public "start any voucher's clock" endpoint with no auth of its
 * own. RADIUS_INTERNAL_SECRET is a second, independent layer: set it and
 * configure FreeRADIUS's post-auth call to send it as X-Internal-Secret, and
 * a Caddy misconfiguration alone is no longer enough. Left optional so this
 * does not silently break an existing FreeRADIUS deployment that predates it.
 */
app.post('/radius/post-auth', wrap(async (req, res) => {
  const secret = process.env.RADIUS_INTERNAL_SECRET;
  if (secret && req.get('X-Internal-Secret') !== secret) return res.status(403).end();

  const username = String(req.body?.username ?? '').trim();
  if (!username) return res.json({ ok: true });

  const { rows: [v] } = await pool.query(
    'select tenant_id from vouchers where code=$1', [username]);
  if (!v) return res.json({ ok: true });   // not a voucher — a PPPoE login, most likely

  const { startVoucherClock } = await import('./radius.js');
  const { withTenant } = await import('./db.js');
  await withTenant(v.tenant_id, (c) => startVoucherClock(c, v.tenant_id, username));
  res.json({ ok: true });
}));

// Tenant resolution for everything else.
// The signed-in session is authoritative; hostname is the fallback for the captive
// portal and webhooks, which have no session. DEV_TENANT lets the Vite dev server
// (which reaches us on localhost, matching no subdomain) pin one — never in production.
app.use(async (req, res, next) => {
  const session = await auth.readSession(auth.sessionToken(req));
  if (session) {
    req.session = session;
    const { rows: [t] } = await pool.query('select * from tenants where id=$1', [session.tenant_id]);
    req.tenant = t;
  }
  if (!req.tenant) req.tenant = await tenantByHost(req.hostname);
  if (!req.tenant && process.env.DEV_TENANT) req.tenant = await tenantByHost(process.env.DEV_TENANT);
  if (!req.tenant) return res.status(404).json({ error: 'unknown tenant' });
  if (req.tenant.status === 'suspended') return res.status(402).json({ error: 'subscription suspended' });

  /**
   * Read-only: an overdue platform invoice has reached day 5.
   *
   * Reading stays open on purpose. An operator who cannot see who owes them money
   * cannot collect it, and collecting it is how they pay us — locking them out
   * entirely works against the thing we want to happen. So every screen still
   * loads and only changes are refused.
   *
   * The captive portal and webhooks are exempt: their customers are not the ones
   * in arrears, and a payment arriving is what lifts this.
   */
  if (req.tenant.status === 'readonly'
      && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && !req.path.startsWith('/portal/')) {
    return res.status(402).json({
      error: 'Your account is read-only until the platform invoice is paid. You can still view everything.',
      readOnly: true,
    });
  }
  next();
});

/**
 * Everything below this line requires a signed-in admin.
 *
 * The resolver above establishes *which* tenant a request belongs to, from the
 * session or failing that the hostname. Resolving a tenant is not the same as
 * being allowed to read it, and nothing enforced the difference: on a public
 * server every /api route answered anyone who knew the hostname — subscribers,
 * payments, SMS logs, gateway settings. It only looked harmless while the
 * database was empty.
 *
 * Exceptions, both public by necessity:
 *   /portal/*  the captive portal, used by subscribers who have no admin login
 *   /radius/*  called by FreeRADIUS over the internal network; Caddy must not
 *              proxy it from outside
 *   /hotspot/* the login page a RouterOS box downloads with /tool/fetch. It has
 *              no session and cannot acquire one, and the page carries only a
 *              company name and prices already advertised to guests.
 *
 * Auth and webhook routes are mounted above the resolver and never reach here.
 */
app.use((req, res, next) => {
  if (req.path.startsWith('/portal/') || req.path.startsWith('/radius/')
      || req.path.startsWith('/hotspot/')) return next();
  if (!req.session) return res.status(401).json({ error: 'sign in required' });
  next();
});

/**
 * Gate a route to specific staff roles, on top of the plain "signed in" check
 * above. Platform owner (`is_super_admin`) always passes — they already have
 * unrestricted cross-tenant access elsewhere.
 *
 * Applied narrowly to routes that read or write credentials (router logins,
 * PPPoE/portal passwords, payment-gateway API secrets): a `support` account
 * has no business reading those, and until now nothing stopped it.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.session.is_super_admin || roles.includes(req.session.role)) return next();
    res.status(403).json({ error: 'not allowed for your role' });
  };
}

/* ── customer portal ───────────────────────────────
 *
 * Lives at /portal/*, which the guard above lets through unauthenticated —
 * customers have no admin session and never will. Its own cookie and its own
 * table, so a subscriber cannot end up holding anything the admin app accepts.
 */
const PORTAL_COOKIE = 'vibelink_portal';
const PORTAL_DAYS = 30;

function portalToken(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const pair of raw.split(';')) {
    const i = pair.indexOf('=');
    if (i > -1 && pair.slice(0, i).trim() === PORTAL_COOKIE) return decodeURIComponent(pair.slice(i + 1).trim());
  }
  return null;
}

async function portalSession(req) {
  const token = portalToken(req);
  if (!token) return null;
  const { rows: [row] } = await pool.query(
    `select s.subscriber_id, s.tenant_id, sub.name, sub.account_code, sub.phone,
            sub.status, sub.expires_at, sub.service, sub.router_id,
            sub.portal_password_hash,
            p.title as plan_title, p.price as plan_price, p.rate_down, p.rate_up
       from portal_sessions s
       join subscribers sub on sub.id = s.subscriber_id
       left join plans p on p.id = sub.plan_id
      where s.token = $1 and s.expires_at > now()`, [token]);
  return row ?? null;
}

/**
 * Sign in with the account number and the portal password.
 *
 * The account number is the username on purpose: it is the same number they
 * quote when paying, already printed on their receipts, and the one thing a
 * customer reliably knows about themselves.
 */
app.post('/portal/login', loginLimiter, wrap(async (req, res) => {
  const account = String(req.body?.account ?? '').trim();
  const password = String(req.body?.password ?? '');
  // Deliberately one message for both cases: telling a stranger which account
  // numbers exist is a free customer list.
  const wrong = { error: 'Wrong account number or password.' };
  if (!account || !password) return res.status(400).json(wrong);

  const { rows: [s] } = await pool.query(
    'select id, portal_password_hash from subscribers where tenant_id=$1 and account_code=$2',
    [req.tenant.id, account]);
  if (!s?.portal_password_hash) return res.status(401).json(wrong);
  if (!(await auth.verifyPassword(password, s.portal_password_hash))) return res.status(401).json(wrong);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PORTAL_DAYS * 864e5);
  await pool.query(
    'insert into portal_sessions (token, subscriber_id, tenant_id, expires_at) values ($1,$2,$3,$4)',
    [token, s.id, req.tenant.id, expiresAt]);

  const parts = [`${PORTAL_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));

  await pool.query('delete from portal_sessions where expires_at < now()').catch(() => {});
  res.json({ ok: true });
}));

app.post('/portal/logout', wrap(async (req, res) => {
  const token = portalToken(req);
  if (token) await pool.query('delete from portal_sessions where token=$1', [token]);
  res.append('Set-Cookie', `${PORTAL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}));

/**
 * "I forgot my login" — self-service, no account number needed, since
 * forgetting the account number too is exactly the situation this exists
 * for. A registered phone is the one thing a customer reliably still has.
 *
 * Always answers the same way regardless of whether the phone matched
 * anything — the account-number lookup right above this one already treats
 * "which numbers exist" as a free customer list not to hand out, and a
 * distinct response here would leak the same thing through a different door.
 */
app.post('/portal/recover', loginLimiter, wrap(async (req, res) => {
  const phone = String(req.body?.phone ?? '').replace(/[^0-9+]/g, '');
  const generic = { ok: true, message: 'If that number is on an account, new login details have been sent to it.' };
  if (!phone) return res.json(generic);

  const normalised = phone.replace(/^\+?(?:254)?0?/, '254');
  const { rows: [s] } = await pool.query(
    `select id, account_code, phone, email from subscribers
      where tenant_id=$1 and (phone=$2 or phone_alt=$2)`, [req.tenant.id, normalised]);
  if (!s) return res.json(generic);

  const password = String(100000 + crypto.randomInt(0, 900000));
  const secrets = await import('./secrets.js');
  await pool.query(
    'update subscribers set portal_password_hash=$2, portal_password_enc=$3 where id=$1',
    [s.id, await auth.hashPassword(password),
     secrets.configured() ? secrets.encrypt(password) : null]);

  const sms = await import('./sms.js');
  const body = `Your portal login: account ${s.account_code}, password ${password}.`;
  sms.send(req.tenant.id, s.phone, 'custom', { body }).catch(() => {});
  if (s.email) {
    const email = await import('./email.js');
    email.send(req.tenant.id, s.email, 'Your account login details',
      `Account number: ${s.account_code}\nPassword: ${password}`).catch(() => {});
  }

  res.json(generic);
}));

/**
 * A signed-in customer changing their own portal password.
 *
 * portal_password_hash/portal_password_enc are their own columns, entirely
 * separate from pppoe_user/pppoe_pass — the credentials their router
 * actually authenticates with. This can only ever touch the portal pair;
 * there is no path from here to the PPPoE ones, deliberately, since a
 * customer resetting a forgotten portal password must never be able to
 * change what their router logs in with.
 */
app.post('/portal/change-password', loginLimiter, wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });

  const current = String(req.body?.currentPassword ?? '');
  const next = String(req.body?.newPassword ?? '');
  if (!s.portal_password_hash || !(await auth.verifyPassword(current, s.portal_password_hash))) {
    return res.status(401).json({ error: 'Current password is not correct.' });
  }
  if (!/^\d{6,12}$/.test(next)) {
    return res.status(400).json({ error: 'New password must be 6-12 digits.' });
  }

  const secrets = await import('./secrets.js');
  await pool.query(
    'update subscribers set portal_password_hash=$2, portal_password_enc=$3 where id=$1',
    [s.subscriber_id, await auth.hashPassword(next),
     secrets.configured() ? secrets.encrypt(next) : null]);
  res.json({ ok: true });
}));

/** Everything the customer's own page shows. Their row only — never a list. */
app.get('/portal/me', wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });

  const { rows: payments } = await pool.query(
    `select amount, received_at, provider_ref
       from payments
      where tenant_id=$1 and subscriber_id=$2 and status='applied'
      order by received_at desc limit 10`, [s.tenant_id, s.subscriber_id]);

  const { rows: [org] } = await pool.query(
    'select name, support_phone from tenants where id=$1', [s.tenant_id]);
  // site_profiles overrides the tenant-wide default per router — a multi-site
  // operator can run a different paybill per site, and this was picking the
  // tenant's first default gateway regardless of which router the customer is
  // actually on, showing the wrong paybill for anyone not on that one site.
  // It also picked across every provider with no filter, so a tenant running
  // both Daraja (PPPoE+hotspot) and KopoKopo (hotspot-only, schema-enforced)
  // could show a PPPoE customer the KopoKopo till — enabled_pppoe scopes it
  // to gateways this subscriber's service can actually use.
  const { rows: [gw] } = await pool.query(
    `select coalesce(sp.shortcode, tpc.shortcode) as shortcode
       from subscribers sub
       left join site_profiles sp on sp.router_id = sub.router_id and sp.tenant_id = sub.tenant_id
       left join lateral (
         select shortcode from tenant_payment_config
          where tenant_id=sub.tenant_id and shortcode is not null
            and (case when sub.service='pppoe' then enabled_pppoe else enabled_hotspot end)
          order by is_default desc nulls last limit 1
       ) tpc on true
      where sub.id=$1`, [s.subscriber_id]).catch(() => ({ rows: [] }));

  /**
   * Invoices, tickets and outages, added alongside payments the portal
   * already showed — a customer previously had to call in to ask "do I owe
   * anything," "did you get my ticket," or "is this outage why I'm down."
   * Outages match by router_id: it is the physical link between a customer
   * and a site, unlike the free-text location field, which nothing else
   * validates against an outage's own free-text site name.
   */
  const { rows: invoices } = await pool.query(
    `select number, amount, paid, due_date, status from invoices
      where tenant_id=$1 and subscriber_id=$2
      order by due_date desc limit 10`, [s.tenant_id, s.subscriber_id]);
  const { rows: tickets } = await pool.query(
    `select number, subject, priority, status, created_at from tickets
      where tenant_id=$1 and subscriber_id=$2
      order by created_at desc limit 10`, [s.tenant_id, s.subscriber_id]);
  const { rows: outages } = await pool.query(
    `select site, cause, eta, started_at from outages
      where tenant_id=$1 and status='active' and router_id=$2`,
    [s.tenant_id, s.router_id]).catch(() => ({ rows: [] }));

  // Unlimited, unlike the 10-row invoices list above: credit alone (what
  // "balance" used to show) is only ever overpayment carried forward — it
  // resets to 0 on any partial payment (settleSubscriber in apply.js) and
  // never represented money owed, which is why the figure looked static or
  // wrong regardless of what a customer actually owed on an open invoice.
  const { rows: [owed] } = await pool.query(
    `select coalesce(sum(amount - paid), 0) as amount from invoices
      where tenant_id=$1 and subscriber_id=$2 and status in ('open','partial')`,
    [s.tenant_id, s.subscriber_id]);
  // Pooled per account_code, not this line alone — see account_wallets.
  const { rows: [wallet] } = await pool.query(
    'select balance from account_wallets where tenant_id=$1 and account_code=$2',
    [s.tenant_id, s.account_code]);

  // Same source FUP enforcement sums from — sessions mirrors radacct via a
  // trigger, so this is real traffic, not a stored counter that only some
  // paths update. Calendar month rather than a billing-cycle date this
  // query has no way to know, same as fup.js's own 'monthly' window.
  const { rows: [usage] } = await pool.query(
    `select coalesce(sum(coalesce(bytes_in,0) + coalesce(bytes_out,0)), 0) as bytes
       from sessions
      where tenant_id=$1 and subscriber_id=$2
        and started_at >= date_trunc('month', now())`, [s.tenant_id, s.subscriber_id]);

  const days = s.expires_at ? Math.ceil((new Date(s.expires_at) - Date.now()) / 86400000) : null;
  res.json({
    name: s.name,
    account: s.account_code,
    phone: s.phone,
    status: s.status,
    service: s.service,
    expiresAt: s.expires_at,
    daysLeft: days == null ? null : Math.max(0, days),
    balance: Number(wallet?.balance ?? 0) - Number(owed.amount ?? 0),
    usageMb: Math.round(Number(usage.bytes) / (1024 * 1024)),
    plan: s.plan_title ? {
      title: s.plan_title,
      price: Number(s.plan_price),
      speed: s.rate_down ? `${Math.round(s.rate_down / 1000)}/${Math.round(s.rate_up / 1000)} Mbps` : null,
    } : null,
    company: org?.name ?? '',
    supportPhone: org?.support_phone ?? '',
    paybill: gw?.shortcode ?? '',
    payments,
    invoices,
    tickets,
    outages,
  });
}));

/**
 * Data used per day, for the last 30 days — the same sessions table the
 * headline usage figure sums, broken out by day instead of collapsed into
 * one number, for the customer who wants to see which day their month
 * actually went.
 */
app.get('/portal/usage', wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });

  const { rows } = await pool.query(
    `select date(started_at) as day,
            sum(coalesce(bytes_in,0) + coalesce(bytes_out,0)) as bytes
       from sessions
      where tenant_id=$1 and subscriber_id=$2
        and started_at >= now() - interval '30 days'
      group by date(started_at)
      order by day`, [s.tenant_id, s.subscriber_id]);

  res.json(rows.map((r) => ({ day: r.day, mb: Math.round(Number(r.bytes) / (1024 * 1024)) })));
}));

/**
 * Self-service STK: a signed-in customer pushes their own M-Pesa prompt
 * instead of copying the paybill and their account number by hand into the
 * M-Pesa menu — the same gateway and account reference the admin's "Send
 * STK" button already uses, scoped so a customer can only ever pay their
 * own account. Daraja only: this is the PPPoE portal, and KopoKopo is
 * hotspot-only by the same schema constraint that keeps it off every other
 * PPPoE path.
 */
/**
 * STK push for a subscriber, routed through the tenant's own Daraja paybill
 * as normal — or, for a tenant with platform_collect_enabled (no gateway of
 * their own), through the platform owner's own paybill instead, exactly
 * the way the platform SMS-credit purchase already borrows the owner's
 * Daraja config for a different tenant's request. The account reference
 * carries the tenant's subdomain so a walk-in paybill payment (the /confirm
 * webhook, not this push) can also find its way back to the right tenant.
 *
 * stk_requests.tenant_id is whichever tenant's credentials actually placed
 * the call — required, since that is whose webhook this becomes — while
 * purpose.tenant_id is who the money is actually for. handleStkResult
 * reads purpose to decide which one applies.
 */
async function stkPushForSubscriber(tenantId, { phone, amount, accountCode, description, purpose }) {
  const { rows: [t] } = await pool.query(
    'select subdomain, platform_collect_enabled, settlement_commission_pct from tenants where id=$1', [tenantId]);

  /**
   * Platform-collect used to take over unconditionally the moment it was
   * enabled, even for a tenant who also had their own working Daraja paybill
   * — the platform paid itself first on every PPPoE payment regardless.
   * Matches hotspot's behaviour now: only a fallback for a tenant with no
   * gateway of their own, same as /hotspot/buy already does.
   */
  const { config } = await import('./db.js');
  const ownDaraja = await config(tenantId, 'daraja');

  if (!ownDaraja && t?.platform_collect_enabled) {
    const { rows: [owner] } = await pool.query(
      "select tenant_id from staff where is_super_admin and tenant_id is not null limit 1");
    if (!owner) throw Object.assign(new Error('Platform collection is not set up yet — ask the platform owner.'), { status: 503 });

    const data = await mpesa.stkPush(owner.tenant_id, {
      phone, amount, accountRef: `${t.subdomain}-${accountCode}`.slice(0, 20), description,
      platformCollect: true,
    });
    const checkoutId = data?.CheckoutRequestID ?? null;
    if (checkoutId) {
      await pool.query(
        `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
         values ($1,'daraja',$2,$3,$4,$5)
         on conflict (tenant_id, provider, checkout_id) do nothing`,
        [owner.tenant_id, checkoutId, phone, amount,
         { type: 'platform_collect', tenant_id: tenantId, commissionPct: Number(t.settlement_commission_pct ?? 5), ...purpose }]);
    }
    return { checkoutId };
  }

  const data = await mpesa.stkPush(tenantId, { phone, amount, accountRef: accountCode, description });
  const checkoutId = data?.CheckoutRequestID ?? null;
  if (checkoutId) {
    await pool.query(
      `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
       values ($1,'daraja',$2,$3,$4,$5)
       on conflict (tenant_id, provider, checkout_id) do nothing`,
      [tenantId, checkoutId, phone, amount, purpose]);
  }
  return { checkoutId };
}

app.post('/portal/pay', stkLimiter, wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });

  const { rows: [sub] } = await pool.query(
    `select sub.name, sub.phone, sub.account_code, p.price as plan_price
       from subscribers sub left join plans p on p.id = sub.plan_id
      where sub.id=$1 and sub.tenant_id=$2`, [s.subscriber_id, s.tenant_id]);
  if (!sub) return res.status(404).json({ error: 'not found' });

  // 07xx, +2547xx and 2547xx all arrive; Daraja wants the last form.
  let phone = String(req.body?.phone ?? sub.phone ?? '').trim();
  phone = phone.replace(/[^0-9+]/g, '').replace(/^\+?(?:254)?0?/, '254');
  if (!/^254[17]\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'That does not look like a Kenyan mobile number' });
  }

  // Defaults to the plan price, but a customer can name their own amount —
  // paying ahead, topping up a partial balance, or clearing more than one
  // cycle at once. Capped generously just to catch a typo (an extra zero)
  // before it becomes an STK prompt for someone's life savings.
  const amount = req.body?.amount != null ? Number(req.body.amount) : Number(sub.plan_price);
  if (!(amount > 0) || amount > 1_000_000) {
    return res.status(400).json({ error: 'Enter a valid amount to pay.' });
  }

  try {
    // Daraja's STK result callback (handleStkResult) looks this row up by
    // checkout_id to know who to credit and how much — without it, a
    // customer's own renewal payment could only ever be applied by the
    // separate C2B confirmation matching their account number, and
    // /portal/status/:checkoutId (what the page polls) had nothing to read
    // back, sitting on "check your phone" even after Safaricom answered.
    const { checkoutId } = await stkPushForSubscriber(s.tenant_id, {
      phone, amount, accountCode: sub.account_code, description: `${sub.name} — ${sub.account_code}`,
      purpose: { subscriber_id: s.subscriber_id },
    });
    res.json({ phone, amount, checkoutId });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.response?.data?.errorMessage ?? e.message });
  }
}));

/**
 * Pay a specific invoice rather than "renew now" — the two differ when a
 * customer has more than one open invoice (a top-up alongside their normal
 * renewal, say) and wants to settle a particular one rather than whichever
 * settleSubscriber would otherwise pick (earliest due).
 */
app.post('/portal/pay-invoice', stkLimiter, wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });

  const number = String(req.body?.invoiceNumber ?? '').trim();
  const { rows: [inv] } = await pool.query(
    `select id, number, amount, paid from invoices
      where tenant_id=$1 and subscriber_id=$2 and number=$3 and status in ('open','partial')`,
    [s.tenant_id, s.subscriber_id, number]);
  if (!inv) return res.status(404).json({ error: 'That invoice was not found, or is already settled.' });

  const owed = Number(inv.amount) - Number(inv.paid);
  // Same "let them name it" reasoning as /portal/pay — a partial payment
  // toward this invoice is legitimate, not just paying it off in full.
  const amount = req.body?.amount != null ? Number(req.body.amount) : owed;
  if (!(amount > 0) || amount > 1_000_000) {
    return res.status(400).json({ error: 'Enter a valid amount to pay.' });
  }

  let phone = String(req.body?.phone ?? s.phone ?? '').trim();
  phone = phone.replace(/[^0-9+]/g, '').replace(/^\+?(?:254)?0?/, '254');
  if (!/^254[17]\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'That does not look like a Kenyan mobile number' });
  }

  try {
    // invoice_id: settleSubscriber applies to this exact invoice when
    // present, rather than falling back to "earliest open".
    const { checkoutId } = await stkPushForSubscriber(s.tenant_id, {
      phone, amount, accountCode: s.account_code, description: `Invoice ${inv.number}`,
      purpose: { subscriber_id: s.subscriber_id, invoice_id: inv.id },
    });
    res.json({ phone, amount, checkoutId });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.response?.data?.errorMessage ?? e.message });
  }
}));

/** Raise a support request from the portal, which the Tickets screen picks up. */
app.post('/portal/support', wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });
  const subject = String(req.body?.subject ?? '').trim();
  if (!subject) return res.status(400).json({ error: 'Say what the problem is.' });
  // Optional — the portal's own form used to be a bare window.prompt() with
  // room for a subject line only, so a customer had nowhere to actually
  // describe the problem beyond a few words. A subject alone still works.
  const body = String(req.body?.body ?? '').trim().slice(0, 2000);

  const { rows: [t] } = await pool.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority, source)
     values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, 'medium', 'portal')
     returning id, number`, [s.tenant_id, subject, s.subscriber_id]);
  if (body) {
    // internal=false: this is the customer's own account of the problem,
    // meant to be seen (Tickets screen already shows non-internal notes),
    // not a private staff-only note about them.
    await pool.query(
      `insert into ticket_notes (tenant_id, ticket_id, author, body, internal)
       values ($1,$2,$3,$4,false)`,
      [s.tenant_id, t.id, s.name ?? 'Customer', body]);
  }
  res.json({ ok: true, ticket: t.number });
}));

/** PPPoE plans this subscriber could switch to — active plans on their own service, tenant-scoped. */
app.get('/portal/plans-pppoe', wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });
  const { rows } = await pool.query(
    `select id, title, price, rate_down, rate_up from plans
      where tenant_id=$1 and service='pppoe' and active
      order by price`, [s.tenant_id]);
  res.json(rows);
}));

/**
 * A plan switch is never applied here directly — proration, whether it
 * takes effect now or at the next renewal, and confirming the customer
 * actually intended a downgrade are all staff judgment calls this route has
 * no way to make safely on its own. What it can do safely is turn "call and
 * ask them to change my plan" into a ticket staff can act on immediately,
 * with exactly which plan and which subscriber already attached — reusing
 * the same tickets/ticket_notes tables and screen the ordinary "report a
 * problem" flow does, rather than a parallel approval system nothing else
 * knows how to show.
 */
app.post('/portal/request-plan-change', wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });
  const planId = String(req.body?.planId ?? '');

  const { rows: [plan] } = await pool.query(
    `select id, title, price from plans where id=$1 and tenant_id=$2 and service='pppoe' and active`,
    [planId, s.tenant_id]);
  if (!plan) return res.status(404).json({ error: 'That plan is not available.' });

  const { rows: [t] } = await pool.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority, source, requested_plan_id)
     values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6),
             $2, $3, 'medium', 'portal', $4)
     returning id, number`,
    [s.tenant_id, `Plan change request: ${s.plan_title ?? 'current plan'} → ${plan.title}`, s.subscriber_id, plan.id]);
  await pool.query(
    `insert into ticket_notes (tenant_id, ticket_id, author, body, internal)
     values ($1,$2,$3,$4,false)`,
    [s.tenant_id, t.id, s.name ?? 'Customer',
     `Requested switch to ${plan.title} (KES ${plan.price}). Current: ${s.plan_title ?? 'none'}.`]);
  res.json({ ok: true, ticket: t.number });
}));

// ── captive portal ────────────────────────────────
app.get('/portal/plans', async (req, res) => {
  const { rows } = await pool.query(
    "select id, title, price, duration_min, devices, rate_down, data_cap_mb from plans where tenant_id=$1 and service='hotspot' and active order by price",
    [req.tenant.id]);
  res.json(rows);
});

/** Hotspot purchase. Channel comes from hotspot_settings.payment_method; fallbacks below. */
app.post('/portal/buy', stkLimiter, async (req, res) => {
  const { planId, phone, mac } = req.body;
  const { rows: [hs] } = await pool.query('select payment_method from hotspot_settings where tenant_id=$1', [req.tenant.id]);
  const method = req.body.method ?? hs?.payment_method ?? 'kopokopo';
  try {
    if (method === 'kopokopo') {
      const id = await kk.stkPush(req.tenant.id, { phone, amount: await price(planId), planId, mac, service: 'hotspot' });
      return res.json({ status: 'pending', checkoutId: id });
    }
    const r = await mpesa.stkPush(req.tenant.id, { phone, amount: await price(planId), accountRef: 'HOTSPOT' });
    res.json({ status: 'pending', checkoutId: r.CheckoutRequestID });
  } catch (e) {
    res.status(502).json({ status: 'fallback', till: await till(req.tenant.id), error: e.message });
  }
});

app.get('/portal/status/:checkoutId', pollLimiter, async (req, res) => {
  // Same fix as /hotspot/buy/:checkoutId above: stkPushForSubscriber's
  // platform-collect path inserts this row under the platform owner's own
  // tenant_id, not this customer's — only purpose.tenant_id says who it was
  // actually for. Scoping strictly to tenant_id meant a platform-collect
  // customer's own portal could never find their own payment.
  const { rows: [r] } = await pool.query(
    `select status, result_desc from stk_requests
      where checkout_id=$2 and (tenant_id=$1 or purpose->>'tenant_id'=$1::text)`,
    [req.tenant.id, req.params.checkoutId]);
  res.json(r ?? { status: 'unknown' });
});

/** Customer typed an M-Pesa code after paying a no-API till. */
app.post('/portal/verify-code', loginLimiter, async (req, res) => {
  const { rows: [p] } = await pool.query(
    "select * from payments where tenant_id=$1 and provider_ref=$2", [req.tenant.id, req.body.code]);
  if (!p) return res.status(404).json({ status: 'not_found', grantedMinutes: 20 });
  res.json({ status: p.status });
});

// ── admin ─────────────────────────────────────────
/**
 * Clients, with whether they are actually connected.
 *
 * The list carried only the billing status, so "active" meant "paid up" and
 * said nothing about whether the customer is online — and an expired customer
 * still connected looked identical to one who had gone. Those are different
 * problems: one is a collection call, the other is a line that should have been
 * cut and was not.
 *
 * The address comes from the live session rather than subscribers.static_ip:
 * that field is what we asked for, this is what the router actually gave them,
 * and when they differ the second one is the one that matters.
 */
app.get('/api/subscribers', requirePermission('clients.view'), async (req, res) => {
  const { rows } = await pool.query(`
    select s.*,
           (a.framedipaddress is not null or live.username is not null) as online,
           -- The router's own answer first when we have a fresh one: if
           -- accounting is silent, radacct's address is stale by definition.
           coalesce(host(live.address), host(a.framedipaddress)) as current_ip,
           live.username is not null    as online_from_router,
           a.acctstarttime              as session_started,
           coalesce(a.acctupdatetime, a.acctstarttime, live.seen_at, last.seen) as last_seen,
           -- Per-router override from site_profiles, falling back to the
           -- tenant's default gateway — this used to be picked purely
           -- client-side from the tenant default alone, showing the wrong
           -- paybill for anyone not on the site that default belongs to.
           coalesce(sp.shortcode, tpc.shortcode) as paybill,
           -- Wallet credit is pooled per account_code (account_wallets), not
           -- per subscriber row — a customer with several lines shares one
           -- balance across all of them (settleSubscriber in apply.js).
           -- What a customer actually owes lives on their open/partial
           -- invoices; net_balance is the pooled wallet minus that.
           coalesce(w.balance, 0) as wallet_balance,
           coalesce(w.balance, 0) - coalesce(owed.amount, 0) as net_balance
      from subscribers s
      left join account_wallets w on w.tenant_id = s.tenant_id and w.account_code = s.account_code
      left join site_profiles sp on sp.router_id = s.router_id and sp.tenant_id = s.tenant_id
      left join lateral (
        -- /api/subscribers is PPPoE-only (see the comment on this route above),
        -- so this always wants the PPPoE-enabled gateway — without the filter
        -- a tenant also running KopoKopo (hotspot-only, schema-enforced) could
        -- have its till outrank Daraja here and show PPPoE customers a paybill
        -- they can't actually pay into.
        select shortcode from tenant_payment_config
         where tenant_id=s.tenant_id and shortcode is not null and enabled_pppoe
         order by is_default desc nulls last limit 1
      ) tpc on true
      left join lateral (
        select sum(amount - paid) amount from invoices
         where subscriber_id = s.id and status in ('open','partial')
      ) owed on true
      /**
       * The open session — but only if it is still being talked about.
       *
       * A router that loses power, reboots, or has its tunnel cut never sends
       * Accounting-Stop, so the row stays open forever and the customer reads
       * as online permanently. That is worse than showing nothing: an operator
       * chasing an outage sees a screen full of connected customers.
       *
       * Interim updates arrive every five minutes, so fifteen is three missed
       * in a row — long enough not to flicker on one dropped packet, short
       * enough that a dead session is not still "online" an hour later.
       */
      left join lateral (
        select framedipaddress, acctstarttime, acctupdatetime
          from radacct
         where username = s.pppoe_user
           and acctstoptime is null
           and coalesce(acctupdatetime, acctstarttime) > now() - interval '15 minutes'
         order by acctstarttime desc limit 1) a on true
      -- Otherwise when they were last seen at all, so "offline since" is
      -- answerable rather than blank.
      left join lateral (
        select max(coalesce(acctstoptime, acctupdatetime)) seen
          from radacct where username = s.pppoe_user) last on true
      /**
       * What the router said when it was last asked.
       *
       * Five minutes, because this is refreshed on demand rather than pushed:
       * an answer older than that is a memory, not a reading, and a customer
       * shown as online on the strength of it is the fault this was added to
       * fix, only slower.
       */
      left join lateral (
        select username, address, seen_at
          from live_sessions
         where tenant_id = s.tenant_id
           and username = s.pppoe_user
           and seen_at > now() - interval '5 minutes') live on true
     where s.tenant_id = $1
     order by s.created_at desc
     limit 200`, [req.tenant.id]);
  res.json(rows);
});

/**
 * Ask every reachable router who is connected, and record the answers.
 *
 * On demand rather than on a timer. Opening an API session to every router on a
 * schedule is a standing cost on hardware that is often a small home board on a
 * domestic line, and the question is only interesting when somebody is looking
 * at the screen.
 *
 * Routers are polled together and a failure on one is just that one: a site
 * whose tunnel is down must not stop the others from being counted, which is
 * precisely the situation this exists for.
 */
/**
 * "I'm here" — called from the app shell on the same visible-tab timer that
 * already refreshes the store, so staff.last_seen reflects genuine recent
 * activity rather than only the moment someone logged in (which is when it
 * was last written before this existed, sometimes hours before). This is
 * what /chat/start checks to decide whether anyone is actually around to
 * answer a new chat, versus just having a session cookie that hasn't
 * expired yet.
 */
app.post('/api/presence/heartbeat', wrap(async (req, res) => {
  if (req.session?.staff_id) {
    await pool.query('update staff set last_seen=now() where id=$1', [req.session.staff_id]);
  }
  res.json({ ok: true });
}));

app.post('/api/presence/refresh', wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const { withTenant } = await import('./db.js');
  const { startVoucherClock } = await import('./radius.js');

  // Same one-liner /hotspot/voucher-status runs, so an operator checking who
  // is online sees accurate status too, not whatever jobs.js's 5-minute
  // sweep last left behind.
  await pool.query(
    "update vouchers set status='expired' where tenant_id=$1 and status='in_use' and expires_at < now()",
    [req.tenant.id]);

  const { rows: routers } = await pool.query(
    `select id, name, host, api_port, service_user, service_password_enc
       from routers where tenant_id=$1`, [req.tenant.id]);

  const reachable = routers.filter((r) => r.service_user && r.service_password_enc);
  const results = await Promise.allSettled(reachable.map(async (r) => {
    const password = secrets.decrypt(r.service_password_enc);
    if (!password) throw new Error('no stored password');
    const conn = await ros.connect({
      host: String(r.host).split('/')[0],
      port: r.api_port ?? 8728,
      user: r.service_user,
      password,
      timeoutSec: 8,
    });
    try {
      return { router: r, sessions: await ros.activeSessions(conn) };
    } finally {
      ros.close(conn);
    }
  }));

  // A set, not a running total: RouterOS can report the same username in
  // more than one active-session row (a stale entry lingering alongside a
  // fresh one is a real thing it does, not hypothetical), and live_sessions
  // itself dedupes on (tenant_id, username) — so a plain per-row counter
  // told an operator "2 connected" for one guest who reconnected once.
  const seenUsers = new Set();
  const unreachable = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled') {
      unreachable.push(reachable[i].name);
      continue;
    }
    for (const sess of r.value.sessions) {
      await pool.query(
        `insert into live_sessions (tenant_id, router_id, username, address, service, seen_at)
              values ($1,$2,$3,$4::inet,$5, now())
         on conflict (tenant_id, username) do update
            set router_id = excluded.router_id, address = excluded.address,
                service = excluded.service, seen_at = now()`,
        [req.tenant.id, r.value.router.id, sess.username, sess.address, sess.service]);
      seenUsers.add(sess.username);

      /**
       * A hotspot username on the router is the voucher code, and seeing it
       * active is proof the guest is actually online — the same fact
       * /radius/post-auth exists to report, but observed directly rather
       * than depending on FreeRADIUS's post-auth section actually calling
       * out to us (it currently does not: the site config only stashes the
       * username into a control attribute and never invokes exec or rest,
       * so voucher_expiry='login' vouchers stayed 'unused' forever no
       * matter how long a guest was connected). This is a second, more
       * reliable path to the same state change, not a replacement for
       * fixing that config — but it works today without touching a system
       * that authenticates every currently-connected customer.
       */
      if (sess.service === 'hotspot') {
        await withTenant(req.tenant.id, (c) => startVoucherClock(c, req.tenant.id, sess.username));
      }
    }
  }

  // Old rows go rather than linger: a stale row here would claim somebody is
  // online on the strength of a reading taken hours ago.
  await pool.query(
    "delete from live_sessions where tenant_id=$1 and seen_at < now() - interval '30 minutes'",
    [req.tenant.id]);

  res.json({
    online: seenUsers.size,
    asked: reachable.length,
    unreachable,
    noCredentials: routers.length - reachable.length,
  });
}));

/**
 * Who is on the hotspot right now — the Hotspot screen's "online" list,
 * which previously did not exist even though the router-polling machinery
 * behind it (activeSessions/live_sessions) already did. Voucher code is
 * the RADIUS username for a hotspot session, so it is the join key back to
 * who actually bought it.
 */
app.get('/api/hotspot/online', requirePermission('hotspot.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select l.username as code, l.address, l.router_id, r.name as router_name, l.seen_at,
            v.phone, v.status as voucher_status, p.title as plan_title
       from live_sessions l
       left join routers r on r.id = l.router_id
       left join vouchers v on v.tenant_id = l.tenant_id and v.code = l.username
       left join plans p on p.id = v.plan_id
      where l.tenant_id = $1 and l.service = 'hotspot'
      order by l.seen_at desc`, [req.tenant.id]);
  res.json(rows);
}));

app.get('/api/payments/unmatched', async (req, res) => {
  const { rows } = await pool.query(
    "select * from payments where tenant_id=$1 and status='unmatched' order by received_at desc", [req.tenant.id]);
  res.json(rows);
});

/** Cashier resolves an unmatched payment; we remember the phone for next time. */
app.post('/api/payments/:id/match', requirePermission('payments.apply'), async (req, res) => {
  const { subscriberId } = req.body;
  const { applyMatched } = await import('./payments/apply.js');
  res.json(await applyMatched?.(req.tenant.id, req.params.id, subscriberId) ?? { ok: true });
});

// ── hotspot settings (Hotspot -> Settings) ─────────
app.get('/api/hotspot/settings', requirePermission('hotspot.view'), async (req, res) => {
  const { rows: [s] } = await pool.query('select * from hotspot_settings where tenant_id=$1', [req.tenant.id]);
  res.json(s ?? {});
});

/**
 * Domains documented, repeatedly, as abused to bypass a captive portal for
 * free — generic hosting/CDN platforms where anyone can stand up a page or
 * a redirect under the same domain a walled garden trusts, or public tools
 * (Google Translate, Google Docs viewer) that already act as an open
 * fetch-and-relay proxy for arbitrary URLs. An operator adding
 * "*.example.com" here is trusting every tenant of that platform, not just
 * their own payment gateway — the walled garden matches by host, and has no
 * way to tell "the page we meant" from "a stranger's page on the same
 * domain."
 */
const RISKY_WALLED_GARDEN_HOSTS = [
  'amazonaws.com', 'cloudfront.net', 'googleusercontent.com', 'appspot.com',
  'herokuapp.com', 'workers.dev', 'pages.dev', 'github.io', 'githubusercontent.com',
  'firebaseapp.com', 'web.app', 'azurewebsites.net', 'ngrok.io', 'ngrok-free.app',
  'ngrok.app', 'vercel.app', 'netlify.app', 'translate.google.com', 'translate.googleapis.com',
  'docs.google.com', 'drive.google.com', 'cdn.jsdelivr.net', 'raw.githubusercontent.com',
];

/**
 * A soft check, not a hard block — a tenant might have a real, narrow reason
 * to allow one of these, and refusing outright would be guessing at intent
 * this endpoint has no way to actually know. Surfaced back to the caller as
 * `warnings` so Settings can show it without the save itself failing.
 */
function walledGardenWarnings(hosts) {
  const warnings = [];
  for (const raw of hosts ?? []) {
    const host = String(raw).trim().toLowerCase();
    if (!host) continue;
    const bare = host.replace(/^\*\./, '');
    if (!bare.includes('.') || bare === '*') {
      warnings.push(`"${raw}" is too broad — this would allow almost anything, not just your payment gateway.`);
      continue;
    }
    if (RISKY_WALLED_GARDEN_HOSTS.some((r) => bare === r || bare.endsWith(`.${r}`))) {
      warnings.push(`"${raw}" is a shared hosting/CDN or open-relay domain — anyone can put a page there, `
        + 'not just you, which is a documented way a captive portal gets bypassed for free. Only add it if you '
        + 'specifically need it, and prefer the narrowest hostname that actually works.');
    }
  }
  return warnings;
}

app.put('/api/hotspot/settings', requirePermission('hotspot.edit'), async (req, res) => {
  const f = req.body;
  const warnings = Array.isArray(f.walled_garden) ? walledGardenWarnings(f.walled_garden) : [];
  // The only host a guest's browser ever needs pre-auth is this tenant's own
  // portal — the login page, its status polling, and the STK-push prompt it
  // shows. M-Pesa itself never needs a walled-garden entry: Daraja is called
  // from our backend, not the guest's browser, and the actual approval
  // happens over the phone's own SIM/USSD channel outside this network
  // entirely, so a Safaricom domain here was never doing anything.
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  const defaultWalledGarden = req.tenant.subdomain ? [`${req.tenant.subdomain}.${root}`] : [];
  const { rows: [s] } = await pool.query(`
    insert into hotspot_settings (tenant_id, ssid, redirect_url, trial_minutes, idle_timeout_sec, bind_mac,
      payment_method, voucher_expiry, code_type, code_length, sms_voucher, auto_login, multi_device,
      template, banner_headline, banner_subtext, walled_garden, hotspot_network)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
            coalesce($17, $19::text[]),
            coalesce($18, '10.5.50.0/24'))
    on conflict (tenant_id) do update set
      ssid=excluded.ssid, redirect_url=excluded.redirect_url, trial_minutes=excluded.trial_minutes,
      idle_timeout_sec=excluded.idle_timeout_sec, bind_mac=excluded.bind_mac,
      payment_method=excluded.payment_method, voucher_expiry=excluded.voucher_expiry,
      code_type=excluded.code_type, code_length=excluded.code_length, sms_voucher=excluded.sms_voucher,
      auto_login=excluded.auto_login, multi_device=excluded.multi_device, template=excluded.template,
      banner_headline=excluded.banner_headline, banner_subtext=excluded.banner_subtext,
      -- Only when the caller actually sent them. Every other screen that saves
      -- these settings posts the whole form back without these two fields, and
      -- excluded.* would quietly wipe the walled garden each time.
      walled_garden=coalesce($17, hotspot_settings.walled_garden),
      hotspot_network=coalesce($18, hotspot_settings.hotspot_network)
    returning *`,
    [req.tenant.id, f.ssid, f.redirect_url, f.trial_minutes, f.idle_timeout_sec, f.bind_mac,
     f.payment_method, f.voucher_expiry, f.code_type, f.code_length, f.sms_voucher, f.auto_login,
     f.multi_device, f.template, f.banner_headline, f.banner_subtext,
     Array.isArray(f.walled_garden) ? f.walled_garden : null,
     f.hotspot_network ?? null, defaultWalledGarden]);
  res.json({ ...s, warnings });
});

/**
 * Just the one field, from the Vouchers screen's own toggle — not folded
 * into the big PUT above, which every other caller already posts the whole
 * settings form back to. Vouchers has never had that form and should not
 * need to fetch and resend fifteen unrelated fields to flip one switch.
 */
app.patch('/api/hotspot/settings/auto-purge', requirePermission('hotspot.edit'), wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    `insert into hotspot_settings (tenant_id, auto_purge_vouchers) values ($1,$2)
     on conflict (tenant_id) do update set auto_purge_vouchers=excluded.auto_purge_vouchers
     returning auto_purge_vouchers`,
    [req.tenant.id, !!req.body?.enabled]);
  res.json(s);
}));

// ─────────────── email gateway ───────────────

/** Config without the password, plus whether one is stored. Never returns it. */
app.get('/api/email/gateway', wrap(async (req, res) => {
  const mail = await import('./email.js');
  const { rows: [c] } = await pool.query(
    `select host, port, secure, username, from_name, from_email, enabled,
            last_error, last_sent_at, password_enc is not null as has_password
       from tenant_email_config where tenant_id=$1`, [req.tenant.id]);
  res.json({ config: c ?? null, fields: mail.FIELDS });
}));

app.put('/api/email/gateway', requirePermission('settings.edit'), wrap(async (req, res) => {
  const secrets = await import('./secrets.js');
  const mail = await import('./email.js');
  const f = req.body ?? {};

  const missing = mail.missingFields(f);
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(', ')}` });
  if (f.password && !secrets.configured())
    return res.status(400).json({
      error: 'APP_SECRET_KEY is not set on the server, so the SMTP password cannot be stored safely. Generate one with: openssl rand -base64 32',
    });

  // An empty password field means "leave the stored one alone", not "clear it".
  // Re-typing the mailbox password every time the from-name changes is how
  // operators end up disabling the gateway by accident.
  const enc = f.password ? secrets.encrypt(String(f.password)) : null;
  const port = Number(f.port) || 587;

  const { rows: [c] } = await pool.query(
    `insert into tenant_email_config
       (tenant_id, host, port, secure, username, password_enc, from_name, from_email, enabled)
     values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,true))
     on conflict (tenant_id) do update set
       host=excluded.host, port=excluded.port, secure=excluded.secure,
       username=excluded.username, from_name=excluded.from_name,
       from_email=excluded.from_email, enabled=excluded.enabled,
       password_enc=coalesce($6, tenant_email_config.password_enc),
       last_error=null
     returning host, port, secure, username, from_name, from_email, enabled,
               password_enc is not null as has_password`,
    [req.tenant.id, f.host, port, port === 465, f.username || null, enc,
     f.from_name || null, f.from_email, f.enabled]);
  res.json(c);
}));

app.delete('/api/email/gateway', requirePermission('settings.edit'), wrap(async (req, res) => {
  await pool.query('delete from tenant_email_config where tenant_id=$1', [req.tenant.id]);
  res.json({ ok: true });
}));

/**
 * Prove the settings work before anything depends on them.
 *
 * Sends to whoever asks rather than a fixed address: the operator testing this
 * is the one who needs to see it arrive, and "it said OK but nothing came" is
 * the complaint this exists to prevent.
 */
app.post('/api/email/test', wrap(async (req, res) => {
  const mail = await import('./email.js');
  const to = String(req.body?.to ?? '').trim();
  if (!to) return res.status(400).json({ error: 'Enter an address to send the test to' });

  const brand = req.tenant.name || 'Vibelink';
  const out = await mail.send(req.tenant.id, to, `${brand} test email`,
    `This is a test from your ${brand} billing system. If you are reading it, your email gateway works.`);
  if (!out.ok) return res.status(502).json({ error: out.error });
  res.json({ ok: true, sent: to });
}));

app.get('/api/email/history', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select to_email, subject, status, error, created_at from email_log
      where tenant_id=$1 order by created_at desc limit 50`, [req.tenant.id]);
  res.json(rows);
}));

/** Which payment channels this tenant may choose from — drives the Preferences dropdown. */
app.get('/api/payment-methods', async (req, res) => {
  const { rows } = await pool.query(
    'select provider, shortcode, enabled_pppoe, enabled_hotspot from tenant_payment_config where tenant_id=$1',
    [req.tenant.id]);
  res.json(rows);
});

// ── SMS gateways ──────────────────────────────────
app.get('/api/sms/gateways', wrap(async (req, res) => {
  const { PROVIDER_FIELDS, missingCredentials } = await import('./sms.js');
  const { rows } = await pool.query(
    'select provider, priority, enabled, credentials from tenant_sms_config where tenant_id=$1 order by priority',
    [req.tenant.id]);
  // How many messages this tenant may still send through the platform
  // owner's own gateway if their own is missing or fails — shown so a
  // tenant with no gateway of their own configured knows why messages are
  // still going out (or why they suddenly stopped, once this reaches 0),
  // rather than it being invisible to them entirely.
  const { rows: [t] } = await pool.query(
    'select platform_sms_balance from tenants where id=$1', [req.tenant.id]);
  const { rows: [pcfg] } = await pool.query('select price_per_credit from platform_sms_config where id=true');
  res.json({
    available: providerNames,
    // The form renders from this, so it cannot ask for a different set of fields
    // than credentialsComplete() checks.
    fields: PROVIDER_FIELDS,
    configured: rows.map(({ credentials, ...g }) => ({
      ...g,
      // Report which secrets exist by name only — never the values.
      credentialKeys: Object.entries(credentials ?? {})
        .filter(([, v]) => String(v ?? '').trim())
        .map(([k]) => k),
      missing: missingCredentials(g.provider, credentials ?? {}),
    })),
    platformBalance: t?.platform_sms_balance ?? 0,
    platformPricePerCredit: Number(pcfg?.price_per_credit ?? 2),
  });
}));

/**
 * Buy more platform SMS credit once a tenant's given balance runs out.
 * Charged to the platform owner's own tenant's own configured Daraja
 * gateway — this is a purchase from the platform, not from this tenant's
 * own payment setup, which may not even exist yet if that's exactly why
 * they need the fallback in the first place.
 */
app.post('/api/sms/buy-credits', wrap(async (req, res) => {
  const quantity = Math.round(Number(req.body?.quantity));
  if (!(quantity > 0)) return res.status(400).json({ error: 'Enter how many credits to buy.' });

  const { rows: [cfg] } = await pool.query('select price_per_credit from platform_sms_config where id=true');
  const price = Number(cfg?.price_per_credit ?? 2);
  const amount = Math.round(quantity * price);

  const { rows: [owner] } = await pool.query(
    "select tenant_id from staff where is_super_admin and tenant_id is not null limit 1");
  if (!owner) return res.status(503).json({ error: 'Platform billing is not set up yet — ask the platform owner.' });

  let phone = String(req.body?.phone ?? '').trim();
  phone = phone.replace(/[^0-9+]/g, '').replace(/^\+?(?:254)?0?/, '254');
  if (!/^254[17]\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'That does not look like a Kenyan mobile number' });
  }

  try {
    const r = await mpesa.stkPush(owner.tenant_id, {
      phone, amount, accountRef: 'SMSCREDIT', description: `${quantity} SMS credits`,
    });
    const checkoutId = r.CheckoutRequestID;
    if (!checkoutId) {
      return res.status(502).json({ error: r.errorMessage ?? r.ResponseDescription ?? 'The payment gateway did not respond' });
    }
    // Filed under the platform owner's own tenant_id — that is whose Daraja
    // credentials the push actually went out on, and handleStkResult looks
    // this row up by (provider, checkout_id) alone regardless of whose
    // balance purpose.tenant_id says to credit.
    await pool.query(
      `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
       values ($1,'daraja',$2,$3,$4,$5)
       on conflict (tenant_id, provider, checkout_id) do nothing`,
      [owner.tenant_id, checkoutId, phone, amount, { type: 'sms_credit', tenant_id: req.tenant.id, quantity }]);
    res.json({ checkoutId, amount, quantity });
  } catch (e) {
    res.status(502).json({ error: e.response?.data?.errorMessage ?? e.message });
  }
}));

/**
 * Scoped by purpose.tenant_id, not stk_requests.tenant_id (that row lives
 * under the platform owner's own tenant) — otherwise any signed-in staff
 * could poll another tenant's in-flight purchase by guessing its checkout id.
 */
app.get('/api/sms/buy-credits/:checkoutId', wrap(async (req, res) => {
  const { rows: [r] } = await pool.query(
    `select status, result_desc from stk_requests
      where provider='daraja' and checkout_id=$1 and (purpose->>'tenant_id')=$2`,
    [req.params.checkoutId, req.tenant.id]);
  res.json(r ?? { status: 'unknown' });
}));

// ─────────────── web push ──────────────────
// A staff member's browser subscription for router-down/SLA/payment alerts —
// see push.js for why this exists alongside SMS/WhatsApp rather than
// instead of it.
app.get('/api/push/vapid-public-key', wrap(async (req, res) => {
  const push = await import('./push.js');
  res.json({ key: push.publicKey() });
}));

app.post('/api/push/subscribe', wrap(async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys) return res.status(400).json({ error: 'Not a valid push subscription' });
  const push = await import('./push.js');
  await push.saveSubscription(req.tenant.id, req.session.staff_id, sub);
  res.json({ ok: true });
}));

app.post('/api/push/unsubscribe', wrap(async (req, res) => {
  const endpoint = String(req.body?.endpoint ?? '');
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  const push = await import('./push.js');
  await push.removeSubscription(endpoint);
  res.json({ ok: true });
}));

app.put('/api/sms/gateways/:provider', requirePermission('settings.edit'), wrap(async (req, res) => {
  const { credentials = {}, priority = 1, enabled = true, templates = {} } = req.body;
  const { PROVIDER_FIELDS, missingCredentials } = await import('./sms.js');
  if (!PROVIDER_FIELDS[req.params.provider])
    return res.status(400).json({ error: 'unknown gateway' });

  // Blank fields must not wipe stored secrets — the form shows "leave blank to
  // keep it", so merge rather than replace. Empty strings are dropped first.
  const incoming = Object.fromEntries(
    Object.entries(credentials).filter(([, v]) => String(v ?? '').trim() !== '')
  );

  const { rows: [saved] } = await pool.query(`
    insert into tenant_sms_config (tenant_id, provider, credentials, templates, priority, enabled)
    values ($1,$2,$3,$4,$5,$6)
    on conflict (tenant_id, provider) do update set
      credentials = tenant_sms_config.credentials || excluded.credentials,
      templates = excluded.templates,
      priority = excluded.priority, enabled = excluded.enabled
    returning credentials`,
    [req.tenant.id, req.params.provider, JSON.stringify(incoming), templates, priority, enabled]);

  // Report rather than refuse: a partly-filled gateway is a legitimate work in
  // progress, and send() skips it until it is complete.
  const missing = missingCredentials(req.params.provider, saved.credentials ?? {});
  res.json({ ok: true, complete: missing.length === 0, missing });
}));

app.delete('/api/sms/gateways/:provider', requirePermission('settings.edit'), wrap(async (req, res) => {
  await pool.query('delete from tenant_sms_config where tenant_id=$1 and provider=$2',
    [req.tenant.id, req.params.provider]);
  res.json({ ok: true });
}));

/** Live credit balance for the header chip. credits=0 when credentials are not set. */
app.get('/api/sms/balance', async (req, res) => {
  const { smsBalance } = await import('./sms.js');
  res.json(await smsBalance(req.tenant.id, { force: req.query.force === '1' }));
});

app.post('/api/sms/test', async (req, res) => {
  const { send } = await import('./sms.js');
  await send(req.tenant.id, req.body.phone, 'receipt', { amount: 1, code: 'TEST', expires: 'now' });
  res.json({ ok: true });
});


// ── tickets, leads, messaging, live support, tariffs, IP pools ──
// All scoped by req.tenant.id — the tenant resolver above 404s unknown hosts and
// every query below runs with RLS active (see withTenant in db.js for writes).
app.get('/api/tickets', requirePermission('tickets.view'), async (req, res) => {
  const { rows } = await pool.query(
    `select t.*, sp.name as sla_policy_name
       from tickets t
       left join sla_policies sp on sp.id = t.sla_policy_id
      where t.tenant_id=$1
      order by t.created_at desc`,
    [req.tenant.id]);
  res.json(rows);
});
app.post('/api/tickets', async (req, res) => {
  const { subject, subscriberId, priority = 'medium' } = req.body;

  /**
   * sla_policies has always been fully configurable from Settings — name,
   * priority, respond/resolve minutes, who to escalate to — and nothing
   * before this ever matched a real ticket against one. due_at stayed null
   * until an operator typed a date in by hand, which made the whole screen
   * describe a promise nothing here was keeping. One matching enabled
   * policy for this priority is enough to say what "on time" even means;
   * an unconfigured priority just gets no due date, same as today.
   */
  const { rows: [policy] } = await pool.query(
    `select id, resolve_mins from sla_policies
      where tenant_id=$1 and priority=$2 and coalesce(enabled, true)
      order by resolve_mins asc limit 1`,
    [req.tenant.id, priority]);

  const { rows: [t] } = await pool.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority, sla_policy_id, due_at)
     values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, $4, $5, $6) returning *`,
    [req.tenant.id, subject, subscriberId ?? null, priority,
     policy?.id ?? null, policy ? new Date(Date.now() + policy.resolve_mins * 60000) : null]);
  res.json(t);
});

/**
 * A lead referred by an active customer often names someone who has never
 * been entered as a referrer on their own — picking them straight off the
 * client list (rather than requiring a trip to Referrals first to create
 * them) is often the very first time that relationship exists anywhere in
 * the system. Reuses an existing customer-type referrer row for this
 * subscriber if the Referrals screen (or an earlier lead) already made one;
 * otherwise creates it, seeded from the client's own name, with no
 * commission rate set yet — the operator can give it one later from
 * Referrals without losing the link made here.
 */
async function referrerForSubscriber(tenantId, subscriberId) {
  const { rows: [existing] } = await pool.query(
    'select id from referrers where tenant_id=$1 and subscriber_id=$2', [tenantId, subscriberId]);
  if (existing) return existing.id;

  const { rows: [sub] } = await pool.query(
    'select name, phone from subscribers where id=$1 and tenant_id=$2', [subscriberId, tenantId]);
  if (!sub) return null;

  const { rows: [created] } = await pool.query(
    `insert into referrers (tenant_id, subscriber_id, name, phone, commission_type, commission_rate, notes)
     values ($1,$2,$3,$4,'percent',0,'Added automatically — first named as a referrer from a lead')
     returning id`,
    [tenantId, subscriberId, sub.name, sub.phone]);
  return created.id;
}

/**
 * Same shape as referrerForSubscriber, for a staff member closing a lead —
 * see PATCH /api/leads/:id's own comment for why this exists. 5% is a
 * starting default an operator can correct under Leads -> Sales reps; a
 * sales role earning nothing until someone remembers to configure a rate
 * would make the whole feature look broken from day one.
 */
async function referrerForStaff(tenantId, staffId) {
  const { rows: [existing] } = await pool.query(
    'select id from referrers where tenant_id=$1 and staff_id=$2', [tenantId, staffId]);
  if (existing) return existing.id;

  const { rows: [member] } = await pool.query(
    'select name, phone from staff where id=$1 and tenant_id=$2', [staffId, tenantId]);
  if (!member) return null;

  const { rows: [created] } = await pool.query(
    `insert into referrers (tenant_id, staff_id, name, phone, commission_type, commission_rate, notes)
     values ($1,$2,$3,$4,'percent',5,'Added automatically — closed a lead assigned to them')
     returning id`,
    [tenantId, staffId, member.name, member.phone]);
  return created.id;
}

app.get('/api/leads', requirePermission('leads.view'), async (req, res) => {
  const { rows } = await pool.query(
    `select l.*, r.name as referrer_name, st.name as assignee_name
       from leads l
       left join referrers r on r.id = l.referrer_id
       left join staff st on st.id = l.assigned_to
      where l.tenant_id=$1
      order by l.created_at desc`,
    [req.tenant.id]);
  res.json(rows);
});
/**
 * Per staff member: leads assigned, leads won, and commission earned —
 * this month and lifetime. Every staff row is included, not just ones with
 * activity, so someone assigned leads that never converted still shows up
 * at zero rather than silently missing from the leaderboard — the research
 * behind this screen was explicit that a leaderboard only earns trust when
 * it visibly reflects the real CRM data, not a filtered view of it.
 *
 * Commission comes through the same referrers/referral_commissions tables
 * a customer or external referrer earns through (see referrerForStaff) —
 * closing a lead and referring a customer are, as far as this system
 * already tracks compensation, the same kind of event.
 */
app.get('/api/leads/sales-performance', requirePermission('leads.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select st.id, st.name,
            count(l.id) filter (where l.assigned_to = st.id) as leads_assigned,
            count(l.id) filter (where l.assigned_to = st.id and l.status = 'won') as leads_won,
            count(l.id) filter (
              where l.assigned_to = st.id and l.status = 'won'
                and l.created_at >= date_trunc('month', now())
            ) as won_this_month,
            coalesce(sum(rc.amount) filter (where rc.created_at >= date_trunc('month', now())), 0) as earned_this_month,
            coalesce(sum(rc.amount), 0) as earned_total
       from staff st
       left join leads l on l.tenant_id = st.tenant_id and l.assigned_to = st.id
       left join referrers r on r.tenant_id = st.tenant_id and r.staff_id = st.id
       left join referral_commissions rc on rc.referrer_id = r.id
      where st.tenant_id = $1 and st.role <> 'platform_admin'
      group by st.id, st.name
      order by earned_this_month desc, leads_won desc`,
    [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/leads', requirePermission('leads.create'), async (req, res) => {
  const { name, phone, source, referrerId, referredByClientId, assignedTo, nextFollowUp } = req.body;

  let referrer = null;
  if (referrerId) {
    const { rowCount } = await pool.query(
      'select 1 from referrers where id=$1 and tenant_id=$2', [referrerId, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such referrer' });
    referrer = referrerId;
  } else if (referredByClientId) {
    const { rowCount } = await pool.query(
      'select 1 from subscribers where id=$1 and tenant_id=$2', [referredByClientId, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such client' });
    referrer = await referrerForSubscriber(req.tenant.id, referredByClientId);
  }

  if (assignedTo) {
    const { rowCount } = await pool.query(
      'select 1 from staff where id=$1 and tenant_id=$2', [assignedTo, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such staff member' });
  }

  const { rows: [l] } = await pool.query(
    `insert into leads (tenant_id, name, phone, source, referrer_id, assigned_to, next_follow_up)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.tenant.id, name, phone, source ?? 'manual', referrer, assignedTo || null, nextFollowUp || null]);
  res.json(l);
});

app.get('/api/leads/:id/notes', requirePermission('leads.view'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    'select 1 from leads where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  const { rows } = await pool.query(
    'select * from lead_notes where tenant_id=$1 and lead_id=$2 order by at', [req.tenant.id, req.params.id]);
  res.json(rows);
}));

app.post('/api/leads/:id/notes', wrap(async (req, res) => {
  const { body } = req.body ?? {};
  if (!String(body ?? '').trim()) return res.status(400).json({ error: 'Write something first' });
  // Same tenant-ownership check as ticket_notes — lead_notes.lead_id is a
  // plain FK to leads(id), not composite, so this is the only thing
  // standing between a staff member on any tenant and writing into another
  // tenant's pipeline.
  const { rowCount } = await pool.query(
    'select 1 from leads where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  const { rows: [n] } = await pool.query(
    `insert into lead_notes (tenant_id, lead_id, author, body) values ($1,$2,$3,$4) returning *`,
    [req.tenant.id, req.params.id, req.session?.name ?? 'system', body]);
  res.json(n);
}));

/**
 * Referrers — staff or outsiders who bring in clients and earn a one-time
 * commission on the client's first payment. clients_referred and totals are
 * computed here rather than trusted from anywhere else, since they're what
 * the list screen is actually for: at a glance, who's earned what.
 */
app.get('/api/referrers', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select r.*, sub.account_code as subscriber_account,
            count(s.id) as clients_referred,
            coalesce(sum(rc.amount) filter (where rc.status='owed'), 0) as owed,
            coalesce(sum(rc.amount) filter (where rc.status='paid'), 0) as paid
       from referrers r
       left join subscribers sub on sub.id = r.subscriber_id
       left join subscribers s on s.referred_by = r.id
       left join referral_commissions rc on rc.referrer_id = r.id
      where r.tenant_id=$1
      group by r.id, sub.account_code
      order by r.created_at desc`,
    [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/referrers', wrap(async (req, res) => {
  const { name, phone, staffId, subscriberId, commissionType = 'percent', commissionRate = 0, notes } = req.body ?? {};
  if (!String(name ?? '').trim()) return res.status(400).json({ error: 'Name is required' });
  if (!['percent', 'fixed'].includes(commissionType)) {
    return res.status(400).json({ error: 'commissionType must be percent or fixed' });
  }
  if (staffId && subscriberId) {
    return res.status(400).json({ error: 'A referrer is staff, an existing customer, or external — not more than one at once' });
  }
  const rate = Number(commissionRate);
  if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: 'Enter a valid commission rate' });
  if (commissionType === 'percent' && rate > 100) {
    return res.status(400).json({ error: 'A percentage commission cannot be over 100%' });
  }

  // Scoped to this tenant, the same guarantee every other foreign key taken
  // bare off a request body carries on this platform.
  if (staffId) {
    const { rowCount } = await pool.query(
      'select 1 from staff where id=$1 and tenant_id=$2', [staffId, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such staff member' });
  }
  if (subscriberId) {
    const { rowCount } = await pool.query(
      'select 1 from subscribers where id=$1 and tenant_id=$2', [subscriberId, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such client' });
  }

  const { rows: [r] } = await pool.query(
    `insert into referrers (tenant_id, staff_id, subscriber_id, name, phone, commission_type, commission_rate, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *, 0 as clients_referred, 0 as owed, 0 as paid`,
    [req.tenant.id, staffId || null, subscriberId || null, String(name).trim(), phone || null, commissionType, rate, notes || null]);
  res.json(r);
}));

app.put('/api/referrers/:id', wrap(async (req, res) => {
  const { name, phone, commissionType, commissionRate, notes } = req.body ?? {};
  if (commissionType && !['percent', 'fixed'].includes(commissionType)) {
    return res.status(400).json({ error: 'commissionType must be percent or fixed' });
  }
  if (commissionRate !== undefined) {
    const rate = Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: 'Enter a valid commission rate' });
    if ((commissionType ?? 'percent') === 'percent' && rate > 100) {
      return res.status(400).json({ error: 'A percentage commission cannot be over 100%' });
    }
  }
  const { rows: [r] } = await pool.query(
    `update referrers set
       name=coalesce(nullif($3,''), name),
       phone=coalesce($4, phone),
       commission_type=coalesce($5, commission_type),
       commission_rate=coalesce($6, commission_rate),
       notes=coalesce($7, notes)
     where id=$1 and tenant_id=$2 returning *`,
    [req.params.id, req.tenant.id, name ?? '', phone ?? null,
     commissionType ?? null, commissionRate ?? null, notes ?? null]);
  if (!r) return res.status(404).json({ error: 'No such referrer' });
  res.json(r);
}));

app.delete('/api/referrers/:id', wrap(async (req, res) => {
  // Referred clients keep their history (referred_by -> null on delete, per
  // the FK) and any commission already recorded stays exactly as it was —
  // deleting the referrer is about not offering them for new referrals
  // going forward, not erasing what already happened.
  await pool.query('delete from referrers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  res.json({ ok: true });
}));

/** Everything owed to one referrer — the drawer behind View. */
app.get('/api/referrers/:id/commissions', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select rc.*, s.name as subscriber_name, s.account_code
       from referral_commissions rc
       join subscribers s on s.id = rc.subscriber_id
      where rc.referrer_id=$1 and rc.tenant_id=$2
      order by rc.created_at desc`,
    [req.params.id, req.tenant.id]);
  res.json(rows);
}));

app.post('/api/referral-commissions/:id/mark-paid', wrap(async (req, res) => {
  const { rows: [c] } = await pool.query(
    `update referral_commissions set status='paid', paid_at=now()
      where id=$1 and tenant_id=$2 and status='owed' returning *`,
    [req.params.id, req.tenant.id]);
  if (!c) return res.status(404).json({ error: 'No such owed commission' });
  res.json(c);
}));

app.get('/api/messages/:subscriberId', requirePermission('messaging.view'), async (req, res) => {
  const { rows } = await pool.query(
    'select * from messages where tenant_id=$1 and subscriber_id=$2 order by sent_at', [req.tenant.id, req.params.subscriberId]);
  res.json(rows);
});
app.post('/api/messages', requirePermission('messaging.send'), async (req, res) => {
  const { subscriberId, body, channel = 'sms' } = req.body;

  /**
   * A third path to the same bug.
   *
   * /api/sms/send and /api/sms/bulk were fixed to expand an operator's tags
   * before sending, and this route — the one the Messaging screen's own
   * "Send message" button actually calls for a single client — was not. It
   * sent `body` untouched, so a message composed with {name}{account} on
   * this screen went out as the literal text "{name}{account}", to a real
   * customer, from this exact button.
   *
   * subscriberVars needs the same join sms.SUBSCRIBER_VARS_SQL uses elsewhere
   * — plan, price and router live on other tables — or {plan} and {speed}
   * would come back empty for every customer instead of only the ones with
   * nothing to report.
   */
  let filled = body;
  let phone = null;
  if (channel !== 'live_chat') {
    const sms = await import('./sms.js');
    const { rows: [s] } = await pool.query(
      `select ${sms.SUBSCRIBER_VARS_SQL}
         from subscribers s
         left join plans p on p.id = s.plan_id
         left join routers r on r.id = s.router_id
        where s.id=$1 and s.tenant_id=$2`,
      [subscriberId, req.tenant.id]);
    phone = s?.phone ?? null;
    if (s) {
      const org = await sms.orgVars(req.tenant.id);
      filled = sms.fill(body, sms.subscriberVars(s, org));
    }
  }

  const { rows: [m] } = await pool.query(
    "insert into messages (tenant_id, subscriber_id, direction, channel, body) values ($1,$2,'out',$3,$4) returning *",
    [req.tenant.id, subscriberId, channel, filled]);

  if (channel !== 'live_chat') {
    const { send } = await import('./sms.js');
    await send(req.tenant.id, phone, 'custom', { body: filled });
  }
  res.json(m);
});

app.get('/api/live-chats', async (req, res) => {
  const { rows } = await pool.query("select * from live_chats where tenant_id=$1 and status<>'closed' order by started_at", [req.tenant.id]);
  res.json(rows);
});
app.post('/api/live-chats/:id/accept', async (req, res) => {
  const { rows: [c] } = await pool.query(
    "update live_chats set status='active', staff_id=$3 where id=$2 and tenant_id=$1 returning *",
    [req.tenant.id, req.params.id, req.body.staffId]);
  res.json(c);
});

app.get('/api/live-chats/:id/messages', wrap(async (req, res) => {
  const { rows: [chat] } = await pool.query(
    'select id, display_name, visitor_ref, status, started_at from live_chats where id=$1 and tenant_id=$2',
    [req.params.id, req.tenant.id]);
  if (!chat) return res.status(404).json({ error: 'No such conversation' });

  const { rows } = await pool.query(
    `select id, sender, body, created_at from chat_messages
      where chat_id=$1 and id > $2 order by id limit 200`,
    [chat.id, Number(req.query.since) || 0]);
  res.json({ chat, messages: rows });
}));

/** A reply from support. Answering also claims the conversation. */
app.post('/api/live-chats/:id/messages', wrap(async (req, res) => {
  const body = String(req.body?.body ?? '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Type a reply first' });

  const { rows: [chat] } = await pool.query(
    `update live_chats set status = case when status='waiting' then 'active' else status end
      where id=$1 and tenant_id=$2 returning id`,
    [req.params.id, req.tenant.id]);
  if (!chat) return res.status(404).json({ error: 'No such conversation' });

  await pool.query(
    "insert into chat_messages (tenant_id, chat_id, sender, body) values ($1,$2,'staff',$3)",
    [req.tenant.id, chat.id, body]);
  res.json({ ok: true });
}));

app.post('/api/live-chats/:id/close', wrap(async (req, res) => {
  await pool.query(
    "update live_chats set status='closed', closed_at=now() where id=$1 and tenant_id=$2",
    [req.params.id, req.tenant.id]);
  res.json({ ok: true });
}));

app.get('/api/tariffs', requirePermission('tariffs.view'), async (req, res) => {
  const { rows } = await pool.query('select * from tariffs where tenant_id=$1 and active order by price', [req.tenant.id]);
  res.json(rows);
});
app.post('/api/tariffs', requirePermission('tariffs.create'), async (req, res) => {
  const { title, price: p, speedDown, speedUp, fairUse } = req.body;
  const { rows: [t] } = await pool.query(
    'insert into tariffs (tenant_id, title, price, speed_down, speed_up, fair_use) values ($1,$2,$3,$4,$5,$6) returning *',
    [req.tenant.id, title, p, speedDown, speedUp, fairUse ?? null]);
  res.json(t);
});

/**
 * The address a router should dial to reach this server.
 *
 * Derived rather than typed. In order of trust:
 *   1. OVPN_PUBLIC_HOST — set it when the tunnel lives on a different name or a
 *      bare IP from the web app.
 *   2. ROOT_DOMAIN — what the production compose file already sets.
 *   3. The hostname this very request arrived on. Caddy passes the original Host
 *      upstream, so in production this is by definition a name that resolves to
 *      this server from the public internet.
 *
 * Never the per-tenant hostname: routers of every tenant dial the one OpenVPN
 * server, and ovpn.<tenant>.vibelink.tech needs DNS nobody has created.
 */
function tunnelHost(req) {
  const explicit = process.env.OVPN_PUBLIC_HOST?.trim();
  if (explicit) return explicit;
  const root = process.env.ROOT_DOMAIN?.trim();
  if (root) return root;
  return req.hostname;
}

/** What the Routers screen needs before it can offer to mint anything. */
app.get('/api/routers/tunnel-info', wrap(async (req, res) => {
  const { SERVER_IP, SUPERNET } = await import('./tunnel.js');
  res.json({
    serverHost: tunnelHost(req),
    // True when we are guessing from the request. The UI says so, because on a
    // laptop this resolves to "localhost", which no router can dial.
    detected: !process.env.OVPN_PUBLIC_HOST && !process.env.ROOT_DOMAIN,
    port: 1194,
    serverIp: SERVER_IP,
    supernet: SUPERNET,
  });
}));

// ── router onboarding via OVPN ────────────────────
// Each tenant owns a /24 out of 10.50.0.0/16 and the router is given the next free
// address inside it. Addresses used to come from a single shared 10.50.0.0/24 and
// were derived from a row count, so tenants collided with each other and a deleted
// router's address was immediately handed to the next one.
app.post('/api/routers/ovpn-script', requireRole('owner'), wrap(async (req, res) => {
  const { ensureSubnet, nextHostIp, SERVER_IP } = await import('./tunnel.js');

  const subnet = await ensureSubnet(req.tenant.id);
  const nasIp = await nextHostIp(req.tenant.id);
  const token = crypto.randomBytes(6).toString('hex');
  // Name from the address, so it stays unique and stays put if rows are removed.
  /**
   * Unique across the whole platform, not just this tenant.
   *
   * The name was router-<last octet>, and ovpn_clients is unique per tenant —
   * so every tenant's first router was called "router-2". OpenVPN knows only
   * the username when a client connects, and client-connect.sh looks the
   * address up by that name alone, so it could return another tenant's
   * allocation: the router dialled in, got an address from somebody else's
   * block, and the address shown here never matched the one on the router.
   *
   * Each tenant owns a distinct /24, so the block and the host octet together
   * are unique and still readable — router-3-2 is the second router in
   * 10.50.3.0/24.
   */
  const octets = nasIp.split('.');
  const username = `router-${octets[2]}-${octets[3]}`;

  // Stored hashed; the plaintext below is shown once, in the script, and then gone.
  await pool.query(
    `insert into ovpn_clients (tenant_id, username, password_hash, assigned_ip)
     values ($1,$2,crypt($3, gen_salt('bf')),$4)`,
    [req.tenant.id, username, token, nasIp]
  );

  // Detected from the deployment; the caller may still override, because on a
  // bench the server is just an address on the same LAN.
  const host = String(req.body?.serverHost ?? '').trim() || tunnelHost(req);

  /**
   * Dial the address, not the name.
   *
   * The router's own log is unambiguous about why tunnels kept dropping:
   *
   *   billing-ovpn: disconnected <could not resolve name>
   *   billing-ovpn: terminating... - could not resolve name
   *
   * RouterOS re-resolves connect-to on every reconnect, and it treats a failed
   * lookup as a reason to tear the tunnel down rather than retry. So the tunnel
   * was only ever as reliable as DNS on the router — and on a mobile or CGNAT
   * link, that is not reliable at all. Every dropped session, every push that
   * died mid-command, traces back to it.
   *
   * Resolving here removes DNS from the path entirely: the router dials an
   * address, which cannot fail to resolve.
   *
   * The cost is that a router pinned this way does not follow the server to a
   * new address. That is worth stating rather than hiding — it is why the name
   * is kept in the script as a comment, and why the fallback below keeps the
   * hostname when resolution fails here. Moving the server means re-onboarding,
   * which is a known day of work, against a fleet that will not stay up.
   */
  let dialTarget = host;
  let pinnedNote = '';
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    try {
      const { address } = await dns.promises.lookup(host, { family: 4 });
      /**
       * Only pin an address a router could actually dial.
       *
       * This resolves on the server, and a server's resolver does not always
       * answer the way the internet does: a hijacking resolver hands back its
       * own landing page, a split-horizon one hands back a private address,
       * and a development box resolves the name to loopback. Writing any of
       * those into the script would point the whole fleet at somewhere that
       * cannot be reached, which is worse than the DNS problem being fixed —
       * and it would be baked into every router until someone re-onboarded
       * them one at a time.
       *
       * When the answer is not publicly routable, keep the hostname and let
       * the router resolve it as before.
       */
      const priv = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(address);
      if (priv) throw new Error(`${host} resolves to ${address} here, which no router can dial`);
      dialTarget = address;
      pinnedNote = host;
    } catch {
      // Leave the hostname in place. A router that can resolve it still works,
      // and a script that dials nothing at all would be worse.
      pinnedNote = '';
    }
  }

  // RouterOS 6 and 7 spell the cipher differently, and pasting the wrong one
  // fails with a bare "syntax error" pointing at the column, which tells you
  // nothing. v6: aes256. v7: aes256-cbc. Both mean AES-256-CBC, which is what
  // the server offers.
  const v6 = String(req.body?.routerosVersion ?? '7').startsWith('6');
  const cipher = v6 ? 'aes256' : 'aes256-cbc';

  // Must match `auth` in infra/openvpn/server.conf — OpenVPN cannot negotiate the
  // HMAC digest per client, so one wrong value here means the tunnel dies right
  // after authenticating. Default sha1 because the RouterOS 6 OVPN client rejects
  // sha256 outright ("syntax error" on the auth= token, not a runtime failure).
  // HMAC-SHA1 is still sound: the SHA1 collision attacks do not carry over to HMAC.
  const authDigest = (process.env.OVPN_AUTH_DIGEST ?? 'sha1').toLowerCase();

  const script = [
    /**
     * Remove any tunnel we set up before, then add this one.
     *
     * Without the remove, `add` fails on a router that already has a
     * billing-ovpn interface — "already have interface with such name" — and
     * RouterOS keeps the old client running with the old username. Revoking a
     * credential and pasting a fresh script therefore changed nothing: the
     * router went on dialling in as before, on the old address, and every
     * attempt to fix the mismatch looked like it had simply failed again.
     *
     * `find` matches nothing on a first install, where remove is a no-op.
     */
    /**
     * Give the router working DNS if it has none.
     *
     * Only when the list is empty, so an operator's own resolvers are left
     * alone. The tunnel no longer depends on this, but everything else the
     * router does — fetching the hotspot login page, reaching M-Pesa through
     * the walled garden — still needs a name to resolve.
     */
    ':if ([:len [/ip dns get servers]] = 0) do={/ip dns set servers=1.1.1.1,8.8.8.8}',

    /**
     * Keep the clock right, because a clock that jumps restarts the tunnel.
     *
     * A router with no NTP boots at whatever time it last remembered, and is
     * then corrected — by MikroTik Cloud, or by the first NTP reply it gets —
     * in one jump. Seen in the field as a 3m37s correction, and the tunnel
     * redialled at exactly that moment: RouterOS restarts timed services when
     * the clock moves. The server logs it as a fresh connection dropping the
     * previous session, and any push in flight dies with no explanation at
     * either end.
     *
     * With NTP running the clock is set once, early, and stays right, so there
     * is no jump to restart anything. It also makes the router's own log
     * timestamps comparable with the server's, which is the difference between
     * diagnosing this in one reading and guessing at it for a day.
     */
    ...(v6
      ? ['/system ntp client set enabled=yes primary-ntp=216.239.35.0 secondary-ntp=162.159.200.1']
      : ['/system ntp client set enabled=yes servers=time.google.com,time.cloudflare.com']),
    ...(pinnedNote ? [`# ${pinnedNote} resolves to ${dialTarget} — dialling the address directly,`,
                      '# because a failed DNS lookup makes RouterOS tear the tunnel down.'] : []),
    '/interface ovpn-client remove [find name=billing-ovpn]',
    // One line per command: the backslash continuation this used to emit is
    // fragile when pasted, and it hid which parameter the parser rejected.
    `/interface ovpn-client add name=billing-ovpn connect-to=${dialTarget} port=1194 `
      + `user=${username} password=${token} certificate=none cipher=${cipher} auth=${authDigest} `
      // Explicit, because a management tunnel must never carry customer traffic
      // even if the server one day pushes a route.
      + 'add-default-route=no mode=ip',
    /**
     * Masquerade on the tunnel interface itself, not a subnet.
     *
     * add-default-route=no above means nothing is routed through this
     * interface except the router's own self-generated traffic, so this is
     * inert today — a genuine no-op, not a risk. It exists as a safety net
     * for whatever the router itself needs to originate through the tunnel
     * (an NTP request, a lookup) rather than something arriving from behind
     * it: masquerading subscriber traffic out of this interface would still
     * be wrong for exactly the reason a plain srcnat-by-subnet rule would be
     * — it would hide every customer behind the router's own single address
     * — which is why this is scoped to the interface, not a subnet.
     */
    '/ip firewall nat remove [find where comment="ispVpn tunnel egress (managed)"]',
    '/ip firewall nat remove [find where comment="ispVpn tunnel egress (vibelink)"]',
    '/ip firewall nat add chain=srcnat out-interface=billing-ovpn action=masquerade '
      + 'comment="ispVpn tunnel egress (managed)"',
    ':log info "Billing OVPN client added - waiting for tunnel IP"',
  ].join('\n');

  res.json({
    script,
    nasIp,
    username,
    subnet,
    serverIp: SERVER_IP,
    serverHost: host,
    // What the router will actually dial, so the screen can say so.
    dialTarget,
    routerosVersion: v6 ? '6' : '7',
    defaultApiPort: 8728,
  });
}));

/**
 * Winbox into your own router over the same tunnel it already dials into —
 * a real OpenVPN client peer, not a proxy. Reaches only this tenant's own
 * routers: server.conf turns on client-to-client for this to work at all,
 * and infra/openvpn/client-connect.sh is what actually confines it — see
 * the VIBELINK_TUNNEL_ISOLATION chain there. Nothing on the API side
 * enforces the isolation; it is entirely a property of that firewall chain.
 */
app.post('/api/routers/vpn-access', requireRole('owner'), wrap(async (req, res) => {
  const { ensureSubnet, nextHostIp } = await import('./tunnel.js');

  const { rows: [{ count }] } = await pool.query(
    `select count(*)::int from routers where tenant_id=$1`, [req.tenant.id]);
  if (!count) return res.status(409).json({ error: 'Add a router first — there is nothing to Winbox into yet.' });

  const subnet = await ensureSubnet(req.tenant.id);
  const ip = await nextHostIp(req.tenant.id);
  const token = crypto.randomBytes(9).toString('base64url');
  // staff- prefix (not router-<octet>) so client-connect.sh's log lines and
  // an operator reading `docker compose logs openvpn` can tell the two
  // kinds of peer apart at a glance.
  const username = `staff-${req.session.staff_id}-${Date.now().toString(36)}`;

  await pool.query(
    `insert into ovpn_clients (tenant_id, username, password_hash, assigned_ip, kind, staff_id)
     values ($1,$2,crypt($3, gen_salt('bf')),$4,'staff',$5)`,
    [req.tenant.id, username, token, ip, req.session.staff_id]);

  let ca;
  try {
    ca = (await (await import('node:fs/promises')).readFile('/etc/openvpn/pki/ca.crt', 'utf8')).trim();
  } catch (e) {
    return res.status(500).json({ error: `Could not read the tunnel's CA certificate: ${e.message}` });
  }

  const host = String(req.body?.serverHost ?? '').trim() || tunnelHost(req);
  const authDigest = (process.env.OVPN_AUTH_DIGEST ?? 'sha1').toLowerCase();

  // A standard client config any OpenVPN app can import — Tunnelblick, the
  // official OpenVPN Connect app, or `openvpn --config` directly. Matches
  // server.conf's own settings (cipher, auth digest, no renegotiation)
  // because none of those are negotiated; a mismatch here fails silently
  // with "no shared cipher" the same way it does for a router.
  const config = [
    'client',
    'dev tun',
    'proto tcp-client',
    `remote ${host} 1194`,
    'resolv-retry infinite',
    'nobind',
    'persist-key',
    'persist-tun',
    'remote-cert-tls server',
    'data-ciphers AES-256-CBC',
    'data-ciphers-fallback AES-256-CBC',
    `auth ${authDigest.toUpperCase()}`,
    'reneg-sec 0',
    'verb 3',
    '<auth-user-pass>',
    username,
    token,
    '</auth-user-pass>',
    '<ca>',
    ca,
    '</ca>',
  ].filter(Boolean).join('\n');

  res.json({
    config,
    filename: `${req.tenant.subdomain ?? 'vibelink'}-winbox.ovpn`,
    yourAddress: ip,
    tenantSubnet: subnet,
    note: `Once connected, Winbox to each router's tunnel address (Routers screen shows it) — `
      + 'this peer can reach your own routers only, nothing else on the platform.',
  });
}));

/** Staff VPN peers this tenant has issued, for a "revoke" list — never the password, already hashed and gone. */
app.get('/api/routers/vpn-access', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select c.id, c.username, host(c.assigned_ip) as ip, c.connected_at, c.created_at,
            s.name as staff_name
       from ovpn_clients c
       left join staff s on s.id = c.staff_id
      where c.tenant_id=$1 and c.kind='staff'
      order by c.created_at desc`, [req.tenant.id]);
  res.json(rows);
}));

app.delete('/api/routers/vpn-access/:id', requireRole('owner'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `delete from ovpn_clients where id=$1 and tenant_id=$2 and kind='staff'`,
    [req.params.id, req.tenant.id]);
  if (!rowCount) return res.status(404).json({ error: 'No such peer' });
  // The connection itself dies on its own: auth.sh is asked again on
  // OpenVPN's periodic re-check and the row is simply gone by then. No
  // separate disconnect step exists to force it sooner.
  res.json({ ok: true, note: 'Revoked — the connection will drop within a few minutes if it is currently active.' });
}));

/**
 * The tunnel username an address implies: 10.50.2.3 is router-2-3.
 *
 * The minting route builds it from the address octets, so the same rule
 * recovers it — which is how a credential whose address has since moved on is
 * still recognised as belonging to this router.
 */
function ovpnUsernameFor(host) {
  const o = String(host).split('/')[0].split('.');
  return o.length === 4 ? `router-${o[2]}-${o[3]}` : '';
}

/**
 * Which login to use for a router: our own account if we have one, otherwise the
 * admin credentials supplied with this request. Shared by every route that talks
 * to a MikroTik, so they cannot drift apart on which takes precedence.
 */
async function routerLogin(r, body, secrets) {
  const stored = secrets.decrypt(r.service_password_enc);
  if (stored && r.service_user) return { user: r.service_user, password: stored, stored: true };
  const user = String(body?.username ?? '').trim();
  if (user) return { user, password: String(body?.password ?? ''), stored: false };
  return null;
}

/**
 * Open the API session, and do not let a stale service account become a dead end.
 *
 * routerLogin prefers the account we minted, which is right almost always. But
 * the router can lose that account without us knowing — a netinstall, a restore
 * from an old backup, an operator tidying /user, or a re-onboard after Revoke.
 * From then on every push logs in with a password nobody accepts, and because
 * stored credentials exist the operator is never asked for admin ones again.
 * The screen says "the router rejected those credentials" forever, with no
 * button that leads anywhere.
 *
 * So when the stored login is refused: use the admin credentials from this
 * request if they were sent, and otherwise ask for them. The account is minted
 * again from there, which is the same path a new router takes.
 */
/**
 * Does this error mean the socket went away, rather than the router objecting?
 *
 * A push takes tens of seconds and the tunnel does not always survive it: the
 * router redials, the server drops the previous session, and every in-flight
 * connection dies with it. RouterOS never answered, so what surfaces is a
 * timeout or a reset — the same shape as an unreachable router, but recoverable
 * in a way that a rejected command is not.
 */
function lostConnection(e) {
  const code = String(e?.code ?? e?.errno ?? '');
  if (['SOCKTMOUT', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_WRITE_AFTER_END'].includes(code)) return true;
  // "no reply after Ns" is step()'s own deadline firing, not a socket-level
  // exception — and it was not matched here, so the one case tryStep exists
  // for (a redial landing mid-command) got zero retries whenever it surfaced
  // as our timeout instead of a raw ECONNRESET. A command that is still
  // running when we give up on it is exactly a lost connection as far as the
  // operator is concerned.
  return /socket|closed|timed? ?out|no response|no reply/i.test(String(e?.message ?? ''));
}

async function openRouter(ros, { host, port, login, body }) {
  try {
    return { conn: await ros.connect({ host, port, user: login.user, password: login.password }), login };
  } catch (e) {
    const cantLogin = String(e?.code ?? e?.errno ?? '') === 'CANTLOGIN';
    if (!cantLogin || !login.stored) throw e;

    const user = String(body?.username ?? '').trim();
    if (!user) {
      const err = new Error(
        `The ${login.user} account no longer works on this router — it was probably reset or `
        + 'restored. Enter the router’s admin username and password once and it will be created again.');
      err.needsAdmin = true;
      throw err;
    }
    const fallback = { user, password: String(body?.password ?? ''), stored: false };
    return {
      conn: await ros.connect({ host, port, user: fallback.user, password: fallback.password }),
      login: fallback,
    };
  }
}

/**
 * The tenant's own standing with the platform: licence validity, and whatever
 * they owe us.
 *
 * Everything the dashboard needs to decide what to show, computed here so the
 * date arithmetic is not repeated in the browser against a clock we do not
 * control.
 */
app.get('/api/licence', wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(`
    select t.status, t.licence_ends,
           (t.licence_ends - current_date) as days_left
      from tenants t where t.id = $1`, [req.tenant.id]);

  const daysLeft = row?.days_left == null ? null : Number(row.days_left);
  res.json({
    status: row?.status ?? 'active',
    readOnly: row?.status === 'readonly',
    licenceEnds: row?.licence_ends ?? null,
    daysLeft,
    // Invoicing belongs to WHMCS. All this reports is how long the licence has
    // left, and whether it is close enough to be worth saying so.
    expiringSoon: daysLeft != null && daysLeft <= 7,
  });
}));

/**
 * Compare the router's RADIUS settings against what this server expects.
 *
 * Also reports the server's own side, so "confirm the IPs and the password" has
 * one answer in one place instead of being reconstructed from three screens.
 */
app.post('/api/routers/:id/radius-check', wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const { SERVER_IP } = await import('./tunnel.js');

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const coaPort = Number(process.env.RADIUS_COA_PORT ?? 3799);
  const expected = {
    radiusServer: SERVER_IP,
    authPort: 1812,
    acctPort: 1813,
    coaPort,
    nasAddress: String(r.host).split('/')[0],
    // The secret itself is not returned; the comparison happens server-side.
    secretSetOnServer: Boolean(r.secret),
  };

  // The `nas` view is derived from the routers table, so this is all but
  // guaranteed for a router that exists. It is reported not as a test but as the
  // one address RADIUS will accept from: a router sending from anything else —
  // its LAN address, say, rather than its tunnel address — is dropped without a
  // reply, and that is the failure this whole screen exists to make visible.
  const { rows: [nas] } = await pool.query(
    'select nasname, shortname from nas where nasname = $1', [expected.nasAddress]);

  const login = await routerLogin(r, req.body, secrets);
  if (!login) {
    return res.json({
      expected,
      knownToRadius: Boolean(nas),
      checks: null,
      note: 'Router login needed to read its side.',
    });
  }

  let conn;
  try {
    conn = await ros.connect({ host: expected.nasAddress, port: r.api_port ?? 8728, user: login.user, password: login.password });
    const { checks, ok } = await ros.radiusCheck(conn, {
      serverIp: SERVER_IP, secret: r.secret, coaPort,
    });
    res.json({ expected, knownToRadius: Boolean(nas), ok: ok && Boolean(nas), checks });
  } catch (e) {
    res.status(502).json({
      expected,
      knownToRadius: Boolean(nas),
      error: describeRouterError(conn?.__socketError ?? e, expected.nasAddress, r.api_port ?? 8728),
    });
  } finally {
    if (conn) ros.close(conn);
  }
}));

/**
 * Tunnels that are connected right now, matched against what we think.
 *
 * Exists because of a failure that wasted a lot of time: the router dialled in
 * on 10.50.3.2, the UI said 10.50.2.2, and nothing anywhere pointed out that the
 * two disagreed. Every push then failed with a connection timeout, which reads
 * as "the router is down" rather than "you are calling the wrong number".
 */
app.get('/api/routers/tunnels', wrap(async (req, res) => {
  const { liveTunnels } = await import('./tunnel.js');
  const { rows: routers } = await pool.query(
    'select id, name, host from routers where tenant_id=$1', [req.tenant.id]);
  const { rows: [t] } = await pool.query(
    'select tunnel_subnet from tenants where id=$1', [req.tenant.id]);

  const mine = t?.tunnel_subnet
    ? String(t.tunnel_subnet).split('/')[0].split('.').slice(0, 3).join('.')
    : '';
  const byHost = new Map(routers.map((r) => [String(r.host).split('/')[0], r]));

  // Only this tenant's block. The status file is server-wide and one tenant must
  // not be shown another's routers.
  const tunnels = (await liveTunnels())
    .filter((t) => !mine || t.address.startsWith(`${mine}.`))
    .map((t) => ({ ...t, router: byHost.get(t.address) ?? null }));

  const live = new Set(tunnels.map((t) => t.address));

  /**
   * Routers being turned away right now.
   *
   * A revoked credential does not stop the router using it — RouterOS retries
   * every few seconds indefinitely — so the fleet looks down and nothing says
   * why. Ten minutes is recent enough to mean "happening now" rather than
   * "happened once last week".
   *
   * Matched to this tenant by the username, which carries the tenant's tunnel
   * block: router-3-2 is in 10.50.3.0/24. A name from before that scheme is
   * shown to nobody rather than to the wrong tenant.
   */
  const { rows: rejected } = await pool.query(
    `select username, count(*)::int tries, max(at) last_try
       from ovpn_auth_failures
      where at > now() - interval '10 minutes'
      group by username order by last_try desc`);
  const mineRejected = mine
    ? rejected.filter((r) => new RegExp(`^router-${mine.split('.')[2]}-`).test(r.username))
    : [];

  res.json({
    tunnels,
    rejected: mineRejected,
    // A router whose address is not connected, when some other address is. That
    // pairing is what makes it a mismatch rather than simply being offline.
    stale: routers
      .filter((r) => !live.has(String(r.host).split('/')[0]))
      .map((r) => ({ ...r, suggestion: tunnels.find((t) => !t.router)?.address ?? null })),
  });
}));

/**
 * Check the login page is reachable and is actually ours before the router
 * installs it.
 *
 * Caddy served the React bundle for /hotspot/* for a while, so the router
 * fetched 715 bytes of index.html, installed it, reported success, and every
 * guest got a blank white screen. The router cannot tell one HTML file from
 * another; the server can, and it is the one issuing the instruction.
 */
async function loginPageReachable(url) {
  const { MARKER } = await import('./hotspot-portal.js');
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return `the page returned HTTP ${res.status}`;
    const body = await res.text();
    if (!body.includes(MARKER)) {
      return 'that URL does not serve the login page — check the /hotspot/* route reaches the API';
    }
    return null;
  } catch (e) {
    return `the page could not be fetched from this server (${e.message})`;
  }
}

/**
 * Run one push step with a deadline and a name.
 *
 * Two failures this prevents. A RouterOS write that never answers hangs the
 * request forever — the browser sits on "Applying…" with no way to tell a slow
 * link from a dead one, which is what a stuck push actually looked like. And a
 * bare error message ("timeout", "no such item") says nothing about which of a
 * dozen commands produced it.
 *
 * 20 seconds per step: long enough for a slow tunnel to a rural tower, short
 * enough that a failure is reported while the operator is still watching.
 */
async function step(label, fn, ms = 20000) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: no reply after ${ms / 1000}s`)), ms);
      }),
    ]);
  } catch (e) {
    // The label goes on the error object, not only into the message. The push
    // routes report socket errors via conn.__socketError rather than the thrown
    // error, so a message-only label was discarded exactly when it mattered --
    // a mid-push disconnect produced a generic "no response from the router"
    // and never said which command caused it.
    e.step = e.step ?? label;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Prefix a router error with the step that produced it, when we know it. */
function atStep(e, message) {
  return e?.step ? `${e.step} — ${message}` : message;
}

/**
 * Push the whole hotspot to one router, in one press.
 *
 * Separate from Configure because the two are wanted at different moments: a
 * PPPoE tower is configured once and left, while a hotspot site gets its
 * captive portal set up, checked, and set up again after someone changes the
 * plan. Bundling them meant re-pushing PPPoE to fix a hotspot.
 *
 * Everything here is idempotent, so the answer to "did that work?" is always to
 * press it again and read the result.
 */
app.post('/api/routers/:id/hotspot', requirePermission('routers.configure'), wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const { SERVER_IP } = await import('./tunnel.js');

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const { rows: [hs] } = await pool.query(
    'select * from hotspot_settings where tenant_id=$1', [req.tenant.id]);
  const { rows: [t] } = await pool.query(
    'select subdomain from tenants where id=$1', [req.tenant.id]);

  const host = String(r.host).split('/')[0];
  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({
    error: 'Enter the router’s admin username and password once. A dedicated account is created from it and used for every push after that.',
    needsAdmin: true,
  });

  // The bridge to build on. Ports are only needed the first time; afterwards the
  // bridge already exists and we attach to it by name.
  const lanPorts = Array.isArray(req.body?.lanPorts) ? req.body.lanPorts : [];
  const bridgeName = String(req.body?.bridge ?? 'bridge-lan').trim() || 'bridge-lan';

  const done = [];
  let conn;
  try {
    conn = await step('connect', () =>
      ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password }));

    // Same reconnect-once wrapper as Configure. A hotspot push is the longer of
    // the two — it fetches the login page over the tunnel as well — so it is the
    // more likely of the two to have a redial land in the middle of it.
    const tryStep = async (label, fn, ms) => {
      try {
        return await step(label, fn, ms);
      } catch (e) {
        if (!lostConnection(e)) throw e;
        try { ros.close(conn); } catch { /* already gone */ }
        conn = await ros.connect({
          host, port: r.api_port ?? 8728, user: login.user, password: login.password,
        });
        done.push(`the tunnel dropped during ${label} — reconnected and carried on`);
        return await step(label, fn, ms);
      }
    };

    // 40s, not the 20s default. ensureBridge now makes far fewer round trips
    // than it used to — the uplink-safety checks were re-fetching the same
    // bridge and port lists two and three times each — but it is still six or
    // seven queries before anything is written, and a slow rural tunnel can
    // still make that add up.
    const bridge = await tryStep('bridge', () =>
      ros.ensureBridge(conn, { name: bridgeName, ports: lanPorts }), 40000);
    if (bridge.added.length) done.push(`bridged ${bridge.added.join(', ')} into ${bridge.bridge}`);

    // RADIUS first: a hotspot server that comes up before the router knows where
    // to authenticate will refuse every login until the next push.
    // 45s, not the 20s default. This lists the router's RADIUS servers, writes
    // one, removes any duplicates and enables CoA — four round trips over a
    // tunnel that may be on a rural link, and the flat deadline was failing a
    // step that was working, just slowly.
    await tryStep('RADIUS', () => ros.applyRadius(conn, {
      serverIp: SERVER_IP,
      secret: r.secret,
      coaPort: Number(process.env.RADIUS_COA_PORT ?? 3799),
      services: r.role === 'both' ? 'ppp,hotspot' : 'hotspot',
    }), 45000);
    done.push(`RADIUS pointed at ${SERVER_IP}`);

    const built = await tryStep('hotspot server, DHCP and pool', () =>
      ros.applyHotspotServer(conn, {
        bridge: bridge.bridge,
        // Every tenant's routers got the identical 'billing.spot' default
        // otherwise — harmless on a single isolated LAN, but it meant the
        // captive-portal page's own JS could never reliably name "the
        // router's real hotspot host" for anything tenant-specific, and an
        // operator managing several networks saw the same name on all of
        // them. Kept as the literal fallback only for a tenant with no
        // subdomain yet, matching what has always been pushed until now.
        dnsName: t?.subdomain ? `${t.subdomain}.spot` : 'billing.spot',
        network: req.body?.hotspotNetwork ?? hs?.hotspot_network ?? '10.5.50.0/24',
        // The profile a voucher will name, built with the same hotspot.
        sharedUsers: hs?.multi_device ? 3 : 1,
        idleSeconds: hs?.idle_timeout_sec ?? 30,
        bindMac: hs?.bind_mac ?? true,
      }), 40000);
    done.push(`hotspot on ${bridge.bridge} at ${built.gateway}, pool ${built.pool}`);
    if (built.changed.length) done.push(`created ${built.changed.join(', ')}`);

    // The user profile is built by applyHotspotServer above, so both this and
    // Configure produce it. Reported here for the operator's benefit.
    done.push(`sessions use hs-default (${hs?.multi_device ? 3 : 1} device`
      + `${hs?.multi_device ? 's' : ''} per code, `
      + `${hs?.bind_mac ?? true ? 'device remembered' : 'code required each time'})`);

    // Masquerade, stated as its own step rather than buried inside building the
    // hotspot. It is the difference between guests having an address and guests
    // having internet, and when it is missing nobody can tell from the result
    // that it was ever meant to happen.
    const nat = await tryStep('NAT', () => ros.applyNat(conn, {
      subnet: req.body?.hotspotNetwork ?? hs?.hotspot_network ?? '10.5.50.0/24',
    }));
    done.push(nat.wan
      ? `masquerading guests out ${nat.wan}`
      : 'masquerading guests (uplink not identified, so out of every interface)');

    // Before the walled garden: a guest who cannot resolve a single hostname
    // never gets as far as needing one allowed. This is the usual reason the
    // captive-portal popup does not appear at all — not a page problem, a DNS
    // problem, and one indistinguishable from "nothing is wrong here" by
    // reading the walled garden or the login page alone.
    //
    // hotspotSubnet also rate-limits the guest side of this same open
    // resolver — see applyDnsProxy's own comment on why an open DNS proxy is
    // the standard way a captive portal gets bypassed for free (DNS
    // tunneling, the same trick every "VPN injector" app relies on).
    const dnsProxy = await tryStep('DNS proxy', () => ros.applyDnsProxy(conn, {
      hotspotSubnet: req.body?.hotspotNetwork ?? hs?.hotspot_network ?? '10.5.50.0/24',
    }), 40000);
    done.push(dnsProxy.protected
      ? `DNS proxy open to guests, blocked from ${dnsProxy.wan}, guest DNS rate-limited against tunneling`
      : dnsProxy.enabled
        ? `DNS proxy open to guests — could not confirm the uplink to firewall it, so check this by hand`
        : `could not enable the DNS proxy safely (no uplink identified) — guests will not be able to resolve names, and the popup will not appear`);

    // The tenant's own portal must be reachable before login or a guest cannot
    // buy anything — that is the entire point of the walled garden here.
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    const portal = t?.subdomain ? `${t.subdomain}.${root}` : null;
    const gardenHosts = [...(hs?.walled_garden ?? []), portal].filter(Boolean);
    const garden = await tryStep('walled garden', () => ros.applyWalledGarden(conn, gardenHosts), 40000);
    done.push(`walled garden allows ${garden.allowed} host${garden.allowed === 1 ? '' : 's'}`
      + (portal ? `, including ${portal}` : ''));

    // The tenant's own login page, replacing MikroTik's. Non-fatal: a hotspot
    // serving the stock page still sells bundles and still authenticates, so a
    // router that cannot reach the internet to fetch it should not fail the
    // whole push — it should say so and leave everything else in place.
    if (portal) {
      try {
        const url = `https://${portal}/hotspot/login.html?router=${r.id}`;
        const unreachable = await loginPageReachable(url);
        if (unreachable) throw new Error(unreachable);

        const page = await tryStep('login page', () =>
          ros.pushHotspotPage(conn, { url, bridge: bridge.bridge }), 40000);
        done.push(`installed the ${portal} login page at ${page.path} (${page.bytes} bytes)`);
      } catch (e) {
        done.push(`could not install the login page (${e.message}) — the stock MikroTik page stays`);
      }
    }

    const ttl = await tryStep('anti-sharing rule', () => ros.applyAntiSharing(conn, { bridge: bridge.bridge }));
    done.push(ttl.created
      ? 'anti-sharing TTL rule added'
      : 'anti-sharing TTL rule already in place');

    await pool.query(
      `update routers set autoconfig_last_at=now(), autoconfig_last_ok=true,
              autoconfig_last_error=null, status='up', last_seen=now() where id=$1`, [r.id]);

    console.log('hotspot push', r.name, host, '→ ok:', done.join('; '));
    res.json({ ok: true, applied: done, gateway: built.gateway });
  } catch (e) {
    let message = atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728));
    if (!conn) {
      const why = await explainUnreachable(req.tenant.id, host);
      // Replace the guess rather than append to it. The stock text asks whether
      // the tunnel is up and whether the address is the right one; when both can
      // be answered, asking as well only buries the answer.
      if (why) message = `${atStep(e, `Could not reach ${host}:${r.api_port ?? 8728}.`)}${why}`;
    }
    await pool.query(
      'update routers set autoconfig_last_at=now(), autoconfig_last_ok=false, autoconfig_last_error=$2 where id=$1',
      [r.id, message.slice(0, 300)]).catch(() => {});
    // Logged as well as returned. This route answers its own errors instead of
    // going through the wrap() handler, so nothing reached the container log --
    // a failed push left `docker compose logs api` showing only the startup
    // line, which reads as "nothing happened" rather than "it failed".
    console.error('hotspot push', r.name, host, '→', message,
      done.length ? `(after: ${done.join('; ')})` : '(nothing applied)');
    // The steps that did land are worth reporting: "it failed" is far less
    // useful than "it failed after the hotspot came up, at the firewall".
    res.status(502).json({ error: message, applied: done });
  } finally {
    if (conn) ros.close(conn);
  }
}));

/**
 * Ask the router why the captive portal is not appearing.
 *
 * Read-only. Every cause of "the login page does not pop" is visible on the
 * router, so this reports them all at once instead of the operator and I
 * eliminating them one round trip at a time.
 */
app.post('/api/routers/:id/hotspot-check', wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const host = String(r.host).split('/')[0];
  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({ error: 'Configure this router first.', needsAdmin: true });

  let conn;
  try {
    conn = await step('connect', () =>
      ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password }));
    const report = await step('read the hotspot', () => ros.hotspotCheck(conn), 30000);

    // What the guest's phone would have to fetch, so a wrong or unreachable
    // page can be told apart from a hotspot that is not running at all.
    const { rows: [t] } = await pool.query('select subdomain from tenants where id=$1', [req.tenant.id]);
    const rootDomain = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    res.json({ ...report, pageUrl: t?.subdomain ? `https://${t.subdomain}.${rootDomain}/hotspot/login.html` : null });
  } catch (e) {
    res.status(502).json({ error: atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728)) });
  } finally {
    if (conn) ros.close(conn);
  }
}));

/**
 * Live throughput per port.
 *
 * Polled by the browser rather than pushed, and each poll opens and closes its
 * own connection. Holding one open per operator watching a screen would leave
 * sockets on the router whenever a tab is closed or a laptop is shut, and
 * RouterOS has a small connection limit that is unpleasant to exhaust.
 */
/**
 * Two different latencies, deliberately told apart rather than folded into
 * one number: how fast *we* can reach the router (the API connect itself,
 * timed — the same round trip every push/read this router does already
 * makes, over whichever tunnel it's on) versus how the router's own uplink
 * to the real internet is doing (RouterOS pinging out itself, not through
 * us at all). A site can have a perfectly healthy tunnel and a miserable
 * uplink, or the reverse — an operator troubleshooting "this site feels
 * slow" needs to know which one it is before they know who to call.
 */
app.post('/api/routers/:id/ping', requirePermission('routers.view'), wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const host = String(r.host).split('/')[0];
  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({ error: 'Configure this router first.', needsAdmin: true });

  let conn;
  try {
    const connectStarted = Date.now();
    conn = await step('connect', () =>
      ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password }));
    const serverToRouterMs = Date.now() - connectStarted;
    // 8.8.8.8, not this server's own address — the point is the router's
    // uplink to the wider internet, which pinging back through the same
    // tunnel it's asking about would not actually test.
    const routerToInternet = await step('ping 8.8.8.8', () => ros.pingHost(conn, '8.8.8.8', 4), 15000);
    res.json({ serverToRouterMs, routerToInternet, at: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728)) });
  } finally {
    if (conn) ros.close(conn);
  }
}));

app.post('/api/routers/:id/traffic', wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const host = String(r.host).split('/')[0];
  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({ error: 'Configure this router first.', needsAdmin: true });

  let conn;
  try {
    conn = await step('connect', () =>
      ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password }));
    const ports = await step('read traffic', () => ros.portTraffic(conn), 15000);
    res.json({ ports, at: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728)) });
  } finally {
    if (conn) ros.close(conn);
  }
}));

/**
 * Devices connected to this router's hotspot, split into two lists: not
 * locked yet (nearbyDevices — a guest's phone, or a TV nobody has pinned
 * down) and already locked to a fixed IP (boundDevices). bindDeviceByMac/
 * unbindDeviceByMac already existed and worked — they're what the public
 * hotspot voucher flow uses to get a TV online with no login page at all —
 * but nothing let an operator do this directly for a device that isn't
 * going through a voucher purchase at all (a customer's own smart TV,
 * printer, or anything else worth always finding at the same address).
 */
app.get('/api/routers/:id/devices', requirePermission('routers.configure'), wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const host = String(r.host).split('/')[0];
  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({ error: 'Configure this router first.', needsAdmin: true });

  let conn;
  try {
    conn = await step('connect', () =>
      ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password }));
    const [nearby, locked] = await Promise.all([
      step('nearby devices', () => ros.nearbyDevices(conn), 15000),
      step('locked devices', () => ros.boundDevices(conn), 15000),
    ]);
    res.json({ nearby, locked });
  } catch (e) {
    res.status(502).json({ error: atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728)) });
  } finally {
    if (conn) ros.close(conn);
  }
}));

app.post('/api/routers/:id/devices/lock', requirePermission('routers.configure'), wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const { mac, downKbps, upKbps, label } = req.body ?? {};
  if (!mac) return res.status(400).json({ error: 'mac is required' });

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const host = String(r.host).split('/')[0];
  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({ error: 'Configure this router first.', needsAdmin: true });

  let conn;
  try {
    conn = await step('connect', () =>
      ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password }));
    const result = await step('lock device', () => ros.bindDeviceByMac(conn, {
      mac, downKbps: Number(downKbps) || 2000, upKbps: Number(upKbps) || 1000, comment: label ?? '',
    }), 20000);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728)) });
  } finally {
    if (conn) ros.close(conn);
  }
}));

app.post('/api/routers/:id/devices/unlock', requirePermission('routers.configure'), wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const { mac } = req.body ?? {};
  if (!mac) return res.status(400).json({ error: 'mac is required' });

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const host = String(r.host).split('/')[0];
  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({ error: 'Configure this router first.', needsAdmin: true });

  let conn;
  try {
    conn = await step('connect', () =>
      ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password }));
    await step('unlock device', () => ros.unbindDeviceByMac(conn, { mac }), 20000);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728)) });
  } finally {
    if (conn) ros.close(conn);
  }
}));

/**
 * Read the PPPoE and hotspot accounts off a router, and optionally create
 * clients from them.
 *
 * Two steps on purpose. GET-like preview first, because importing several
 * hundred customers is not something to trigger by misclicking, and the
 * operator needs to see what is about to be created and which already exist.
 *
 * Names that already exist as a pppoe_user are reported and skipped rather than
 * updated: the database is authoritative once a customer is billed from here,
 * and quietly overwriting a password from a router that has drifted would cut
 * that customer off.
 *
 * A /ppp/secret with no password used to be skipped outright — nothing to
 * authenticate it with, and inventing a password for an account nobody can
 * confirm is real risks billing a stale entry from someone who left months
 * ago. /ppp/active (live right now) is what turns that risk into a fact:
 * a no-password secret that the router currently shows connected, or a live
 * PPPoE session with no /ppp/secret entry at all (a router relying purely on
 * RADIUS), is unambiguously a real customer. Both get a freshly generated
 * password here — RADIUS (radius.js's syncSubscriberCredentials), not the
 * router's own /ppp/secret, is what actually authenticates a subscriber once
 * billed from this platform, so the router's local secret being empty or
 * missing entirely is not a blocker once we know the account is live.
 *
 * Active hotspot sessions come from the same /ppp/active,/ip/hotspot/active
 * read (routeros.js's activeSessions) and are matched by MAC — a hotspot
 * login commonly has no stable username at all, but the device does.
 */
/**
 * The sorting logic behind import-secrets, pulled out on its own: pure data
 * in, categorized data out, no router or DB I/O — so it can be tested
 * directly against fixed router-shaped rows instead of only through a live
 * RouterOS socket, which is exactly the class of bug (an ordering/reference
 * mistake with no easy manual repro) this file has already shipped once.
 */
function categorizeImport(found, sessions, knownPppoe, knownMac) {
  const activeByUser = new Map(
    sessions.filter((s) => s.service === 'pppoe').map((s) => [s.username, s]));

  const importable = found.filter((f) => f.password && !knownPppoe.has(f.name));
  const already = found.filter((f) => knownPppoe.has(f.name)).map((f) => f.name);

  const noPasswordAll = found.filter((f) => !f.password && !knownPppoe.has(f.name));
  const noPasswordActive = noPasswordAll.filter((f) => activeByUser.has(f.name));
  const noPassword = noPasswordAll.filter((f) => !activeByUser.has(f.name)).map((f) => f.name);

  const secretNames = new Set(found.map((f) => f.name));
  const orphanActive = sessions.filter((s) =>
    s.service === 'pppoe' && !secretNames.has(s.username) && !knownPppoe.has(s.username));

  const seenMac = new Set();
  const hotspotImportable = sessions.filter((s) => {
    if (s.service !== 'hotspot' || !s.mac || knownMac.has(s.mac) || seenMac.has(s.mac)) return false;
    seenMac.add(s.mac);
    return true;
  });

  return { importable, already, noPassword, noPasswordActive, orphanActive, hotspotImportable, activeByUser };
}

/**
 * The active hotspot plan whose duration comes closest to covering
 * `remainingMinutes` without falling short of it — rounding up to the next
 * real plan rather than shortchanging a migrated guest a single minute of
 * time they already had. Falls back to the longest plan available when even
 * that isn't enough, and to null when there is no hotspot plan at all
 * (nothing sane to hand out) — the caller skips the voucher and imports the
 * guest with no time carried over rather than guessing.
 */
function closestHotspotPlan(plans, remainingMinutes) {
  const hotspot = plans.filter((p) => p.service === 'hotspot').sort((a, b) => a.duration_min - b.duration_min);
  if (!hotspot.length) return null;
  return hotspot.find((p) => p.duration_min >= remainingMinutes) ?? hotspot[hotspot.length - 1];
}

app.post('/api/routers/:id/import-secrets', wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const radius = await import('./radius.js');
  const apply = req.body?.apply === true;

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const host = String(r.host).split('/')[0];
  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({ error: 'Configure this router first.', needsAdmin: true });

  let conn;
  try {
    conn = await step('connect', () =>
      ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password }));
    const found = await step('read /ppp/secret', () => ros.pppSecrets(conn), 30000);
    const sessions = await step('read active sessions', () => ros.activeSessions(conn), 30000);
    // Best-effort and only ever consulted for hotspot guests — a router with
    // no hotspot server, or one whose profile has no session-timeout set at
    // all (untimed access), simply yields an empty map, and every hotspot
    // import below imports with no remaining time carried over rather than
    // failing the whole run over it.
    const remaining = await step('read hotspot session time', () => ros.hotspotSessionRemaining(conn), 15000);
    ros.close(conn);
    conn = null;

    const { rows: existingSubs } = await pool.query(
      'select pppoe_user, locked_mac from subscribers where tenant_id=$1', [req.tenant.id]);
    const knownPppoe = new Set(existingSubs.map((x) => x.pppoe_user).filter(Boolean));
    const knownMac = new Set(existingSubs.map((x) => x.locked_mac).filter(Boolean));

    const { importable, already, noPassword, noPasswordActive, orphanActive, hotspotImportable, activeByUser } =
      categorizeImport(found, sessions, knownPppoe, knownMac);

    const { rows: plans } = await pool.query(
      "select id, title, duration_min, service from plans where tenant_id=$1 and active", [req.tenant.id]);

    if (!apply) {
      return res.json({
        preview: true,
        total: found.length,
        importable: importable.map((f) => ({ name: f.name, remoteAddress: f.remoteAddress })),
        already,
        noPassword,
        importableActive: [
          ...noPasswordActive.map((f) => ({ name: f.name, address: activeByUser.get(f.name)?.address ?? null })),
          ...orphanActive.map((s) => ({ name: s.username, address: s.address })),
        ],
        // Each guest's own remaining time, plus which real plan they'd be
        // handed a voucher for on apply — shown up front so an operator sees
        // exactly what each import will grant before committing to it, not
        // just after.
        hotspotImportable: hotspotImportable.map((s) => {
          const remainingMinutes = remaining.get(s.mac) ?? null;
          const plan = remainingMinutes != null ? closestHotspotPlan(plans, remainingMinutes) : null;
          return {
            mac: s.mac, address: s.address, username: s.username,
            remainingMinutes,
            suggestedPlan: plan ? { id: plan.id, title: plan.title, durationMin: plan.duration_min } : null,
          };
        }),
      });
    }

    const genPass = () => String(Math.floor(1000000 + Math.random() * 9000000));
    const created = [];
    const hotspotCreated = [];
    const failed = [];

    // Real-password PPPoE secrets — the router's own password comes across as-is.
    for (const f of importable) {
      try {
        // Per row rather than one transaction: one malformed secret should not
        // undo an import of several hundred that worked.
        const { rows: [sub] } = await pool.query(
          `insert into subscribers (tenant_id, account_code, name, phone, service,
             pppoe_user, pppoe_pass, router_id, static_ip)
           values ($1,$2,$3,$4,'pppoe',$5,$6,$7,$8) returning id`,
          [req.tenant.id, f.name, f.comment?.trim() || f.name, '', f.name, f.password, r.id,
           f.remoteAddress || null]);
        await radius.syncSubscriberCredentials(pool, req.tenant.id, sub.id);
        created.push(f.name);
      } catch (e) {
        failed.push({ name: f.name, error: e.message });
      }
    }

    // Confirmed-live PPPoE accounts with no usable router-side password —
    // minted fresh, since RADIUS is what actually authenticates them from here.
    for (const f of [
      ...noPasswordActive.map((f) => ({ name: f.name, address: activeByUser.get(f.name)?.address ?? null })),
      ...orphanActive.map((s) => ({ name: s.username, address: s.address })),
    ]) {
      try {
        const password = genPass();
        const { rows: [sub] } = await pool.query(
          `insert into subscribers (tenant_id, account_code, name, phone, service,
             pppoe_user, pppoe_pass, router_id, static_ip)
           values ($1,$2,$3,$4,'pppoe',$5,$6,$7,$8) returning id`,
          [req.tenant.id, f.name, f.name, '', f.name, password, r.id, f.address || null]);
        await radius.syncSubscriberCredentials(pool, req.tenant.id, sub.id);
        created.push(f.name);
      } catch (e) {
        failed.push({ name: f.name, error: e.message });
      }
    }

    // Active hotspot sessions, matched by device MAC rather than a username
    // a hotspot login commonly does not have. These are pay-as-you-go
    // hotspot guests, not PPPoE lines — they belong on Hotspot → Vouchers,
    // not the Clients screen, so this issues each one a real voucher
    // (issueVoucherAccess, the same path a paid purchase goes through)
    // instead of a subscribers row Clients would never show and that would
    // have no plan, no expiry, and no way to actually authenticate again.
    //
    // The voucher's duration comes from closestHotspotPlan against however
    // much of their current session they had left — the point of reading
    // that at all — so migrating a router into billing does not reset a
    // guest who paid for (say) 20 more minutes back to zero. Best-effort
    // per guest: one row failing to bind on the router must not undo every
    // other guest imported in the same run.
    for (const s of hotspotImportable) {
      try {
        const remainingMinutes = remaining.get(s.mac) ?? null;
        const plan = remainingMinutes != null ? closestHotspotPlan(plans, remainingMinutes) : null;
        if (!plan) throw new Error('No active hotspot plan long enough to carry this guest\'s remaining time.');

        const v = await radius.issueVoucherAccess(pool, req.tenant.id, plan.id, null, s.mac);
        await pool.query('update vouchers set router_id=$2 where id=$1', [v.id, r.id]);
        const apply2 = await import('./payments/apply.js');
        await apply2.bindDeviceOnRouter(r.id, s.mac, plan.id, `${v.code} — migrated`);
        await pool.query(
          `insert into voucher_devices (voucher_id, mac, router_id, label) values ($1,$2,$3,$4)
           on conflict (voucher_id, mac) do nothing`,
          [v.id, s.mac, r.id, s.username || null]);
        hotspotCreated.push(s.mac);
      } catch (e) {
        failed.push({ name: s.mac, error: e.message });
      }
    }

    // Every imported PPPoE client has an empty phone — /ppp/secret holds
    // none. Said plainly, because payments are matched on the phone number
    // and an import that looks complete but silently breaks matching is
    // worse than one that admits what it left undone.
    res.json({
      imported: created.length + hotspotCreated.length,
      created, hotspotCreated, already, noPassword, failed,
      needPhone: created.length,
    });
  } catch (e) {
    res.status(502).json({
      error: atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728)),
    });
  } finally {
    if (conn) ros.close(conn);
  }
}));

/** The router's own ports, so the operator can pick which are LAN. */
app.post('/api/routers/:id/interfaces', wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const login = await routerLogin(r, req.body, secrets);
  if (!login) return res.status(428).json({ error: 'Router login needed first.', needsAdmin: true });

  const host = String(r.host).split('/')[0];
  let conn;
  try {
    conn = await ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password });
    const [lan, bridgeList, info] = await Promise.all([
      ros.lanCandidates(conn), ros.bridges(conn), ros.identify(conn),
    ]);
    res.json({ lan, bridges: bridgeList, ...info });
  } catch (e) {
    res.status(502).json({ error: describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728) });
  } finally {
    if (conn) ros.close(conn);
  }
}));

/**
 * Configure a MikroTik over its API: RADIUS, CoA, PPPoE and hotspot, in one go.
 *
 * First run needs the operator's own admin login, used once to create our
 * service account and then discarded. Every run after that uses that account,
 * so changing the admin password does not break anything.
 *
 * Reachable only because the API container shares the tunnel namespace — the
 * router's address here is its tunnel address, never a public one.
 */
app.post('/api/routers/:id/autoconfig', requirePermission('routers.configure'), wrap(async (req, res) => {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const { SERVER_IP } = await import('./tunnel.js');

  if (!secrets.configured())
    return res.status(400).json({
      error: 'APP_SECRET_KEY is not set on the server, so the router password cannot be stored safely. Generate one with: openssl rand -base64 32',
    });

  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const host = String(r.host).split('/')[0];
  let login = await routerLogin(r, req.body, secrets);
  if (!login)
    return res.status(428).json({
      error: 'Enter the router’s admin username and password once. A dedicated account is created from it and used for every push after that.',
      needsAdmin: true,
    });

  const done = [];
  let conn;
  try {
    // `login` is reassigned when the stored account turns out to be gone, so
    // the mint step below sees that we arrived on admin credentials.
    ({ conn, login } = await step('connect', () =>
      openRouter(ros, { host, port: r.api_port ?? 8728, login, body: req.body })));

    /**
     * Every step, with one reconnect if the tunnel drops under it.
     *
     * The OpenVPN log shows the router redialling every few minutes, and the
     * server drops the previous session when it does: "new connection by client
     * router-2-2 will cause previous active sessions to be dropped". Whatever
     * command was in flight at that moment gets no answer, so the push failed at
     * RADIUS one time, the bridge the next, the hotspot the time after —
     * wherever the reconnect happened to land. Nothing was wrong with the step
     * that got the blame.
     *
     * Reopening and running it again is safe because every step here is
     * idempotent by design; that property was built for the operator pressing
     * Send again and serves just as well here. One retry, not a loop — a router
     * that is genuinely gone should fail quickly and say so.
     *
     * The steps close over `conn`, so reassigning it is all the retry needs to
     * pick up the new socket.
     */
    const tryStep = async (label, fn, ms) => {
      try {
        return await step(label, fn, ms);
      } catch (e) {
        if (!lostConnection(e)) throw e;
        try { ros.close(conn); } catch { /* already gone */ }
        conn = await ros.connect({
          host, port: r.api_port ?? 8728, user: login.user, password: login.password,
        });
        done.push(`the tunnel dropped during ${label} — reconnected and carried on`);
        return await step(label, fn, ms);
      }
    };

    const info = await tryStep('identify', () => ros.identify(conn));

    // Mint our own account if we arrived on someone else's credentials.
    if (!login.stored) {
      const servicePassword = secrets.randomPassword();
      const { created } = await ros.ensureServiceUser(conn, { password: servicePassword });
      await pool.query(
        `update routers set service_user=$2, service_password_enc=$3, service_created_at=now()
          where id=$1`,
        [r.id, ros.SERVICE_USER, secrets.encrypt(servicePassword)]);
      done.push(created ? `created the ${ros.SERVICE_USER} account` : `took over the existing ${ros.SERVICE_USER} account`);
    }

    const radius = await tryStep('RADIUS', () => ros.applyRadius(conn, {
      serverIp: SERVER_IP,
      secret: r.secret,
      coaPort: Number(process.env.RADIUS_COA_PORT ?? 3799),
      services: r.role === 'both' ? 'ppp,hotspot' : r.role,
    }), 45000);
    done.push(`pointed RADIUS at ${SERVER_IP} and enabled CoA`);
    if (radius.replaced) done.push(`removed ${radius.replaced} stale RADIUS entr${radius.replaced === 1 ? 'y' : 'ies'}`);

    if (r.role === 'both' || r.role === 'pppoe') {
      await tryStep('PPP accounting', () => ros.applyPpp(conn));
      done.push('enabled PPPoE accounting with 5-minute interim updates');

      // Only when ports were chosen. Building a bridge unasked could swallow the
      // uplink and take the site off the internet.
      const lanPorts = Array.isArray(req.body?.lanPorts) ? req.body.lanPorts : null;
      if (lanPorts?.length) {
        const bridgeName = String(req.body?.bridge ?? 'bridge-lan').trim() || 'bridge-lan';
        // 40s: see the note on the same call in the hotspot push above. This is
        // the site that actually failed — RADIUS and PPP accounting both landed,
        // then "bridge: no reply after 20s" on a router that was fine, just slow
        // to answer the uplink-safety checks this step now makes.
        const bridge = await tryStep('bridge', () =>
          ros.ensureBridge(conn, { name: bridgeName, ports: lanPorts }), 40000);
        done.push(bridge.added.length
          ? `bridged ${bridge.added.join(', ')} into ${bridge.bridge}`
          : `${bridge.bridge} already had those ports`);
        if (bridge.skipped.length) done.push(`left alone: ${bridge.skipped.join(', ')}`);
        // A breather after bridge creation, which makes RouterOS recompute its
        // whole interface/STP state — firing the next heavy step immediately
        // after was part of what spiked CPU to 100% and dropped the tunnel
        // mid-push on weaker boards.
        await ros.sleep(500);

        /**
         * The pool the operator configured under Networks, not a built-in one.
         *
         * A tenant who defines 192.168.0.0/16 there and then finds their
         * subscribers on 10.100.x has been ignored — the page exists to decide
         * this and the push was not reading it. Prefer a pool tied to this
         * router, then any pool for the service, and fall back to the default
         * only when they have defined none.
         */
        const { rows: [confPool] } = await pool.query(
          `select cidr from ip_pools
            where tenant_id=$1 and service='pppoe'
              and (router_id = $2 or router_id is null)
            order by (router_id = $2) desc
            limit 1`, [req.tenant.id, r.id]);

        // A cidr has to become a usable range: .1 is the gateway, and the
        // broadcast address cannot be handed to a subscriber.
        const poolFromCidr = (cidr) => {
          if (!cidr) return null;
          const [base, bits] = String(cidr).split('/');
          const o = base.split('.').map(Number);
          const toInt = (a) => ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
          const toStr = (n) => [24, 16, 8, 0].map((sh) => (n >>> sh) & 255).join('.');
          const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
          const net = (toInt(o) & mask) >>> 0;
          const broadcast = (net | (~mask >>> 0)) >>> 0;
          if (broadcast - net < 3) return null;
          return { gateway: toStr(net + 1), range: `${toStr(net + 2)}-${toStr(broadcast - 1)}` };
        };
        // Checked here as well as when the pool is saved: pools created before
        // that check existed are still in the database, and this is the last
        // point at which the range can be stopped from reaching a router.
        const unsafe = tunnelConflict(confPool?.cidr, req.tenant.tunnel_subnet, SERVER_IP);
        if (unsafe) throw new Error(unsafe);

        const chosen = poolFromCidr(confPool?.cidr);
        if (chosen) done.push(`using the ${confPool.cidr} pool from Networks`);

        const pppoe = await tryStep('PPPoE server and profile', () =>
          ros.applyPppoeServer(conn, {
            bridge: bridge.bridge,
            gateway: req.body?.gateway ?? chosen?.gateway,
            // NAT covers the pool subscribers are given from here.
            natSubnet: confPool?.cidr ?? null,
          }), 40000);
        done.push(confPool
          ? `PPPoE server on ${pppoe.bridge}; addresses come from ${confPool.cidr} here, not from the router`
          : `PPPoE server on ${pppoe.bridge} — no PPPoE pool defined under Networks, so no gateway address `
            + 'or NAT was pushed to the router at all; add one under Networks and Configure again');
        await ros.sleep(500);

        // Recorded so RADIUS can refuse a static IP this router cannot serve.
        // Sending one outside the pool makes the router authenticate the
        // subscriber and then drop the session a second later.
        await pool.query('update routers set pppoe_pool=$2 where id=$1',
          [r.id, confPool?.cidr ?? null]);

        // The expired-customers range — auto-created for this router if it
        // does not already have one (ensureExpiredPool covers both a
        // brand-new router and one that predates auto-provisioning).
        // System-managed: never offered under Networks.
        const expiredPool = await ensureExpiredPool(req.tenant.id, r.id, r.name);
        if (expiredPool) {
          const blocked = await tryStep('expired-customers firewall block', () =>
            ros.applyExpiredPool(conn, { cidr: expiredPool.cidr }), 20000);
          done.push(blocked.done?.length
            ? `expired customers (${expiredPool.cidr}) blocked at the firewall: ${blocked.done.join('; ')}`
            : `expired customers (${expiredPool.cidr}) already blocked at the firewall`);
        } else {
          done.push('could not auto-create an expired-customers pool — every candidate range is taken; '
            + 'suspended/expired accounts fall back to a near-zero speed limit instead of a firewall block');
        }
      }
    }
    /**
     * Hotspot settings — DHCP, the hotspot server itself, its user profile,
     * the DNS proxy, the walled garden, the login page — used to be pushed
     * from here too, on every Configure/Refresh, for any router with role
     * hotspot or both, duplicating the dedicated Hotspot button
     * (/api/routers/:id/hotspot above) with its own separate copy of the
     * same steps. The two could drift, and a plain Configure silently
     * rewrote a guest-facing setup the operator only meant to touch through
     * the Hotspot action. Hotspot config is pushed from exactly one place
     * now — the Hotspot button — never as a side effect of Configure.
     */

    await pool.query(
      `update routers set autoconfig_last_at=now(), autoconfig_last_ok=true, autoconfig_last_error=null,
              ros_version=$2, ros_identity=$3, status='up', last_seen=now()
        where id=$1`,
      [r.id, info.version, info.identity]);

    console.log('configure push', r.name, host, '→ ok:', done.join('; '));
    res.json({ ok: true, applied: done, ...info });
  } catch (e) {
    // 428 means "I need something from you", and the screen answers it by
    // asking for the admin password. Reporting it as a 502 would show the same
    // dead end this exists to remove.
    if (e.needsAdmin) return res.status(428).json({ error: e.message, needsAdmin: true, applied: done });

    let message = atStep(e, describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728));
    if (!conn) {
      const why = await explainUnreachable(req.tenant.id, host);
      // Replace the guess rather than append to it. The stock text asks whether
      // the tunnel is up and whether the address is the right one; when both can
      // be answered, asking as well only buries the answer.
      if (why) message = `${atStep(e, `Could not reach ${host}:${r.api_port ?? 8728}.`)}${why}`;
    }
    await pool.query(
      'update routers set autoconfig_last_at=now(), autoconfig_last_ok=false, autoconfig_last_error=$2 where id=$1',
      [r.id, message.slice(0, 300)]);
    console.error('configure push', r.name, host, '→', message,
      done.length ? `(after: ${done.join('; ')})` : '(nothing applied)');
    res.status(502).json({ error: message, applied: done });
  } finally {
    if (conn) ros.close(conn);
  }
}));

/**
 * Turn a node-routeros failure into something worth reading.
 *
 * RosException carries the cause in `errno`, not in `message`: for a socket-level
 * failure that is a raw libuv number with no matching entry in the library's
 * message table, so `message` comes back as an empty string and the operator is
 * shown a blank error. The number is also platform-specific — ECONNREFUSED is
 * -4078 on Windows and -111 on Linux — so translate it rather than matching it.
 */
/**
 * Turn a connection failure into the answer, not a question.
 *
 * describeRouterError asks whether the tunnel is up and whether the address is
 * the tunnel one. Both are knowable: OpenVPN's status file says exactly which
 * routers are connected and on what address. Asking the operator to go and check
 * has cost several rounds of this already.
 */
async function explainUnreachable(tenantId, host) {
  try {
    const { liveTunnels } = await import('./tunnel.js');
    const { rows: [t] } = await pool.query(
      'select tunnel_subnet from tenants where id=$1', [tenantId]);
    const prefix = t?.tunnel_subnet
      ? String(t.tunnel_subnet).split('/')[0].split('.').slice(0, 3).join('.')
      : null;

    const all = await liveTunnels();
    const mine = prefix ? all.filter((x) => x.address.startsWith(`${prefix}.`)) : all;

    if (mine.some((x) => x.address === host)) {
      return ` The tunnel to ${host} is up, so the router is reachable but its API did not answer —`
        + ' check /ip service that "api" is enabled and not restricted by address.';
    }
    if (!mine.length) {
      return ' No router is connected to the tunnel at all right now, so this address cannot answer.';
    }
    return ` Nothing is connected on ${host}. Connected right now: `
      + `${mine.map((x) => x.address).join(', ')}. Use the banner on this page to adopt the right one.`;
  } catch {
    // Diagnostics must never replace the real error with one of their own.
    return '';
  }
}

function describeRouterError(e, host, port) {
  let code = e?.code ?? e?.errno;
  if (typeof code === 'number') {
    try { code = util.getSystemErrorName(code); } catch { code = String(code); }
  }
  code = String(code ?? '');

  if (code === 'CANTLOGIN')
    return 'The router rejected those credentials. Check the username and password, and that the account has full rights.';
  if (code === 'ECONNREFUSED')
    return `Nothing is listening on ${host}:${port}. Enable the API service on the router: /ip service enable api`;
  if (code === 'SOCKTMOUT' || code === 'ETIMEDOUT')
    return `No response from ${host}:${port}. Is the tunnel up, and is the NAS address the router's tunnel address rather than its LAN one?`;
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH')
    return `No route to ${host}. The tunnel is probably down.`;
  if (code === 'ECONNRESET')
    return `${host} closed the connection. On RouterOS 7 check that the plain API service is enabled, not only api-ssl.`;

  // Never return an empty string: a blank error is worse than a clumsy one.
  return e?.message?.trim() || (code ? `${code} talking to ${host}:${port}` : `Could not configure ${host}:${port}`);
}

/** Rename a router, correct its NAS address, secret, API port or role. */
app.put('/api/routers/:id', requirePermission('routers.edit'), wrap(async (req, res) => {
  const { name, host, secret, apiPort, role, nasIdentifier } = req.body ?? {};
  const { rows: [r] } = await pool.query(
    `update routers set
       name           = coalesce(nullif($3,''), name),
       host           = coalesce(nullif($4,'')::inet, host),
       secret         = coalesce(nullif($5,''), secret),
       api_port       = coalesce($6, api_port),
       role           = coalesce(nullif($7,''), role),
       nas_identifier = coalesce(nullif($8,''), nas_identifier)
     where id=$1 and tenant_id=$2
     returning *`,
    [req.params.id, req.tenant.id, name ?? '', host ?? '', secret ?? '',
     apiPort ? Number(apiPort) : null, role ?? '', nasIdentifier ?? '']);
  if (!r) return res.status(404).json({ error: 'No such router' });
  res.json(r);
}));

/**
 * Remove a router.
 *
 * Refuses while subscribers still point at it: subscribers.router_id is what
 * activateSubscriber() follows to find the NAS to send CoA to, and orphaning it
 * would silently stop enforcement for those customers rather than fail loudly.
 * Their tunnel credentials go too, so a deleted router cannot dial back in.
 */
app.delete('/api/routers/:id', requirePermission('routers.delete'), wrap(async (req, res) => {
  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const { rows: [{ count }] } = await pool.query(
    'select count(*)::int from subscribers where router_id=$1', [r.id]);

  /*
   * The guard is a default, not a rule.
   *
   * Refusing outright was wrong: duplicate rows for one physical router could not
   * be cleared without first moving customers off rows that should never have
   * existed. force=1 deletes anyway and detaches the customers instead of
   * deleting them.
   *
   * What that costs is worth being precise about. Their radcheck and radreply
   * entries are keyed by username, so authentication and their speed keep
   * working. What breaks is CoA: activateSubscriber follows router_id to find the
   * NAS, so with none, a mid-session change waits for the subscriber to
   * reconnect. Give them a router again and it resumes.
   */
  const force = req.query.force === '1' || req.body?.force === true;
  if (count > 0 && !force)
    return res.status(409).json({
      error: count === 1
        ? '1 subscriber still uses this router. Move them to another one, or delete anyway.'
        : `${count} subscribers still use this router. Move them to another one, or delete anyway.`,
      subscribers: count,
      canForce: true,
    });

  if (count > 0) {
    await pool.query('update subscribers set router_id=null where router_id=$1', [r.id]);
  }

  /**
   * Take the tunnel credential with the router, including a stale one.
   *
   * Deleting matched the router's current NAS address only, so a credential
   * minted for it earlier — after an address change, or a re-onboard that moved
   * it from .2 to .3 — was left behind holding an address and appearing in the
   * list under a router that no longer exists. That is how the screen came to
   * show router-2-3 as issued with no routers at all.
   *
   * A credential carrying a live tunnel is never touched, whatever the router
   * rows say. Revoking one disconnects a router that cannot then be reached to
   * put it right, and a delete in the UI should not be able to cause a site
   * visit. Those are reported instead.
   */
  const { rows: mine } = await pool.query(
    `select id, username, host(assigned_ip) ip from ovpn_clients
      where tenant_id=$1 and (assigned_ip = $2 or username = $3)`,
    [req.tenant.id, r.host, ovpnUsernameFor(r.host)]);

  let connected = new Set();
  try {
    const { liveTunnels } = await import('./tunnel.js');
    connected = new Set((await liveTunnels()).map((t) => t.address));
  } catch { /* no status file — treat nothing as live rather than guessing */ }

  const revoked = [];
  const kept = [];
  for (const c of mine) {
    if (connected.has(c.ip)) { kept.push(c.username); continue; }
    await pool.query('delete from ovpn_clients where id=$1 and tenant_id=$2', [c.id, req.tenant.id]);
    revoked.push(c.username);
  }

  await pool.query('delete from wg_peers where tenant_id=$1 and router_id=$2', [req.tenant.id, r.id]);
  // The auto-created expired-customers pool is this router's alone — never
  // offered under Networks, so detaching it would leave a locked, invisible
  // row nobody could ever see or remove again, permanently eating one of
  // the sixteen candidate ranges autoExpiredCidr can hand out. Drop it
  // outright rather than orphaning it.
  await pool.query("delete from ip_pools where tenant_id=$1 and router_id=$2 and purpose='expired'",
    [req.tenant.id, r.id]);
  // ip_pools.router_id has no ON DELETE, so a pool assigned to this router blocked
  // the delete outright with a raw foreign-key error. Detach rather than drop: the
  // address range is still the operator's to reassign.
  await pool.query('update ip_pools set router_id=null where tenant_id=$1 and router_id=$2',
    [req.tenant.id, r.id]);
  await pool.query('delete from routers where id=$1 and tenant_id=$2', [r.id, req.tenant.id]);
  res.json({ ok: true, freed: r.host, detached: count, revoked, kept });
}));

/**
 * One row per meaningful move a gadget makes — issued to a tech, returned,
 * installed, sent for repair, adjusted, or just edited. Best-effort: a
 * failure here should never take down the actual inventory change it's
 * describing.
 */
async function logInventoryMovement(tenantId, itemId, action, extra = {}) {
  try {
    await pool.query(
      `insert into inventory_movements (tenant_id, item_id, action, from_location, to_location, staff_id, subscriber_id, quantity, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, itemId, action, extra.fromLocation ?? null, extra.toLocation ?? null,
       extra.staffId ?? null, extra.subscriberId ?? null, extra.quantity ?? 1, extra.note ?? null]);
  } catch (e) { console.error('logInventoryMovement', e.message); }
}

// ── inventory: physical gadgets, whether ours or a client's own ──
app.get('/api/inventory', requirePermission('inventory.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select i.*, s.name as subscriber_name, s.account_code as subscriber_account_code,
            r.name as router_name, st.name as assigned_staff_name
       from inventory_items i
       left join subscribers s on s.id = i.subscriber_id
       left join routers r on r.id = i.router_id
       left join staff st on st.id = i.assigned_staff_id
      where i.tenant_id=$1
      order by i.created_at desc`,
    [req.tenant.id]);
  res.json(rows);
}));

app.get('/api/inventory/:id/movements', requirePermission('inventory.view'), wrap(async (req, res) => {
  const { rows: [item] } = await pool.query(
    'select 1 from inventory_items where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!item) return res.status(404).json({ error: 'not found' });
  const { rows } = await pool.query(
    `select m.*, st.name as staff_name, s.name as subscriber_name
       from inventory_movements m
       left join staff st on st.id = m.staff_id
       left join subscribers s on s.id = m.subscriber_id
      where m.item_id=$1 order by m.created_at desc limit 50`,
    [req.params.id]);
  res.json(rows);
}));

// The only categories with no individual identity worth tracking — a length
// of cable or a bag of connectors is a count, not a set of accountable
// units. Everything else must carry a MAC or a serial, which in practice
// means it can only ever be added one at a time (quantity 1): a single row
// can hold one identifier, never one per unit in a batch.
const UNSERIALIZED_CATEGORIES = new Set(['Cable', 'Connector']);

/**
 * Adding stock never decides ownership or where it ends up — a gadget just
 * received is in the warehouse and unowned by anyone in particular yet;
 * "has the client paid for it" and "installed where" are both Issue-time
 * questions (POST /api/inventory/:id/issue), not add-time ones. Every
 * created row defaults to the company's own, in the warehouse.
 *
 * Quantity decides the shape, same as before, but a multi-unit batch of an
 * individually-identified category (anything but Cable/Connector) no
 * longer gets rejected outright — it creates one row per unit instead of
 * one row with a count, since "10 routers" is 10 accountable gadgets, each
 * needing its own MAC or serial, not an anonymous quantity of 10. They
 * share a name for display grouping; each is its own record from here on,
 * addressable and issuable individually by its own MAC.
 */
app.post('/api/inventory', requirePermission('inventory.create'), wrap(async (req, res) => {
  const { name, category, macAddress, serialNumber, units, status, notes, quantity, unit } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

  const qty = Math.max(1, Math.trunc(Number(quantity)) || 1);
  const isBulk = qty > 1;
  const exempt = UNSERIALIZED_CATEGORIES.has(category);

  // A true bulk consumable — one row, a count, no per-unit identity.
  if (isBulk && exempt) {
    const { rows: [item] } = await pool.query(
      `insert into inventory_items (tenant_id, name, category, owned_by_tenant, status, notes, tracking, quantity, unit, location)
       values ($1,$2,$3,true,$4,$5,'bulk',$6,$7,'warehouse') returning id`,
      [req.tenant.id, name.trim(), category || null, status || 'in_stock', notes || null, qty, unit?.trim() || null]);
    await logInventoryMovement(req.tenant.id, item.id, 'created', { toLocation: 'warehouse', quantity: qty });
    return res.json({ id: item.id, ok: true });
  }

  // Several identical, individually accountable units added in one go.
  if (isBulk && !exempt) {
    const list = Array.isArray(units) ? units : [];
    if (list.length !== qty) return res.status(400).json({ error: `Provide a MAC or serial for each of the ${qty} units.` });
    for (const u of list) {
      if (!u?.macAddress?.trim() && !u?.serialNumber?.trim())
        return res.status(400).json({ error: 'Every unit needs a MAC address or serial number.' });
    }
    const c = await pool.connect();
    const createdIds = [];
    try {
      await c.query('begin');
      for (const u of list) {
        const { rows: [item] } = await c.query(
          `insert into inventory_items (tenant_id, name, category, mac_address, serial_number,
             owned_by_tenant, status, notes, tracking, quantity, location)
           values ($1,$2,$3,$4,$5,true,$6,$7,'serialized',1,'warehouse') returning id`,
          [req.tenant.id, name.trim(), category || null, u.macAddress?.trim().toUpperCase() || null,
           u.serialNumber?.trim() || null, status || 'in_stock', notes || null]);
        createdIds.push(item.id);
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      if (e.code === '23505') return res.status(409).json({ error: 'One of those MAC addresses is already in inventory.' });
      throw e;
    } finally {
      c.release();
    }
    for (const id of createdIds) await logInventoryMovement(req.tenant.id, id, 'created', { toLocation: 'warehouse', quantity: 1 });
    return res.json({ ids: createdIds, ok: true });
  }

  // A single, individually identified gadget — the original case.
  if (!exempt && !macAddress?.trim() && !serialNumber?.trim()) {
    return res.status(400).json({ error: 'Record a MAC address or serial number for this gadget.' });
  }
  try {
    const { rows: [item] } = await pool.query(
      `insert into inventory_items (tenant_id, name, category, mac_address, serial_number,
         owned_by_tenant, status, notes, tracking, quantity, location)
       values ($1,$2,$3,$4,$5,true,$6,$7,'serialized',1,'warehouse') returning id`,
      [req.tenant.id, name.trim(), category || null, macAddress?.trim().toUpperCase() || null,
       serialNumber?.trim() || null, status || 'in_stock', notes || null]);
    await logInventoryMovement(req.tenant.id, item.id, 'created', { toLocation: 'warehouse', quantity: 1 });
    res.json({ id: item.id, ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That MAC address is already in inventory.' });
    throw e;
  }
}));

app.put('/api/inventory/:id', requirePermission('inventory.edit'), wrap(async (req, res) => {
  const { name, category, macAddress, serialNumber, ownedByTenant, subscriberId, routerId,
          status, notes, quantity, unit } = req.body;

  const { rows: [before] } = await pool.query(
    'select * from inventory_items where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!before) return res.status(404).json({ error: 'not found' });

  const qty = quantity !== undefined ? Math.max(1, Math.trunc(Number(quantity)) || 1) : before.quantity;
  const isBulk = qty > 1;
  const effectiveCategory = category !== undefined ? category : before.category;
  const exempt = UNSERIALIZED_CATEGORIES.has(effectiveCategory);
  const effectiveMac = macAddress !== undefined ? macAddress : before.mac_address;
  const effectiveSerial = serialNumber !== undefined ? serialNumber : before.serial_number;

  if (isBulk && !exempt) {
    return res.status(400).json({
      error: `Only ${[...UNSERIALIZED_CATEGORIES].join('/')} can be a quantity line — add ${effectiveCategory || 'this'} one at a time with its own MAC or serial.`,
    });
  }
  if (!isBulk && !exempt && !effectiveMac?.trim() && !effectiveSerial?.trim()) {
    return res.status(400).json({ error: 'Record a MAC address or serial number for this gadget.' });
  }

  if (!isBulk && subscriberId) {
    const { rowCount } = await pool.query(
      'select 1 from subscribers where id=$1 and tenant_id=$2', [subscriberId, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such client' });
  }
  if (!isBulk && routerId) {
    const { rowCount } = await pool.query(
      'select 1 from routers where id=$1 and tenant_id=$2', [routerId, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such router' });
  }

  // The edit form no longer carries a client/site link at all — that's set
  // by the dedicated Issue action now, not by editing a stock line — so an
  // absent key here means "leave it alone," not "clear it." Only an
  // explicitly-sent value (including an explicit empty string, to
  // unassign) actually changes it.
  const newSubscriberId = isBulk ? null : (subscriberId !== undefined ? (subscriberId || null) : before.subscriber_id);
  const newRouterId = isBulk ? null : (routerId !== undefined ? (routerId || null) : before.router_id);
  const newLocation = newSubscriberId
    ? 'premises'
    : (newSubscriberId !== (before.subscriber_id ?? null) ? 'warehouse' : before.location);

  try {
    const { rows: [item] } = await pool.query(
      `update inventory_items set
         name = coalesce($3, name),
         category = $4,
         mac_address = $5,
         serial_number = $6,
         owned_by_tenant = coalesce($7, owned_by_tenant),
         subscriber_id = $8,
         router_id = $9,
         status = coalesce($10, status),
         notes = $11,
         tracking = $12,
         quantity = $13,
         unit = $14,
         location = $15,
         updated_at = now()
       where id=$1 and tenant_id=$2 returning id`,
      [req.params.id, req.tenant.id, name?.trim() || null, category || null,
       isBulk ? null : macAddress?.trim().toUpperCase() || null,
       isBulk ? null : serialNumber?.trim() || null,
       typeof ownedByTenant === 'boolean' ? ownedByTenant : null,
       newSubscriberId,
       newRouterId,
       status || null, notes || null, isBulk ? 'bulk' : 'serialized',
       qty,
       isBulk ? unit?.trim() || null : null,
       newLocation]);
    if (!item) return res.status(404).json({ error: 'not found' });
    if (newSubscriberId && newSubscriberId !== (before.subscriber_id ?? null)) {
      await logInventoryMovement(req.tenant.id, item.id, 'installed', {
        fromLocation: before.location, toLocation: 'premises', subscriberId: newSubscriberId,
      });
    } else if (newLocation !== before.location) {
      await logInventoryMovement(req.tenant.id, item.id, 'updated', { fromLocation: before.location, toLocation: newLocation });
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That MAC address is already in inventory.' });
    throw e;
  }
}));

/**
 * Received more, or used some, without opening the full edit form — the
 * common case for a consumable/spare that gets touched every few days.
 * Clamped at zero rather than allowed negative: stock leaving faster than
 * it was ever recorded coming in is a data-entry mistake worth surfacing,
 * not a number worth storing.
 */
app.post('/api/inventory/:id/adjust-quantity', requirePermission('inventory.edit'), wrap(async (req, res) => {
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'Provide a non-zero delta' });
  const { rows: [item] } = await pool.query(
    `update inventory_items set quantity = greatest(0, quantity + $3), updated_at = now()
     where id=$1 and tenant_id=$2 returning quantity`,
    [req.params.id, req.tenant.id, Math.trunc(delta)]);
  if (!item) return res.status(404).json({ error: 'not found' });
  await logInventoryMovement(req.tenant.id, req.params.id, 'adjusted', { quantity: Math.abs(Math.trunc(delta)), note: delta > 0 ? 'received' : 'used' });
  res.json({ ok: true, quantity: item.quantity });
}));

/**
 * Hand a gadget (or some units of a bulk stock line) to a technician's van.
 *
 * A bulk line is the interesting case: the units sitting in the warehouse
 * are interchangeable until the moment one actually leaves, which is
 * exactly when its real MAC/serial becomes worth recording — ISPBox's own
 * model for this ("assign a serial to a service on install; it stays on
 * the client's record for its whole life") is the same idea one step
 * earlier, at issue rather than install. Only meaningful for a single unit:
 * a MAC/serial issuing five identical cable drums makes no sense, so it's
 * only accepted when quantity is exactly 1.
 */
app.post('/api/inventory/:id/issue', requirePermission('inventory.edit'), wrap(async (req, res) => {
  const { staffId, quantity, macAddress, serialNumber, note, subscriberId, routerId, ownedByTenant } = req.body;
  if (!staffId) return res.status(400).json({ error: 'Pick a technician' });
  // "Has the client paid for it, or does it remain ours?" only actually
  // means anything once it's going to a specific client — issuing to a
  // van, with no client picked yet, leaves ownership exactly as it always
  // defaults: the company's.
  const clientOwns = subscriberId ? ownedByTenant === false : false;
  const { rowCount: staffOk } = await pool.query(
    'select 1 from staff where id=$1 and tenant_id=$2', [staffId, req.tenant.id]);
  if (!staffOk) return res.status(404).json({ error: 'No such staff member' });

  // Where it's going, decided at issue time rather than when it was first
  // added as stock — a freshly received gadget has nowhere installed yet;
  // that only becomes known once a technician actually takes it out.
  if (subscriberId) {
    const { rowCount } = await pool.query(
      'select 1 from subscribers where id=$1 and tenant_id=$2', [subscriberId, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such client' });
  }
  if (routerId) {
    const { rowCount } = await pool.query(
      'select 1 from routers where id=$1 and tenant_id=$2', [routerId, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such router' });
  }
  const destination = subscriberId ? 'premises' : 'van';

  const { rows: [item] } = await pool.query(
    'select * from inventory_items where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!item) return res.status(404).json({ error: 'not found' });

  if (item.tracking === 'bulk') {
    const qty = Math.trunc(Number(quantity)) || 1;
    if (qty < 1) return res.status(400).json({ error: 'Issue at least 1' });
    if (qty > item.quantity) return res.status(409).json({ error: `Only ${item.quantity} in stock.` });
    if (qty > 1 && (macAddress || serialNumber)) {
      return res.status(400).json({ error: 'A MAC or serial can only be recorded when issuing exactly 1 unit.' });
    }
    // Issuing exactly one unit is the moment it stops being an anonymous
    // count and becomes a specific, accountable gadget — both identifiers
    // are required here, not optional, so a unit can never leave the shelf
    // without something to hold whoever's carrying it accountable for it.
    if (qty === 1 && (!macAddress?.trim() || !serialNumber?.trim())) {
      return res.status(400).json({ error: 'Record both the MAC address and serial number of the unit being issued.' });
    }

    await pool.query('update inventory_items set quantity = quantity - $2, updated_at = now() where id=$1', [item.id, qty]);
    await logInventoryMovement(req.tenant.id, item.id, destination === 'premises' ? 'installed' : 'issued', {
      toLocation: destination, staffId, subscriberId: subscriberId || null, quantity: qty, note,
    });

    let createdId = null;
    if (qty === 1) {
      try {
        const { rows: [child] } = await pool.query(
          `insert into inventory_items (tenant_id, name, category, mac_address, serial_number,
             owned_by_tenant, status, tracking, quantity, location, assigned_staff_id, subscriber_id, router_id)
           values ($1,$2,$3,$4,$5,$6,'in_stock','serialized',1,$7,$8,$9,$10) returning id`,
          [req.tenant.id, item.name, item.category, macAddress?.trim().toUpperCase() || null,
           serialNumber?.trim() || null, destination === 'premises' ? !clientOwns : item.owned_by_tenant,
           destination, staffId, subscriberId || null, routerId || null]);
        createdId = child.id;
        await logInventoryMovement(req.tenant.id, child.id, 'created', { toLocation: destination, staffId, subscriberId: subscriberId || null, note: `Issued from "${item.name}" stock` });
      } catch (e) {
        if (e.code !== '23505') throw e;
        // MAC collision on the child row: the bulk deduction and movement
        // log already succeeded and are correct regardless, so this is
        // reported rather than rolled back — the unit did leave the shelf.
        return res.json({ ok: true, quantity: item.quantity - qty, warning: 'Issued, but that MAC is already in inventory — the unit was not given its own record.' });
      }
    }
    return res.json({ ok: true, quantity: item.quantity - qty, createdId });
  }

  // A gadget that was never given both identifiers at creation has nothing
  // to hold whoever's carrying it accountable for it — same rule as issuing
  // a single unit out of bulk stock, just checked against what's already on
  // the record instead of what's typed in now.
  if (!item.mac_address || !item.serial_number) {
    return res.status(400).json({ error: 'This gadget is missing a MAC address or serial number — add both (Edit) before issuing it.' });
  }

  await pool.query(
    `update inventory_items set location=$2, assigned_staff_id=$3, subscriber_id=$4, router_id=coalesce($5, router_id),
       owned_by_tenant = case when $2='premises' then $6 else owned_by_tenant end, updated_at=now() where id=$1`,
    [item.id, destination, staffId, subscriberId || null, routerId || null, !clientOwns]);
  await logInventoryMovement(req.tenant.id, item.id, destination === 'premises' ? 'installed' : 'issued', {
    fromLocation: item.location, toLocation: destination, staffId, subscriberId: subscriberId || null, note,
  });
  res.json({ ok: true });
}));

/** Back from a technician's van (or the repair bench) to the warehouse shelf. */
app.post('/api/inventory/:id/return', requirePermission('inventory.edit'), wrap(async (req, res) => {
  const { rows: [item] } = await pool.query(
    'select * from inventory_items where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!item) return res.status(404).json({ error: 'not found' });
  await pool.query(
    `update inventory_items set location='warehouse', assigned_staff_id=null, subscriber_id=null, updated_at=now() where id=$1`,
    [item.id]);
  await logInventoryMovement(req.tenant.id, item.id, 'returned', { fromLocation: item.location, toLocation: 'warehouse', note: req.body?.note || null });
  res.json({ ok: true });
}));

/**
 * Swap a faulty gadget out for a working one from the warehouse, in one
 * step — the replacement inherits exactly where the faulty one was (the
 * same client's premises, or the same technician's van) and who it belongs
 * to, while the faulty one moves to the repair bench rather than
 * disappearing from the record. Two separate calls (Return the faulty one,
 * then Issue a replacement) would work too, but would leave the client
 * connectionless in between and lose the "this one replaced that one"
 * link this keeps in the movement history of both.
 */
app.post('/api/inventory/:id/replace', requirePermission('inventory.edit'), wrap(async (req, res) => {
  const { replacementId, note } = req.body;
  if (!replacementId) return res.status(400).json({ error: 'Pick a replacement unit' });

  const { rows: [faulty] } = await pool.query(
    'select * from inventory_items where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!faulty) return res.status(404).json({ error: 'not found' });
  if (faulty.status !== 'faulty') return res.status(400).json({ error: 'Only a gadget marked faulty can be replaced this way.' });
  if (!['premises', 'van'].includes(faulty.location)) {
    return res.status(400).json({ error: "This gadget isn't currently deployed anywhere — use Issue instead of Replace." });
  }

  const { rows: [replacement] } = await pool.query(
    'select * from inventory_items where id=$1 and tenant_id=$2', [replacementId, req.tenant.id]);
  if (!replacement) return res.status(404).json({ error: 'No such replacement unit' });
  if (replacement.tracking !== 'serialized') return res.status(400).json({ error: 'The replacement must be an individually tracked gadget, not a bulk stock line.' });
  if (replacement.location !== 'warehouse') return res.status(409).json({ error: 'The replacement must currently be sitting in the warehouse.' });
  if (replacement.status === 'faulty') return res.status(400).json({ error: 'The replacement is itself marked faulty.' });

  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `update inventory_items set location=$2, subscriber_id=$3, router_id=$4, assigned_staff_id=$5,
         owned_by_tenant=$6, status='in_stock', updated_at=now() where id=$1`,
      [replacement.id, faulty.location, faulty.subscriber_id, faulty.router_id, faulty.assigned_staff_id, faulty.owned_by_tenant]);
    await c.query(
      `update inventory_items set location='repair_bench', subscriber_id=null, router_id=null, assigned_staff_id=null, updated_at=now() where id=$1`,
      [faulty.id]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }

  const swapNote = note?.trim() || null;
  await logInventoryMovement(req.tenant.id, replacement.id, 'replaced', {
    fromLocation: 'warehouse', toLocation: faulty.location, subscriberId: faulty.subscriber_id, staffId: faulty.assigned_staff_id,
    note: swapNote || `Replacing faulty ${faulty.name} (${faulty.mac_address || faulty.serial_number || faulty.id})`,
  });
  await logInventoryMovement(req.tenant.id, faulty.id, 'replaced', {
    fromLocation: faulty.location, toLocation: 'repair_bench',
    note: swapNote || `Replaced by ${replacement.name} (${replacement.mac_address || replacement.serial_number || replacement.id})`,
  });

  res.json({ ok: true, replacementId: replacement.id, faultyId: faulty.id });
}));

app.delete('/api/inventory/:id', requirePermission('inventory.delete'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    'delete from inventory_items where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

// ── router onboarding via WireGuard ───────────────
// Preferred over OVPN on RouterOS 7: in-kernel, and far faster than RouterOS's
// single-threaded OpenVPN. RouterOS 6 has no WireGuard — use the OVPN route there.
app.post('/api/routers/wg-peer', requireRole('owner'), wrap(async (req, res) => {
  const wg = await import('./wireguard.js');
  const { name, routerId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name the router' });

  const endpoint = process.env.WG_ENDPOINT;
  const serverPublicKey = process.env.WG_SERVER_PUBLIC_KEY;
  if (!endpoint || !serverPublicKey)
    return res.status(400).json({
      error: 'WG_ENDPOINT and WG_SERVER_PUBLIC_KEY are not set. See docs/NETWORK-SETUP.md.',
    });

  /**
   * Refused up front for a router already known to be on RouterOS 6.
   *
   * WireGuard genuinely does not exist on RouterOS 6 — there is no version of
   * the script that would work there, unlike the other RouterOS-6-shaped
   * failures in this file, which are a missing property to work around rather
   * than a missing feature. Minting a peer and a script the router cannot use
   * costs a wasted key and a confusing failure on the router end for nothing
   * this side could not have known in advance, for any router whose version we
   * have already recorded from a previous Configure push.
   *
   * A router being onboarded for the first time has no recorded version yet —
   * there is nothing to check, so nothing is refused, and the script's own
   * "RouterOS 7 only — check with /system resource print" comment is what
   * carries the warning until the router has actually identified itself.
   */
  if (routerId) {
    const { rows: [existing] } = await pool.query(
      'select ros_version from routers where id=$1 and tenant_id=$2', [routerId, req.tenant.id]);
    if (existing?.ros_version && /^6\b/.test(existing.ros_version)) {
      return res.status(409).json({
        error: `This router last identified itself as RouterOS ${existing.ros_version}, which has `
          + 'no WireGuard. Use "+ Onboard via OVPN" for it instead.',
      });
    }
  }

  const { peer, privateKey, presharedKey, assignedIp } =
    await wg.createPeer(req.tenant.id, { name, routerId: routerId ?? null });

  // The router is about to be handed a script that dials this peer — the
  // server's own wg0 has to already know about it, or the handshake just
  // never completes with nothing anywhere to point at. See syncServer()'s
  // own comment for why the reload half can still come back false.
  const sync = await wg.syncServer().catch((e) => ({ written: false, reloaded: false, reason: e.message }));

  res.json({
    peerId: peer.id,
    assignedIp,
    publicKey: peer.public_key,
    // Shown once. The server keeps only the public key; if this is lost the peer
    // must be recreated rather than recovered.
    script: wg.mikrotikScript({ privateKey, presharedKey, assignedIp, endpoint, serverPublicKey }),
    note: 'The private key is shown once and is not stored. Apply it before closing this.',
    sync,
  });
}));

/**
 * Onboard with failover: WireGuard as the preferred transport, OVPN as a
 * standby the router itself switches to if WireGuard's handshake ever goes
 * stale (see wireguard.js's failoverScript) — for a site whose WAN blocks or
 * mangles WireGuard's UDP port, which happens on some carrier/CGNAT links,
 * without leaving that router permanently on the slower, single-threaded
 * OVPN path once WireGuard is reachable again.
 *
 * Both transports are minted for the *same* tunnel address — RADIUS CoA and
 * the watchdog only ever know a router by that one address, so which
 * interface is actually carrying it at a given moment has to stay invisible
 * to everything on this side.
 */
app.post('/api/routers/failover-script', requireRole('owner'), wrap(async (req, res) => {
  const wg = await import('./wireguard.js');
  const { ensureSubnet, nextHostIp, SERVER_IP } = await import('./tunnel.js');
  const { name, routerId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name the router' });

  const endpoint = process.env.WG_ENDPOINT;
  const serverPublicKey = process.env.WG_SERVER_PUBLIC_KEY;
  if (!endpoint || !serverPublicKey) {
    return res.status(400).json({
      error: 'WG_ENDPOINT and WG_SERVER_PUBLIC_KEY are not set. See docs/NETWORK-SETUP.md.',
    });
  }
  if (routerId) {
    const { rows: [existing] } = await pool.query(
      'select ros_version from routers where id=$1 and tenant_id=$2', [routerId, req.tenant.id]);
    if (existing?.ros_version && /^6\b/.test(existing.ros_version)) {
      return res.status(409).json({
        error: `This router last identified itself as RouterOS ${existing.ros_version}, which has `
          + 'no WireGuard, so it cannot fail over to OVPN from a WireGuard primary. Use '
          + '"+ Onboard via OVPN" for it instead.',
      });
    }
  }

  await ensureSubnet(req.tenant.id);
  const nasIp = await nextHostIp(req.tenant.id);

  const { peer, privateKey, presharedKey, assignedIp } =
    await wg.createPeer(req.tenant.id, { name, routerId: routerId ?? null, ip: nasIp });

  const octets = nasIp.split('.');
  const ovpnUsername = `router-${octets[2]}-${octets[3]}`;
  const ovpnToken = crypto.randomBytes(6).toString('hex');
  await pool.query(
    `insert into ovpn_clients (tenant_id, username, password_hash, assigned_ip)
     values ($1,$2,crypt($3, gen_salt('bf')),$4)`,
    [req.tenant.id, ovpnUsername, ovpnToken, nasIp]);

  const sync = await wg.syncServer().catch((e) => ({ written: false, reloaded: false, reason: e.message }));

  const host = String(req.body?.serverHost ?? '').trim() || tunnelHost(req);
  const v6 = false; // a RouterOS 6 router was already refused above
  const authDigest = (process.env.OVPN_AUTH_DIGEST ?? 'sha1').toLowerCase();

  const script = [
    wg.mikrotikScript({ privateKey, presharedKey, assignedIp, endpoint, serverPublicKey }),
    '',
    '# OVPN standby — added disabled; billing-failover enables it only if',
    '# billing-wg\'s handshake goes stale.',
    '/interface ovpn-client remove [find name=billing-ovpn]',
    `/interface ovpn-client add name=billing-ovpn connect-to=${host} port=1194 `
      + `user=${ovpnUsername} password=${ovpnToken} certificate=none cipher=aes256-cbc auth=${authDigest} `
      + 'add-default-route=no mode=ip disabled=yes',
    '/ip firewall nat remove [find where comment="ispVpn tunnel egress (managed)"]',
    '/ip firewall nat add chain=srcnat out-interface=billing-ovpn action=masquerade '
      + 'comment="ispVpn tunnel egress (managed)"',
    '',
    wg.failoverScript(),
    '',
    ':log info "billing WireGuard/OVPN failover configured"',
  ].join('\n');

  res.json({
    peerId: peer.id,
    assignedIp,
    publicKey: peer.public_key,
    ovpnUsername,
    script,
    note: 'The WireGuard private key and OVPN password are shown once and are not stored. '
      + 'Apply the script before closing this.',
    sync,
  });
}));

app.get('/api/routers/wg-peers', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select p.id, p.name, p.assigned_ip, p.enabled, p.last_handshake, p.rx_bytes, p.tx_bytes,
            r.name as router_name
     from wg_peers p left join routers r on r.id = p.router_id
     where p.tenant_id=$1 order by p.assigned_ip`, [req.tenant.id]);
  res.json(rows);
}));

app.delete('/api/routers/wg-peers/:id', requireRole('owner'), wrap(async (req, res) => {
  await pool.query('delete from wg_peers where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  const wg = await import('./wireguard.js');
  const sync = await wg.syncServer().catch((e) => ({ written: false, reloaded: false, reason: e.message }));
  res.json({ ok: true, sync });
}));

app.get('/api/routers', async (req, res) => {
  const { rows } = await pool.query('select * from routers where tenant_id=$1 order by name', [req.tenant.id]);
  res.json(rows);
});

/** Confirm the router after the OVPN tunnel is up: nickname, NAS secret, API port (default 8728). */
app.post('/api/routers', requireRole('owner'), wrap(async (req, res) => {
  const { name, nasIdentifier, host, secret, apiPort = 8728, role = 'both', wgPeerId } = req.body;

  // Nobody needs to invent this. It is a shared secret between us and one router,
  // it is never typed by a human now that Configure pushes it, and a chosen one
  // is only ever weaker than a random one.
  const { randomPassword } = await import('./secrets.js');
  const nasSecret = String(secret ?? '').trim() || randomPassword(24);

  const { rows: [r] } = await pool.query(
    `insert into routers (tenant_id, name, host, api_port, nas_identifier, role, secret)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.tenant.id, name, host, apiPort, nasIdentifier ?? host, role, nasSecret]);

  // The peer this router's WireGuard/failover onboarding minted, before
  // this row existed to point at — the WireGuard peers list showed
  // "Unassigned" for every onboarded router until this ran, even once its
  // tunnel worked perfectly.
  if (wgPeerId) {
    await pool.query('update wg_peers set router_id=$1 where id=$2 and tenant_id=$3',
      [r.id, wgPeerId, req.tenant.id]);
  }

  // Every router shares one physical WAN and cannot route another site's
  // expired-pool range — the operator has to set one aside per router anyway
  // — so it may as well already exist rather than depend on remembering to
  // add it before the firewall block does anything. Soft-fails: a tenant who
  // has somehow claimed all sixteen candidate blocks still gets their router.
  // Not offered under Networks — this pool is system-managed, never edited
  // or deleted by hand; ensureExpiredPool below covers a router created
  // before this ran, or whose auto-created pool was ever removed.
  try {
    const cidr = await autoExpiredCidr(req.tenant.id);
    if (cidr) {
      await pool.query(
        `insert into ip_pools (tenant_id, name, cidr, router_id, service, purpose, locked)
         values ($1,$2,$3,$4,'pppoe','expired',true)`,
        [req.tenant.id, `${name} — expired customers`, cidr, r.id]);
    }
  } catch (e) {
    console.warn('auto expired-pool for router', r.id, e.message);
  }

  res.json(r);
}));

/**
 * The next free /20 (4096 addresses) out of a block set aside purely for
 * auto-created expired-customer pools — a tenant's own address plan lives
 * under Networks and is never touched here, so this can never collide with
 * ranges they chose themselves. Sixteen /20s fit in 10.250.0.0/16, which is
 * sixteen routers before a tenant would need to set one up by hand instead.
 */
async function autoExpiredCidr(tenantId) {
  const { rows: existing } = await pool.query('select cidr from ip_pools where tenant_id=$1', [tenantId]);
  const { rows: [t] } = await pool.query('select tunnel_subnet from tenants where id=$1', [tenantId]);
  const { rows: [hs] } = await pool.query(
    'select hotspot_network from hotspot_settings where tenant_id=$1', [tenantId]);
  const { SERVER_IP } = await import('./tunnel.js');

  for (let i = 0; i < 16; i++) {
    const cidr = `10.250.${i * 16}.0/20`;
    if (existing.some((e) => poolsOverlap(e.cidr, cidr))) continue;
    if (tunnelConflict(cidr, t?.tunnel_subnet, SERVER_IP)) continue;
    if (hs?.hotspot_network && poolsOverlap(hs.hotspot_network, cidr)) continue;
    return cidr;
  }
  return null;   // every candidate block taken — an operator has to set one up by hand
}

/**
 * A router that predates auto-provisioning (or whose auto-created pool was
 * ever removed) has no expired-customers range to block — this backfills
 * one the next time Configure runs, the same shape POST /api/routers already
 * does for a brand-new router, so "return the expired pool" reaches routers
 * that already existed rather than only new ones.
 */
async function ensureExpiredPool(tenantId, routerId, routerName) {
  const { rows: [existing] } = await pool.query(
    `select cidr from ip_pools
      where tenant_id=$1 and service='pppoe' and purpose='expired'
        and (router_id = $2 or router_id is null)
      order by (router_id = $2) desc
      limit 1`, [tenantId, routerId]);
  if (existing) return existing;

  const cidr = await autoExpiredCidr(tenantId);
  if (!cidr) return null;
  const { rows: [created] } = await pool.query(
    `insert into ip_pools (tenant_id, name, cidr, router_id, service, purpose, locked)
     values ($1,$2,$3,$4,'pppoe','expired',true) returning cidr`,
    [tenantId, `${routerName} — expired customers`, cidr, routerId]);
  return created;
}

/**
 * Revoke a tunnel credential.
 *
 * Minting an OVPN script and never finishing onboarding leaves a credential that
 * nothing else can remove — deleting a router only clears the one matching its
 * address, and these have no router. They also hold an address out of the
 * tenant's /24 until they go.
 */
app.delete('/api/ovpn-clients/:id', wrap(async (req, res) => {
  const { rows: [c] } = await pool.query(
    'delete from ovpn_clients where id=$1 and tenant_id=$2 returning username, assigned_ip',
    [req.params.id, req.tenant.id]);
  if (!c) return res.status(404).json({ error: 'No such tunnel credential' });
  res.json({ ok: true, freed: c.assigned_ip, username: c.username });
}));

/**
 * Prove the CoA path works before trusting it with a paying customer.
 *
 * CoA fails silently in production: auth and accounting leave a trail, but a CoA
 * that never lands only means speed changes wait for the next reconnect.
 *
 * The test targets a *live session* when there is one. It used to invent a
 * username instead, on the assumption that a NAK would come back and prove the
 * round trip — but RouterOS ignores a CoA for a session it does not have, with no
 * reply at all. So on a router with nobody connected the test reported "no
 * answer" no matter how correct the setup was, which sent operators hunting for
 * a fault that did not exist.
 */
app.post('/api/routers/:id/test-coa', wrap(async (req, res) => {
  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const coaClient = await import('./coa.js');
  const host = String(r.host).split('/')[0];

  // A session actually on this NAS right now.
  const { rows: [live] } = await pool.query(
    `select a.username, a.acctsessionid,
            (select value from radreply
              where username = a.username and attribute = 'Mikrotik-Rate-Limit'
              limit 1) as rate
       from radacct a
      where host(a.nasipaddress) = $1 and a.acctstoptime is null
      order by a.acctstarttime desc limit 1`,
    [host]);

  const username = req.body?.username?.trim() || live?.username;
  if (!username) {
    // Say so plainly instead of sending a packet that cannot be answered.
    await pool.query('update routers set coa_last_at = now() where id = $1', [r.id]);
    return res.json({
      ok: false,
      reachable: null,
      inconclusive: true,
      detail: 'Nobody is connected through this router, so there is no session to change. '
        + 'RouterOS ignores a Change-of-Authorization for a session it does not have — it does not '
        + 'refuse it, it simply never replies — so this cannot be tested until a subscriber connects. '
        + 'Come back once someone is online.',
    });
  }

  // Re-send the rate they already have: a real CoA that proves the path without
  // changing anyone's speed as a side effect of pressing a test button.
  const rate = req.body?.rate?.trim() || live?.rate || '1024k/1024k';

  const result = await coaClient.send({
    host: r.host, secret: r.secret, username, rate,
    sessionId: live?.acctsessionid, timeoutMs: 2000, retries: 1,
  });

  // A NAK still proves the round trip: the router answered and agreed on the secret.
  const reachable = result.ok || result.code === coaClient.codes.COA_NAK;

  await pool.query(
    `update routers set coa_last_at = now(), coa_last_ok = $2, coa_last_error = $3 where id = $1`,
    [r.id, reachable, reachable ? null : String(result.error ?? '').slice(0, 300)]);
  res.json({
    ok: result.ok,
    reachable,
    username,
    detail: result.ok
      ? `Router accepted a live change for ${username} (CoA-ACK).`
      : reachable
        ? 'Router answered and the shared secret matches, but rejected the change. The CoA path itself works.'
        : `${result.error}. Check "/radius incoming print" shows accept=yes, and that the secret in "/radius print detail" matches this router's.`,
  });
}));

/**
 * Free addresses a subscriber on this router could be given.
 *
 * Any prefix length, not just /24: the offsets come from inet arithmetic on the
 * pool's own cidr, so a /22 or /16 enumerates correctly instead of quietly
 * assuming 254 hosts. Capped, because a /16 is 65k addresses and nobody picks
 * from that in a dropdown.
 *
 * Network and broadcast are skipped, and anything already assigned is left out.
 */
app.put('/api/ip-pools/:id', wrap(async (req, res) => {
  const { name, cidr, routerId, service, purpose } = req.body ?? {};
  if (purpose !== undefined && purpose !== 'normal') {
    return res.status(400).json({ error: 'purpose must be normal' });
  }

  const { rows: [existing] } = await pool.query(
    'select locked, router_id from ip_pools where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!existing) return res.status(404).json({ error: 'No such pool' });
  // Unassigning a locked pool's router is how the "can't be deleted" guard
  // gets sidestepped — set it, unset it, then delete an unlocked orphan. The
  // router_id itself simply cannot move for a locked pool; everything else
  // about it (name, range) is still editable.
  const routerIdInput = existing.locked ? undefined : routerId;

  const { rows: [p] } = await pool.query(
    `update ip_pools set
       name      = coalesce(nullif($3,''), name),
       cidr      = coalesce(nullif($4,'')::cidr, cidr),
       -- '' clears the assignment; absent leaves it alone.
       router_id = case when $5::text is null then router_id
                        when $5 = '' then null else $5::uuid end,
       service   = coalesce(nullif($6,''), service),
       purpose   = coalesce(nullif($7,''), purpose)
     where id=$1 and tenant_id=$2 returning *`,
    [req.params.id, req.tenant.id, name ?? '', cidr ?? '',
     routerIdInput === undefined ? null : String(routerIdInput), service ?? '', purpose ?? '']);
  res.json(p);
}));

/**
 * Remove a pool.
 *
 * Refuses while subscribers hold addresses inside it: those are live customers,
 * and deleting the range they came from leaves nothing to reconcile against when
 * working out which addresses are free.
 */
app.delete('/api/ip-pools/:id', wrap(async (req, res) => {
  const { rows: [p] } = await pool.query(
    'select * from ip_pools where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!p) return res.status(404).json({ error: 'No such pool' });

  if (p.locked && p.router_id) {
    return res.status(409).json({
      error: 'This pool was created automatically for its router and can\'t be deleted directly. '
        + 'Delete the router (or unassign it there) to free this pool up.',
    });
  }

  const { rows: [{ count }] } = await pool.query(
    `select count(*)::int from subscribers
      where tenant_id=$1 and static_ip is not null and static_ip << $2::cidr`,
    [req.tenant.id, p.cidr]);
  if (count > 0)
    return res.status(409).json({
      error: count === 1
        ? '1 client holds an address in this pool. Move them before deleting it.'
        : `${count} clients hold addresses in this pool. Move them before deleting it.`,
    });

  await pool.query('delete from ip_pools where id=$1 and tenant_id=$2', [p.id, req.tenant.id]);
  res.json({ ok: true, freed: p.cidr });
}));

/** Addresses in one pool and who holds them, for the pool detail view. */
app.get('/api/ip-pools/:id/usage', wrap(async (req, res) => {
  const { rows: [p] } = await pool.query(
    'select * from ip_pools where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!p) return res.status(404).json({ error: 'No such pool' });

  const { rows: taken } = await pool.query(
    `select host(static_ip) as ip, name, account_code, status
       from subscribers
      where tenant_id=$1 and static_ip is not null and static_ip << $2::cidr
      order by static_ip`, [req.tenant.id, p.cidr]);

  const { rows: [size] } = await pool.query(
    'select (broadcast($1::cidr) - network($1::cidr) - 1)::bigint as hosts', [p.cidr]);

  res.json({
    pool: p,
    hosts: Number(size.hosts),
    used: taken.length,
    free: Math.max(0, Number(size.hosts) - taken.length),
    taken,
  });
}));

app.get('/api/routers/:id/free-ips', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  const { rows } = await pool.query(`
    with pools as (
      -- Not the expired-customers pool: that range exists to be firewalled
      -- off, not offered as a normal client's assigned address.
      select cidr from ip_pools
       where tenant_id = $1
         and (router_id = $2 or router_id is null)
         and service = 'pppoe'
         and purpose != 'expired'
    )
    select host(network(p.cidr) + i) as ip, text(p.cidr) as pool
      from pools p,
           lateral generate_series(
             1,
             greatest(least(broadcast(p.cidr) - network(p.cidr) - 1, $3::bigint), 0)
           ) as i
     where not exists (
       -- host() on both sides: inet equality compares the prefix length as well,
       -- so a stored 10.44.0.1/32 never matches a generated 10.44.0.1/22 and
       -- every taken address was being offered again.
       select 1 from subscribers s
        where s.tenant_id = $1 and host(s.static_ip) = host(network(p.cidr) + i))
     order by 1
     limit $3`, [req.tenant.id, req.params.id, limit]);

  res.json({ addresses: rows.map((r) => r.ip), pools: [...new Set(rows.map((r) => r.pool))] });
}));

/**
 * Never returns the expired-customers pool — it's auto-created and pushed
 * by Configure, not something an operator sets up or edits, and showing it
 * next to the ranges they actually manage only invited someone to rename,
 * narrow, or delete the one thing quietly doing the firewall block.
 */
app.get('/api/ip-pools', async (req, res) => {
  const { rows } = await pool.query(
    `select p.*, r.name as router_name,
       (select count(*) from subscribers s where s.router_id=p.router_id) used
     from ip_pools p left join routers r on r.id=p.router_id
     where p.tenant_id=$1 and p.purpose != 'expired'`, [req.tenant.id]);
  res.json(rows);
});
/**
 * Two pools must never overlap.
 *
 * PPPoE addresses are allocated here and hotspot addresses by the router's own
 * DHCP. If the ranges intersect, both can hand the same address to different
 * customers, and the symptom is intermittent: two people work fine until they
 * are online at once, then neither does. Nothing in either subsystem can detect
 * that afterwards, so it is refused at the point of creation.
 */
function poolsOverlap(a, b) {
  const parse = (cidr) => {
    const [base, bits] = String(cidr).split('/');
    const o = String(base).split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const width = Number(bits);
    if (!Number.isInteger(width) || width < 0 || width > 32) return null;
    const int = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
    const mask = width === 0 ? 0 : (0xffffffff << (32 - width)) >>> 0;
    const net = (int & mask) >>> 0;
    return { net, bcast: (net | (~mask >>> 0)) >>> 0 };
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  return x.net <= y.bcast && y.net <= x.bcast;
}

/**
 * A range that would swallow the management tunnel.
 *
 * Every one of these ranges ends up as an address on a bridge, and an address
 * on a bridge creates a connected route. If that route covers the router's own
 * tunnel address or this server's, it beats the tunnel's own route: the router
 * stops being able to reach us the instant the push lands, and no later push
 * can undo it because there is nothing left to push through. Recovering it
 * means someone standing in front of the router.
 *
 * Worth refusing outright rather than warning about. The operator loses a
 * range they can trivially change; the alternative is a site off the air and a
 * drive out to it.
 */
function tunnelConflict(cidr, tunnelSubnet, serverIp) {
  if (!cidr) return null;
  if (tunnelSubnet && poolsOverlap(cidr, tunnelSubnet)) {
    return `${cidr} covers the management tunnel (${tunnelSubnet}). Putting that address on a `
      + 'router would cut its connection to this server, and it could only be fixed on site. '
      + 'Pick a range outside the tunnel.';
  }
  if (serverIp && poolsOverlap(cidr, `${serverIp}/32`)) {
    return `${cidr} covers this server's own tunnel address (${serverIp}). A router given that `
      + 'range would lose contact with us and could only be fixed on site.';
  }
  return null;
}

app.post('/api/ip-pools', wrap(async (req, res) => {
  const { name, cidr, routerId, service = 'pppoe', purpose = 'normal' } = req.body;
  if (!name || !cidr) return res.status(400).json({ error: 'A pool needs a name and a range' });
  if (purpose !== 'normal') return res.status(400).json({ error: 'purpose must be normal' });

  const { rows: existing } = await pool.query(
    'select name, cidr, service from ip_pools where tenant_id=$1', [req.tenant.id]);

  const clash = existing.find((e) => poolsOverlap(e.cidr, cidr));
  if (clash) {
    return res.status(409).json({
      error: `${cidr} overlaps "${clash.name}" (${clash.cidr}, ${clash.service}). `
        + 'PPPoE and hotspot must use separate ranges, or the same address can be given '
        + 'to two customers.',
    });
  }

  // And against the tunnel, which is not a pool at all but is the one range
  // that must never appear on a router's bridge.
  {
    const { SERVER_IP } = await import('./tunnel.js');
    const { rows: [t] } = await pool.query(
      'select tunnel_subnet from tenants where id=$1', [req.tenant.id]);
    const clashes = tunnelConflict(cidr, t?.tunnel_subnet, SERVER_IP);
    if (clashes) return res.status(409).json({ error: clashes });
  }

  // Also against the hotspot LAN, which is not an ip_pools row but is handed
  // out by the router's DHCP all the same.
  const { rows: [hs] } = await pool.query(
    'select hotspot_network from hotspot_settings where tenant_id=$1', [req.tenant.id]);
  if (service === 'pppoe' && hs?.hotspot_network && poolsOverlap(hs.hotspot_network, cidr)) {
    return res.status(409).json({
      error: `${cidr} overlaps the hotspot LAN (${hs.hotspot_network}). `
        + 'Change one of them so PPPoE and hotspot addresses cannot collide.',
    });
  }

  const { rows: [p] } = await pool.query(
    'insert into ip_pools (tenant_id, name, cidr, router_id, service, purpose) values ($1,$2,$3,$4,$5,$6) returning *',
    [req.tenant.id, name, cidr, routerId ?? null, service, purpose]);
  res.json(p);
}));

// ══════════════════════════════════════════════════════════════════════════
// Everything below backs a screen in the admin UI. The original design shipped
// the routes above; these were added when the remaining screens were wired up.
// ══════════════════════════════════════════════════════════════════════════

// ── subscribers (Clients screen) ──────────────────
/**
 * Mint credentials for a new client: a free 5-digit account number and a 7-digit
 * password.
 *
 * Digits only, because both get read down a phone line and typed into a router
 * by people who are not looking at a screen. "Is that a lowercase L or a one?"
 * costs a support call every time.
 *
 * The account number is allocated here rather than in the browser because it has
 * to be unique within the tenant, and only the database knows what is taken.
 */
const digits = (n) => {
  const lo = 10 ** (n - 1);
  return String(lo + crypto.randomInt(0, 9 * lo));
};

/**
 * A free 5-digit account number, allocated once here so the uniqueness check
 * and the shape of the number are never duplicated — or skipped — anywhere
 * else that needs one.
 */
/**
 * Whether `code` is already taken — scoped to just this tenant normally, but
 * widened to every platform-collect-enabled tenant when `crossTenant` is set.
 *
 * Only a platform-collected tenant needs the wider check: those are the only
 * ones sharing the platform owner's own paybill, where a customer dialing it
 * directly types a bare, unprefixed account number — /webhooks/daraja/confirm
 * disambiguates that by searching for a unique match across every
 * platform-collected tenant, and two tenants issuing the same account code
 * to different customers is exactly the collision that search cannot resolve
 * (it lands unmatched instead of being applied to either customer). A tenant
 * that never turns platform-collect on has no such paybill to share and
 * keeps the narrower, per-tenant-only check it always had.
 */
async function accountCodeTaken(tenantId, code, crossTenant) {
  if (crossTenant) {
    const { rowCount } = await pool.query(
      `select 1 from subscribers s join tenants t on t.id = s.tenant_id
        where t.platform_collect_enabled and s.account_code = $1`,
      [code]);
    return rowCount > 0;
  }
  const { rowCount } = await pool.query(
    'select 1 from subscribers where tenant_id=$1 and account_code=$2', [tenantId, code]);
  return rowCount > 0;
}

async function allocateAccountCode(tenantId, crossTenant = false) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = digits(5);
    if (!(await accountCodeTaken(tenantId, candidate, crossTenant))) return candidate;
  }
  // 90,000 possibilities: only a tenant with most of them already in use gets
  // here, and returning a duplicate would fail on insert anyway.
  return null;
}

app.get('/api/subscribers/new-credentials', requirePermission('clients.view'), wrap(async (req, res) => {
  const account = await allocateAccountCode(req.tenant.id, req.tenant.platform_collect_enabled);
  if (!account) return res.status(409).json({ error: 'Could not find a free 5-digit account number.' });
  res.json({ account, password: digits(7) });
}));

/**
 * A coordinate, or null.
 *
 * The Add client form ships with a default latitude and longitude filled in, so
 * a blank string and an out-of-range number both arrive routinely. Storing
 * either would put pins in the sea; null means "we do not know", which is
 * honest and shows nothing on the map.
 */
function coord(value, limit) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/**
 * A row in the Activity log tab. Best-effort and fire-and-forget — a client
 * mutation succeeding is what matters; failing to record that it happened is
 * not worth failing the request over.
 */
async function logActivity(req, subscriberId, accountCode, action, detail = null) {
  try {
    await pool.query(
      `insert into activity_log (tenant_id, subscriber_id, account_code, actor, action, detail)
       values ($1,$2,$3,$4,$5,$6)`,
      [req.tenant.id, subscriberId, accountCode, req.session?.name ?? 'system', action, detail]);
  } catch (e) { console.error('logActivity', e.message); }
}

app.post('/api/subscribers', requirePermission('clients.create'), wrap(async (req, res) => {
  const { accountCode, name, phone, phoneAlt, service = 'pppoe', planId, routerId,
          pppoeUser, pppoePass, staticIp, autopay, location, lat, lng, lineLabel, referredBy,
          email, category, identification, billingType } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
  // KopoKopo is hotspot-only by policy everywhere else in this codebase
  // (kopokopo_hotspot_only db constraint, till-based flow, settings screen's
  // own note) — autopay is a separate column that constraint can't reach.
  if (autopay === 'kopokopo') {
    return res.status(400).json({ error: 'KopoKopo cannot be used for autopay — it is hotspot-only.' });
  }

  /**
   * Catch the same customer being added twice.
   *
   * A number may legitimately hold several lines — a household taking a second
   * connection, a business with two sites — so this is a warning with a way
   * past it rather than a prohibition. Refusing outright makes a real case
   * impossible; allowing it silently is how a customer pays one account while
   * the other quietly expires.
   */
  const label = String(lineLabel ?? '').trim() || null;

  /**
   * Fell back to the phone number once, silently, whenever the operator
   * saved without pressing Generate — the account number field has no
   * required attribute, and its placeholder text looks identical to a real
   * value at a glance. That put a 10-digit phone number where the paybill
   * account is meant to be a 5-digit code short enough to read aloud, and
   * everything downstream that assumes that shape — the similarity match in
   * payments/apply.js, the account-collision reasoning in schema.sql — was
   * built on an invariant the API never actually enforced.
   *
   * A syntactically valid submission is trusted (an operator correcting or
   * choosing their own number is not this bug); anything else, including no
   * value at all, gets a real allocated code instead of the raw phone number.
   */
  const submitted = String(accountCode ?? '').trim();
  const account = /^\d{4,6}$/.test(submitted) ? submitted
    : await allocateAccountCode(req.tenant.id, req.tenant.platform_collect_enabled);
  if (!account) return res.status(409).json({ error: 'Could not find a free account number.' });

  /**
   * A hand-picked code is trusted for shape, not for collisions — a
   * platform-collected tenant sharing the platform's own paybill with other
   * such tenants needs this checked against ALL of them, not just itself,
   * or two tenants' customers end up with the identical bare account number
   * on the one paybill every direct-dial payment there is disambiguated by
   * (see /webhooks/daraja/confirm). The narrower per-tenant check still
   * happens later via the same-account "add a line" flow below and the
   * table's own unique constraint; this only adds the wider one.
   */
  if (req.tenant.platform_collect_enabled && /^\d{4,6}$/.test(submitted)) {
    const { rows: elsewhere } = await pool.query(
      `select t.name from subscribers s join tenants t on t.id = s.tenant_id
        where t.platform_collect_enabled and s.tenant_id <> $1 and s.account_code = $2`,
      [req.tenant.id, account]);
    if (elsewhere.length) {
      return res.status(409).json({
        error: `Account ${account} is already used by a customer at ${elsewhere[0].name}, another platform-collect `
          + 'tenant on the same shared paybill. Pick a different number so a direct-dial payment can tell you apart.',
      });
    }
  }

  /**
   * Several lines under one account.
   *
   * A customer with two connections is one person paying one account number,
   * not two strangers who share a phone. The tag is what tells them apart —
   * "Shop", "Flat 3" — so it is required for the second and later lines and
   * pointless on the first.
   */
  const { rows: sameAccount } = await pool.query(
    'select line_label from subscribers where tenant_id=$1 and account_code=$2',
    [req.tenant.id, account]);

  if (sameAccount.length && !label) {
    return res.status(409).json({
      error: `Account ${account} already has a line. Give this one a tag — "Shop", "Flat 3" — `
        + 'so the two can be told apart.',
      needsLineLabel: true,
    });
  }
  if (label && sameAccount.some((x) => (x.line_label ?? '') === label)) {
    return res.status(409).json({ error: `Account ${account} already has a line tagged "${label}".` });
  }

  // A repeated phone on a *different* account is still worth querying: that is
  // the same customer entered twice, which is the mistake this catches.
  if (!sameAccount.length && !req.body?.allowDuplicatePhone) {
    const { rows: existing } = await pool.query(
      'select name, account_code from subscribers where tenant_id=$1 and phone=$2',
      [req.tenant.id, phone]);
    if (existing.length) {
      return res.status(409).json({
        error: `${phone} already belongs to ${existing.map((x) => `${x.name} (${x.account_code})`).join(', ')}. `
          + 'Use that account number to add another line to them, or tick "different customer".',
        duplicatePhone: true,
      });
    }
  }
  // Scoped the same as every other foreign key taken bare off the request —
  // a referrer id has to actually belong to this tenant, not just exist.
  let referrerId = null;
  if (referredBy) {
    const { rowCount } = await pool.query(
      'select 1 from referrers where id=$1 and tenant_id=$2', [referredBy, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such referrer' });
    referrerId = referredBy;
  }

  const { rows: [s] } = await pool.query(
    `insert into subscribers (tenant_id, account_code, name, phone, phone_alt, service, plan_id,
       router_id, pppoe_user, pppoe_pass, static_ip, autopay, location, lat, lng, line_label, referred_by,
       email, category, identification, billing_type)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning *`,
    [req.tenant.id, account, name, phone, phoneAlt || null, service, planId ?? null,
     routerId ?? null, pppoeUser ?? null, pppoePass ?? null, staticIp ?? null, autopay ?? null,
     location || null, coord(lat, 90), coord(lng, 180), label, referrerId,
     email || null, category || null, identification || null, billingType || null]);
  await logActivity(req, s.id, s.account_code, sameAccount.length ? 'Service added' : 'Account created',
    label ? `Line "${label}"` : null);

  // Before responding, not after: the operator's next move is to hand over the
  // credentials and have the customer dial in, and RADIUS has to know them by then.
  if (s.pppoe_user) {
    const radius = await import('./radius.js');
    await radius.syncSubscriberCredentials(pool, req.tenant.id, s.id);
  }

  // Every customer gets a portal login at registration rather than waiting for
  // someone to press a button later. A portal account that only exists once
  // support creates it is one the customer never discovers they have.
  //
  // The readable copy is skipped when APP_SECRET_KEY is unset. Storing it in
  // clear instead would be worse than not storing it, and failing the whole
  // creation over it would be worse still — being able to add a customer must
  // not depend on an optional convenience being configured.
  const secrets = await import('./secrets.js');
  const portalPassword = String(100000 + crypto.randomInt(0, 900000));
  await pool.query(
    'update subscribers set portal_password_hash=$2, portal_password_enc=$3 where id=$1',
    [s.id, await auth.hashPassword(portalPassword),
     secrets.configured() ? secrets.encrypt(portalPassword) : null]);

  res.json({ ...s, portal_password: portalPassword });

  // After responding: a customer is created whether or not their phone is
  // reachable, and the operator should not wait on an SMS gateway to find out.
  notifySubscriber(req.tenant.id, s.id, 'welcome').catch(() => {});
}));

/**
 * Send one templated message to a subscriber, on every number they gave us.
 *
 * A household shares the connection but not the handset — the person who pays is
 * often not the one who notices it is down — so both numbers get everything.
 */
async function notifySubscriber(tenantId, subscriberId, template, extra = {}) {
  const sms = await import('./sms.js');
  const { rows: [s] } = await pool.query(
    `select ${sms.SUBSCRIBER_VARS_SQL}
       from subscribers s
       left join plans p on p.id = s.plan_id
       left join routers r on r.id = s.router_id
      where s.id = $1 and s.tenant_id = $2`, [subscriberId, tenantId]);
  if (!s) return;

  const vars = { ...sms.subscriberVars(s, await sms.orgVars(tenantId)), ...extra };
  // Duplicates would text the same handset twice when both fields match.
  const numbers = [...new Set([s.phone, s.phone_alt].filter(Boolean))];
  for (const n of numbers) await sms.send(tenantId, n, template, vars).catch(() => {});
}

/**
 * Add or subtract from a wallet, with a reason — not the same thing as the
 * plain "Wallet balance" field on the Edit-client modal (PATCH /:id below,
 * `credit`), which overwrites the number outright with no before/after and
 * no lock against a payment landing on the same account mid-edit. This is
 * for the case that actually needs care: a goodwill refund, correcting an
 * operator's mistake, deducting for damaged equipment — anywhere "what
 * changed and why" matters as much as the new number.
 */
app.post('/api/subscribers/:id/wallet-adjustment', requirePermission('clients.wallet_adjust'), wrap(async (req, res) => {
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason ?? '').trim();
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'Enter a non-zero amount to add or subtract.' });
  }
  if (!reason) return res.status(400).json({ error: 'A reason is required for a manual wallet adjustment.' });

  const { rows: [sub] } = await pool.query(
    'select id, account_code from subscribers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!sub) return res.status(404).json({ error: 'not found' });

  const { before, after } = await withTenant(req.tenant.id, async (c) => {
    // Same lock-via-upsert idiom settleSubscriber uses in apply.js: the
    // UPDATE branch takes the same row lock `for update` would, so this can
    // never race a payment landing on the same account mid-adjustment.
    const { rows: [wallet] } = await c.query(
      `insert into account_wallets (tenant_id, account_code, balance)
       values ($1,$2,0)
       on conflict (tenant_id, account_code) do update set balance = account_wallets.balance
       returning balance`,
      [req.tenant.id, sub.account_code]);
    const before = Number(wallet.balance);
    const after = before + amount;
    await c.query(
      'update account_wallets set balance=$3, updated_at=now() where tenant_id=$1 and account_code=$2',
      [req.tenant.id, sub.account_code, after]);
    return { before, after };
  });

  await logActivity(req, sub.id, sub.account_code, 'Wallet adjusted',
    `${amount > 0 ? '+' : ''}KES ${amount.toFixed(2)} (${before.toFixed(2)} → ${after.toFixed(2)}) — ${reason}`);

  res.json({ wallet_balance: after });
}));

app.patch('/api/subscribers/:id', requirePermission('clients.edit'), wrap(async (req, res) => {
  const allowed = ['name', 'phone', 'phone_alt', 'status', 'plan_id', 'router_id', 'static_ip',
                   'autopay', 'expires_at', 'pppoe_user', 'pppoe_pass', 'location', 'lat', 'lng',
                   'email', 'category', 'identification', 'billing_type', 'tags', 'customer_ref'];
  const sets = Object.keys(req.body).filter((k) => allowed.includes(k));
  const settingCredit = 'credit' in req.body;
  if (!sets.length && !settingCredit) return res.status(400).json({ error: 'nothing to update' });

  if (req.body.autopay === 'kopokopo') {
    return res.status(400).json({ error: 'KopoKopo cannot be used for autopay — it is hotspot-only.' });
  }

  /**
   * Wallet balance is pooled per account_code (account_wallets), not a
   * column on this subscriber row — every line under the same account
   * shares it. Setting it here means "set the whole account's wallet to
   * this", same as editing used to look like it did per-line.
   */
  let walletBalance = null;
  if (settingCredit) {
    const c = Number(req.body.credit);
    if (!Number.isFinite(c)) return res.status(400).json({ error: 'Balance must be a number' });
    const { rows: [target] } = await pool.query(
      'select account_code from subscribers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!target) return res.status(404).json({ error: 'not found' });
    const { rows: [w] } = await pool.query(
      `insert into account_wallets (tenant_id, account_code, balance, updated_at)
       values ($1,$2,$3,now())
       on conflict (tenant_id, account_code) do update set balance=$3, updated_at=now()
       returning balance`,
      [req.tenant.id, target.account_code, c]);
    walletBalance = Number(w.balance);
  }
  if (!sets.length) {
    const { rows: [s] } = await pool.query('select * from subscribers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
    await logActivity(req, s.id, s.account_code, 'Edited', 'credit');
    return res.json({ ...s, wallet_balance: walletBalance });
  }

  // Same rule as on create: an unusable coordinate becomes null rather than a
  // numeric cast error, or a pin somewhere out at sea.
  if ('lat' in req.body) req.body.lat = coord(req.body.lat, 90);
  if ('lng' in req.body) req.body.lng = coord(req.body.lng, 180);

  // Numbers only, and the same lengths the generator uses. These get dictated
  // over the phone and typed into a router by someone who is not looking at a
  // screen, which is the whole reason they are digits.
  if (req.body.pppoe_user != null && !/^\d{4,12}$/.test(String(req.body.pppoe_user))) {
    return res.status(400).json({ error: 'PPPoE username must be 4-12 digits' });
  }
  if (req.body.pppoe_pass != null && !/^\d{4,12}$/.test(String(req.body.pppoe_pass))) {
    return res.status(400).json({ error: 'PPPoE password must be 4-12 digits' });
  }

  // A username change leaves the old radcheck row behind, still valid. Anyone
  // holding the previous credentials would keep getting online after support
  // "changed" them, which is exactly what changing them is meant to prevent.
  let previousUser = null;
  if (req.body.pppoe_user != null) {
    const { rows: [old] } = await pool.query(
      'select pppoe_user from subscribers where id=$1 and tenant_id=$2',
      [req.params.id, req.tenant.id]);
    previousUser = old?.pppoe_user ?? null;
  }
  const { rows: [s] } = await pool.query(
    `update subscribers set ${sets.map((k, i) => `${k}=$${i + 3}`).join(', ')}
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, ...sets.map((k) => req.body[k])]);
  if (!s) return res.status(404).json({ error: 'not found' });

  // A plan change moves the rate limit, which lives in radreply; a credential
  // change moves the password. Without this the subscriber keeps the old value
  // until some later payment happens to rewrite it.
  const touchedRadius = ['plan_id', 'pppoe_user', 'pppoe_pass'].some((k) => sets.includes(k));
  if (touchedRadius && s.pppoe_user) {
    const radius = await import('./radius.js');
    if (previousUser && previousUser !== s.pppoe_user) {
      await radius.forgetSubscriberCredentials(pool, previousUser, req.tenant.id);
    }
    await radius.syncSubscriberCredentials(pool, req.tenant.id, s.id);
  }

  // Which fields, not their values — a credential or balance change belongs
  // in the log as the fact that it happened, not as a second place a
  // password or a customer's new balance sits in plain text.
  await logActivity(req, s.id, s.account_code, 'Edited', [...sets, ...(settingCredit ? ['credit'] : [])].join(', '));

  res.json({ ...s, ...(settingCredit ? { wallet_balance: walletBalance } : {}) });
}));

/**
 * Free a PPPoE line to lock onto whichever router dials in next.
 *
 * A line gets locked to its first router's MAC automatically (see the
 * lockNewPppoeMacs job) so a shared password stops working from anywhere
 * else. That is exactly wrong the moment the customer's own equipment
 * changes for a legitimate reason — a tech swapping a dead router, the
 * customer buying a new one — so an admin has to be able to say "this next
 * MAC is fine" without waiting for someone to invent a workaround.
 */
app.post('/api/subscribers/:id/clear-mac-lock', wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    'update subscribers set locked_mac=null where id=$1 and tenant_id=$2 returning pppoe_user, account_code',
    [req.params.id, req.tenant.id]);
  if (!s) return res.status(404).json({ error: 'not found' });

  if (s.pppoe_user) {
    const radius = await import('./radius.js');
    await radius.clearPppoeMacLock(pool, req.tenant.id, s.pppoe_user)
      .catch((e) => console.warn('clear-mac-lock: radius not updated —', e?.message ?? e));
  }
  await logActivity(req, req.params.id, s.account_code, 'MAC lock cleared');
  res.json({ ok: true });
}));

/**
 * Read back everything a customer needs to get online or sign in.
 *
 * Separate from GET /api/subscribers on purpose: the list is loaded constantly by
 * every screen, and putting passwords in it would spray them through logs, caches
 * and the browser devtools of anyone who happens to have Clients open. This is a
 * deliberate act with its own request.
 *
 * The portal password is only readable for customers whose password was set after
 * the encrypted column existed. Older ones have a hash and nothing else, so they
 * report as unreadable rather than pretending to be missing.
 */
app.get('/api/subscribers/:id/credentials', requireRole('owner'), wrap(async (req, res) => {
  const secrets = await import('./secrets.js');
  const { rows: [s] } = await pool.query(
    `select account_code, pppoe_user, pppoe_pass, portal_password_enc, portal_password_hash
       from subscribers where id=$1 and tenant_id=$2`, [req.params.id, req.tenant.id]);
  if (!s) return res.status(404).json({ error: 'not found' });

  let portalPassword = null;
  if (s.portal_password_enc) {
    // A key rotation makes old ciphertext undecryptable. That is a bad reason to
    // fail the whole request when the PPPoE half is still perfectly readable.
    try { portalPassword = secrets.decrypt(s.portal_password_enc); } catch { /* unreadable */ }
  }

  res.json({
    account: s.account_code,
    pppoeUser: s.pppoe_user,
    pppoePassword: s.pppoe_pass,
    portalPassword,
    portalPasswordSet: Boolean(s.portal_password_hash),
  });
}));

/**
 * Data used per day, for the last 30 days — the Statistics tab's staff-
 * facing counterpart to /portal/usage above, scoped by tenant/session
 * rather than a customer's own portal cookie.
 */
app.get('/api/subscribers/:id/usage', requirePermission('clients.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select date(started_at) as day,
            sum(coalesce(bytes_in,0) + coalesce(bytes_out,0)) as bytes
       from sessions
      where tenant_id=$1 and subscriber_id=$2
        and started_at >= now() - interval '30 days'
      group by date(started_at)
      order by day`, [req.tenant.id, req.params.id]);
  res.json(rows.map((r) => ({ day: r.day, mb: Math.round(Number(r.bytes) / (1024 * 1024)) })));
}));

/**
 * What's happened on this line — status changes, edits, credential resets —
 * for the Activity log tab. Matched by account_code too, not just
 * subscriber_id: a deleted line's own log rows have subscriber_id cleared
 * (see the delete route) but stay filed under the account they belonged to.
 */
app.get('/api/subscribers/:id/activity', requirePermission('clients.view'), wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    'select account_code from subscribers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!s) return res.status(404).json({ error: 'not found' });
  const { rows } = await pool.query(
    `select actor, action, detail, created_at from activity_log
      where tenant_id=$1 and account_code=$2
      order by created_at desc limit 100`,
    [req.tenant.id, s.account_code]);
  res.json(rows);
}));

/**
 * Give a customer a fresh portal password.
 *
 * Six digits, for the same reason the rest are: it gets read out over the phone
 * by support. Returned once in the clear and stored only as a hash, so this is
 * the only moment anyone can see it — including us.
 */
app.post('/api/subscribers/:id/portal-password', wrap(async (req, res) => {
  // An operator may set one the customer has chosen; omitting it generates one.
  const chosen = String(req.body?.password ?? '').trim();
  if (chosen && !/^\d{6,12}$/.test(chosen)) {
    return res.status(400).json({ error: 'Portal password must be 6-12 digits' });
  }
  const password = chosen || String(100000 + crypto.randomInt(0, 900000));
  const secrets = await import('./secrets.js');
  const hash = await auth.hashPassword(password);
  const { rows: [s] } = await pool.query(
    `update subscribers set portal_password_hash=$3, portal_password_enc=$4
      where id=$1 and tenant_id=$2 returning name, phone, account_code`,
    [req.params.id, req.tenant.id, hash,
     secrets.configured() ? secrets.encrypt(password) : null]);
  if (!s) return res.status(404).json({ error: 'not found' });

  await logActivity(req, req.params.id, s.account_code, 'Portal password reset');
  res.json({ password, account: s.account_code });

  // Texted as well as shown: the operator generating it is rarely the person who
  // needs it, and reading a code back over the phone is how it gets mistyped.
  notifySubscriber(req.tenant.id, req.params.id, 'custom', {
    body: `Your ${'{company}'} account portal: login ${s.account_code}, password ${password}`,
  }).catch(() => {});
}));

/**
 * Pause, suspend, or put a subscriber back on.
 *
 * These were one button writing status='suspended', so an operator could not
 * tell someone they had stopped deliberately from someone the system cut off for
 * not paying — and the nightly sweep would happily "expire" a paused customer.
 *
 *   pause    deliberate, by an admin. Automation leaves it alone.
 *   suspend  a block. A payment clears it.
 *   resume   back to active, and the plan's speed is reapplied.
 *
 * Admin-only, and never exposed to the customer.
 */
app.post('/api/subscribers/:id/access', requirePermission('clients.suspend'), wrap(async (req, res) => {
  const action = String(req.body?.action ?? '');
  const target = { pause: 'paused', suspend: 'suspended', resume: 'active' }[action];
  if (!target) return res.status(400).json({ error: 'action must be pause, suspend or resume' });

  /**
   * A pause used to freeze the status but not the clock: expires_at kept
   * counting down underneath it, so a customer paused for a week came back to
   * find a week of their remaining days had quietly burned away regardless.
   *
   * paused_at records when the pause started; on resume, that elapsed stretch
   * is added back onto expires_at before it is cleared, so paused time is
   * never billed. A pause resumed by another pause (already paused, paused
   * again) leaves paused_at untouched — the clock was already stopped.
   */
  const { rows: [s] } = await pool.query(
    `update subscribers set
       status = $3,
       paused_at = case
         when $3 = 'paused' and status <> 'paused' then now()
         when $3 = 'paused' then paused_at
         else null
       end,
       expires_at = case
         when $3 = 'active' and paused_at is not null
           then expires_at + (now() - paused_at)
         else expires_at
       end
     where id=$1 and tenant_id=$2 returning *`,
    [req.params.id, req.tenant.id, target]);
  if (!s) return res.status(404).json({ error: 'not found' });

  const { withTenant } = await import('./db.js');
  const radius = await import('./radius.js');
  await withTenant(req.tenant.id, async (c) => {
    if (target === 'active') await radius.activateSubscriber(c, req.tenant.id, s.id);
    // Both off-states use the walled garden: the session drops to a crawl rather
    // than vanishing, so the customer gets a portal page instead of silence.
    else await radius.walledGarden(c, req.tenant.id, s.id);
  }).catch((e) => console.warn('access change: radius not updated —', e?.message ?? e));

  await logActivity(req, s.id, s.account_code, { pause: 'Paused', suspend: 'Suspended', resume: 'Resumed' }[action]);
  res.json(s);
}));

app.delete('/api/subscribers/:id', requirePermission('clients.delete'), wrap(async (req, res) => {
  // Read the username first: once the row is gone there is nothing to link the
  // RADIUS credentials back to, and a deleted customer whose credentials still
  // authenticate is a customer still getting free service.
  const { rows: [s] } = await pool.query(
    'select pppoe_user, account_code, line_label from subscribers where tenant_id=$1 and id=$2',
    [req.tenant.id, req.params.id]);
  if (!s) return res.status(404).json({ error: 'No such client' });

  const { rowCount } = await pool.query(
    'delete from subscribers where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  // Reported rather than assumed. This route answered ok:true unconditionally,
  // so a delete blocked by a foreign key looked like it had worked and the row
  // reappeared on the next refresh.
  if (!rowCount) return res.status(409).json({ error: 'Client could not be deleted' });

  if (s.pppoe_user) {
    const radius = await import('./radius.js');
    await radius.forgetSubscriberCredentials(pool, s.pppoe_user, req.tenant.id);
  }
  // subscriber_id is already gone by the time this runs (on delete set null),
  // so the row is filed under account_code alone — still findable from the
  // account's Activity log even though the line itself no longer exists.
  await logActivity(req, null, s.account_code, 'Service deleted', s.line_label ? `Line "${s.line_label}"` : null);
  res.json({ ok: true });
}));

// ── money (Payments screen) ───────────────────────
app.get('/api/payments', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    select pay.*,
           -- Which bundle a hotspot sale actually paid for — a payment
           -- carried only voucher_id, which named nothing a person could
           -- read on this screen.
           v.code as voucher_code, p.title as plan_title, p.rate_down, p.rate_up,
           -- Whose PPPoE account this actually applied to — a payment matched
           -- by account number carried only subscriber_id, so confirming a
           -- specific customer's payment landed meant a database query.
           s.name as customer_name
      from payments pay
      left join vouchers v on v.id = pay.voucher_id
      left join plans p on p.id = v.plan_id
      left join subscribers s on s.id = pay.subscriber_id
     where pay.tenant_id=$1
     order by pay.received_at desc
     limit 500`, [req.tenant.id]);
  res.json(rows);
}));

/**
 * Payment monitoring by site — how much each physical router has actually
 * collected, PPPoE and hotspot combined.
 *
 * PPPoE attributes through the subscriber's own router_id, set once at
 * signup/assignment and stable for the life of the line. Hotspot attributes
 * through vouchers.router_id, set from the login page's own ?router= at
 * purchase time (only from the point that was wired up — see schema.sql's
 * comment on the column; a voucher bought before that has nothing to
 * attribute and lands in the "Unassigned" row rather than being silently
 * dropped from the total).
 *
 * Only 'applied' payments — a pending or failed STK attempt collected
 * nothing, and unmatched ones have no subscriber or voucher to attribute
 * through in the first place.
 */
app.get('/api/payments/by-site', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    select router_id, router_name,
           sum(pppoe_amount) as pppoe_amount, sum(pppoe_count) as pppoe_count,
           sum(hotspot_amount) as hotspot_amount, sum(hotspot_count) as hotspot_count,
           sum(pppoe_amount) + sum(hotspot_amount) as total_amount
      from (
        select s.router_id, r.name as router_name,
               pay.amount as pppoe_amount, 1 as pppoe_count, 0 as hotspot_amount, 0 as hotspot_count
          from payments pay
          join subscribers s on s.id = pay.subscriber_id
          left join routers r on r.id = s.router_id
         where pay.tenant_id=$1 and pay.status='applied'
        union all
        select v.router_id, r.name as router_name,
               0 as pppoe_amount, 0 as pppoe_count, pay.amount as hotspot_amount, 1 as hotspot_count
          from payments pay
          join vouchers v on v.id = pay.voucher_id
          left join routers r on r.id = v.router_id
         where pay.tenant_id=$1 and pay.status='applied'
      ) x
     group by router_id, router_name
     order by total_amount desc`, [req.tenant.id]);
  res.json(rows);
}));

app.get('/api/invoices', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from invoices where tenant_id=$1 order by due_date desc limit 500', [req.tenant.id]);
  res.json(rows);
}));

/**
 * A "paid" invoice at creation is for recording something already settled —
 * a cash payment taken on-site, a historical invoice being backfilled — not
 * a new charge waiting to be collected. paid is set to the full amount
 * rather than left at 0, since a paid invoice showing "0 of 5000 paid"
 * would read as still owed everywhere the amount/paid pair is displayed.
 */
app.post('/api/invoices', wrap(async (req, res) => {
  const { subscriberId, amount, dueDate, reason, planId, paid } = req.body;
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Say what this invoice is for' });
  }
  const isPaid = !!paid;
  const { rows: [i] } = await pool.query(
    `insert into invoices (tenant_id, subscriber_id, plan_id, number, amount, paid, status, due_date, reason)
     values ($1, $2, $3,
             -- No random suffix, no dashes: INV + the date + a per-day
             -- sequence number, so two invoices raised the same day read as
             -- 001/002 rather than an unreadable hex tail nobody could ever
             -- read back over the phone.
             'INV' || to_char(now(),'YYMMDD') ||
               lpad((
                 select count(*) + 1 from invoices
                  where tenant_id=$1 and number like 'INV' || to_char(now(),'YYMMDD') || '%'
               )::text, 3, '0'),
             $4, $5, $6, $7, $8)
     returning *`,
    [req.tenant.id, subscriberId ?? null, planId ?? null, amount,
     isPaid ? amount : 0, isPaid ? 'paid' : 'open', dueDate, String(reason).trim()]);
  res.json(i);
}));

app.put('/api/invoices/:id', wrap(async (req, res) => {
  const { amount, dueDate, reason, status } = req.body;
  const { rows: [existing] } = await pool.query(
    'select * from invoices where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!existing) return res.status(404).json({ error: 'No such invoice' });
  if (status && !['open', 'partial', 'paid', 'void'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const { rows: [i] } = await pool.query(
    `update invoices set
       amount = coalesce($3, amount),
       due_date = coalesce($4, due_date),
       reason = coalesce(nullif($5, ''), reason),
       -- Marking an invoice paid by hand (a cash payment, a correction) sets
       -- paid to the full amount too — the same reasoning as create above,
       -- so status and the amount/paid pair never disagree with each other.
       paid = case when $6 = 'paid' then coalesce($3, amount) else paid end,
       status = coalesce(nullif($6, ''), status)
     where id=$1 and tenant_id=$2
     returning *`,
    [req.params.id, req.tenant.id, amount ?? null, dueDate ?? null, reason ?? '', status ?? '']);
  res.json(i);
}));

/**
 * Refused once a real payment has landed against it — deleting the invoice
 * would leave that payments row pointing at nothing, and the money already
 * collected with no record of what it was for. void the invoice instead
 * (PUT status=void) if it needs to stop counting toward what's owed.
 */
app.delete('/api/invoices/:id', wrap(async (req, res) => {
  const { rows: [existing] } = await pool.query(
    'select paid from invoices where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!existing) return res.status(404).json({ error: 'No such invoice' });
  if (Number(existing.paid) > 0) {
    return res.status(409).json({
      error: 'This invoice has a payment applied to it — void it instead of deleting, so that payment stays accounted for.',
    });
  }
  await pool.query('delete from invoices where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  res.json({ ok: true });
}));

/**
 * Cashier types in an M-Pesa code by hand, or pastes a statement line.
 * Goes through the same applyPayment funnel as the webhooks, so matching,
 * receipting and idempotency all behave identically.
 */
app.post('/api/payments/manual', requirePermission('payments.apply'), wrap(async (req, res) => {
  const { code, amount, phone, name, account } = req.body;
  if (!code || !amount) return res.status(400).json({ error: 'M-Pesa code and amount are required' });
  const { applyPayment } = await import('./payments/apply.js');
  const out = await applyPayment(req.tenant.id, {
    provider: 'manual_till',
    ref: String(code).trim().toUpperCase(),
    amount: Number(amount),
    phone: phone ? String(phone).replace(/^\+?(?:254)?0?/, '254') : null,
    name: name ?? null,
    rawAccount: account ?? null,
    payload: { source: 'manual', by: req.session?.email ?? 'unknown' },
  });
  res.json(out);
}));

/**
 * Push an STK prompt to a handset from the admin side.
 *
 * The outbound push works with nothing but credentials — the phone rings. The
 * *result* arrives on a webhook, so unless BASE_URL is publicly reachable the
 * request stays 'pending' forever and no payment is applied. We say so in the
 * response rather than letting that look like a failure.
 */
app.post('/api/payments/stk', wrap(async (req, res) => {
  const { provider = 'daraja', subscriberId, phone, amount, planId } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Enter an amount' });

  let msisdn = phone;
  let accountRef = req.body.accountRef;
  if (subscriberId) {
    const { rows: [s] } = await pool.query(
      'select phone, account_code from subscribers where tenant_id=$1 and id=$2',
      [req.tenant.id, subscriberId]);
    if (!s) return res.status(404).json({ error: 'subscriber not found' });
    msisdn = msisdn || s.phone;
    accountRef = accountRef || s.account_code;
  }
  if (!msisdn) return res.status(400).json({ error: 'No phone number to push to' });
  msisdn = String(msisdn).replace(/^\+?(?:254)?0?/, '254');

  const base = process.env.BASE_URL ?? '';
  const callbackReachable = /^https?:\/\//.test(base) && !/localhost|127\.0\.0\.1/.test(base);

  try {
    let checkoutId;
    if (provider === 'kopokopo') {
      const cfg = await import('./db.js').then((m) => m.config(req.tenant.id, 'kopokopo'));
      if (!cfg) return res.status(400).json({ error: 'No kopokopo gateway configured. Add one under Settings → Payment gateways.' });
      if (!planId) return res.status(400).json({ error: 'KopoKopo is hotspot-only — pick a hotspot bundle' });
      const kk = await import('./payments/kopokopo.js');
      checkoutId = await kk.stkPush(req.tenant.id, { phone: msisdn, amount: Number(amount), planId, mac: null, service: 'hotspot' });
    } else {
      // stkPushForSubscriber, not a direct mpesa.stkPush call — this route
      // used to require a Daraja gateway of this tenant's own even when
      // platform-collect was enabled and set up, the same fallback every
      // other charge on the platform (PPPoE renewal, the customer portal)
      // already gets. A tenant like this one, relying entirely on
      // platform-collect, could never charge a subscriber from here at all —
      // "No daraja gateway configured" on an account that was never meant to
      // need one.
      const r = await stkPushForSubscriber(req.tenant.id, {
        phone: msisdn, amount: Number(amount), accountCode: accountRef || 'TOPUP',
        description: 'Account top-up', purpose: { subscriber_id: subscriberId ?? null },
      });
      checkoutId = r.checkoutId;
      if (!checkoutId) return res.status(502).json({ error: 'Gateway did not return a checkout id' });
    }
    res.json({
      checkoutId,
      phone: msisdn,
      callbackReachable,
      note: callbackReachable
        ? 'Prompt sent. The result will arrive on the webhook.'
        : `Prompt sent, but BASE_URL is "${base || 'unset'}" so ${provider} cannot reach this server. The handset will show the prompt; the confirmation will not come back and the request stays pending.`,
    });
  } catch (e) {
    res.status(502).json({ error: e.response?.data?.errorMessage ?? e.message });
  }
}));

/** Poll an STK request the admin fired. */
app.get('/api/payments/stk/:checkoutId', wrap(async (req, res) => {
  const { rows: [r] } = await pool.query(
    'select checkout_id, provider, phone, amount, status, result_code, result_desc, created_at from stk_requests where tenant_id=$1 and checkout_id=$2',
    [req.tenant.id, req.params.checkoutId]);
  res.json(r ?? { status: 'unknown' });
}));

/** Paste a block of forwarded M-Pesa SMS; each parseable line is applied. */
app.post('/api/payments/reconcile', requirePermission('payments.apply'), wrap(async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Paste the statement text first' });
  const { parseMpesaSms } = await import('./payments/manual.js');
  const { applyPayment } = await import('./payments/apply.js');

  const results = { parsed: 0, applied: 0, unmatched: 0, duplicate: 0, skipped: 0 };
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tx = parseMpesaSms(line.trim());
    if (!tx) { results.skipped++; continue; }
    results.parsed++;
    const out = await applyPayment(req.tenant.id, { ...tx, provider: 'manual_till', payload: { sms: line } });
    if (out.duplicate) results.duplicate++;
    else if (out.unmatched) results.unmatched++;
    else if (out.applied) results.applied++;
  }
  res.json(results);
}));

/**
 * Push an M-Pesa STK prompt to a PPPoE customer's own phone, from the admin
 * side — for the customer who calls in to pay but has no working portal, or
 * an operator collecting on the spot.
 *
 * Daraja (paybill) only, deliberately — never KopoKopo. KopoKopo is gated
 * to hotspot everywhere else in this codebase (the till-based flow, the
 * settings screen's own "hotspot only" note, the database's
 * kopokopo_hotspot_only constraint); this is the same rule applied to the
 * one place a PPPoE STK push is actually initiated by staff rather than
 * the customer's own payment-method choice.
 */
app.post('/api/subscribers/:id/stk', wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    `select s.name, s.phone, s.account_code, p.price as plan_price
       from subscribers s left join plans p on p.id = s.plan_id
      where s.id=$1 and s.tenant_id=$2`, [req.params.id, req.tenant.id]);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (!s.phone) return res.status(400).json({ error: 'This customer has no phone number on file.' });

  const amount = Number(req.body?.amount) || Number(s.plan_price);
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount, or set a plan for this customer first.' });

  try {
    const { checkoutId } = await stkPushForSubscriber(req.tenant.id, {
      phone: mpesa.normalise(s.phone), amount, accountCode: s.account_code,
      description: `${s.name} — ${s.account_code}`,
      purpose: { subscriber_id: req.params.id },
    });
    res.json({ ok: true, phone: s.phone, amount, checkoutId });
  } catch (e) {
    res.status(502).json({ error: e.response?.data?.errorMessage ?? e.message });
  }
}));

/** Give affected subscribers free days back after an outage. */
app.post('/api/subscribers/compensate', wrap(async (req, res) => {
  const { ids = [], days = 1 } = req.body;
  if (!ids.length) return res.status(400).json({ error: 'no subscribers selected' });
  const { rows } = await pool.query(
    `update subscribers
       set expires_at = greatest(coalesce(expires_at, now()), now()) + ($3 || ' days')::interval
     where tenant_id=$1 and id = any($2::uuid[])
     returning id, name, expires_at, account_code`,
    [req.tenant.id, ids, String(Number(days) || 1)]);
  const n = Number(days) || 1;
  for (const r of rows) await logActivity(req, r.id, r.account_code, 'Extended', `${n} day${n === 1 ? '' : 's'}`);
  res.json({ compensated: rows.length, days: n, rows });
}));

/** Report which required credentials a payment channel is still missing. */
app.post('/api/payment-methods/:provider/test', requireRole('owner'), wrap(async (req, res) => {
  const required = {
    daraja: ['consumer_key', 'consumer_secret', 'passkey'],
    kopokopo: ['client_id', 'client_secret'],
    bankstk: ['bank', 'account', 'token'],
    manual_till: [],
  }[req.params.provider];
  if (!required) return res.status(400).json({ error: 'unknown channel' });

  const { rows: [cfg] } = await pool.query(
    // A tenant can hold more than one gateway per provider now (e.g. an
    // ordinary Daraja paybill plus a dedicated platform-collect one) — this
    // tests the default, same as config() would pick for an ordinary charge.
    'select shortcode, credentials from tenant_payment_config where tenant_id=$1 and provider=$2 order by is_default desc, id limit 1',
    [req.tenant.id, req.params.provider]);
  if (!cfg) return res.status(404).json({ error: 'Not configured yet — save credentials first.' });

  const creds = cfg.credentials ?? {};
  const missing = required.filter((k) => !String(creds[k] ?? '').trim());
  if (!cfg.shortcode) missing.unshift('shortcode');
  if (missing.length) {
    return res.json({ ok: false, shortcode: cfg.shortcode, missing, note: 'Incomplete configuration' });
  }

  /**
   * Fields being present is not the same as Safaricom/KopoKopo accepting
   * them — this used to be the whole test, and a paybill could show
   * "complete" for weeks with consumer credentials that were simply wrong,
   * only surfacing at Register URLs with a bare "Invalid Access Token" and
   * no earlier warning. An OAuth token request costs nothing and touches no
   * real customer, unlike an STK push, so it is safe to do live here.
   */
  if (req.params.provider === 'daraja' || req.params.provider === 'kopokopo') {
    const mod = req.params.provider === 'daraja' ? mpesa : kk;
    const auth = await mod.testAuth(req.tenant.id);
    return res.json({
      ok: auth.ok, shortcode: cfg.shortcode, missing: [],
      note: auth.ok ? 'Credentials accepted' : `Safaricom/KopoKopo rejected these credentials: ${JSON.stringify(auth.error)}`,
    });
  }

  res.json({ ok: true, shortcode: cfg.shortcode, missing: [], note: 'All required credentials present' });
}));

app.get('/api/settlements', requirePermission('payments.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from settlements where tenant_id=$1 order by created_at desc', [req.tenant.id]);
  res.json(rows);
}));

/**
 * On-demand payout, instead of waiting for the 2am settleTenants sweep — see
 * jobs.js's payoutTenantNow for the actual B2C call and its failure modes
 * (nothing pending, below the KES 100 minimum, no settlement_phone set, or
 * the platform payout account missing). Those all come back as a normal
 * 400/503 with a message meant to be shown directly, not logged.
 */
app.post('/api/settlements/payout', requirePermission('payments.request_payout'), wrap(async (req, res) => {
  try {
    const result = await payoutTenantNow(req.tenant.id);
    res.json(result);
  } catch (e) {
    // This catch previously swallowed everything silently — a failed payout
    // showed up only in the browser's response body, nowhere in server logs,
    // which is exactly the gap that made a real Safaricom rejection here
    // indistinguishable from a session/auth problem without opening
    // DevTools. e.response?.data carries Safaricom's own error body when
    // this came from an axios call (b2c()), which e.message alone does not.
    console.error('POST /api/settlements/payout →', req.tenant.id, e.status ?? 500, e.message,
      e.response?.data ? JSON.stringify(e.response.data) : '');
    res.status(e.status ?? 500).json({ error: e.message });
  }
}));

// ── catalogue: plans and tariffs ──────────────────
app.get('/api/plans', requirePermission('tariffs.view'), wrap(async (req, res) => {
  const { service } = req.query;
  const { rows } = await pool.query(
    `select * from plans where tenant_id=$1 and active ${service ? 'and service=$2' : ''} order by price`,
    service ? [req.tenant.id, service] : [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/plans', requirePermission('tariffs.create'), wrap(async (req, res) => {
  const { service = 'hotspot', title, price: p, durationMin, devices = 1,
          rateDown, rateUp, dataCapMb, radiusProfile } = req.body;
  const { rows: [row] } = await pool.query(
    `insert into plans (tenant_id, service, title, price, duration_min, devices,
       rate_down, rate_up, data_cap_mb, radius_profile)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [req.tenant.id, service, title, p, durationMin, devices,
     rateDown ?? 0, rateUp ?? 0, dataCapMb ?? null, radiusProfile ?? `${service}-${title}`]);
  res.json(row);
}));

app.put('/api/plans/:id', requirePermission('tariffs.edit'), wrap(async (req, res) => {
  const { title, price: p, durationMin, devices, rateDown, rateUp, dataCapMb } = req.body ?? {};
  const { rows: [row] } = await pool.query(
    `update plans set
       title        = coalesce(nullif($3,''), title),
       price        = coalesce($4, price),
       duration_min = coalesce($5, duration_min),
       devices      = coalesce($6, devices),
       rate_down    = coalesce($7, rate_down),
       rate_up      = coalesce($8, rate_up),
       -- Explicit null clears the cap, so distinguish "not sent" from "cleared".
       data_cap_mb  = case when $9::text = 'keep' then data_cap_mb else $10::bigint end,
       updated_at   = now()
     where id=$1 and tenant_id=$2 returning *`,
    [req.params.id, req.tenant.id, title ?? '', p ?? null, durationMin ?? null,
     devices ?? null, rateDown ?? null, rateUp ?? null,
     dataCapMb === undefined ? 'keep' : 'set', dataCapMb ?? null]);
  if (!row) return res.status(404).json({ error: 'No such plan' });
  res.json(row);
}));

/**
 * Delete a plan for real, or say precisely why it cannot go.
 *
 * This flipped `active=false` and answered ok. The plan left the list, so it
 * looked deleted, and the row stayed in the database for ever — which is not
 * what anybody pressing Delete believes is happening.
 *
 * Three things reference a plan, and they are not equal. Customers on it are
 * the operator's to move, so refuse and say how many. Invoices and vouchers are
 * records of money: deleting the plan would blank the plan on a bill that was
 * already sent. That row has to stay, and the honest thing is to say so rather
 * than either lying about a delete or destroying a receipt.
 */
app.delete('/api/plans/:id', requirePermission('tariffs.delete'), wrap(async (req, res) => {
  const { rows: [p] } = await pool.query(
    'select id, title from plans where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!p) return res.status(404).json({ error: 'No such plan' });

  const { rows: [use] } = await pool.query(`
    select (select count(*) from subscribers where tenant_id=$1 and plan_id=$2)::int subs,
           (select count(*) from vouchers    where tenant_id=$1 and plan_id=$2)::int vouchers,
           (select count(*) from invoices    where tenant_id=$1 and plan_id=$2)::int invoices`,
    [req.tenant.id, p.id]);

  if (use.subs) {
    return res.status(409).json({
      error: `${use.subs} client${use.subs === 1 ? ' is' : 's are'} on "${p.title}". Move them to `
        + 'another plan first, then delete it.',
    });
  }

  if (use.invoices || use.vouchers) {
    // Kept, and said so. Hiding it and reporting success is how the operator
    // ends up believing the database is smaller than it is.
    await pool.query('update plans set active=false where tenant_id=$1 and id=$2',
      [req.tenant.id, p.id]);
    return res.json({
      ok: true,
      kept: true,
      message: `"${p.title}" is off the list, but the record itself has to stay: it is named on `
        + `${use.invoices} invoice${use.invoices === 1 ? '' : 's'} and ${use.vouchers} `
        + `voucher${use.vouchers === 1 ? '' : 's'}. Deleting it would blank the plan on bills `
        + 'that have already been issued.',
    });
  }

  const { rowCount } = await pool.query(
    'delete from plans where tenant_id=$1 and id=$2', [req.tenant.id, p.id]);
  if (!rowCount) return res.status(409).json({ error: 'The plan could not be deleted' });
  res.json({ ok: true, deleted: 1 });
}));

app.put('/api/tariffs/:id', requirePermission('tariffs.edit'), wrap(async (req, res) => {
  const { title, price: p, speedDown, speedUp, fairUse } = req.body;
  const { rows: [t] } = await pool.query(
    `update tariffs set title=coalesce($3,title), price=coalesce($4,price),
       speed_down=coalesce($5,speed_down), speed_up=coalesce($6,speed_up), fair_use=$7
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, title ?? null, p ?? null, speedDown ?? null, speedUp ?? null, fairUse ?? null]);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
}));

// Deleted, not deactivated. Nothing in the schema references a tariff, so
// there is no history to protect and no reason to keep a row the operator has
// asked to be rid of. It used to flip `active=false`, which emptied the screen
// and left the row behind forever.
app.delete('/api/tariffs/:id', requirePermission('tariffs.delete'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    'delete from tariffs where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'No such tariff' });
  res.json({ ok: true, deleted: rowCount });
}));

// ── vouchers (Hotspot -> Vouchers) ────────────────
/**
 * status='in_use' means a voucher's clock has started and it has not yet
 * expired — a customer who is "active," in the sense of having paid and
 * still being entitled to connect. It says nothing about whether they are
 * connected *right now*: a guest who walked off with a live voucher still
 * reads in_use for the rest of its duration. The Hotspot dashboard's "Live
 * sessions" table used in_use as a proxy for online, so an operator saw
 * every currently-valid code as "connected," not only the ones actually on
 * the network — the same distinction /api/subscribers already draws
 * between an active subscription and being online, applied here the same
 * way: radacct for an open, recently-updated session, live_sessions for
 * what a router answered when last asked.
 */
app.get('/api/vouchers', requirePermission('hotspot.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    select v.*,
           /**
            * A device added through "Adding a TV or console?" never touches
            * RADIUS at all — it is a static ip-binding on the router, not a
            * hotspot login, so radacct and live_sessions (both keyed on the
            * code as a RADIUS username) never see it and it always read as
            * offline here despite genuinely having a live, working
            * connection. There is no traffic-based signal available for an
            * ip-bound device without polling its router on every list load,
            * so this treats "bound, and the voucher itself is still valid"
            * as the online signal for that case — which is the honest
            * answer to what an operator actually wants to know: is this
            * customer's access currently live, not literally "sent a packet
            * in the last few minutes."
            */
           (a.framedipaddress is not null or live.username is not null
             or (dev.mac is not null and v.status = 'in_use'
                 and (v.expires_at is null or v.expires_at > now()))) as online,
           dev.mac as device_mac, dev.label as device_label,
           -- Which bundle this code actually was, and at what speed — a
           -- voucher only ever carried plan_id, an id an operator cannot
           -- read, so the table had no way to say what somebody bought.
           p.title as plan_title, p.rate_down, p.rate_up,
           -- The M-Pesa/KopoKopo reference that paid for this code, for the
           -- same reason a receipt names the transaction it came from.
           pay.provider_ref as mpesa_ref, pay.provider as pay_provider
      from vouchers v
      left join plans p on p.id = v.plan_id
      left join payments pay on pay.voucher_id = v.id
      left join lateral (
        select framedipaddress from radacct
         where username = v.code
           and acctstoptime is null
           and coalesce(acctupdatetime, acctstarttime) > now() - interval '15 minutes'
         order by acctstarttime desc limit 1) a on true
      left join lateral (
        select username from live_sessions
         where tenant_id = v.tenant_id and username = v.code
           and seen_at > now() - interval '5 minutes') live on true
      left join lateral (
        select mac, label from voucher_devices where voucher_id = v.id
         order by added_at desc limit 1) dev on true
     where v.tenant_id=$1
     order by v.created_at desc
     limit 1000`, [req.tenant.id]);
  res.json(rows);
}));

/** Generate a batch by hand — the usual path is a payment landing in apply.js. */
app.post('/api/vouchers', requirePermission('hotspot.vouchers'), wrap(async (req, res) => {
  const { planId, count = 1, batch } = req.body;
  const { issueVoucherAccess } = await import('./radius.js');
  const { withTenant } = await import('./db.js');
  const made = await withTenant(req.tenant.id, async (c) => {
    const out = [];
    for (let i = 0; i < Math.min(Number(count) || 1, 500); i++) {
      const v = await issueVoucherAccess(c, req.tenant.id, planId, null, null);
      if (batch) await c.query('update vouchers set batch=$2 where id=$1', [v.id, batch]);
      out.push(v);
    }
    return out;
  });
  res.json(made);
}));

/**
 * Delete vouchers, and the access they carry.
 *
 * A voucher's code is a RADIUS username: issuing one writes radcheck and
 * radreply rows keyed by the code. Deleting only the voucher row left those
 * behind, so the code still authenticated — the voucher was gone from every
 * screen and the guest holding it stayed online indefinitely, with nothing in
 * the UI to explain who they were.
 *
 * The codes have to be read before the rows go, because afterwards there is
 * nothing left to say which credentials belonged to them.
 */
app.post('/api/vouchers/delete', requirePermission('hotspot.delete'), wrap(async (req, res) => {
  const { ids = [] } = req.body;
  const { rows: doomed } = await pool.query(
    'select code from vouchers where tenant_id=$1 and id = any($2::uuid[])', [req.tenant.id, ids]);

  const { rowCount } = await pool.query(
    'delete from vouchers where tenant_id=$1 and id = any($2::uuid[])', [req.tenant.id, ids]);

  const { forgetVoucherAccess } = await import('./radius.js');
  const revoked = await forgetVoucherAccess(pool, doomed.map((v) => v.code), req.tenant.id);
  res.json({ deleted: rowCount, revoked });
}));

app.post('/api/vouchers/purge-expired', requirePermission('hotspot.delete'), wrap(async (req, res) => {
  const { rows: doomed } = await pool.query(
    "select code from vouchers where tenant_id=$1 and status='expired'", [req.tenant.id]);
  const { rowCount } = await pool.query(
    "delete from vouchers where tenant_id=$1 and status='expired'", [req.tenant.id]);
  const { forgetVoucherAccess } = await import('./radius.js');
  const revoked = await forgetVoucherAccess(pool, doomed.map((v) => v.code), req.tenant.id);
  res.json({ deleted: rowCount, revoked });
}));

// ── staff (Staff & roles) ─────────────────────────
app.get('/api/staff', wrap(async (req, res) => {
  const { role } = req.query;
  // platform_admin is our own standing maintenance login — never shown to the tenant.
  // Never password_hash either — nothing on this screen has a use for it,
  // and there's no reason to put a password hash on the wire on every load.
  const { rows } = await pool.query(
    `select id, tenant_id, name, phone, email, role, username, last_seen, is_super_admin
       from staff where tenant_id=$1 and role<>'platform_admin' ${role ? 'and role=$2' : ''} order by name`,
    role ? [req.tenant.id, role] : [req.tenant.id]);
  res.json(rows);
}));

/**
 * Invite a new staff member — a plain insert, never an update.
 *
 * This used to upsert on (tenant_id, phone): a phone number that collided
 * with an *existing* staff member's — including, once, the tenant's own
 * owner account — silently overwrote that person's name, email and role
 * with whatever the new invite typed in, rather than creating a second
 * row. There is no legitimate "re-invite to update someone" flow in the
 * product that ever relied on that (createStaff is only ever called from
 * the invite form, never as an edit) — it was pure risk with nothing to
 * show for it. A collision on phone, email or username is now rejected
 * outright, by name, before anything is written.
 */
app.post('/api/staff', requirePermission('staff.create'), wrap(async (req, res) => {
  const { name, phone, email, role = 'support' } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });

  const { rows: [phoneClash] } = await pool.query(
    'select name from staff where tenant_id=$1 and phone=$2', [req.tenant.id, phone]);
  if (phoneClash) return res.status(409).json({ error: `${phoneClash.name} already uses that phone number.` });

  if (email) {
    const { rows: [emailClash] } = await pool.query(
      'select name from staff where lower(email)=lower($1)', [email]);
    if (emailClash) return res.status(409).json({ error: `${emailClash.name} already uses that email address.` });
  }

  let s;
  try {
    ({ rows: [s] } = await pool.query(
      `insert into staff (tenant_id, name, phone, email, role) values ($1,$2,$3,$4,$5) returning *`,
      [req.tenant.id, name, phone, email ?? null, role]));
  } catch (e) {
    // The pre-checks above cover the common case; this is the race-condition
    // backstop for two invites landing at the same instant.
    if (e.code === '23505') return res.status(409).json({ error: 'That phone number, email or username is already in use.' });
    throw e;
  }

  // The row existing was previously the whole "invite" — nothing was ever
  // sent to the person it names, so they had no password, no username, and
  // no way to discover either fact short of being told by hand. SMS always
  // (phone is the one field this route actually requires); email too if
  // one was given. Best-effort: the account is real either way, and a
  // delivery hiccup shouldn't fail the invite itself.
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  const brand = req.tenant.name || 'Vibelink';
  auth.createLoginToken(s.id, 'invite').then(async (token) => {
    const link = `https://${req.tenant.subdomain}.${root}/accept-invite?token=${token}`;
    const sms = await import('./sms.js');
    await sms.send(req.tenant.id, s.phone, 'custom',
      { body: `You've been added to ${brand}'s team. Set up your login: ${link} (valid 3 days)` }).catch(() => {});
    if (s.email) {
      const email = await import('./email.js');
      await email.sendSystem(req.tenant.id, s.email, `You've been invited to ${brand}`,
        `Set up your login: ${link}\n\nThis link expires in 3 days. If this wasn't expected, ignore it.`).catch(() => {});
    }
  }).catch(() => {});

  res.json(s);
}));

/**
 * Edit an existing staff member — name, phone, email, username, role.
 *
 * Same collision safety as the invite route, checked against every other
 * row (not itself), and the same protection the delete route already has
 * against an owner's role being changed by anyone but the platform owner —
 * this is exactly the gap a colliding invite exploited by accident once
 * already (see the comment on the invite route above), so an edit gets the
 * same guard rather than reopening it through a different door.
 */
app.put('/api/staff/:id', requirePermission('staff.edit'), wrap(async (req, res) => {
  const { name, phone, email, username, role } = req.body;

  const { rows: [target] } = await pool.query(
    'select * from staff where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!target) return res.status(404).json({ error: 'No such member of staff' });

  if ((target.role === 'owner' || target.role === 'platform_admin') && role && role !== target.role && !req.session.is_super_admin) {
    return res.status(403).json({ error: "Only the platform owner can change an owner's role." });
  }

  if (phone && phone !== target.phone) {
    const { rows: [clash] } = await pool.query(
      'select name from staff where tenant_id=$1 and phone=$2 and id<>$3', [req.tenant.id, phone, target.id]);
    if (clash) return res.status(409).json({ error: `${clash.name} already uses that phone number.` });
  }
  if (email !== undefined && email && email.toLowerCase() !== (target.email ?? '').toLowerCase()) {
    const { rows: [clash] } = await pool.query(
      'select name from staff where lower(email)=lower($1) and id<>$2', [email, target.id]);
    if (clash) return res.status(409).json({ error: `${clash.name} already uses that email address.` });
  }
  if (username !== undefined && username && username.toLowerCase() !== (target.username ?? '').toLowerCase()) {
    const { rows: [clash] } = await pool.query(
      'select name from staff where lower(username)=lower($1) and id<>$2', [username, target.id]);
    if (clash) return res.status(409).json({ error: `${clash.name} already uses that username.` });
  }

  try {
    const { rows: [updated] } = await pool.query(
      `update staff set
         name = coalesce($3, name),
         phone = coalesce($4, phone),
         email = $5,
         username = $6,
         role = coalesce($7, role)
       where id=$1 and tenant_id=$2
       returning id, tenant_id, name, phone, email, role, username, last_seen, is_super_admin`,
      [req.params.id, req.tenant.id, name?.trim() || null, phone?.trim() || null,
       email !== undefined ? (email?.trim() || null) : target.email,
       username !== undefined ? (username?.trim() || null) : target.username,
       role || null]);
    res.json(updated);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That phone number, email or username is already in use.' });
    throw e;
  }
}));

/**
 * The permission matrix Staff -> "Roles & permissions" edits. Previously a
 * local useState with nothing to load from or save to — every checkbox
 * there was decoration, and no route anywhere checked a role against it.
 * requirePermission() (permissions.js), now applied to a first real set of
 * routes, is what makes a checkbox here actually do something.
 */
app.get('/api/permissions', requirePermission('staff.view'), wrap(async (req, res) => {
  res.json({ matrix: await loadPermissions(req.tenant.id), meta: PERMISSION_META });
}));

app.put('/api/permissions', requirePermission('staff.manage_permissions'), wrap(async (req, res) => {
  const matrix = req.body?.matrix;
  if (!matrix || typeof matrix !== 'object') return res.status(400).json({ error: 'matrix is required' });
  await savePermissions(req.tenant.id, matrix);
  res.json({ matrix: await loadPermissions(req.tenant.id) });
}));

app.delete('/api/staff/:id', requirePermission('staff.delete'), wrap(async (req, res) => {
  // Never your own login. An owner who deletes it locks the tenant out of its
  // own portal, and the only way back is through us — nothing the person who
  // did it can undo. Refused rather than confirmed.
  if (req.params.id === req.session.staff_id) {
    return res.status(409).json({ error: 'You cannot delete your own login. Ask a colleague to do it.' });
  }

  const { rows: [target] } = await pool.query(
    'select role from staff where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!target) return res.status(404).json({ error: 'No such member of staff' });

  /**
   * The owner login is not another member of staff's to remove.
   *
   * Every other role can be deleted by an owner running their own team, but an
   * owner account is the tenant's root of access — the one login the platform
   * relies on to reach them at all if something goes wrong. Letting any other
   * staff account delete it, even another owner, turns one compromised or
   * disgruntled login into a tenant that has locked itself out. Only the
   * platform owner, who can also reissue it, may remove one.
   */
  if ((target.role === 'owner' || target.role === 'platform_admin') && !req.session.is_super_admin) {
    return res.status(403).json({
      error: 'Only the platform owner can remove an owner login. Contact support if this account needs to go.',
    });
  }

  const { rowCount } = await pool.query(
    'delete from staff where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'No such member of staff' });
  res.json({ ok: true });
}));

// ── tickets and leads: status changes ─────────────
app.patch('/api/tickets/:id', requirePermission('tickets.edit'), wrap(async (req, res) => {
  const allowed = ['status', 'priority', 'assigned_to', 'subject', 'description', 'due_at'];
  const sets = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  // Pushing the deadline out (or reopening a ticket) after checkSlaBreaches
  // already fired should let a genuinely new breach notify again, rather
  // than staying silently suppressed by a flag from before the edit.
  const resetNotified = sets.includes('due_at') || sets.includes('status');
  const { rows: [t] } = await pool.query(
    `update tickets set ${sets.map((k, i) => `${k}=$${i + 3}`).join(', ')}, updated_at=now()
     ${resetNotified ? ', sla_breach_notified=false' : ''}
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, ...sets.map((k) => req.body[k])]);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
}));

app.delete('/api/tickets/:id', requirePermission('tickets.delete'), wrap(async (req, res) => {
  await pool.query('delete from tickets where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

/**
 * One click for a plan-change-request ticket: apply the requested plan,
 * resolve the ticket, and assign it to whoever approved it — the standard
 * shape for this kind of request (see the ITSM/telecom change-workflow
 * research this was built from): the approver becomes the owner of record,
 * and approving is the same action as resolving rather than two separate
 * steps someone can forget the second half of.
 *
 * Refuses anything that isn't actually a pending plan-change request —
 * requested_plan_id is only ever set by /portal/request-plan-change, so a
 * ticket without one has nothing here to safely apply.
 */
app.post('/api/tickets/:id/approve-plan-change', wrap(async (req, res) => {
  const { rows: [t] } = await pool.query(
    'select * from tickets where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!t) return res.status(404).json({ error: 'No such ticket' });
  if (!t.requested_plan_id) return res.status(400).json({ error: 'This ticket has no plan change to approve.' });
  if (!t.subscriber_id) return res.status(400).json({ error: 'This ticket has no client attached.' });
  if (t.status === 'resolved') return res.status(409).json({ error: 'Already resolved.' });

  const { rows: [plan] } = await pool.query(
    'select id, title from plans where id=$1 and tenant_id=$2', [t.requested_plan_id, req.tenant.id]);
  if (!plan) return res.status(404).json({ error: 'That plan no longer exists.' });

  const { rows: [sub] } = await pool.query(
    'update subscribers set plan_id=$1 where id=$2 and tenant_id=$3 returning pppoe_user',
    [plan.id, t.subscriber_id, req.tenant.id]);
  if (!sub) return res.status(404).json({ error: 'That client no longer exists.' });

  // Same as PATCH /api/subscribers/:id's own plan_id handling — the rate
  // limit lives in radreply and does not move on its own.
  if (sub.pppoe_user) {
    const radius = await import('./radius.js');
    await radius.syncSubscriberCredentials(pool, req.tenant.id, t.subscriber_id)
      .catch((e) => console.warn('approve-plan-change: radius not updated —', e?.message ?? e));
  }

  const { rows: [updated] } = await pool.query(
    `update tickets set status='resolved', assigned_to=$3, updated_at=now()
      where id=$1 and tenant_id=$2 returning *`,
    [req.params.id, req.tenant.id, req.session.staff_id]);
  await pool.query(
    `insert into ticket_notes (tenant_id, ticket_id, author, body, internal)
     values ($1,$2,$3,$4,false)`,
    [req.tenant.id, req.params.id, req.session.name ?? 'Support',
     `Approved — switched to ${plan.title}.`]);

  res.json(updated);
}));

app.patch('/api/leads/:id', requirePermission('leads.edit'), wrap(async (req, res) => {
  // referred_by_client_id is not a real column — resolved to a referrer_id
  // (finding or creating a customer-type referrer for that subscriber, same
  // as the create route) before it ever reaches the update below.
  if (req.body.referred_by_client_id) {
    const { rowCount } = await pool.query(
      'select 1 from subscribers where id=$1 and tenant_id=$2', [req.body.referred_by_client_id, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such client' });
    req.body.referrer_id = await referrerForSubscriber(req.tenant.id, req.body.referred_by_client_id);
  }

  const allowed = ['status', 'name', 'phone', 'source', 'referrer_id', 'assigned_to', 'next_follow_up'];
  const sets = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });

  if (sets.includes('referrer_id') && req.body.referrer_id) {
    const { rowCount } = await pool.query(
      'select 1 from referrers where id=$1 and tenant_id=$2', [req.body.referrer_id, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such referrer' });
  }
  if (sets.includes('assigned_to') && req.body.assigned_to) {
    const { rowCount } = await pool.query(
      'select 1 from staff where id=$1 and tenant_id=$2', [req.body.assigned_to, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'No such staff member' });
  }

  /**
   * Winning a lead with nobody named as its referrer, but a staff member
   * chasing it, credits that staff member instead — closing a lead is, in
   * every way this system already tracks compensation, indistinguishable
   * from being the reason the customer signed up. Only when there is
   * genuinely no referrer already: an actual named referrer (a customer
   * sending a friend, an outside party) always wins over the sales rep who
   * happened to be assigned, since that relationship was explicit and this
   * one is inferred.
   */
  if (req.body.status === 'won' && !sets.includes('referrer_id')) {
    const { rows: [current] } = await pool.query(
      'select referrer_id, assigned_to from leads where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
    const staffId = req.body.assigned_to ?? current?.assigned_to;
    if (current && !current.referrer_id && staffId) {
      req.body.referrer_id = await referrerForStaff(req.tenant.id, staffId);
      sets.push('referrer_id');
    }
  }

  const { rows: [l] } = await pool.query(
    `update leads set ${sets.map((k, i) => `${k}=$${i + 3}`).join(', ')}
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, ...sets.map((k) => req.body[k])]);
  if (!l) return res.status(404).json({ error: 'not found' });
  res.json(l);
}));

app.delete('/api/leads/:id', requirePermission('leads.delete'), wrap(async (req, res) => {
  await pool.query('delete from leads where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

// ── service outages ───────────────────────────────
app.get('/api/outages', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select o.*, r.name as router_name from outages o
     left join routers r on r.id = o.router_id
     where o.tenant_id=$1 order by o.started_at desc`, [req.tenant.id]);
  res.json(rows);
}));

/** Declaring an outage also SMSes every subscriber on the affected router. */
app.post('/api/outages', wrap(async (req, res) => {
  const { site, routerId, cause, eta, note } = req.body;
  if (!site) return res.status(400).json({ error: 'site is required' });
  const { rows: [o] } = await pool.query(
    `insert into outages (tenant_id, site, router_id, cause, eta, note)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.tenant.id, site, routerId ?? null, cause ?? null, eta ?? null, note ?? null]);
  res.json(o);

  if (routerId) {
    const { send } = await import('./sms.js');
    const { rows: affected } = await pool.query(
      "select distinct phone from subscribers where tenant_id=$1 and router_id=$2 and status in ('active','grace') and phone is not null",
      [req.tenant.id, routerId]);
    for (const s of affected) {
      await send(req.tenant.id, s.phone, 'outage', { site, eta: eta ?? 'shortly' }).catch(() => {});
    }
  }
}));

app.patch('/api/outages/:id', wrap(async (req, res) => {
  const { status } = req.body;
  const { rows: [o] } = await pool.query(
    `update outages set status=$3, resolved_at = case when $3='resolved' then now() else null end
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, status ?? 'resolved']);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
}));

// ── SLA policies ──────────────────────────────────
app.get('/api/sla-policies', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from sla_policies where tenant_id=$1 order by name', [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/sla-policies', wrap(async (req, res) => {
  const { name, priority = 'high', respondMins = 60, resolveMins = 480, uptime = 99.5 } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows: [p] } = await pool.query(
    `insert into sla_policies (tenant_id, name, priority, respond_mins, resolve_mins, uptime)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (tenant_id, name) do update set priority=excluded.priority,
       respond_mins=excluded.respond_mins, resolve_mins=excluded.resolve_mins, uptime=excluded.uptime
     returning *`,
    [req.tenant.id, name, priority, respondMins, resolveMins, uptime]);
  res.json(p);
}));

app.delete('/api/sla-policies/:id', wrap(async (req, res) => {
  await pool.query('delete from sla_policies where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

// ── knowledge base ────────────────────────────────
app.get('/api/kb-articles', requirePermission('kb.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from kb_articles where tenant_id=$1 order by updated_at desc', [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/kb-articles', requirePermission('kb.edit'), wrap(async (req, res) => {
  const { title, category, body = '', published = true } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const { rows: [a] } = await pool.query(
    `insert into kb_articles (tenant_id, title, category, body, published)
     values ($1,$2,$3,$4,$5) returning *`,
    [req.tenant.id, title, category ?? null, body, published]);
  res.json(a);
}));

/**
 * Edit an article.
 *
 * There was create and delete and nothing in between, so correcting a typo
 * meant deleting the article and writing it again — losing its id, and with it
 * any link a customer or the support bot had to it.
 */
app.put('/api/kb-articles/:id', requirePermission('kb.edit'), wrap(async (req, res) => {
  const { title, category, body, published } = req.body ?? {};
  const { rows: [a] } = await pool.query(
    `update kb_articles set
       title     = coalesce(nullif($3,''), title),
       category  = coalesce(nullif($4,''), category),
       body      = coalesce($5, body),
       published = coalesce($6, published)
     where id=$1 and tenant_id=$2 returning *`,
    [req.params.id, req.tenant.id, title ?? '', category ?? '', body ?? null,
     typeof published === 'boolean' ? published : null]);
  if (!a) return res.status(404).json({ error: 'No such article' });
  res.json(a);
}));

app.delete('/api/kb-articles/:id', requirePermission('kb.delete'), wrap(async (req, res) => {
  await pool.query('delete from kb_articles where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

// ── site payment profiles ─────────────────────────
app.get('/api/site-profiles', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select p.*, r.name as router_name from site_profiles p
     left join routers r on r.id = p.router_id
     where p.tenant_id=$1 order by p.site`, [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/site-profiles', wrap(async (req, res) => {
  const { site, routerId, provider, shortcode, accountPrefix } = req.body;
  if (!site || !shortcode) return res.status(400).json({ error: 'site and shortcode are required' });
  const { rows: [p] } = await pool.query(
    `insert into site_profiles (tenant_id, site, router_id, provider, shortcode, account_prefix)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (tenant_id, site) do update set router_id=excluded.router_id,
       provider=excluded.provider, shortcode=excluded.shortcode, account_prefix=excluded.account_prefix
     returning *`,
    [req.tenant.id, site, routerId ?? null, provider ?? 'daraja', shortcode, accountPrefix ?? null]);
  res.json(p);
}));

app.delete('/api/site-profiles/:id', wrap(async (req, res) => {
  await pool.query('delete from site_profiles where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

// ── payment credentials (Payment methods screen) ──
app.put('/api/payment-methods/:provider', requirePermission('payments.edit'), wrap(async (req, res) => {
  const { shortcode, credentials = {}, enabledPppoe = false, enabledHotspot = false } = req.body;
  if (req.params.provider === 'kopokopo' && enabledPppoe)
    return res.status(400).json({ error: 'KopoKopo is hotspot-only' });
  await pool.query(
    `insert into tenant_payment_config (tenant_id, provider, shortcode, credentials, enabled_pppoe, enabled_hotspot)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (tenant_id, provider) do update set shortcode=excluded.shortcode,
       credentials=excluded.credentials, enabled_pppoe=excluded.enabled_pppoe,
       enabled_hotspot=excluded.enabled_hotspot`,
    [req.tenant.id, req.params.provider, shortcode ?? null, credentials, enabledPppoe, enabledHotspot]);
  res.json({ ok: true });
}));

// ── OVPN clients (Routers screen) ─────────────────
/**
 * Tunnel credentials, and whether each one is carrying a router right now.
 *
 * "In use by" was worked out by matching the credential's address against the
 * NAS address of a router row, so a credential the app had not been told about
 * was labelled "no router — safe to revoke". That label was wrong in the one
 * case where it matters: a router dialling in on that very credential, right
 * then, whose row in the app happens to point at a different address. Pressing
 * Revoke there cuts the live tunnel and the router cannot be reached to fix it.
 *
 * The OpenVPN status file says which addresses are actually connected. That is
 * the fact, and it beats an inference drawn from a row someone typed.
 */
app.get('/api/ovpn-clients', wrap(async (req, res) => {
  const { liveTunnels } = await import('./tunnel.js');
  const { rows } = await pool.query(
    'select id, username, assigned_ip, connected_at, created_at from ovpn_clients where tenant_id=$1 order by username',
    [req.tenant.id]);

  let connected = new Set();
  try {
    connected = new Set((await liveTunnels()).map((t) => t.address));
  } catch {
    // No status file yet, or unreadable. Better to show the list without the
    // live column than to fail the whole screen over a diagnostic.
  }

  res.json(rows.map((r) => ({
    ...r,
    connectedNow: connected.has(String(r.assigned_ip).split('/')[0]),
  })));
}));

// ── SMS history and bulk send (Messaging screen) ──
app.get('/api/sms/history', requirePermission('messaging.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from sms_log where tenant_id=$1 order by at desc limit 500', [req.tenant.id]);
  res.json(rows);
}));

/** Send one SMS to an arbitrary number — voucher resends, one-off notices. */
app.post('/api/sms/send', requirePermission('messaging.send'), wrap(async (req, res) => {
  const { phone, body } = req.body;
  if (!phone || !body?.trim()) return res.status(400).json({ error: 'phone and body are required' });
  const sms = await import('./sms.js');

  /**
   * Tags work here too, when the number belongs to somebody we know.
   *
   * A one-off to an arbitrary number can still fill the company details, and
   * looking the number up means resending a reminder by hand produces the same
   * message the automatic one would. Unmatched numbers get the org tags filled
   * and the rest emptied, which is the existing behaviour for a token with no
   * value — never the literal braces.
   */
  const org = await sms.orgVars(req.tenant.id);
  const { rows: [s] } = await pool.query(
    `select ${sms.SUBSCRIBER_VARS_SQL}
       from subscribers s
       left join plans p on p.id = s.plan_id
       left join routers r on r.id = s.router_id
      where s.tenant_id=$1 and (s.phone=$2 or s.phone_alt=$2) limit 1`,
    [req.tenant.id, phone]);

  const vars = s ? sms.subscriberVars(s, org) : { ...org };
  await sms.send(req.tenant.id, phone, 'custom', { ...vars, body: sms.fill(body, vars) });
  res.json({ ok: true, personalised: !!s });
}));

/** Bulk SMS. Audience is resolved server-side so the browser never sends a phone list. */
app.post('/api/sms/bulk', requirePermission('messaging.send_bulk'), wrap(async (req, res) => {
  const { audience = 'all', routerId, planId, body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' });

  const filters = {
    all: ['', []],
    router: ['and router_id=$2', [routerId]],
    package: ['and plan_id=$2', [planId]],
    expiring: ["and status='active' and expires_at between now() and now() + interval '3 days'", []],
    expired: ["and status='expired'", []],
  };
  const [clause, extra] = filters[audience] ?? filters.all;
  const sms = await import('./sms.js');
  // Joined so every placeholder can be filled — plan, price and speed live on
  // plans, and the router name on routers.
  const { rows } = await pool.query(
    `select ${sms.SUBSCRIBER_VARS_SQL}
       from subscribers s
       left join plans p on p.id = s.plan_id
       left join routers r on r.id = s.router_id
      where s.tenant_id=$1 ${clause.replace(/\b(router_id|plan_id|status|expires_at)\b/g, 's.$1')}`,
    [req.tenant.id, ...extra]);

  // A customer with several PPPoE lines sharing one phone (house + shop,
  // say) must get this broadcast once, not once per matching line.
  const seen = new Set();
  const recipients = rows.filter((s) => s.phone && !seen.has(s.phone) && seen.add(s.phone));

  res.json({ queued: recipients.length });

  // One lookup for the whole run rather than per recipient.
  const org = await sms.orgVars(req.tenant.id);
  for (const s of recipients) {
    // Expanded per recipient — the whole point of the tags is that each person
    // gets their own name, account and expiry rather than a form letter.
    const vars = sms.subscriberVars(s, org);
    vars.body = sms.fill(body, vars);
    for (const n of [...new Set([s.phone, s.phone_alt].filter(Boolean))]) {
      await sms.send(req.tenant.id, n, 'custom', vars).catch(() => {});
    }
  }
}));

/** The tokens a template may contain, for the message composer to offer. */
/**
 * The message templates this tenant sends.
 *
 * Editing them was impossible: the wording lived in a constant in the browser
 * bundle, so an ISP could not change what their own customers receive without
 * us shipping a release. The defaults stay as the fallback for anything they
 * have not overridden.
 */
app.get('/api/sms/templates', wrap(async (req, res) => {
  const { DEFAULTS, PLACEHOLDERS } = await import('./sms.js');
  const { rows } = await pool.query(
    'select templates from tenant_sms_config where tenant_id=$1 order by priority limit 1',
    [req.tenant.id]);
  res.json({
    defaults: DEFAULTS,
    templates: rows[0]?.templates ?? {},
    placeholders: PLACEHOLDERS,
  });
}));

app.put('/api/sms/templates', requirePermission('settings.edit'), wrap(async (req, res) => {
  const templates = req.body?.templates;
  if (!templates || typeof templates !== 'object') {
    return res.status(400).json({ error: 'Nothing to save' });
  }
  // Written to every gateway this tenant has: the wording is theirs, not the
  // provider's, and a message should not change because a gateway failed over.
  const { rowCount } = await pool.query(
    'update tenant_sms_config set templates=$2 where tenant_id=$1', [req.tenant.id, templates]);
  if (!rowCount) {
    return res.status(400).json({ error: 'Add an SMS gateway first — templates are stored against it.' });
  }
  res.json({ ok: true, templates });
}));

app.get('/api/sms/placeholders', wrap(async (_req, res) => {
  const { PLACEHOLDERS } = await import('./sms.js');
  res.json(PLACEHOLDERS);
}));

// ── tenants and platform billing (owner screens) ──
// Hiding these in the sidebar is not access control: every tenant's revenue is
// behind them, so the routes check the session themselves.
const superAdminOnly = (req, res, next) =>
  req.session?.is_super_admin ? next() : res.status(403).json({ error: 'platform owner only' });

/**
 * Safaricom's B2C tariff, editable rather than hardcoded — see schema.sql's
 * seed comment on b2c_fee_tiers. Platform-owner only: this is what
 * jobs.js's payoutRow charges a 'tiered'-mode tenant, so a wrong number here
 * has the same blast radius as a wrong number in the code, just correctable
 * without a deploy.
 */
app.get('/api/platform/b2c-fee-tiers', superAdminOnly, wrap(async (_req, res) => {
  const { rows } = await pool.query('select * from b2c_fee_tiers order by min_amount');
  res.json(rows);
}));

app.put('/api/platform/b2c-fee-tiers', superAdminOnly, wrap(async (req, res) => {
  const tiers = Array.isArray(req.body?.tiers) ? req.body.tiers : null;
  if (!tiers || !tiers.length) return res.status(400).json({ error: 'Provide at least one tier' });
  for (const t of tiers) {
    if (!(Number(t.minAmount) >= 0) || !(Number(t.fee) >= 0))
      return res.status(400).json({ error: 'Each tier needs a non-negative minAmount and fee' });
  }
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('delete from b2c_fee_tiers');
    for (const t of tiers) {
      await c.query(
        'insert into b2c_fee_tiers (min_amount, max_amount, fee) values ($1,$2,$3)',
        [Number(t.minAmount), t.maxAmount === '' || t.maxAmount == null ? null : Number(t.maxAmount), Number(t.fee)]);
    }
    await c.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await c.query('rollback');
    if (e.code === '23505') return res.status(409).json({ error: 'Two tiers share the same minimum amount.' });
    throw e;
  } finally {
    c.release();
  }
}));

app.get('/api/tenants', superAdminOnly, wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    select t.*,
      (select count(*) from subscribers s where s.tenant_id=t.id and s.status='active') devices,
      (select coalesce(sum(amount),0) from payments p
        where p.tenant_id=t.id and p.status='applied'
          and p.received_at >= date_trunc('month', now())) collected
    from tenants t order by t.created_at desc`);
  res.json(rows);
}));

/**
 * Every tenant, and whether they are in trouble.
 *
 * Built to answer one question in one screen: which of these needs attention
 * today. The tenant list already shows who exists and what they pay; none of it
 * says whose towers are down, who has stopped collecting, or who has nobody
 * connected — which is what turns into a support call or a cancellation.
 *
 * One query rather than one per tenant. A per-tenant loop is fine at five ISPs
 * and unusable at two hundred, and this is the screen most likely to be left
 * open on a second monitor.
 */
app.get('/api/platform/overview', superAdminOnly, wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    select
      t.id, t.name, t.subdomain, t.billing_ref, t.status, t.licence_ends,
      t.plan_type, t.plan_amount, t.created_at,

      (select count(*) from subscribers s where s.tenant_id = t.id) subscribers,
      (select count(*) from subscribers s
        where s.tenant_id = t.id and s.status = 'active') active_subscribers,

      (select count(*) from routers r where r.tenant_id = t.id) routers,
      (select count(*) from routers r
        where r.tenant_id = t.id and r.status = 'down') routers_down,
      (select max(r.last_seen) from routers r where r.tenant_id = t.id) router_last_seen,

      -- Sessions still open. Zero across a tenant with customers is the shape of
      -- an outage nobody has reported yet.
      (select count(*) from radacct a
        where a.acctstoptime is null
          and a.username in (select pppoe_user from subscribers
                              where tenant_id = t.id and pppoe_user is not null)) online,

      (select coalesce(sum(p.amount), 0) from payments p
        where p.tenant_id = t.id and p.status = 'applied'
          and p.received_at >= date_trunc('month', now())) collected_this_month,
      (select max(p.received_at) from payments p
        where p.tenant_id = t.id and p.status = 'applied') last_payment_at

    from tenants t
    order by t.created_at desc`);

  res.json(rows);
}));

/**
 * How the server itself is doing.
 *
 * An ISP's dashboard shows their routers and their customers, and says nothing
 * about the machine all of it depends on. When the VPS runs out of disk or the
 * database stops answering, every screen degrades in ways that look like
 * unrelated faults — payments not landing, pushes timing out — and nobody
 * thinks to check the host until late.
 *
 * Owner-only: it describes the platform, not a tenant, and disk figures are
 * nobody else's business.
 */
app.get('/api/platform/health', superAdminOnly, wrap(async (_req, res) => {
  const os = await import('node:os');
  const fsp = await import('node:fs/promises');

  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  // Timed rather than assumed reachable: a database answering slowly is the
  // shape of trouble that precedes it not answering at all.
  const startedAt = Date.now();
  let db = { ok: false, ms: null, error: null };
  try {
    await pool.query('select 1');
    db = { ok: true, ms: Date.now() - startedAt, error: null };
  } catch (e) {
    db = { ok: false, ms: Date.now() - startedAt, error: e.message };
  }

  // Disk, from statfs where the platform provides it. Not available everywhere,
  // and a missing figure is reported as unknown rather than guessed at.
  let disk = null;
  try {
    const st = await fsp.statfs('/');
    disk = {
      totalBytes: st.blocks * st.bsize,
      freeBytes: st.bavail * st.bsize,
    };
  } catch { disk = null; }

  const { rows: [counts] } = await pool.query(`
    select
      (select count(*) from tenants)                          tenants,
      (select count(*) from routers where status='up')        routers_up,
      (select count(*) from routers where status='down')      routers_down,
      (select count(*) from radacct where acctstoptime is null) sessions_open`);

  // The tunnel: how many routers are actually dialled in right now.
  let tunnels = null;
  try {
    const { liveTunnels } = await import('./tunnel.js');
    tunnels = (await liveTunnels()).length;
  } catch { tunnels = null; }

  /**
   * OpenVPN and FreeRADIUS, checked rather than assumed.
   *
   * These are the two services whose failure is invisible from the app: routers
   * quietly stop dialling in, customers quietly stop authenticating, and every
   * screen keeps working. OpenVPN is judged by whether it is still writing its
   * status file; RADIUS by whether anything has authenticated recently, which
   * is the only signal available from here without speaking the protocol.
   */
  const services = {};
  try {
    const fsp2 = await import('node:fs/promises');
    const st = await fsp2.stat(process.env.OVPN_STATUS_FILE ?? '/run/openvpn/status.log');
    const ageSec = Math.round((Date.now() - st.mtimeMs) / 1000);
    // OpenVPN rewrites it every 10 seconds; a minute stale means it has stopped.
    services.openvpn = { ok: ageSec < 60, detail: `status file ${ageSec}s old` };
  } catch (e) {
    services.openvpn = { ok: false, detail: 'no status file — the tunnel service may be down' };
  }
  try {
    const { rows: [r] } = await pool.query(
      "select max(authdate) last from radpostauth where authdate > now() - interval '24 hours'");
    services.radius = r?.last
      ? { ok: true, detail: `last authentication ${new Date(r.last).toISOString()}` }
      : { ok: null, detail: 'no authentications in 24h — quiet, or not reaching us' };
  } catch (e) {
    services.radius = { ok: false, detail: e.message };
  }

  res.json({
    at: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    hostUptimeSeconds: Math.round(os.uptime()),
    // On Linux this is runnable processes per core; over 1.0 per core means
    // work is queueing rather than merely being busy.
    load: { one: load[0], five: load[1], fifteen: load[2], cores: os.cpus().length },
    memory: { totalBytes: totalMem, freeBytes: freeMem, processBytes: process.memoryUsage().rss },
    disk,
    db,
    tunnels,
    services,
    counts,
  });
}));

/**
 * Restart the API, which is as far as a reboot button should go.
 *
 * Deliberately not the machine. A VPS reboot from inside a web request takes
 * down the database, the tunnel and every router session with no way to report
 * whether it came back — and the one thing an operator cannot do after pressing
 * it is read the result. Restarting this process fixes the case a reboot is
 * usually reached for (a wedged API) and leaves the rest running.
 *
 * Docker's restart policy brings the process straight back.
 */
app.post('/api/platform/restart', superAdminOnly, wrap(async (_req, res) => {
  console.warn('restart requested from the platform monitor');
  res.json({ ok: true, note: 'The API is restarting. This page will reconnect in a few seconds.' });
  // After the response, so the caller is told before the process goes.
  setTimeout(() => process.exit(0), 250);
}));

app.post('/api/tenants', superAdminOnly, wrap(async (req, res) => {
  const { name, subdomain, planType = 'flat', planAmount, revsharePct, supportPhone } = req.body;
  if (!name || !subdomain) return res.status(400).json({ error: 'name and subdomain are required' });
  const { rows: [t] } = await pool.query(
    `insert into tenants (name, subdomain, plan_type, plan_amount, revshare_pct, support_phone)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [name, subdomain, planType, planAmount ?? null, revsharePct ?? null, supportPhone ?? null]);

  // Starter help articles, so a new ISP is not answering the same four
  // questions from an empty page. Non-fatal: failing to seed content must not
  // fail creating the tenant.
  const { seedTenant } = await import('./seed-tenant.js');
  await seedTenant(t.id).catch((e) => console.error('seedTenant', t.id, e.message));

  // A standing maintenance login for us, invisible to the tenant and not
  // removable by them — see the platform_admin guards on GET/DELETE /api/staff.
  const maintPassword = crypto.randomBytes(6).toString('base64url');
  await pool.query(
    `insert into staff (tenant_id, name, phone, role, username, password_hash)
     values ($1, 'Vibelink support', 'platform-admin', 'platform_admin', $2, $3)`,
    [t.id, `admin-${t.subdomain}`, await auth.hashPassword(maintPassword)])
    .catch((e) => console.error('platform_admin seed', t.id, e.message));

  res.json(t);
}));

app.patch('/api/tenants/:id', superAdminOnly, wrap(async (req, res) => {
  const allowed = ['status', 'plan_type', 'plan_amount', 'revshare_pct', 'licence_ends', 'support_phone',
                   'platform_collect_enabled', 'settlement_phone', 'settlement_commission_pct', 'settlement_fee_mode'];
  const sets = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  const { rows: [t] } = await pool.query(
    `update tenants set ${sets.map((k, i) => `${k}=$${i + 2}`).join(', ')} where id=$1 returning *`,
    [req.params.id, ...sets.map((k) => req.body[k])]);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
}));

/**
 * Add or remove licence days.
 *
 * Billing lives in WHMCS now, so this is the switch that carries its decisions
 * across: a payment there means days here. Relative rather than absolute because
 * that is how it is actually used — "give them another month", "take back the
 * week they did not pay for" — and it counts from today when a licence has
 * already lapsed, so an expired tenant gets the full extension rather than days
 * swallowed by the gap.
 */
app.post('/api/tenants/:id/licence', superAdminOnly, wrap(async (req, res) => {
  const days = Number(req.body?.days);
  if (!Number.isFinite(days) || days === 0)
    return res.status(400).json({ error: 'days must be a non-zero number' });

  const { rows: [t] } = await pool.query(
    `update tenants set licence_ends =
       greatest(coalesce(licence_ends, current_date), current_date) + ($2 || ' days')::interval
     where id=$1 returning id, name, licence_ends`,
    [req.params.id, days]);
  if (!t) return res.status(404).json({ error: 'not found' });

  // Days back on the clock should restore access without waiting for anything.
  if (days > 0) {
    await pool.query(
      "update tenants set status='active' where id=$1 and status in ('readonly','suspended')",
      [t.id]);
  }
  res.json(t);
}));

/**
 * List every staff login for a tenant, for account recovery.
 *
 * Never returns password_hash — the operator has no use for the hash itself,
 * only the ability to reset it below.
 */
/**
 * The platform owner's own SMS gateway — a tenant with none of their own
 * configured (or an exhausted one) falls back to sending through this, at
 * the platform owner's expense, up to whatever balance that tenant was
 * individually given (see the /sms-balance route below). One row, shared
 * by every tenant that falls back to it; credentials only ever come back
 * as which keys are set, matching how a tenant's own SMS gateway settings
 * already behave.
 */
app.get('/api/platform/sms-config', superAdminOnly, wrap(async (req, res) => {
  const { PROVIDER_FIELDS } = await import('./sms.js');
  const { rows: [cfg] } = await pool.query(
    'select provider, credentials, price_per_credit from platform_sms_config where id=true');
  res.json({
    provider: cfg?.provider ?? null,
    credentialKeys: Object.entries(cfg?.credentials ?? {})
      .filter(([, v]) => String(v ?? '').trim())
      .map(([k]) => k),
    fields: PROVIDER_FIELDS,
    pricePerCredit: Number(cfg?.price_per_credit ?? 2),
  });
}));

/** The real balance on the platform owner's own gateway account — cached 5 minutes, same as a tenant's own. */
app.get('/api/platform/sms-balance', superAdminOnly, wrap(async (req, res) => {
  const { platformSmsBalance } = await import('./sms.js');
  res.json(await platformSmsBalance({ force: req.query.force === '1' }));
}));

app.put('/api/platform/sms-config', superAdminOnly, wrap(async (req, res) => {
  const { provider, credentials = {}, pricePerCredit } = req.body ?? {};
  const { PROVIDER_FIELDS } = await import('./sms.js');
  if (!PROVIDER_FIELDS[provider]) return res.status(400).json({ error: 'unknown gateway' });

  // Blank fields keep whatever secret is already stored, same as a
  // tenant's own SMS gateway form — the operator never has to re-type an
  // API key just to change one other field.
  const incoming = Object.fromEntries(
    Object.entries(credentials).filter(([, v]) => String(v ?? '').trim() !== ''));

  await pool.query(
    `insert into platform_sms_config (id, provider, credentials, price_per_credit)
     values (true, $1, $2, coalesce($3::numeric, 2))
     on conflict (id) do update set
       provider = excluded.provider,
       credentials = platform_sms_config.credentials || excluded.credentials,
       price_per_credit = coalesce($3::numeric, platform_sms_config.price_per_credit)`,
    [provider, incoming, pricePerCredit != null ? Number(pricePerCredit) : null]);
  res.json({ ok: true });
}));

/**
 * Top up (or set) how many messages a tenant may send through the platform
 * gateway before it stops — deliberately a small, explicit balance per
 * tenant rather than a switch, so one tenant's volume can never quietly
 * become the platform owner's own bill without them having chosen it.
 */
app.post('/api/tenants/:id/sms-balance', superAdminOnly, wrap(async (req, res) => {
  const { delta, set } = req.body ?? {};
  const { rows: [t] } = await pool.query(
    set != null
      ? 'update tenants set platform_sms_balance=$2 where id=$1 returning platform_sms_balance'
      : 'update tenants set platform_sms_balance=greatest(platform_sms_balance + $2, 0) where id=$1 returning platform_sms_balance',
    [req.params.id, set != null ? Number(set) : Number(delta) || 0]);
  if (!t) return res.status(404).json({ error: 'No such tenant' });
  res.json({ platform_sms_balance: t.platform_sms_balance });
}));

app.get('/api/tenants/:id/staff', superAdminOnly, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select id, name, phone, email, username, role, is_super_admin, last_seen
       from staff where tenant_id=$1 order by (role='owner') desc, name`,
    [req.params.id]);
  res.json(rows);
}));

/**
 * Reset a tenant staff member's sign-in details.
 *
 * Operators lock themselves out and there was nobody who could help — no reset
 * path existed at all, so the only recovery was editing the database by hand.
 * The password is returned once so it can be read down the phone, and stored
 * only as a hash. Works for any staff row on the tenant, not just the owner —
 * a cashier or technician can forget their login just as easily.
 */
app.post('/api/tenants/:id/staff/:staffId', superAdminOnly, wrap(async (req, res) => {
  const { email, username, password } = req.body ?? {};

  const { rows: [target] } = await pool.query(
    'select id from staff where id=$1 and tenant_id=$2', [req.params.staffId, req.params.id]);
  if (!target) return res.status(404).json({ error: 'No such staff account on that tenant.' });

  // Both are unique across the whole platform, so a clash has to be caught here
  // rather than surfacing as a constraint violation the operator cannot read.
  if (email) {
    const { rowCount } = await pool.query(
      'select 1 from staff where lower(email)=lower($1) and id<>$2', [String(email).trim(), target.id]);
    if (rowCount) return res.status(409).json({ error: 'Another account already uses that email.' });
  }
  const user = username ? String(username).toLowerCase().replace(/[^a-z0-9._-]/g, '') : null;
  if (user) {
    const { rowCount } = await pool.query(
      'select 1 from staff where lower(username)=lower($1) and id<>$2', [user, target.id]);
    if (rowCount) return res.status(409).json({ error: `The username "${user}" is taken.` });
  }

  // Generated when asked for rather than accepted from the form: nobody should
  // be choosing another person's password, and it is never stored in the clear.
  const fresh = password === true ? crypto.randomBytes(6).toString('base64url') : null;
  const hash = fresh ? await auth.hashPassword(fresh) : null;

  const { rows: [s] } = await pool.query(
    `update staff set
       email = coalesce(nullif($2,''), email),
       username = coalesce($3, username),
       password_hash = coalesce($4, password_hash)
     where id=$1 returning email, username`,
    [target.id, email ? String(email).trim() : '', user, hash]);

  // Signing them out everywhere: a reset that leaves old sessions alive has not
  // actually taken the account back.
  if (fresh) await pool.query('delete from admin_sessions where staff_id=$1', [target.id]);

  res.json({ email: s.email, username: s.username, password: fresh });
}));

// ── fair use policy ───────────────────────────────
app.get('/api/fup-policies', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select f.*, p.title as plan_title from fup_policies f
     left join plans p on p.id = f.plan_id
     where f.tenant_id=$1 order by f.name`, [req.tenant.id]);
  res.json(rows);
}));

const fupBody = (b) => ({
  name: b.name,
  appliesTo: b.planId ? 'plan' : 'all',
  planId: b.planId || null,
  dataCapGb: Number(b.dataCapGb),
  windowPeriod: b.windowPeriod ?? 'monthly',
  throttleDown: Math.round(Number(b.throttleDown) || 0),
  throttleUp: Math.round(Number(b.throttleUp) || 0),
  notifyAtPct: Number(b.notifyAtPct) || 80,
  enabled: b.enabled !== false,
});

app.post('/api/fup-policies', wrap(async (req, res) => {
  const f = fupBody(req.body);
  if (!f.name?.trim()) return res.status(400).json({ error: 'Name the policy' });
  if (!Number.isFinite(f.dataCapGb) || f.dataCapGb <= 0)
    return res.status(400).json({ error: 'Data cap must be a positive number of GB' });
  const { rows: [row] } = await pool.query(
    `insert into fup_policies (tenant_id, name, applies_to, plan_id, data_cap_gb,
       window_period, throttle_down, throttle_up, notify_at_pct, enabled)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [req.tenant.id, f.name, f.appliesTo, f.planId, f.dataCapGb, f.windowPeriod,
     f.throttleDown, f.throttleUp, f.notifyAtPct, f.enabled]);
  res.json(row);
}));

app.put('/api/fup-policies/:id', wrap(async (req, res) => {
  const f = fupBody(req.body);
  const { rows: [row] } = await pool.query(
    `update fup_policies set name=$3, applies_to=$4, plan_id=$5, data_cap_gb=$6,
       window_period=$7, throttle_down=$8, throttle_up=$9, notify_at_pct=$10, enabled=$11
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, f.name, f.appliesTo, f.planId, f.dataCapGb,
     f.windowPeriod, f.throttleDown, f.throttleUp, f.notifyAtPct, f.enabled]);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}));

app.delete('/api/fup-policies/:id', wrap(async (req, res) => {
  await pool.query('delete from fup_policies where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

/** Live usage against each cap, for the FUP screen. */
app.get('/api/fup-usage', wrap(async (req, res) => {
  const { usageReport } = await import('./fup.js');
  res.json(await usageReport(req.tenant.id));
}));

/**
 * MRR, churn and revenue — the real-time-dashboard metrics every ISP
 * platform reviewed for this feature (Sonar's "MRR, churn and network
 * health on one dashboard") leads with, none of which existed anywhere in
 * this app before. MRR is normalised to a monthly-equivalent figure per
 * plan (duration_min lets a plan be weekly/quarterly/whatever and still
 * roll up honestly) rather than just summing sticker prices, which would
 * overstate a base with non-monthly plans on it.
 */
app.get('/api/analytics/mrr', wrap(async (req, res) => {
  const { rows: [mrrRow] } = await pool.query(
    `select coalesce(sum(p.price * (43200.0 / greatest(p.duration_min, 1))), 0) as mrr,
            count(*) as active_count
       from subscribers s join plans p on p.id = s.plan_id
      where s.tenant_id=$1 and s.status in ('active','grace')`,
    [req.tenant.id]);

  const { rows: [monthRow] } = await pool.query(
    `select
       (select count(*) from subscribers where tenant_id=$1 and created_at >= date_trunc('month', now())) as new_this_month,
       (select count(*) from subscribers where tenant_id=$1 and status in ('expired','suspended')
          and expires_at >= date_trunc('month', now())) as churned_this_month,
       (select coalesce(sum(amount), 0) from payments
         where tenant_id=$1 and status='applied' and received_at >= date_trunc('month', now())) as revenue_this_month`,
    [req.tenant.id]);

  const { rows: [baseRow] } = await pool.query(
    `select count(*) filter (where status in ('active','grace')) as retained,
            count(*) filter (where status in ('expired','suspended')) as lost
       from subscribers where tenant_id=$1`,
    [req.tenant.id]);

  const base = Number(baseRow.retained) + Number(baseRow.lost);
  res.json({
    mrr: Math.round(Number(mrrRow.mrr)),
    activeCount: Number(mrrRow.active_count),
    newThisMonth: Number(monthRow.new_this_month),
    churnedThisMonth: Number(monthRow.churned_this_month),
    revenueThisMonth: Number(monthRow.revenue_this_month),
    // Snapshot churn — current lost/base, not a rolling cohort measure —
    // for the same reason ARPU below is a snapshot: there is no
    // status-history table to compute a true monthly cohort rate from yet.
    churnRatePct: base ? Math.round((Number(baseRow.lost) / base) * 1000) / 10 : 0,
    arpu: mrrRow.active_count > 0 ? Math.round(Number(mrrRow.mrr) / Number(mrrRow.active_count)) : 0,
  });
}));

/** Run enforcement now rather than waiting for the quarter-hour cron. */
app.post('/api/fup-enforce', wrap(async (req, res) => {
  const { enforceForTenant } = await import('./fup.js');
  res.json(await enforceForTenant(req.tenant.id));
}));

/** Lift a fair-use throttle early — a goodwill top-up for the rest of the window. */
app.post('/api/fup-usage/:subscriberId/restore', wrap(async (req, res) => {
  const { clearFupThrottle } = await import('./radius.js');
  const { withTenant } = await import('./db.js');
  const ok = await withTenant(req.tenant.id, (c) => clearFupThrottle(c, req.tenant.id, req.params.subscriberId));
  await pool.query(
    `update fup_state set throttled=false, warned=false
     where tenant_id=$1 and subscriber_id=$2 and window_start >= date_trunc('day', now())::date`,
    [req.tenant.id, req.params.subscriberId]);
  res.json({ ok, restored: ok });
}));

// ── SLA edit ──────────────────────────────────────
app.put('/api/sla-policies/:id', wrap(async (req, res) => {
  const { name, priority, respondMins, resolveMins, uptime, businessHours, escalateTo, enabled } = req.body;
  const { rows: [p] } = await pool.query(
    `update sla_policies set name=coalesce($3,name), priority=coalesce($4,priority),
       respond_mins=coalesce($5,respond_mins), resolve_mins=coalesce($6,resolve_mins),
       uptime=coalesce($7,uptime), business_hours=$8, escalate_to=$9,
       enabled=coalesce($10,enabled)
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, name ?? null, priority ?? null, respondMins ?? null,
     resolveMins ?? null, uptime ?? null, businessHours ?? null, escalateTo || null,
     typeof enabled === 'boolean' ? enabled : null]);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
}));

// ── ticket detail and notes ───────────────────────
app.get('/api/tickets/:id', requirePermission('tickets.view'), wrap(async (req, res) => {
  const { rows: [t] } = await pool.query(
    `select tk.*, s.name as subscriber_name, s.phone as subscriber_phone, st.name as assignee_name,
            sp.name as sla_policy_name, rp.title as requested_plan_title
     from tickets tk
     left join subscribers s on s.id = tk.subscriber_id
     left join staff st on st.id = tk.assigned_to
     left join sla_policies sp on sp.id = tk.sla_policy_id
     left join plans rp on rp.id = tk.requested_plan_id
     where tk.tenant_id=$1 and tk.id=$2`, [req.tenant.id, req.params.id]);
  if (!t) return res.status(404).json({ error: 'not found' });
  // ticket_notes.ticket_id is a plain FK to tickets(id), not composite on
  // (tenant_id, id) — without this filter, a note written into another
  // tenant's ticket (see the insert below, which had the same gap) would
  // read back here as if it were this tenant's own.
  const { rows: notes } = await pool.query(
    'select * from ticket_notes where tenant_id=$1 and ticket_id=$2 order by at', [req.tenant.id, req.params.id]);
  res.json({ ...t, notes });
}));

app.post('/api/tickets/:id/notes', wrap(async (req, res) => {
  const { body, internal = true } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Write something first' });
  // The ticket named in the URL must actually belong to this tenant before
  // anything is written against it — this used to insert straight from
  // req.params.id with no check at all, so any authenticated staff member
  // on any tenant who knew or was given another tenant's ticket id could
  // write a note into that tenant's support queue and silently bump its
  // updated_at, and that tenant would then read the forged note back as
  // their own (see the select above).
  const { rows: [owned] } = await pool.query(
    'select 1 from tickets where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!owned) return res.status(404).json({ error: 'not found' });
  const { rows: [n] } = await pool.query(
    `insert into ticket_notes (tenant_id, ticket_id, author, body, internal)
     values ($1,$2,$3,$4,$5) returning *`,
    [req.tenant.id, req.params.id, req.session?.name ?? 'system', body, internal]);
  await pool.query('update tickets set updated_at=now() where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  res.json(n);
}));

// ── tenant delete (platform owner) ────────────────
app.delete('/api/tenants/:id', superAdminOnly, wrap(async (req, res) => {
  if (req.params.id === req.tenant.id)
    return res.status(400).json({ error: 'You cannot delete the tenant you are signed in to.' });
  const { rows: [t] } = await pool.query('delete from tenants where id=$1 returning name, subdomain', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, ...t });
}));

// ── payment gateways: several per provider ────────
app.get('/api/payment-gateways', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select id, provider, label, shortcode, is_default, is_platform_collect, enabled_pppoe, enabled_hotspot,
            last_callback_at, credentials
     from tenant_payment_config where tenant_id=$1
     order by provider, is_default desc, label nulls last`, [req.tenant.id]);
  // Report which secrets are set without ever sending them back to the browser.
  res.json(rows.map(({ credentials, ...g }) => ({
    ...g,
    credentialKeys: Object.entries(credentials ?? {})
      .filter(([, v]) => String(v ?? '').trim())
      .map(([k]) => k),
  })));
}));

app.post('/api/payment-gateways', requirePermission('payments.edit'), wrap(async (req, res) => {
  const { provider, label, shortcode, credentials = {}, enabledPppoe = false, enabledHotspot = false, isDefault } = req.body;
  if (!provider || !shortcode) return res.status(400).json({ error: 'Channel and shortcode are required' });
  if (provider === 'kopokopo' && enabledPppoe)
    return res.status(400).json({ error: 'KopoKopo is hotspot-only' });

  const { rows: [existing] } = await pool.query(
    'select 1 from tenant_payment_config where tenant_id=$1 and provider=$2 limit 1', [req.tenant.id, provider]);
  const makeDefault = isDefault ?? !existing;   // first one in is the default

  const c = await pool.connect();
  try {
    await c.query('begin');
    if (makeDefault)
      await c.query('update tenant_payment_config set is_default=false where tenant_id=$1 and provider=$2',
        [req.tenant.id, provider]);
    const { rows: [g] } = await c.query(
      `insert into tenant_payment_config (tenant_id, provider, label, shortcode, credentials,
         enabled_pppoe, enabled_hotspot, is_default)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [req.tenant.id, provider, label ?? null, shortcode, credentials, enabledPppoe, enabledHotspot, makeDefault]);
    await c.query('commit');
    res.json({ id: g.id, ok: true });
  } catch (e) {
    await c.query('rollback');
    if (e.code === '23505') return res.status(409).json({ error: 'That shortcode is already saved for this channel.' });
    throw e;
  } finally {
    c.release();
  }
}));

/**
 * Reveal one gateway's stored credentials.
 *
 * The list deliberately reports only which keys are set, so after saving, an
 * operator saw empty boxes and could not tell whether it had worked. Rather than
 * returning secrets on every page load, this is a deliberate action — the same
 * shape as the router's RADIUS secret.
 */
app.get('/api/payment-gateways/:id/credentials', requirePermission('payments.edit'), wrap(async (req, res) => {
  const { rows: [g] } = await pool.query(
    'select credentials from tenant_payment_config where id=$1 and tenant_id=$2',
    [req.params.id, req.tenant.id]);
  if (!g) return res.status(404).json({ error: 'not found' });
  res.json({ credentials: g.credentials ?? {} });
}));

/**
 * Tell Safaricom where to send C2B payments for this paybill.
 *
 * Without this, a customer pays and the confirmation never reaches us: Daraja
 * posts to whatever URL was registered, which for a new shortcode is nothing at
 * all. registerC2B existed since the import and had no way to be called.
 */
app.post('/api/payment-gateways/:id/register-urls', requirePermission('payments.edit'), wrap(async (req, res) => {
  const { rows: [g] } = await pool.query(
    'select * from tenant_payment_config where id=$1 and tenant_id=$2',
    [req.params.id, req.tenant.id]);
  if (!g) return res.status(404).json({ error: 'not found' });
  if (g.provider !== 'daraja')
    return res.status(400).json({ error: 'Only M-Pesa paybills register callback URLs this way.' });

  const base = process.env.BASE_URL ?? '';
  if (!/^https:\/\//.test(base))
    return res.status(400).json({
      error: `BASE_URL is "${base || 'unset'}". Safaricom will not accept a callback URL that is not public HTTPS.`,
    });

  try {
    // Registers this specific gateway's own shortcode/credentials — not
    // whichever one config()'s is_default pick would return, which used to
    // silently register the wrong paybill for any tenant holding more than
    // one Daraja config (a real gap now that a tenant can hold both an
    // ordinary paybill and a dedicated platform-collect one).
    const out = await mpesa.registerC2BForConfig(g);
    res.json({
      ok: true,
      confirmation: `${base}/webhooks/daraja/confirm`,
      validation: `${base}/webhooks/daraja/validate`,
      response: out,
    });
  } catch (e) {
    // Safaricom puts the real reason in the body, not the status text.
    const detail = e?.response?.data;
    res.status(502).json({
      error: detail?.errorMessage ?? detail?.ResponseDescription ?? e.message,
      response: detail ?? null,
    });
  }
}));

app.put('/api/payment-gateways/:id', requirePermission('payments.edit'), wrap(async (req, res) => {
  const { label, shortcode, credentials, enabledPppoe, enabledHotspot } = req.body;

  // Checked before the update runs, not after: the CHECK constraint would
  // otherwise reject the query first and this route would never get to send
  // back the clear "hotspot-only" message — the caller just saw a raw 500.
  if (enabledPppoe) {
    const { rows: [existing] } = await pool.query(
      'select provider from tenant_payment_config where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
    if (existing?.provider === 'kopokopo')
      return res.status(400).json({ error: 'KopoKopo is hotspot-only' });
  }

  const { rows: [g] } = await pool.query(
    `update tenant_payment_config set
       label = coalesce($3, label),
       shortcode = coalesce($4, shortcode),
       -- merge so blank fields in the form do not wipe stored secrets
       credentials = credentials || coalesce($5::jsonb, '{}'::jsonb),
       enabled_pppoe = coalesce($6, enabled_pppoe),
       enabled_hotspot = coalesce($7, enabled_hotspot)
     where tenant_id=$1 and id=$2 returning id, provider`,
    [req.tenant.id, req.params.id, label ?? null, shortcode ?? null,
     credentials ? JSON.stringify(credentials) : null,
     typeof enabledPppoe === 'boolean' ? enabledPppoe : null,
     typeof enabledHotspot === 'boolean' ? enabledHotspot : null]);
  if (!g) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

app.post('/api/payment-gateways/:id/default', requirePermission('payments.edit'), wrap(async (req, res) => {
  const { rows: [g] } = await pool.query(
    'select provider from tenant_payment_config where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!g) return res.status(404).json({ error: 'not found' });
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('update tenant_payment_config set is_default=false where tenant_id=$1 and provider=$2',
      [req.tenant.id, g.provider]);
    await c.query('update tenant_payment_config set is_default=true where id=$1', [req.params.id]);
    await c.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}));

/**
 * A platform-collected tenant's own settlement destination — self-service,
 * not something the platform owner types in on their behalf (Tenants.jsx
 * still carries commission/fee-mode, which stay platform-controlled). Only
 * meaningful once platform_collect_enabled is set, but not gated on it: a
 * tenant expecting to be switched on shortly may as well have it waiting.
 *
 * Three shapes, one at a time — jobs.js's payoutRow reads only the columns
 * for whichever settlement_method is current, so switching method here and
 * only filling in the new one's fields is enough; the old method's columns
 * are left as-is rather than blanked; they simply stop being read.
 */
app.patch('/api/settings/settlement-method', requirePermission('payments.edit'), wrap(async (req, res) => {
  const method = req.body?.method;

  if (method === 'phone') {
    let phone = String(req.body?.phone ?? '').trim();
    if (!phone) return res.status(400).json({ error: 'Enter an M-Pesa number.' });
    phone = phone.replace(/[^0-9+]/g, '').replace(/^\+?(?:254)?0?/, '254');
    if (!/^254[17]\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'That does not look like a Kenyan mobile number.' });
    }
    await pool.query("update tenants set settlement_method='phone', settlement_phone=$2 where id=$1",
      [req.tenant.id, phone]);
    return res.json({ settlementMethod: 'phone', settlementPhone: phone });
  }

  if (method === 'till') {
    const till = String(req.body?.till ?? '').trim();
    if (!/^\d{5,7}$/.test(till)) return res.status(400).json({ error: 'Enter a valid till/paybill number.' });
    await pool.query("update tenants set settlement_method='till', settlement_till=$2 where id=$1",
      [req.tenant.id, till]);
    return res.json({ settlementMethod: 'till', settlementTill: till });
  }

  if (method === 'bank') {
    const bankName = String(req.body?.bankName ?? '').trim();
    const bankPaybill = String(req.body?.bankPaybill ?? '').trim();
    const accountNumber = String(req.body?.accountNumber ?? '').trim();
    if (!bankName) return res.status(400).json({ error: 'Choose a bank.' });
    if (!/^\d{5,7}$/.test(bankPaybill)) return res.status(400).json({ error: "Enter the bank's paybill number." });
    if (!accountNumber) return res.status(400).json({ error: 'Enter your account number at that bank.' });
    await pool.query(
      `update tenants set settlement_method='bank', settlement_bank_name=$2,
         settlement_bank_paybill=$3, settlement_account_number=$4 where id=$1`,
      [req.tenant.id, bankName, bankPaybill, accountNumber]);
    return res.json({ settlementMethod: 'bank', settlementBankName: bankName, settlementBankPaybill: bankPaybill, settlementAccountNumber: accountNumber });
  }

  res.status(400).json({ error: 'Unknown settlement method.' });
}));

/**
 * Only meaningful on the platform-owner's own tenant — daraja.js's
 * resolveConfig() only ever looks this up against whichever tenant the
 * is_super_admin staff row belongs to, so flipping it on any other tenant's
 * gateway would have no effect at all. Gated on is_super_admin rather than
 * that being enforced structurally, since nothing stops a request for a
 * tenant that isn't the owner — it would just be a no-op, and this avoids
 * the confusion of a toggle that appears to work but silently does nothing.
 */
app.post('/api/payment-gateways/:id/platform-collect', requirePermission('payments.edit'), wrap(async (req, res) => {
  if (!req.session.is_super_admin)
    return res.status(403).json({ error: 'Only the platform owner can designate a platform-collect paybill.' });
  const { rows: [g] } = await pool.query(
    'select provider from tenant_payment_config where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  if (!g) return res.status(404).json({ error: 'not found' });
  const on = req.body?.on !== false;
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (on) {
      await c.query('update tenant_payment_config set is_platform_collect=false where tenant_id=$1 and provider=$2',
        [req.tenant.id, g.provider]);
      await c.query('update tenant_payment_config set is_platform_collect=true where id=$1', [req.params.id]);
    } else {
      await c.query('update tenant_payment_config set is_platform_collect=false where id=$1', [req.params.id]);
    }
    await c.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}));

app.delete('/api/payment-gateways/:id', requirePermission('payments.edit'), wrap(async (req, res) => {
  const { rows: [g] } = await pool.query(
    'delete from tenant_payment_config where tenant_id=$1 and id=$2 returning provider, is_default',
    [req.tenant.id, req.params.id]);
  if (!g) return res.status(404).json({ error: 'not found' });
  // Never leave a provider without a default.
  if (g.is_default)
    await pool.query(
      `update tenant_payment_config set is_default=true
       where id = (select id from tenant_payment_config
                   where tenant_id=$1 and provider=$2 order by id limit 1)`,
      [req.tenant.id, g.provider]);
  res.json({ ok: true });
}));

// ── automation switches ───────────────────────────
const AUTOMATION_JOBS = [
  { job: 'expireAndSuspend', name: 'Expire & suspend', cron: '*/5 * * * *', detail: 'Grace → walled garden → expired, and expires stale vouchers' },
  { job: 'generateInvoices', name: 'Generate invoices', cron: '0 6 * * *', detail: 'Raises an invoice 3 days before a line expires' },
  { job: 'autoCharge', name: 'Auto-charge', cron: '0 8,12,18 * * *', detail: 'Fires STK for every account with a saved mandate' },
  { job: 'remind', name: 'Payment reminders', cron: '0 9 * * *', detail: 'SMS to anyone expiring within 3 days' },
  { job: 'enforceFup', name: 'Fair-use enforcement', cron: '*/15 * * * *', detail: 'Totals session bytes against each cap, warns, then throttles' },
  { job: 'watchdog', name: 'Router watchdog', cron: '*/1 * * * *', detail: 'Pings every NAS and flags the ones that stop answering' },
  { job: 'ownerBrief', name: 'Owner brief', cron: '0 20 * * *', detail: 'Evening SMS: collected, new clients, routers down' },
  { job: 'expireTenantLicences', name: 'Tenant licences', cron: '0 7 * * *', detail: 'Read-only once the licence date passes; full access again when it is extended' },
  { job: 'lockNewPppoeMacs', name: 'PPPoE MAC lock', cron: '*/5 * * * *', detail: 'Locks a fresh line to the first router it actually dials in from' },
  /**
   * Two jobs that have been running all along without appearing here.
   *
   * Both were added after this list was written and never added to it, so the
   * screen showed eight of the ten that run. Work was happening that the
   * operator could neither see nor stop — and when the list later looked
   * shorter than remembered, it read as automation having been taken away.
   *
   * healRouters is per tenant and switches off like the rest. closeStaleSessions
   * works on radacct, which has no tenant column, so one run covers the whole
   * platform: it is shown with what it does and no switch, rather than a switch
   * that would quietly do nothing.
   */
  { job: 'healRouters', name: 'Router self-healing', cron: '*/10 * * * *', detail: 'Re-pushes RADIUS and the hotspot profile to a router that has drifted or been reset' },
  { job: 'autoProvisionNewRouters', name: 'Router auto-provisioning', cron: '*/2 * * * *', detail: 'Pushes RADIUS and accounting the first time a newly onboarded router\'s tunnel comes up, before anyone presses Configure' },
  { job: 'settleTenants', name: 'Platform settlement payout', cron: '0 2 * * *', detail: 'Pays out what has been collected on behalf of a platform-collect tenant to their registered M-Pesa number' },
  { job: 'closeStaleSessions', name: 'Close dead sessions', cron: '*/5 * * * *', system: true, detail: 'Ends sessions a router stopped accounting for, so a customer who dropped off does not read as online for ever' },
  /**
   * Same gap this list's own comment above already describes, caught by
   * scripts/check-jobs.mjs rather than by memory this time: both had been
   * running, unlisted, since before any of the jobs above them were added
   * here at all.
   */
  { job: 'dbBackup', name: 'Database backup', cron: '0 3 * * *', system: true, detail: 'Nightly pg_dump to R2 — daily kept a week, Sunday\'s kept two months' },
  { job: 'purgeExpiredVouchers', name: 'Purge expired vouchers', cron: '30 3 * * *', detail: 'Deletes a voucher a day after it expired, if Hotspot → Settings has the auto-purge toggle on' },
  { job: 'checkSlaBreaches', name: 'SLA breach alerts', cron: '*/5 * * * *', detail: 'Texts whoever an SLA policy names to escalate to (or the owner) the moment a ticket passes its resolve-by time' },
  { job: 'enforceHotspotDataCaps', name: 'Hotspot data caps', cron: '*/15 * * * *', detail: 'Tracks usage against a plan’s data cap and cuts a voucher off the moment it’s hit' },
  { job: 'expireStuckStkRequests', name: 'Time out stuck M-Pesa prompts', cron: '*/3 * * * *', detail: 'Marks an STK push as timed out if the gateway never calls back, so a guest is not left staring at "check your phone" forever' },
  { job: 'pollWireguardStatus', name: 'WireGuard status', cron: '*/1 * * * *', system: true, detail: 'Reads handshake/traffic stats from the wireguard container and updates each peer' },
];

/**
 * What automation has done lately.
 *
 * Both the dashboard and the Automation screen showed a hardcoded zero for the
 * last 24 hours, which reads as "nothing is running" on a system that has been
 * working all night.
 *
 * Not tenant-scoped, because the jobs are not: one run of expireAndSuspend
 * covers every tenant at once. Only counts and job names are returned — nothing
 * here says anything about another tenant's customers or money.
 */
app.get('/api/automation/runs', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    select job,
           count(*)::int                             runs,
           count(*) filter (where not ok)::int       failures,
           max(ran_at)                               last_run,
           round(avg(ms))::int                       avg_ms
      from job_runs
     where ran_at > now() - interval '24 hours'
     group by job
     order by job`);

  res.json({
    since: '24 hours',
    total: rows.reduce((n, r) => n + r.runs, 0),
    failures: rows.reduce((n, r) => n + r.failures, 0),
    jobs: rows,
  });
}));

/**
 * The last few job runs, newest first.
 *
 * The dashboard had a "Live automation feed" that was a hardcoded sentence
 * saying nothing had run yet — on a system where a job fires every minute. It
 * read as though automation had been switched off, or removed.
 */
app.get('/api/automation/recent', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `select job, ok, error, ms, ran_at from job_runs order by ran_at desc limit 40`);
  res.json(rows);
}));

app.get('/api/automation', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select job, enabled, updated_at from automation_jobs where tenant_id=$1', [req.tenant.id]);
  const state = Object.fromEntries(rows.map((r) => [r.job, r]));
  res.json(AUTOMATION_JOBS.map((j) => ({
    ...j,
    enabled: state[j.job]?.enabled ?? true,     // absent means on
    updatedAt: state[j.job]?.updated_at ?? null,
  })));
}));

app.put('/api/automation/:job', requirePermission('settings.edit'), wrap(async (req, res) => {
  const known = AUTOMATION_JOBS.find((j) => j.job === req.params.job);
  if (!known) return res.status(404).json({ error: 'unknown job' });
  // A platform-wide job cannot be switched off by one tenant. Refusing is
  // honest; storing the flag would leave a switch that reads "stopped" while
  // the job carries on.
  if (known.system) {
    return res.status(409).json({
      error: `${known.name} runs for the whole platform, so it cannot be switched off for one account.`,
    });
  }
  const enabled = req.body.enabled !== false;
  await pool.query(
    `insert into automation_jobs (tenant_id, job, enabled) values ($1,$2,$3)
     on conflict (tenant_id, job) do update set enabled=excluded.enabled, updated_at=now()`,
    [req.tenant.id, req.params.job, enabled]);
  res.json({ job: req.params.job, enabled });
}));

// ── organisation settings (Settings screen) ───────
/**
 * Your own account: who you are, and your password.
 *
 * Neither could be changed from inside the product. Staff details were editable
 * only through the platform owner, so an operator who mistyped their name at
 * signup lived with it, and anyone who thought their password was known had to
 * ask us to reset it — which means telling somebody a password, the thing
 * passwords exist to avoid.
 */
app.patch('/api/me', wrap(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const phone = String(req.body?.phone ?? '').trim();

  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That is not a valid email address.' });
  }
  // Email identifies the account at sign-in, so a duplicate would make one of
  // the two unreachable.
  if (email) {
    const { rows: [taken] } = await pool.query(
      'select 1 from staff where lower(email)=lower($1) and id<>$2', [email, req.session.staff_id]);
    if (taken) return res.status(409).json({ error: 'Another account already uses that email.' });
  }

  const { rows: [me] } = await pool.query(
    `update staff set name=coalesce(nullif($2,''), name),
            email=coalesce(nullif($3,''), email),
            phone=coalesce(nullif($4,''), phone)
      where id=$1 and tenant_id=$5
      returning name, email, phone, username, role`,
    [req.session.staff_id, name, email, phone, req.tenant.id]);
  if (!me) return res.status(404).json({ error: 'Account not found' });
  res.json(me);
}));

app.post('/api/me/password', wrap(async (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');

  if (next.length < 8) {
    return res.status(400).json({ error: 'The new password must be at least 8 characters.' });
  }

  const { rows: [acct] } = await pool.query(
    'select password_hash from staff where id=$1 and tenant_id=$2',
    [req.session.staff_id, req.tenant.id]);
  if (!acct) return res.status(404).json({ error: 'Account not found' });

  // The current password is required even though the session proves who they
  // are: a session is often a laptop somebody walked away from, and changing
  // the password is what locks the real owner out.
  if (!(await auth.verifyPassword(current, acct.password_hash))) {
    return res.status(403).json({ error: 'That is not your current password.' });
  }

  await pool.query('update staff set password_hash=$2 where id=$1',
    [req.session.staff_id, await auth.hashPassword(next)]);
  res.json({ ok: true });
}));

/**
 * "What's new" feed — see schema.sql's platform_updates. Read by every
 * tenant; unread is computed here (against tenants.last_update_seen_at)
 * rather than left to the frontend, so a tenant that never opened it before
 * still gets a correct count on the very first load.
 */
app.get('/api/platform/updates', wrap(async (req, res) => {
  const { rows: updates } = await pool.query(
    'select * from platform_updates order by created_at desc limit 30');
  const seenAt = req.tenant.last_update_seen_at ? new Date(req.tenant.last_update_seen_at) : null;
  const unread = updates.filter((u) => !seenAt || new Date(u.created_at) > seenAt).length;
  res.json({ updates, unread });
}));

app.post('/api/platform/updates', superAdminOnly, wrap(async (req, res) => {
  const { title, body } = req.body;
  if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'Title and body are required' });
  const { rows: [u] } = await pool.query(
    'insert into platform_updates (title, body) values ($1,$2) returning *',
    [title.trim(), body.trim()]);
  res.json(u);
}));

app.delete('/api/platform/updates/:id', superAdminOnly, wrap(async (req, res) => {
  await pool.query('delete from platform_updates where id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/updates/seen', wrap(async (req, res) => {
  await pool.query('update tenants set last_update_seen_at=now() where id=$1', [req.tenant.id]);
  res.json({ ok: true });
}));

app.get('/api/settings', requirePermission('settings.view'), wrap(async (req, res) => {
  const { rows: [extra] } = await pool.query('select * from app_settings where tenant_id=$1', [req.tenant.id]);
  const { id, name, subdomain, currency, timezone, kra_pin, support_phone, licence_ends, status } = req.tenant;
  res.json({
    org: { id, name, subdomain, currency, timezone, kra_pin, support_phone, licence_ends, status },
    smtp: extra?.smtp ?? {},
    prefs: extra?.prefs ?? {},
    alertPhone: extra?.alert_phone ?? null,
  });
}));

app.put('/api/settings', requirePermission('settings.edit'), wrap(async (req, res) => {
  const { org, smtp, prefs, alertPhone } = req.body;

  // Where router alerts go. Stored on app_settings rather than staff, because
  // it is a rota decision, not a person's contact detail.
  if (alertPhone !== undefined) {
    await pool.query(
      `insert into app_settings (tenant_id, alert_phone) values ($1, nullif($2,''))
       on conflict (tenant_id) do update set alert_phone = excluded.alert_phone`,
      [req.tenant.id, String(alertPhone ?? '').trim()]);
  }
  if (org) {
    await pool.query(
      `update tenants set name=coalesce($2,name), currency=coalesce($3,currency),
         timezone=coalesce($4,timezone), kra_pin=coalesce($5,kra_pin),
         support_phone=coalesce($6,support_phone)
       where id=$1`,
      [req.tenant.id, org.name ?? null, org.currency ?? null, org.timezone ?? null,
       org.kra_pin ?? null, org.support_phone ?? null]);
  }
  if (smtp || prefs) {
    await pool.query(
      `insert into app_settings (tenant_id, smtp, prefs) values ($1, coalesce($2, '{}'::jsonb), $3)
       on conflict (tenant_id) do update set
         smtp = coalesce($2, app_settings.smtp), prefs = coalesce($3, app_settings.prefs)`,
      [req.tenant.id, smtp ?? null, prefs ?? null]);
  }
  res.json({ ok: true });
}));

const FAVICON_MIME = new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml', 'image/jpeg', 'image/webp']);
// 50KB raw, comfortably under express.json()'s default 100kb request-body cap
// once base64'd (~+33%) and wrapped in JSON — a favicon has no business being
// bigger than this, and failing here with a clear message beats the body
// parser itself rejecting the request with a bare 413 before this ever runs.
const FAVICON_MAX_BYTES = 50 * 1024;

/**
 * A tenant's own browser-tab icon, everywhere their staff and their guests
 * see this platform — the sign-in screen, the dashboard, the hotspot login
 * page. One shared favicon.svg for every ISP was the last piece of branding
 * that still said "this is the platform," not "this is my ISP," once every
 * page/title/notice already read the tenant's own name.
 */
app.put('/api/settings/favicon', requireRole('owner'), wrap(async (req, res) => {
  const dataUrl = String(req.body?.dataUrl ?? '');
  const m = /^data:([\w./+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return res.status(400).json({ error: 'Not a recognisable image file.' });
  const [, mime, b64] = m;
  if (!FAVICON_MIME.has(mime)) {
    return res.status(400).json({ error: 'Use a PNG, ICO, SVG, JPEG or WebP file.' });
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > FAVICON_MAX_BYTES) {
    return res.status(400).json({ error: `That file is too large — keep it under ${Math.round(FAVICON_MAX_BYTES / 1024)}KB.` });
  }
  await pool.query('update tenants set favicon=$2, favicon_mime=$3 where id=$1', [req.tenant.id, buf, mime]);
  res.json({ ok: true });
}));

app.delete('/api/settings/favicon', requireRole('owner'), wrap(async (req, res) => {
  await pool.query('update tenants set favicon=null, favicon_mime=null where id=$1', [req.tenant.id]);
  res.json({ ok: true });
}));

const price = async (planId) =>
  (await pool.query('select price from plans where id=$1', [planId])).rows[0].price;
const till = async (tenantId) =>
  (await pool.query("select shortcode from tenant_payment_config where tenant_id=$1 and provider='manual_till'", [tenantId])).rows[0]?.shortcode;

// Final error handler. Everything above funnels here via next(err), including the
// async rejections caught by the wrapper installed at the top of this file.
app.use((err, req, res, _next) => {
  const msg = describe(err);
  console.error(req.method, req.path, '→', msg);
  if (!res.headersSent) res.status(err.status ?? 500).json({ error: msg });
});

// Last line of defence: a stray rejection should be logged, not fatal.
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', describe(e)));

startJobs();
app.listen(process.env.PORT ?? 8080, () => console.log('billing api up'));
