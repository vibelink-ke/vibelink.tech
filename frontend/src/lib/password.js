/**
 * Password rules and suggestions for the forms that set one.
 * Mirrors backend/src/passwordPolicy.js, which is what enforces them.
 */
export const PASSWORD_MIN = 8;

export const PASSWORD_RULES = [
  { key: 'length', label: '8 or more characters (12 is better)', test: (s) => s.length >= PASSWORD_MIN },
  { key: 'lower', label: 'A lowercase letter', test: (s) => /[a-z]/.test(s) },
  { key: 'upper', label: 'An uppercase letter', test: (s) => /[A-Z]/.test(s) },
  { key: 'number', label: 'A number', test: (s) => /[0-9]/.test(s) },
  { key: 'special', label: 'A special character (! @ # $ % …)', test: (s) => /[^A-Za-z0-9]/.test(s) },
];

/** Each rule with whether the password meets it, plus an overall `ok`. */
export function checkPassword(password) {
  const s = String(password ?? '');
  const rules = PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, ok: r.test(s) }));
  return { rules, ok: rules.every((r) => r.ok) };
}

/** null when fine, otherwise what is missing — worded like the server's message. */
export function passwordProblem(password) {
  const s = String(password ?? '');
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

// No 0/O or 1/l/I: these get read off a screen and typed on a phone.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '!@#$%&*?-_+=';

/** Uniform random index below n, from the browser's secure generator (no modulo bias). */
function randomBelow(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

/** A random 12-character password with at least one of each kind. */
export function generatePassword(length = 12) {
  const pick = (set) => set[randomBelow(set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  const all = UPPER + LOWER + DIGITS + SPECIAL;
  while (chars.length < Math.max(length, PASSWORD_MIN)) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
