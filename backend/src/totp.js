import express from 'express';
import crypto from 'node:crypto';
import { encrypt, decrypt } from './secrets.js';

/**
 * Authenticator-app sign-in (TOTP, RFC 6238): the six-digit code that Google Authenticator, Microsoft Authenticator,
 * Authy and 1Password show and change every 30 seconds.
 *
 * A staff member turns it on for themselves (My account). After that the password alone no longer signs them in: the
 * password step hands back a short-lived challenge, and a code from the app (or one of ten one-time backup codes)
 * completes it. The secret is kept encrypted; a code can be used only once (a later time-step than the last accepted
 * one); a challenge allows five wrong tries. Fingerprint (passkey) sign-in is its own second factor and is not asked
 * again. A magic link is refused while this is on, since an email link alone would go around it.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_TRIES = 5;

export function base32(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function unbase32(str) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

/** The time-step a code matches (within one step either side, for clock drift), or null. */
export function matchStep(secret, code, now = Date.now()) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^[0-9]{6}$/.test(c)) return null;
  const cur = Math.floor(now / 1000 / STEP);
  for (const step of [cur, cur - 1, cur + 1]) {
    const a = Buffer.from(hotp(secret, step)); const b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return step;
  }
  return null;
}

export const newSecret = () => base32(crypto.randomBytes(20));
export const otpauthUri = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

const hashCode = (c) => crypto.createHash('sha256').update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
const makeBackupCodes = () => Array.from({ length: 10 }, () => {
  const raw = base32(crypto.randomBytes(5)).slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
});

const challenges = new Map();
export function issueChallenge(staffId, tenantId, remember) {
  const id = crypto.randomBytes(24).toString('base64url');
  challenges.set(id, { staffId, tenantId, remember, tries: 0, exp: Date.now() + CHALLENGE_TTL_MS });
  for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k);
  return id;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function totpEnabled(pool, staffId) {
  const { rows: [r] } = await pool.query('select 1 from staff_totp where staff_id=$1 and enabled', [staffId]);
  return !!r;
}

/** Checks a six-digit code or a backup code for a staff member; spends whichever it was. */
async function checkCode(pool, staffId, code) {
  const { rows: [t] } = await pool.query('select secret_enc, last_step from staff_totp where staff_id=$1 and enabled', [staffId]);
  if (!t) return false;
  const secret = decrypt(t.secret_enc);
  const step = secret ? matchStep(secret, code) : null;
  if (step !== null) {
    const { rowCount } = await pool.query(
      'update staff_totp set last_step=$2 where staff_id=$1 and (last_step is null or last_step < $2)', [staffId, step]);
    return rowCount > 0;
  }
  const { rowCount } = await pool.query(
    'update staff_backup_codes set used_at=now() where staff_id=$1 and code_hash=$2 and used_at is null',
    [staffId, hashCode(code)]);
  return rowCount > 0;
}

