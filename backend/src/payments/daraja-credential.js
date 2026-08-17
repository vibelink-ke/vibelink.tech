/**
 * The SecurityCredential every Daraja payout call needs.
 *
 * B2C, reversal, account balance and transaction status do not take the
 * initiator password directly. They take it RSA-encrypted with Safaricom's
 * public key and base64-encoded, so the password never crosses the wire in a
 * form anyone but Safaricom can read.
 *
 * The certificates are Safaricom's own and are published in their
 * documentation — there is nothing secret in this directory. The initiator
 * password is the secret, it belongs to the tenant, and it is stored encrypted
 * like every other gateway credential.
 *
 * Both certificates are long expired: production in 2018, sandbox in 2016.
 * Safaricom has never reissued them and still ships them, because only the
 * public key is used and Safaricom decrypts with the matching private key —
 * nothing validates a date. Node is asked for the public key directly rather
 * than verifying a chain, so expiry is not consulted here either. If Safaricom
 * ever does reissue, replace the file; nothing else changes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.join(here, '..', '..', 'certs');

const cache = new Map();

function publicKey(env) {
  const which = env === 'sandbox' ? 'sandbox' : 'production';
  if (cache.has(which)) return cache.get(which);

  const file = path.join(certDir, `daraja-${which}.cer`);
  let pem;
  try {
    pem = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`Safaricom's ${which} certificate is missing from backend/certs. `
      + 'Payouts cannot be signed without it.');
  }

  const key = new crypto.X509Certificate(pem).publicKey;
  cache.set(which, key);
  return key;
}

/**
 * Encrypt the initiator password for one API call.
 *
 * PKCS#1 v1.5 padding, which is what Safaricom's endpoint expects. OAEP is the
 * better padding in general and is rejected here — this is one of the few places
 * where following the counterparty matters more than following the guidance.
 */
export function securityCredential(initiatorPassword, env = process.env.DARAJA_ENV) {
  const password = String(initiatorPassword ?? '').trim();
  if (!password) {
    throw new Error('No initiator password is set for this gateway, so payouts cannot be signed.');
  }
  return crypto.publicEncrypt(
    { key: publicKey(env), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(password, 'utf8'),
  ).toString('base64');
}

/** Which certificate is in use, for showing on the settings screen. */
export function certificateInfo(env = process.env.DARAJA_ENV) {
  const which = env === 'sandbox' ? 'sandbox' : 'production';
  const file = path.join(certDir, `daraja-${which}.cer`);
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(file, 'utf8'));
    return { environment: which, subject: cert.subject, validTo: cert.validTo, present: true };
  } catch {
    return { environment: which, present: false };
  }
}
