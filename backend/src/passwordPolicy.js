import crypto from 'node:crypto';

/**
 * What a password has to contain, checked wherever someone chooses one.
 * (frontend/src/lib/password.js applies the same rules so the form can say
 * what is missing before it is sent; this is the one that actually enforces.)
 *
 * At least 8 characters, with a lowercase letter, an uppercase letter, a
 * number and a special character. Only ever applied when a password is being
 * set — nobody is locked out for having an older, weaker one.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** null when the password is acceptable, otherwise a sentence saying what it lacks. */
export function passwordProblem(password) {
  const s = String(password ?? '');
  if (s.length > PASSWORD_MAX) return `Password is too long — ${PASSWORD_MAX} characters at most.`;
  const missing = [];
  if (s.length < PASSWORD_MIN) missing.push(`at least ${PASSWORD_MIN} characters`);
  if (!/[a-z]/.test(s)) missing.push('a lowercase letter');
  if (!/[A-Z]/.test(s)) missing.push('an uppercase letter');
  if (!/[0-9]/.test(s)) missing.push('a number');
  if (!/[^A-Za-z0-9]/.test(s)) missing.push('a special character (such as ! @ # $ %)');
  if (!missing.length) return null;
  const last = missing.pop();
  return `Password needs ${missing.length ? `${missing.join(', ')} and ${last}` : last}.`;
}

// Left out on purpose: 0/O, 1/l/I — passwords get read off a screen and typed
// on a phone, and those are the ones that get mistyped.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '!@#$%&*?-_+=';

/** A random password that meets the rules above, with at least one of each kind. */
export function generatePassword(length = 12) {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  const all = UPPER + LOWER + DIGITS + SPECIAL;
  while (chars.length < Math.max(length, PASSWORD_MIN)) chars.push(pick(all));
  // Shuffle, so the guaranteed characters are not always the first four.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
