import express from 'express';
import crypto from 'node:crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

/**
 * Sign in with a fingerprint (or face, or screen lock): passkeys, the WebAuthn standard phones and laptops support.
 *
 * A staff member turns it on once, while signed in, on the device they want to use. The device makes a key pair and
 * keeps the private half behind its fingerprint sensor; we keep only the public half. Signing in afterwards asks the
 * device to sign a one-off challenge, which only works after the fingerprint check, so no password is typed or sent.
 *
 * A passkey belongs to the address it was made on (the tenant's own portal host), so it can only be used there — the
 * browser enforces that, and we check it again here. Signing in through one is scoped to the tenant exactly as the
 * password login is: a passkey for another tenant's host does not open this one.
 *
 * Challenges are held in memory for five minutes and used once. That is enough for a single API process, which is what
 * runs here; a second one would need them in the database.
 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challenges = new Map();

const remember = (data) => {
  const id = crypto.randomBytes(18).toString('base64url');
  challenges.set(id, { ...data, exp: Date.now() + CHALLENGE_TTL_MS });
  for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k);
  return id;
};
const take = (id) => {
  const c = challenges.get(String(id ?? ''));
  challenges.delete(String(id ?? ''));
  return c && c.exp >= Date.now() ? c : null;
};

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function passkeyRouter({ pool, auth, tenantByHost, limiter }) {
  const router = express.Router();
  const rpIdOf = (req) => req.hostname;
  const originOf = (req) => `${req.protocol}://${req.get('host')}`;

  /** The signed-in staff member, or a 401. This router is mounted before the app's tenant resolver, so it reads the session itself. */
  const me = wrap(async (req, res, next) => {
    const s = await auth.readSession(auth.sessionToken(req));
    if (!s) return res.status(401).json({ error: 'Sign in first.' });
    req.me = s;
    next();
  });

  // ── managing your own passkeys ─────────────────────────────
  router.get('/', me, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select id, label, created_at, last_used_at from staff_passkeys where staff_id = $1 and rp_id = $2 order by created_at`,
      [req.me.staff_id, rpIdOf(req)]);
    res.json(rows);
  }));

  router.post('/register/options', me, wrap(async (req, res) => {
    const { rows: existing } = await pool.query('select credential_id, transports from staff_passkeys where staff_id = $1', [req.me.staff_id]);
    const options = await generateRegistrationOptions({
      rpName: req.me.company || 'Vibelink',
      rpID: rpIdOf(req),
      userName: req.me.email || req.me.username || req.me.name || 'user',
      userDisplayName: req.me.name || req.me.email || 'Vibelink user',
      userID: new TextEncoder().encode(String(req.me.staff_id)),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
      // The device's own fingerprint/face/screen lock, kept on the device and findable at sign-in without typing a name.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
    });
    res.json({ options, challengeId: remember({ challenge: options.challenge, staffId: req.me.staff_id }) });
  }));

  router.post('/register/verify', me, wrap(async (req, res) => {
    const c = take(req.body?.challengeId);
    if (!c || c.staffId !== req.me.staff_id) return res.status(400).json({ error: 'That took too long. Try again.' });
    let v;
    try {
      v = await verifyRegistrationResponse({
        response: req.body.response, expectedChallenge: c.challenge,
        expectedOrigin: originOf(req), expectedRPID: rpIdOf(req), requireUserVerification: true,
      });
    } catch (e) {
      return res.status(400).json({ error: `Could not set it up: ${e.message}` });
    }
    if (!v.verified || !v.registrationInfo) return res.status(400).json({ error: 'The device could not be verified.' });
    const { credential } = v.registrationInfo;
    const label = String(req.body?.label ?? '').trim().slice(0, 60) || 'This device';
    await pool.query(
      `insert into staff_passkeys (staff_id, tenant_id, credential_id, public_key, counter, transports, label, rp_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (credential_id) do update set public_key = excluded.public_key, counter = excluded.counter, label = excluded.label`,
      [req.me.staff_id, req.me.tenant_id, credential.id, Buffer.from(credential.publicKey), credential.counter,
        credential.transports ?? null, label, rpIdOf(req)]);
    res.json({ ok: true });
  }));

  router.delete('/:id', me, wrap(async (req, res) => {
    const { rowCount } = await pool.query('delete from staff_passkeys where id = $1 and staff_id = $2', [req.params.id, req.me.staff_id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  }));

  // ── signing in ─────────────────────────────────────────────
  router.post('/login/options', limiter, wrap(async (req, res) => {
    const options = await generateAuthenticationOptions({ rpID: rpIdOf(req), userVerification: 'required' });
    res.json({ options, challengeId: remember({ challenge: options.challenge }) });
  }));

  router.post('/login/verify', limiter, wrap(async (req, res) => {
    const c = take(req.body?.challengeId);
    const response = req.body?.response;
    if (!c || !response?.id) return res.status(400).json({ error: 'That took too long. Try again.' });

    const { rows: [pk] } = await pool.query(
      'select * from staff_passkeys where credential_id = $1 and rp_id = $2', [response.id, rpIdOf(req)]);
    if (!pk) return res.status(401).json({ error: 'This device is not set up for fingerprint sign-in here.' });

    let v;
    try {
      v = await verifyAuthenticationResponse({
        response, expectedChallenge: c.challenge, expectedOrigin: originOf(req), expectedRPID: rpIdOf(req),
        credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports ?? undefined },
        requireUserVerification: true,
      });
    } catch (e) {
      return res.status(401).json({ error: 'The fingerprint could not be verified.' });
    }
    if (!v.verified) return res.status(401).json({ error: 'The fingerprint could not be verified.' });

    // The same door checks as the password login.
    const tenant = await tenantByHost(req.hostname)
      ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
    const { rows: [acct] } = await pool.query(
      `select st.*, t.status as tenant_status, t.subdomain from staff st join tenants t on t.id = st.tenant_id
        where st.id = $1 and ($2::uuid is null or st.tenant_id = $2)`,
      [pk.staff_id, tenant?.id ?? null]);
    if (!acct) return res.status(401).json({ error: 'This device is not set up for fingerprint sign-in here.' });
    if (acct.tenant_status === 'suspended') return res.status(402).json({ error: 'This account is suspended. Contact support.' });

    await pool.query('update staff_passkeys set counter = $2, last_used_at = now() where id = $1', [pk.id, v.authenticationInfo.newCounter]);

    const { token, expiresAt } = await auth.createSession(acct.id, acct.tenant_id, { remember: true });
    auth.setSessionCookie(res, token, expiresAt);
    await pool.query('update staff set last_seen = now() where id = $1', [acct.id]);
    auth.pruneSessions();
    const s = await auth.readSession(token);

    let redirectTo = null;
    const root = process.env.ROOT_DOMAIN?.trim();
    if (!tenant && root && s.subdomain && req.hostname !== `${s.subdomain}.${root}`) {
      const handoff = await auth.createHandoff(token);
      redirectTo = `https://${s.subdomain}.${root}/api/auth/handoff?token=${encodeURIComponent(handoff)}`;
    }
    res.json({ ...(await auth.publicSession(s)), redirectTo });
  }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    console.error('passkey:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' });
  });

  return router;
}
