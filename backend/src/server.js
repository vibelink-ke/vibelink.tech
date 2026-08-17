import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import util from 'node:util';
import express from 'express';
import { pool, tenantByHost } from './db.js';
import { router as daraja } from './payments/daraja.js';
import { router as kopokopo } from './payments/kopokopo.js';
import { router as bank } from './payments/bankstk.js';
import { router as manual } from './payments/manual.js';
import * as kk from './payments/kopokopo.js';
import * as mpesa from './payments/daraja.js';
import { startJobs } from './jobs.js';
import { providerNames } from './sms.js';
import * as auth from './auth.js';

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
app.use(express.json());

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

app.post('/api/auth/login', wrap(async (req, res) => {
  // `identifier` is the email-or-username field; `email` stays accepted so an
  // older client keeps working.
  const { identifier, email, password, remember = true } = req.body;
  const who = String(identifier ?? email ?? '').trim();
  if (!who || !password) return res.status(400).json({ error: 'Enter your email or username and password.' });

  const { rows: [acct] } = await pool.query(
    `select st.*, t.status as tenant_status from staff st
     join tenants t on t.id = st.tenant_id
     where lower(st.email) = lower($1) or lower(st.username) = lower($1)`, [who]);

  // Same message for "no such account" and "wrong password" would be friendlier to
  // attackers only marginally here, and the design shows distinct copy — keep the
  // design's wording but verify against a dummy hash so timing does not leak.
  if (!acct) {
    await auth.verifyPassword(password, null);
    return res.status(401).json({ error: 'No account found for that email or username. Create one first.' });
  }
  if (!(await auth.verifyPassword(password, acct.password_hash)))
    return res.status(401).json({ error: 'That password is not correct.' });
  if (acct.tenant_status === 'suspended')
    return res.status(402).json({ error: 'This account is suspended. Contact support@vibelink.tech.' });

  const { token, expiresAt } = await auth.createSession(acct.id, acct.tenant_id, { remember });
  auth.setSessionCookie(res, token, expiresAt);
  await pool.query('update staff set last_seen = now() where id = $1', [acct.id]);
  auth.pruneSessions();
  auth.pruneHandoffs();

  const s = await auth.readSession(token);
  res.json(auth.publicSession(s));
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
    await c.query('insert into hotspot_settings (tenant_id) values ($1) on conflict do nothing', [tenant.id]);
    await c.query('commit');
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

  const tenant = await tenantByHost(domain);
  return tenant ? res.status(200).end() : res.status(404).end();
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
 *
 * Auth and webhook routes are mounted above the resolver and never reach here.
 */
app.use((req, res, next) => {
  if (req.path.startsWith('/portal/') || req.path.startsWith('/radius/')) return next();
  if (!req.session) return res.status(401).json({ error: 'sign in required' });
  next();
});

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
            sub.status, sub.expires_at, sub.credit, sub.service,
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
app.post('/portal/login', wrap(async (req, res) => {
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
  const { rows: [gw] } = await pool.query(
    `select shortcode from tenant_payment_config
      where tenant_id=$1 and shortcode is not null
      order by is_default desc nulls last limit 1`, [s.tenant_id]).catch(() => ({ rows: [] }));

  const days = s.expires_at ? Math.ceil((new Date(s.expires_at) - Date.now()) / 86400000) : null;
  res.json({
    name: s.name,
    account: s.account_code,
    phone: s.phone,
    status: s.status,
    service: s.service,
    expiresAt: s.expires_at,
    daysLeft: days == null ? null : Math.max(0, days),
    balance: Number(s.credit ?? 0),
    plan: s.plan_title ? {
      title: s.plan_title,
      price: Number(s.plan_price),
      speed: s.rate_down ? `${Math.round(s.rate_down / 1000)}/${Math.round(s.rate_up / 1000)} Mbps` : null,
    } : null,
    company: org?.name ?? '',
    supportPhone: org?.support_phone ?? '',
    paybill: gw?.shortcode ?? '',
    payments,
  });
}));

/** Raise a support request from the portal, which the Tickets screen picks up. */
app.post('/portal/support', wrap(async (req, res) => {
  const s = await portalSession(req);
  if (!s) return res.status(401).json({ error: 'not signed in' });
  const subject = String(req.body?.subject ?? '').trim();
  if (!subject) return res.status(400).json({ error: 'Say what the problem is.' });

  const { rows: [t] } = await pool.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority)
     values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, 'medium')
     returning number`, [s.tenant_id, subject, s.subscriber_id]);
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
app.post('/portal/buy', async (req, res) => {
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

app.get('/portal/status/:checkoutId', async (req, res) => {
  const { rows: [r] } = await pool.query(
    'select status, result_desc from stk_requests where tenant_id=$1 and checkout_id=$2',
    [req.tenant.id, req.params.checkoutId]);
  res.json(r ?? { status: 'unknown' });
});

/** Customer typed an M-Pesa code after paying a no-API till. */
app.post('/portal/verify-code', async (req, res) => {
  const { rows: [p] } = await pool.query(
    "select * from payments where tenant_id=$1 and provider_ref=$2", [req.tenant.id, req.body.code]);
  if (!p) return res.status(404).json({ status: 'not_found', grantedMinutes: 20 });
  res.json({ status: p.status });
});

// ── admin ─────────────────────────────────────────
app.get('/api/subscribers', async (req, res) => {
  const { rows } = await pool.query(
    'select * from subscribers where tenant_id=$1 order by created_at desc limit 200', [req.tenant.id]);
  res.json(rows);
});

app.get('/api/payments/unmatched', async (req, res) => {
  const { rows } = await pool.query(
    "select * from payments where tenant_id=$1 and status='unmatched' order by received_at desc", [req.tenant.id]);
  res.json(rows);
});

/** Cashier resolves an unmatched payment; we remember the phone for next time. */
app.post('/api/payments/:id/match', async (req, res) => {
  const { subscriberId } = req.body;
  const { applyMatched } = await import('./payments/apply.js');
  res.json(await applyMatched?.(req.tenant.id, req.params.id, subscriberId) ?? { ok: true });
});

// ── hotspot settings (Hotspot -> Settings) ─────────
app.get('/api/hotspot/settings', async (req, res) => {
  const { rows: [s] } = await pool.query('select * from hotspot_settings where tenant_id=$1', [req.tenant.id]);
  res.json(s ?? {});
});

app.put('/api/hotspot/settings', async (req, res) => {
  const f = req.body;
  const { rows: [s] } = await pool.query(`
    insert into hotspot_settings (tenant_id, ssid, redirect_url, trial_minutes, idle_timeout_min, bind_mac,
      payment_method, voucher_expiry, code_type, code_length, sms_voucher, auto_login, multi_device,
      template, banner_headline, banner_subtext)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    on conflict (tenant_id) do update set
      ssid=excluded.ssid, redirect_url=excluded.redirect_url, trial_minutes=excluded.trial_minutes,
      idle_timeout_min=excluded.idle_timeout_min, bind_mac=excluded.bind_mac,
      payment_method=excluded.payment_method, voucher_expiry=excluded.voucher_expiry,
      code_type=excluded.code_type, code_length=excluded.code_length, sms_voucher=excluded.sms_voucher,
      auto_login=excluded.auto_login, multi_device=excluded.multi_device, template=excluded.template,
      banner_headline=excluded.banner_headline, banner_subtext=excluded.banner_subtext
    returning *`,
    [req.tenant.id, f.ssid, f.redirect_url, f.trial_minutes, f.idle_timeout_min, f.bind_mac,
     f.payment_method, f.voucher_expiry, f.code_type, f.code_length, f.sms_voucher, f.auto_login,
     f.multi_device, f.template, f.banner_headline, f.banner_subtext]);
  res.json(s);
});

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
  });
}));

app.put('/api/sms/gateways/:provider', wrap(async (req, res) => {
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

app.delete('/api/sms/gateways/:provider', wrap(async (req, res) => {
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

/** FreeRADIUS post-auth hook: starts the clock when voucher_expiry = 'login'. */
app.post('/radius/post-auth', async (req, res) => {
  const { startVoucherClock } = await import('./radius.js');
  const { withTenant } = await import('./db.js');
  await withTenant(req.tenant.id, (c) => startVoucherClock(c, req.tenant.id, req.body.username));
  res.json({ ok: true });
});

// ── tickets, leads, messaging, live support, tariffs, IP pools ──
// All scoped by req.tenant.id — the tenant resolver above 404s unknown hosts and
// every query below runs with RLS active (see withTenant in db.js for writes).
app.get('/api/tickets', async (req, res) => {
  const { rows } = await pool.query('select * from tickets where tenant_id=$1 order by created_at desc', [req.tenant.id]);
  res.json(rows);
});
app.post('/api/tickets', async (req, res) => {
  const { subject, subscriberId, priority = 'medium' } = req.body;
  const { rows: [t] } = await pool.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority)
     values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, $4) returning *`,
    [req.tenant.id, subject, subscriberId ?? null, priority]);
  res.json(t);
});

app.get('/api/leads', async (req, res) => {
  const { rows } = await pool.query('select * from leads where tenant_id=$1 order by created_at desc', [req.tenant.id]);
  res.json(rows);
});
app.post('/api/leads', async (req, res) => {
  const { name, phone, source } = req.body;
  const { rows: [l] } = await pool.query(
    'insert into leads (tenant_id, name, phone, source) values ($1,$2,$3,$4) returning *',
    [req.tenant.id, name, phone, source ?? 'manual']);
  res.json(l);
});

app.get('/api/messages/:subscriberId', async (req, res) => {
  const { rows } = await pool.query(
    'select * from messages where tenant_id=$1 and subscriber_id=$2 order by sent_at', [req.tenant.id, req.params.subscriberId]);
  res.json(rows);
});
app.post('/api/messages', async (req, res) => {
  const { subscriberId, body, channel = 'sms' } = req.body;
  const { rows: [m] } = await pool.query(
    "insert into messages (tenant_id, subscriber_id, direction, channel, body) values ($1,$2,'out',$3,$4) returning *",
    [req.tenant.id, subscriberId, channel, body]);
  if (channel !== 'live_chat') { const { send } = await import('./sms.js');
    const { rows: [s] } = await pool.query('select phone from subscribers where id=$1', [subscriberId]);
    await send(req.tenant.id, s?.phone, 'custom', { body }); }
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

app.get('/api/tariffs', async (req, res) => {
  const { rows } = await pool.query('select * from tariffs where tenant_id=$1 and active order by price', [req.tenant.id]);
  res.json(rows);
});
app.post('/api/tariffs', async (req, res) => {
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
app.post('/api/routers/ovpn-script', wrap(async (req, res) => {
  const { ensureSubnet, nextHostIp, SERVER_IP } = await import('./tunnel.js');

  const subnet = await ensureSubnet(req.tenant.id);
  const nasIp = await nextHostIp(req.tenant.id);
  const token = crypto.randomBytes(6).toString('hex');
  // Name from the address, so it stays unique and stays put if rows are removed.
  const username = `router-${nasIp.split('.').pop()}`;

  // Stored hashed; the plaintext below is shown once, in the script, and then gone.
  await pool.query(
    `insert into ovpn_clients (tenant_id, username, password_hash, assigned_ip)
     values ($1,$2,crypt($3, gen_salt('bf')),$4)`,
    [req.tenant.id, username, token, nasIp]
  );

  // Detected from the deployment; the caller may still override, because on a
  // bench the server is just an address on the same LAN.
  const host = String(req.body?.serverHost ?? '').trim() || tunnelHost(req);

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
    // One line per command: the backslash continuation this used to emit is
    // fragile when pasted, and it hid which parameter the parser rejected.
    `/interface ovpn-client add name=billing-ovpn connect-to=${host} port=1194 `
      + `user=${username} password=${token} certificate=none cipher=${cipher} auth=${authDigest} `
      // Explicit, because a management tunnel must never carry customer traffic
      // even if the server one day pushes a route.
      + 'add-default-route=no mode=ip',
    // No srcnat rule here. This tunnel exists so the server can reach the router;
    // masquerading out of it would hide everything behind the router instead.
    ':log info "Billing OVPN client added - waiting for tunnel IP"',
  ].join('\n');

  res.json({
    script,
    nasIp,
    username,
    subnet,
    serverIp: SERVER_IP,
    serverHost: host,
    routerosVersion: v6 ? '6' : '7',
    defaultApiPort: 8728,
  });
}));

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
app.post('/api/routers/:id/autoconfig', wrap(async (req, res) => {
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
  const login = await routerLogin(r, req.body, secrets);
  if (!login)
    return res.status(428).json({
      error: 'Enter the router’s admin username and password once. A dedicated account is created from it and used for every push after that.',
      needsAdmin: true,
    });

  const done = [];
  let conn;
  try {
    conn = await ros.connect({ host, port: r.api_port ?? 8728, user: login.user, password: login.password });

    const info = await ros.identify(conn);

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

    const radius = await ros.applyRadius(conn, {
      serverIp: SERVER_IP,
      secret: r.secret,
      coaPort: Number(process.env.RADIUS_COA_PORT ?? 3799),
      services: r.role === 'both' ? 'ppp,hotspot' : r.role,
    });
    done.push(`pointed RADIUS at ${SERVER_IP} and enabled CoA`);
    if (radius.replaced) done.push(`removed ${radius.replaced} stale RADIUS entr${radius.replaced === 1 ? 'y' : 'ies'}`);

    if (r.role === 'both' || r.role === 'pppoe') {
      await ros.applyPpp(conn);
      done.push('enabled PPPoE accounting with 5-minute interim updates');

      // Only when ports were chosen. Building a bridge unasked could swallow the
      // uplink and take the site off the internet.
      const lanPorts = Array.isArray(req.body?.lanPorts) ? req.body.lanPorts : null;
      if (lanPorts?.length) {
        const bridgeName = String(req.body?.bridge ?? 'bridge-lan').trim() || 'bridge-lan';
        const bridge = await ros.ensureBridge(conn, { name: bridgeName, ports: lanPorts });
        done.push(bridge.added.length
          ? `bridged ${bridge.added.join(', ')} into ${bridge.bridge}`
          : `${bridge.bridge} already had those ports`);
        if (bridge.skipped.length) done.push(`left alone: ${bridge.skipped.join(', ')}`);

        const pppoe = await ros.applyPppoeServer(conn, {
          bridge: bridge.bridge,
          poolRange: req.body?.poolRange,
          gateway: req.body?.gateway,
        });
        done.push(`PPPoE server listening on ${pppoe.bridge}, handing out ${pppoe.pool}`);
      }
    }
    if (r.role === 'both' || r.role === 'hotspot') {
      const { profiles } = await ros.applyHotspot(conn);
      done.push(profiles
        ? `switched ${profiles} hotspot profile${profiles === 1 ? '' : 's'} to RADIUS`
        : 'no hotspot profiles on this router');
    }

    await pool.query(
      `update routers set autoconfig_last_at=now(), autoconfig_last_ok=true, autoconfig_last_error=null,
              ros_version=$2, ros_identity=$3, status='up', last_seen=now()
        where id=$1`,
      [r.id, info.version, info.identity]);

    res.json({ ok: true, applied: done, ...info });
  } catch (e) {
    const message = describeRouterError(conn?.__socketError ?? e, host, r.api_port ?? 8728);
    await pool.query(
      'update routers set autoconfig_last_at=now(), autoconfig_last_ok=false, autoconfig_last_error=$2 where id=$1',
      [r.id, message.slice(0, 300)]);
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
app.put('/api/routers/:id', wrap(async (req, res) => {
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
app.delete('/api/routers/:id', wrap(async (req, res) => {
  const { rows: [r] } = await pool.query(
    'select * from routers where id=$1 and tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!r) return res.status(404).json({ error: 'No such router' });

  const { rows: [{ count }] } = await pool.query(
    'select count(*)::int from subscribers where router_id=$1', [r.id]);
  if (count > 0)
    return res.status(409).json({
      error: count === 1
        ? '1 subscriber still uses this router. Move them to another one first.'
        : `${count} subscribers still use this router. Move them to another one first.`,
    });

  await pool.query('delete from ovpn_clients where tenant_id=$1 and assigned_ip=$2',
    [req.tenant.id, r.host]);
  await pool.query('delete from wg_peers where tenant_id=$1 and router_id=$2', [req.tenant.id, r.id]);
  // ip_pools.router_id has no ON DELETE, so a pool assigned to this router blocked
  // the delete outright with a raw foreign-key error. Detach rather than drop: the
  // address range is still the operator's to reassign.
  await pool.query('update ip_pools set router_id=null where tenant_id=$1 and router_id=$2',
    [req.tenant.id, r.id]);
  await pool.query('delete from routers where id=$1 and tenant_id=$2', [r.id, req.tenant.id]);
  res.json({ ok: true, freed: r.host });
}));

// ── router onboarding via WireGuard ───────────────
// Preferred over OVPN on RouterOS 7: in-kernel, and far faster than RouterOS's
// single-threaded OpenVPN. RouterOS 6 has no WireGuard — use the OVPN route there.
app.post('/api/routers/wg-peer', wrap(async (req, res) => {
  const wg = await import('./wireguard.js');
  const { name, routerId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name the router' });

  const endpoint = process.env.WG_ENDPOINT;
  const serverPublicKey = process.env.WG_SERVER_PUBLIC_KEY;
  if (!endpoint || !serverPublicKey)
    return res.status(400).json({
      error: 'WG_ENDPOINT and WG_SERVER_PUBLIC_KEY are not set. See docs/NETWORK-SETUP.md.',
    });

  const { peer, privateKey, presharedKey, assignedIp } =
    await wg.createPeer(req.tenant.id, { name, routerId: routerId ?? null });

  res.json({
    peerId: peer.id,
    assignedIp,
    publicKey: peer.public_key,
    // Shown once. The server keeps only the public key; if this is lost the peer
    // must be recreated rather than recovered.
    script: wg.mikrotikScript({ privateKey, presharedKey, assignedIp, endpoint, serverPublicKey }),
    note: 'The private key is shown once and is not stored. Apply it before closing this.',
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

app.delete('/api/routers/wg-peers/:id', wrap(async (req, res) => {
  await pool.query('delete from wg_peers where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true, note: 'Run scripts/wg-sync.mjs to drop it from the running server.' });
}));

app.get('/api/routers', async (req, res) => {
  const { rows } = await pool.query('select * from routers where tenant_id=$1 order by name', [req.tenant.id]);
  res.json(rows);
});

/** Confirm the router after the OVPN tunnel is up: nickname, NAS secret, API port (default 8728). */
app.post('/api/routers', wrap(async (req, res) => {
  const { name, nasIdentifier, host, secret, apiPort = 8728, role = 'both' } = req.body;

  // Nobody needs to invent this. It is a shared secret between us and one router,
  // it is never typed by a human now that Configure pushes it, and a chosen one
  // is only ever weaker than a random one.
  const { randomPassword } = await import('./secrets.js');
  const nasSecret = String(secret ?? '').trim() || randomPassword(24);

  const { rows: [r] } = await pool.query(
    `insert into routers (tenant_id, name, host, api_port, nas_identifier, role, secret)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.tenant.id, name, host, apiPort, nasIdentifier ?? host, role, nasSecret]);
  res.json(r);
}));

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
  const { name, cidr, routerId, service } = req.body ?? {};
  const { rows: [p] } = await pool.query(
    `update ip_pools set
       name      = coalesce(nullif($3,''), name),
       cidr      = coalesce(nullif($4,'')::cidr, cidr),
       -- '' clears the assignment; absent leaves it alone.
       router_id = case when $5::text is null then router_id
                        when $5 = '' then null else $5::uuid end,
       service   = coalesce(nullif($6,''), service)
     where id=$1 and tenant_id=$2 returning *`,
    [req.params.id, req.tenant.id, name ?? '', cidr ?? '',
     routerId === undefined ? null : String(routerId), service ?? '']);
  if (!p) return res.status(404).json({ error: 'No such pool' });
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
      select cidr from ip_pools
       where tenant_id = $1
         and (router_id = $2 or router_id is null)
         and service = 'pppoe'
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

app.get('/api/ip-pools', async (req, res) => {
  const { rows } = await pool.query(
    `select p.*, r.name as router_name,
       (select count(*) from subscribers s where s.router_id=p.router_id) used
     from ip_pools p left join routers r on r.id=p.router_id where p.tenant_id=$1`, [req.tenant.id]);
  res.json(rows);
});
app.post('/api/ip-pools', async (req, res) => {
  const { name, cidr, routerId, service = 'pppoe' } = req.body;
  const { rows: [p] } = await pool.query(
    'insert into ip_pools (tenant_id, name, cidr, router_id, service) values ($1,$2,$3,$4,$5) returning *',
    [req.tenant.id, name, cidr, routerId ?? null, service]);
  res.json(p);
});

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
app.get('/api/subscribers/new-credentials', wrap(async (req, res) => {
  const digits = (n) => {
    const lo = 10 ** (n - 1);
    return String(lo + crypto.randomInt(0, 9 * lo));
  };

  let account = null;
  for (let attempt = 0; attempt < 40 && !account; attempt++) {
    const candidate = digits(5);
    const { rowCount } = await pool.query(
      'select 1 from subscribers where tenant_id=$1 and account_code=$2', [req.tenant.id, candidate]);
    if (!rowCount) account = candidate;
  }
  // 90,000 possibilities: only an operator with most of them in use gets here,
  // and silently handing back a duplicate would fail on insert anyway.
  if (!account) return res.status(409).json({ error: 'Could not find a free 5-digit account number.' });

  res.json({ account, password: digits(7) });
}));

app.post('/api/subscribers', wrap(async (req, res) => {
  const { accountCode, name, phone, phoneAlt, service = 'pppoe', planId, routerId,
          pppoeUser, pppoePass, staticIp, autopay } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
  const { rows: [s] } = await pool.query(
    `insert into subscribers (tenant_id, account_code, name, phone, phone_alt, service, plan_id,
       router_id, pppoe_user, pppoe_pass, static_ip, autopay)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [req.tenant.id, accountCode ?? phone, name, phone, phoneAlt || null, service, planId ?? null,
     routerId ?? null, pppoeUser ?? null, pppoePass ?? null, staticIp ?? null, autopay ?? null]);

  res.json(s);

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

app.patch('/api/subscribers/:id', wrap(async (req, res) => {
  const allowed = ['name', 'phone', 'status', 'plan_id', 'router_id', 'static_ip', 'autopay', 'expires_at'];
  const sets = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  const { rows: [s] } = await pool.query(
    `update subscribers set ${sets.map((k, i) => `${k}=$${i + 3}`).join(', ')}
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, ...sets.map((k) => req.body[k])]);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
}));

/**
 * Give a customer a fresh portal password.
 *
 * Six digits, for the same reason the rest are: it gets read out over the phone
 * by support. Returned once in the clear and stored only as a hash, so this is
 * the only moment anyone can see it — including us.
 */
app.post('/api/subscribers/:id/portal-password', wrap(async (req, res) => {
  const password = String(100000 + crypto.randomInt(0, 900000));
  const hash = await auth.hashPassword(password);
  const { rows: [s] } = await pool.query(
    'update subscribers set portal_password_hash=$3 where id=$1 and tenant_id=$2 returning name, phone, account_code',
    [req.params.id, req.tenant.id, hash]);
  if (!s) return res.status(404).json({ error: 'not found' });

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
app.post('/api/subscribers/:id/access', wrap(async (req, res) => {
  const action = String(req.body?.action ?? '');
  const target = { pause: 'paused', suspend: 'suspended', resume: 'active' }[action];
  if (!target) return res.status(400).json({ error: 'action must be pause, suspend or resume' });

  const { rows: [s] } = await pool.query(
    'update subscribers set status=$3 where id=$1 and tenant_id=$2 returning *',
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

  res.json(s);
}));

app.delete('/api/subscribers/:id', wrap(async (req, res) => {
  await pool.query('delete from subscribers where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

// ── money (Payments screen) ───────────────────────
app.get('/api/payments', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from payments where tenant_id=$1 order by received_at desc limit 500', [req.tenant.id]);
  res.json(rows);
}));

app.get('/api/invoices', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from invoices where tenant_id=$1 order by due_date desc limit 500', [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/invoices', wrap(async (req, res) => {
  const { subscriberId, amount, dueDate } = req.body;
  const { rows: [i] } = await pool.query(
    `insert into invoices (tenant_id, subscriber_id, number, amount, due_date)
     values ($1,$2,'INV-' || to_char(now(),'YYMM') || '-' || substr(gen_random_uuid()::text,1,6),$3,$4)
     returning *`,
    [req.tenant.id, subscriberId ?? null, amount, dueDate]);
  res.json(i);
}));

/**
 * Cashier types in an M-Pesa code by hand, or pastes a statement line.
 * Goes through the same applyPayment funnel as the webhooks, so matching,
 * receipting and idempotency all behave identically.
 */
app.post('/api/payments/manual', wrap(async (req, res) => {
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

  const cfg = await import('./db.js').then((m) => m.config(req.tenant.id, provider));
  if (!cfg) return res.status(400).json({ error: `No ${provider} gateway configured. Add one under Settings → Payment gateways.` });

  const base = process.env.BASE_URL ?? '';
  const callbackReachable = /^https?:\/\//.test(base) && !/localhost|127\.0\.0\.1/.test(base);

  try {
    let checkoutId;
    if (provider === 'kopokopo') {
      if (!planId) return res.status(400).json({ error: 'KopoKopo is hotspot-only — pick a hotspot bundle' });
      const kk = await import('./payments/kopokopo.js');
      checkoutId = await kk.stkPush(req.tenant.id, { phone: msisdn, amount: Number(amount), planId, mac: null, service: 'hotspot' });
    } else {
      const mpesa = await import('./payments/daraja.js');
      const r = await mpesa.stkPush(req.tenant.id, {
        phone: msisdn, amount: Number(amount),
        accountRef: accountRef || 'TOPUP', description: 'Account top-up',
      });
      checkoutId = r.CheckoutRequestID;
      if (!checkoutId) return res.status(502).json({ error: r.errorMessage ?? r.ResponseDescription ?? 'Gateway did not return a checkout id' });
      // Daraja only writes stk_requests from the portal path; record it here too so
      // the callback can find the row and status polling works.
      await pool.query(
        `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
         values ($1,'daraja',$2,$3,$4,$5)
         on conflict (tenant_id, provider, checkout_id) do nothing`,
        [req.tenant.id, checkoutId, msisdn, Number(amount), { subscriber_id: subscriberId ?? null }]);
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
app.post('/api/payments/reconcile', wrap(async (req, res) => {
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

/** Give affected subscribers free days back after an outage. */
app.post('/api/subscribers/compensate', wrap(async (req, res) => {
  const { ids = [], days = 1 } = req.body;
  if (!ids.length) return res.status(400).json({ error: 'no subscribers selected' });
  const { rows } = await pool.query(
    `update subscribers
       set expires_at = greatest(coalesce(expires_at, now()), now()) + ($3 || ' days')::interval
     where tenant_id=$1 and id = any($2::uuid[])
     returning id, name, expires_at`,
    [req.tenant.id, ids, String(Number(days) || 1)]);
  res.json({ compensated: rows.length, days: Number(days) || 1, rows });
}));

/** Report which required credentials a payment channel is still missing. */
app.post('/api/payment-methods/:provider/test', wrap(async (req, res) => {
  const required = {
    daraja: ['consumer_key', 'consumer_secret', 'passkey'],
    kopokopo: ['client_id', 'client_secret'],
    bankstk: ['bank', 'account', 'token'],
    manual_till: [],
  }[req.params.provider];
  if (!required) return res.status(400).json({ error: 'unknown channel' });

  const { rows: [cfg] } = await pool.query(
    'select shortcode, credentials from tenant_payment_config where tenant_id=$1 and provider=$2',
    [req.tenant.id, req.params.provider]);
  if (!cfg) return res.status(404).json({ error: 'Not configured yet — save credentials first.' });

  const creds = cfg.credentials ?? {};
  const missing = required.filter((k) => !String(creds[k] ?? '').trim());
  if (!cfg.shortcode) missing.unshift('shortcode');
  res.json({
    ok: missing.length === 0,
    shortcode: cfg.shortcode,
    missing,
    // Deliberately does not call the provider: a live STK push would charge a real
    // customer. This confirms the config is complete, nothing more.
    note: missing.length ? 'Incomplete configuration' : 'All required credentials present',
  });
}));

app.get('/api/settlements', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from settlements where tenant_id=$1 order by created_at desc', [req.tenant.id]);
  res.json(rows);
}));

// ── catalogue: plans and tariffs ──────────────────
app.get('/api/plans', wrap(async (req, res) => {
  const { service } = req.query;
  const { rows } = await pool.query(
    `select * from plans where tenant_id=$1 and active ${service ? 'and service=$2' : ''} order by price`,
    service ? [req.tenant.id, service] : [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/plans', wrap(async (req, res) => {
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

app.put('/api/plans/:id', wrap(async (req, res) => {
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

app.delete('/api/plans/:id', wrap(async (req, res) => {
  await pool.query('update plans set active=false where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

app.put('/api/tariffs/:id', wrap(async (req, res) => {
  const { title, price: p, speedDown, speedUp, fairUse } = req.body;
  const { rows: [t] } = await pool.query(
    `update tariffs set title=coalesce($3,title), price=coalesce($4,price),
       speed_down=coalesce($5,speed_down), speed_up=coalesce($6,speed_up), fair_use=$7
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, title ?? null, p ?? null, speedDown ?? null, speedUp ?? null, fairUse ?? null]);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
}));

app.delete('/api/tariffs/:id', wrap(async (req, res) => {
  await pool.query('update tariffs set active=false where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

// ── vouchers (Hotspot -> Vouchers) ────────────────
app.get('/api/vouchers', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from vouchers where tenant_id=$1 order by created_at desc limit 1000', [req.tenant.id]);
  res.json(rows);
}));

/** Generate a batch by hand — the usual path is a payment landing in apply.js. */
app.post('/api/vouchers', wrap(async (req, res) => {
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

app.post('/api/vouchers/delete', wrap(async (req, res) => {
  const { ids = [] } = req.body;
  const { rowCount } = await pool.query(
    'delete from vouchers where tenant_id=$1 and id = any($2::uuid[])', [req.tenant.id, ids]);
  res.json({ deleted: rowCount });
}));

app.post('/api/vouchers/purge-expired', wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    "delete from vouchers where tenant_id=$1 and status='expired'", [req.tenant.id]);
  res.json({ deleted: rowCount });
}));

// ── staff (Staff & roles) ─────────────────────────
app.get('/api/staff', wrap(async (req, res) => {
  const { role } = req.query;
  const { rows } = await pool.query(
    `select * from staff where tenant_id=$1 ${role ? 'and role=$2' : ''} order by name`,
    role ? [req.tenant.id, role] : [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/staff', wrap(async (req, res) => {
  const { name, phone, email, role = 'support' } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
  const { rows: [s] } = await pool.query(
    `insert into staff (tenant_id, name, phone, email, role) values ($1,$2,$3,$4,$5)
     on conflict (tenant_id, phone) do update set name=excluded.name, email=excluded.email, role=excluded.role
     returning *`,
    [req.tenant.id, name, phone, email ?? null, role]);
  res.json(s);
}));

app.delete('/api/staff/:id', wrap(async (req, res) => {
  await pool.query('delete from staff where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

// ── tickets and leads: status changes ─────────────
app.patch('/api/tickets/:id', wrap(async (req, res) => {
  const allowed = ['status', 'priority', 'assigned_to', 'subject', 'description', 'due_at'];
  const sets = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  const { rows: [t] } = await pool.query(
    `update tickets set ${sets.map((k, i) => `${k}=$${i + 3}`).join(', ')}, updated_at=now()
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, ...sets.map((k) => req.body[k])]);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
}));

app.delete('/api/tickets/:id', wrap(async (req, res) => {
  await pool.query('delete from tickets where tenant_id=$1 and id=$2', [req.tenant.id, req.params.id]);
  res.json({ ok: true });
}));

app.patch('/api/leads/:id', wrap(async (req, res) => {
  const allowed = ['status', 'name', 'phone', 'source'];
  const sets = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  const { rows: [l] } = await pool.query(
    `update leads set ${sets.map((k, i) => `${k}=$${i + 3}`).join(', ')}
     where tenant_id=$1 and id=$2 returning *`,
    [req.tenant.id, req.params.id, ...sets.map((k) => req.body[k])]);
  if (!l) return res.status(404).json({ error: 'not found' });
  res.json(l);
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
      "select phone from subscribers where tenant_id=$1 and router_id=$2 and status in ('active','grace')",
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
app.get('/api/kb-articles', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from kb_articles where tenant_id=$1 order by updated_at desc', [req.tenant.id]);
  res.json(rows);
}));

app.post('/api/kb-articles', wrap(async (req, res) => {
  const { title, category, body = '', published = true } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const { rows: [a] } = await pool.query(
    `insert into kb_articles (tenant_id, title, category, body, published)
     values ($1,$2,$3,$4,$5) returning *`,
    [req.tenant.id, title, category ?? null, body, published]);
  res.json(a);
}));

app.delete('/api/kb-articles/:id', wrap(async (req, res) => {
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
app.put('/api/payment-methods/:provider', wrap(async (req, res) => {
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
app.get('/api/ovpn-clients', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select id, username, assigned_ip, connected_at, created_at from ovpn_clients where tenant_id=$1 order by username',
    [req.tenant.id]);
  res.json(rows);
}));

// ── SMS history and bulk send (Messaging screen) ──
app.get('/api/sms/history', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from sms_log where tenant_id=$1 order by at desc limit 500', [req.tenant.id]);
  res.json(rows);
}));

/** Send one SMS to an arbitrary number — voucher resends, one-off notices. */
app.post('/api/sms/send', wrap(async (req, res) => {
  const { phone, body } = req.body;
  if (!phone || !body?.trim()) return res.status(400).json({ error: 'phone and body are required' });
  const { send } = await import('./sms.js');
  await send(req.tenant.id, phone, 'custom', { body });
  res.json({ ok: true });
}));

/** Bulk SMS. Audience is resolved server-side so the browser never sends a phone list. */
app.post('/api/sms/bulk', wrap(async (req, res) => {
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

  res.json({ queued: rows.length });

  // One lookup for the whole run rather than per recipient.
  const org = await sms.orgVars(req.tenant.id);
  for (const s of rows) {
    const vars = { ...sms.subscriberVars(s, org), body };
    for (const n of [...new Set([s.phone, s.phone_alt].filter(Boolean))]) {
      await sms.send(req.tenant.id, n, 'custom', vars).catch(() => {});
    }
  }
}));

/** The tokens a template may contain, for the message composer to offer. */
app.get('/api/sms/placeholders', wrap(async (_req, res) => {
  const { PLACEHOLDERS } = await import('./sms.js');
  res.json(PLACEHOLDERS);
}));

// ── tenants and platform billing (owner screens) ──
// Hiding these in the sidebar is not access control: every tenant's revenue is
// behind them, so the routes check the session themselves.
const superAdminOnly = (req, res, next) =>
  req.session?.is_super_admin ? next() : res.status(403).json({ error: 'platform owner only' });

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

app.post('/api/tenants', superAdminOnly, wrap(async (req, res) => {
  const { name, subdomain, planType = 'flat', planAmount, revsharePct, supportPhone } = req.body;
  if (!name || !subdomain) return res.status(400).json({ error: 'name and subdomain are required' });
  const { rows: [t] } = await pool.query(
    `insert into tenants (name, subdomain, plan_type, plan_amount, revshare_pct, support_phone)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [name, subdomain, planType, planAmount ?? null, revsharePct ?? null, supportPhone ?? null]);
  res.json(t);
}));

app.patch('/api/tenants/:id', superAdminOnly, wrap(async (req, res) => {
  const allowed = ['status', 'plan_type', 'plan_amount', 'revshare_pct', 'licence_ends', 'support_phone'];
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
 * Reset a tenant owner's sign-in details.
 *
 * Operators lock themselves out and there was nobody who could help — no reset
 * path existed at all, so the only recovery was editing the database by hand.
 * The password is returned once so it can be read down the phone, and stored
 * only as a hash.
 */
app.post('/api/tenants/:id/owner', superAdminOnly, wrap(async (req, res) => {
  const { email, username, password } = req.body ?? {};

  const { rows: [owner] } = await pool.query(
    // staff has no created_at; id is stable and there is normally one owner.
    "select id from staff where tenant_id=$1 and role='owner' order by id limit 1",
    [req.params.id]);
  if (!owner) return res.status(404).json({ error: 'That tenant has no owner account.' });

  // Both are unique across the whole platform, so a clash has to be caught here
  // rather than surfacing as a constraint violation the operator cannot read.
  if (email) {
    const { rowCount } = await pool.query(
      'select 1 from staff where lower(email)=lower($1) and id<>$2', [String(email).trim(), owner.id]);
    if (rowCount) return res.status(409).json({ error: 'Another account already uses that email.' });
  }
  const user = username ? String(username).toLowerCase().replace(/[^a-z0-9._-]/g, '') : null;
  if (user) {
    const { rowCount } = await pool.query(
      'select 1 from staff where lower(username)=lower($1) and id<>$2', [user, owner.id]);
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
    [owner.id, email ? String(email).trim() : '', user, hash]);

  // Signing them out everywhere: a reset that leaves old sessions alive has not
  // actually taken the account back.
  if (fresh) await pool.query('delete from admin_sessions where staff_id=$1', [owner.id]);

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
app.get('/api/tickets/:id', wrap(async (req, res) => {
  const { rows: [t] } = await pool.query(
    `select tk.*, s.name as subscriber_name, s.phone as subscriber_phone, st.name as assignee_name
     from tickets tk
     left join subscribers s on s.id = tk.subscriber_id
     left join staff st on st.id = tk.assigned_to
     where tk.tenant_id=$1 and tk.id=$2`, [req.tenant.id, req.params.id]);
  if (!t) return res.status(404).json({ error: 'not found' });
  const { rows: notes } = await pool.query(
    'select * from ticket_notes where ticket_id=$1 order by at', [req.params.id]);
  res.json({ ...t, notes });
}));

app.post('/api/tickets/:id/notes', wrap(async (req, res) => {
  const { body, internal = true } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Write something first' });
  const { rows: [n] } = await pool.query(
    `insert into ticket_notes (tenant_id, ticket_id, author, body, internal)
     values ($1,$2,$3,$4,$5) returning *`,
    [req.tenant.id, req.params.id, req.session?.name ?? 'system', body, internal]);
  await pool.query('update tickets set updated_at=now() where id=$1', [req.params.id]);
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
    `select id, provider, label, shortcode, is_default, enabled_pppoe, enabled_hotspot,
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

app.post('/api/payment-gateways', wrap(async (req, res) => {
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
app.get('/api/payment-gateways/:id/credentials', wrap(async (req, res) => {
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
app.post('/api/payment-gateways/:id/register-urls', wrap(async (req, res) => {
  const { rows: [g] } = await pool.query(
    'select provider, shortcode from tenant_payment_config where id=$1 and tenant_id=$2',
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
    const out = await mpesa.registerC2B(req.tenant.id);
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

app.put('/api/payment-gateways/:id', wrap(async (req, res) => {
  const { label, shortcode, credentials, enabledPppoe, enabledHotspot } = req.body;
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
  if (g.provider === 'kopokopo' && enabledPppoe)
    return res.status(400).json({ error: 'KopoKopo is hotspot-only' });
  res.json({ ok: true });
}));

app.post('/api/payment-gateways/:id/default', wrap(async (req, res) => {
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

app.delete('/api/payment-gateways/:id', wrap(async (req, res) => {
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
];

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

app.put('/api/automation/:job', wrap(async (req, res) => {
  if (!AUTOMATION_JOBS.some((j) => j.job === req.params.job))
    return res.status(404).json({ error: 'unknown job' });
  const enabled = req.body.enabled !== false;
  await pool.query(
    `insert into automation_jobs (tenant_id, job, enabled) values ($1,$2,$3)
     on conflict (tenant_id, job) do update set enabled=excluded.enabled, updated_at=now()`,
    [req.tenant.id, req.params.job, enabled]);
  res.json({ job: req.params.job, enabled });
}));

// ── organisation settings (Settings screen) ───────
app.get('/api/settings', wrap(async (req, res) => {
  const { rows: [extra] } = await pool.query('select * from app_settings where tenant_id=$1', [req.tenant.id]);
  const { id, name, subdomain, currency, timezone, kra_pin, support_phone, licence_ends, status } = req.tenant;
  res.json({
    org: { id, name, subdomain, currency, timezone, kra_pin, support_phone, licence_ends, status },
    smtp: extra?.smtp ?? {},
    prefs: extra?.prefs ?? {},
  });
}));

app.put('/api/settings', wrap(async (req, res) => {
  const { org, smtp, prefs } = req.body;
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
      `insert into app_settings (tenant_id, smtp, prefs) values ($1, $2, $3)
       on conflict (tenant_id) do update set
         smtp = coalesce($2, app_settings.smtp), prefs = coalesce($3, app_settings.prefs)`,
      [req.tenant.id, smtp ?? null, prefs ?? null]);
  }
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