export function totpRouter({ pool, auth, limiter, finishSignIn }) {
  const router = express.Router();

  const me = wrap(async (req, res, next) => {
    const s = await auth.readSession(auth.sessionToken(req));
    if (!s) return res.status(401).json({ error: 'Sign in first.' });
    req.me = s;
    next();
  });

  router.get('/', me, wrap(async (req, res) => {
    const { rows: [t] } = await pool.query('select enabled from staff_totp where staff_id=$1', [req.me.staff_id]);
    const { rows: [b] } = await pool.query(
      'select count(*)::int as n from staff_backup_codes where staff_id=$1 and used_at is null', [req.me.staff_id]);
    res.json({ enabled: !!t?.enabled, backupLeft: t?.enabled ? b.n : 0 });
  }));

  // Step 1: a fresh secret, not yet in force, for the app to scan.
  router.post('/setup', me, wrap(async (req, res) => {
    if (await totpEnabled(pool, req.me.staff_id)) return res.status(409).json({ error: 'Two-step sign-in is already on. Turn it off first to set it up again.' });
    const secret = newSecret();
    await pool.query(
      `insert into staff_totp (staff_id, tenant_id, secret_enc, enabled, last_step) values ($1,$2,$3,false,null)
       on conflict (staff_id) do update set secret_enc=excluded.secret_enc, enabled=false, last_step=null`,
      [req.me.staff_id, req.me.tenant_id, encrypt(secret)]);
    const account = req.me.email || req.me.username || req.me.name || 'user';
    res.json({ secret, uri: otpauthUri(secret, account, req.me.company || 'Vibelink') });
  }));

  // Step 2: prove the app is showing the right codes, then it is on. The backup codes are shown once.
  router.post('/enable', me, limiter, wrap(async (req, res) => {
    const { rows: [t] } = await pool.query('select secret_enc, enabled from staff_totp where staff_id=$1', [req.me.staff_id]);
    if (!t || t.enabled) return res.status(400).json({ error: 'Start the setup first.' });
    const step = matchStep(decrypt(t.secret_enc) ?? '', req.body?.code);
    if (step === null) return res.status(400).json({ error: 'That code is not right. Check the app and try the current one.' });
    const codes = makeBackupCodes();
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('update staff_totp set enabled=true, last_step=$2, confirmed_at=now() where staff_id=$1', [req.me.staff_id, step]);
      await c.query('delete from staff_backup_codes where staff_id=$1', [req.me.staff_id]);
      for (const code of codes) await c.query('insert into staff_backup_codes (staff_id, code_hash) values ($1,$2)', [req.me.staff_id, hashCode(code)]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    res.json({ ok: true, backupCodes: codes });
  }));

  // Turning it off, or making new backup codes, needs the password and a current code.
  const strong = wrap(async (req, res, next) => {
    const { rows: [st] } = await pool.query('select password_hash from staff where id=$1', [req.me.staff_id]);
    if (!(await auth.verifyPassword(req.body?.password ?? '', st?.password_hash))) return res.status(401).json({ error: 'That password is not correct.' });
    if (!(await checkCode(pool, req.me.staff_id, req.body?.code))) return res.status(400).json({ error: 'That code is not right.' });
    next();
  });

  router.post('/disable', me, limiter, strong, wrap(async (req, res) => {
    await pool.query('delete from staff_totp where staff_id=$1', [req.me.staff_id]);
    await pool.query('delete from staff_backup_codes where staff_id=$1', [req.me.staff_id]);
    res.json({ ok: true });
  }));

  router.post('/backup-codes', me, limiter, strong, wrap(async (req, res) => {
    const codes = makeBackupCodes();
    await pool.query('delete from staff_backup_codes where staff_id=$1', [req.me.staff_id]);
    for (const code of codes) await pool.query('insert into staff_backup_codes (staff_id, code_hash) values ($1,$2)', [req.me.staff_id, hashCode(code)]);
    res.json({ backupCodes: codes });
  }));

  // An owner clears a colleague's authenticator (a lost phone) so they can sign in and set it up again.
  router.post('/reset/:staffId', me, wrap(async (req, res) => {
    if (req.me.role !== 'owner' && !req.me.is_super_admin) return res.status(403).json({ error: 'Only an owner can reset a colleague’s authenticator.' });
    if (req.params.staffId === req.me.staff_id) return res.status(400).json({ error: 'Use "Turn off" for your own account.' });
    const { rows: [target] } = await pool.query('select id from staff where id=$1 and tenant_id=$2', [req.params.staffId, req.me.tenant_id]);
    if (!target) return res.status(404).json({ error: 'No such staff member.' });
    await pool.query('delete from staff_totp where staff_id=$1', [target.id]);
    await pool.query('delete from staff_backup_codes where staff_id=$1', [target.id]);
    res.json({ ok: true });
  }));

  // The second step of signing in. Public: the challenge proves the password step was passed.
  router.post('/login', limiter, wrap(async (req, res) => {
    const id = String(req.body?.challengeId ?? '');
    const ch = challenges.get(id);
    if (!ch || ch.exp < Date.now()) { challenges.delete(id); return res.status(400).json({ error: 'That took too long. Enter your password again.', expired: true }); }
    ch.tries += 1;
    if (ch.tries > MAX_TRIES) { challenges.delete(id); return res.status(429).json({ error: 'Too many wrong codes. Enter your password again.', expired: true }); }
    if (!(await checkCode(pool, ch.staffId, req.body?.code))) return res.status(401).json({ error: 'That code is not right.' });
    challenges.delete(id);
    res.json(await finishSignIn(req, res, ch.staffId, ch.tenantId, ch.remember));
  }));

  return router;
}
