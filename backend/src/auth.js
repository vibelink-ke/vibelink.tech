import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';

const scrypt = promisify(crypto.scrypt);

const SESSION_COOKIE = 'billing_session';
const SESSION_DAYS = 30;
const SHORT_SESSION_HOURS = 12;   // "Keep me signed in" unchecked

/* ── password hashing ─────────────────────────────────────── */

/** scrypt with a per-password salt. Format: scrypt$N$salt$hash, all base64. */
export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const key = await scrypt(plain, salt, 64, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Constant-time verify. Returns false rather than throwing on a malformed hash. */
export async function verifyPassword(plain, stored) {
  if (!stored) return false;
  const [scheme, N, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scrypt(plain, salt, expected.length, { N: Number(N), r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ── sessions ─────────────────────────────────────────────── */

export async function createSession(staffId, tenantId, { remember = true } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ms = remember ? SESSION_DAYS * 864e5 : SHORT_SESSION_HOURS * 36e5;
  const expiresAt = new Date(Date.now() + ms);
  await pool.query(
    'insert into admin_sessions (token, staff_id, tenant_id, expires_at) values ($1,$2,$3,$4)',
    [token, staffId, tenantId, expiresAt]
  );
  return { token, expiresAt };
}

export async function readSession(token) {
  if (!token) return null;
  const { rows: [row] } = await pool.query(
    `select s.token, s.tenant_id, st.id as staff_id, st.name, st.email, st.username,
            st.role, st.is_super_admin,
            t.name as company, t.subdomain, t.status as tenant_status
     from admin_sessions s
     join staff st on st.id = s.staff_id
     join tenants t on t.id = s.tenant_id
     where s.token = $1 and s.expires_at > now()`,
    [token]
  );
  return row ?? null;
}

export const destroySession = (token) =>
  pool.query('delete from admin_sessions where token = $1', [token]);

/* ── handing a session to another subdomain ───────────────── */

const HANDOFF_SECONDS = 60;

/** One-use ticket the apex gives out so a tenant's own hostname can adopt the session. */
export async function createHandoff(sessionToken) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `insert into session_handoffs (token, session_token, expires_at)
     values ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [token, sessionToken, HANDOFF_SECONDS]
  );
  return token;
}

/**
 * Redeem a ticket, at most once.
 *
 * The update is the guard: `used_at is null` inside the statement means two
 * simultaneous requests cannot both come away with the session, without needing
 * a transaction around a read.
 */
export async function consumeHandoff(token) {
  if (!token) return null;
  const { rows: [row] } = await pool.query(
    `update session_handoffs set used_at = now()
      where token = $1 and used_at is null and expires_at > now()
      returning session_token`,
    [token]
  );
  return row?.session_token ?? null;
}

export const pruneHandoffs = () =>
  pool.query('delete from session_handoffs where expires_at < now()').catch(() => {});

/* ── password reset / magic-link sign-in ─────────────────────── */

const RESET_MINUTES = 30;
const MAGIC_MINUTES = 15;

/** Minted for a staff row before any session exists — that is what it is for. */
export async function createLoginToken(staffId, purpose) {
  const token = crypto.randomBytes(24).toString('base64url');
  const minutes = purpose === 'magic' ? MAGIC_MINUTES : RESET_MINUTES;
  await pool.query(
    `insert into login_tokens (token, staff_id, purpose, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [token, staffId, purpose, minutes]
  );
  return token;
}

/** Redeem at most once, and only for the purpose it was minted for. */
export async function consumeLoginToken(token, purpose) {
  if (!token) return null;
  const { rows: [row] } = await pool.query(
    `update login_tokens set used_at = now()
      where token = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning staff_id`,
    [token, purpose]
  );
  return row?.staff_id ?? null;
}

export const pruneLoginTokens = () =>
  pool.query('delete from login_tokens where expires_at < now()').catch(() => {});

/** Opportunistic cleanup so expired rows do not accumulate. */
export const pruneSessions = () =>
  pool.query('delete from admin_sessions where expires_at < now()').catch(() => {});

/* ── cookie plumbing ──────────────────────────────────────── */

export function setSessionCookie(res, token, expiresAt) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  // Secure would break plain-http local development; set it everywhere else.
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Minimal cookie parse — avoids pulling in cookie-parser for one value. */
export function sessionToken(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const pair of raw.split(';')) {
    const i = pair.indexOf('=');
    if (i === -1) continue;
    if (pair.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(pair.slice(i + 1).trim());
  }
  return null;
}

/** Shape handed to the browser. Never includes the hash or the token. */
export const publicSession = (s) => ({
  email: s.email,
  username: s.username,
  name: s.name,
  role: s.role,
  company: s.company,
  subdomain: s.subdomain,
  superAdmin: s.is_super_admin,
});
