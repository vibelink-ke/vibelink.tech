/**
 * Encryption for credentials the app must be able to *use* later, so they cannot
 * be hashed the way passwords are.
 *
 * Router admin passwords are the first of these. A stolen database dump should
 * not hand someone administrative access to every customer's MikroTik, so the
 * ciphertext lives in Postgres and the key lives in the environment — two places
 * an attacker has to reach instead of one.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly on decrypt
 * rather than returning plausible rubbish.
 */
import crypto from 'node:crypto';

const SALT = 'vibelink/secrets/v1';   // fixed: the key is the secret, not the salt

let cachedKey = null;

function key() {
  if (cachedKey) return cachedKey;
  const raw = process.env.APP_SECRET_KEY?.trim();
  if (!raw) {
    throw new Error(
      'APP_SECRET_KEY is not set, so credentials cannot be stored safely. ' +
      'Generate one with: openssl rand -base64 32'
    );
  }
  if (raw.length < 16) throw new Error('APP_SECRET_KEY is too short — use at least 32 random bytes.');
  // scrypt so any passphrase becomes a proper 32-byte key rather than being
  // truncated or padded into one.
  cachedKey = crypto.scryptSync(raw, SALT, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return cachedKey;
}

/** Returns "v1.<iv>.<tag>.<ciphertext>", all base64. */
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

/** Null rather than throwing on anything unreadable — a bad row must not take out the request. */
export function decrypt(blob) {
  if (!blob) return null;
  try {
    const [version, ivB64, tagB64, bodyB64] = String(blob).split('.');
    if (version !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** True when a key is configured, so callers can fail early with a useful message. */
export const configured = () => Boolean(process.env.APP_SECRET_KEY?.trim());

/** Router service-account passwords. Avoids characters RouterOS quoting dislikes. */
export const randomPassword = (bytes = 24) =>
  crypto.randomBytes(bytes).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 28);
