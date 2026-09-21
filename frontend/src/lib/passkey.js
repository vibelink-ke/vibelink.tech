import { api } from '../api/client';

/**
 * Fingerprint / face / screen-lock sign-in (WebAuthn passkeys), from the browser's side.
 *
 * The server hands over its options as JSON with binary values as base64url text; the browser API wants real buffers
 * and hands back buffers, so this converts both ways. "Turn on" is done once, signed in, on the device to be used; the
 * sign-in button then asks that device to prove itself with its fingerprint. Nothing secret ever leaves the device.
 */
const FLAG = 'vl_passkey';

export const passkeySupported = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext;

/** Whether this browser has had fingerprint sign-in turned on (so the sign-in screen can offer it). */
export const passkeyOnThisDevice = () => {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
};
const setFlag = (on) => { try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch { /* private window */ } };
export const forgetPasskeyFlag = () => setFlag(false);

const toBuf = (b64u) => {
  const s = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const toB64u = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** A friendlier line for the errors the browser throws when the person cancels or the device has nothing set up. */
const explain = (e) => {
  if (e?.name === 'NotAllowedError') return new Error('Cancelled, or the fingerprint was not recognised.');
  if (e?.name === 'InvalidStateError') return new Error('This device is already set up.');
  if (e?.name === 'NotSupportedError') return new Error('This device does not support fingerprint sign-in.');
  return e;
};

/** Turn fingerprint sign-in on for this device. Must be called while signed in. */
export async function enablePasskey(label) {
  try {
    const { options, challengeId } = await api.passkeyRegisterOptions();
    const publicKey = {
      ...options,
      challenge: toBuf(options.challenge),
      user: { ...options.user, id: toBuf(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({ ...c, id: toBuf(c.id) })),
    };
    const cred = await navigator.credentials.create({ publicKey });
    await api.passkeyRegisterVerify({
      challengeId,
      label,
      response: {
        id: cred.id,
        rawId: toB64u(cred.rawId),
        type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
        clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
        response: {
          clientDataJSON: toB64u(cred.response.clientDataJSON),
          attestationObject: toB64u(cred.response.attestationObject),
          transports: cred.response.getTransports?.() ?? [],
        },
      },
    });
    setFlag(true);
  } catch (e) {
    throw explain(e);
  }
}

/** Sign in with the device's fingerprint. Resolves to the same session object a password sign-in does. */
export async function signInWithPasskey() {
  try {
    const { options, challengeId } = await api.passkeyLoginOptions();
    const cred = await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: toBuf(options.challenge),
        allowCredentials: (options.allowCredentials ?? []).map((c) => ({ ...c, id: toBuf(c.id) })),
      },
    });
    return await api.passkeyLoginVerify({
      challengeId,
      response: {
        id: cred.id,
        rawId: toB64u(cred.rawId),
        type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
        clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
        response: {
          clientDataJSON: toB64u(cred.response.clientDataJSON),
          authenticatorData: toB64u(cred.response.authenticatorData),
          signature: toB64u(cred.response.signature),
          userHandle: cred.response.userHandle ? toB64u(cred.response.userHandle) : undefined,
        },
      },
    });
  } catch (e) {
    throw explain(e);
  }
}
