/**
 * Dates in messages, in Nairobi time.
 *
 * The api container is node:22-alpine with no TZ, so it runs in UTC, and
 * toLocaleString('en-KE') with no zone named prints UTC — a voucher SMS said
 * the code expired three hours before it really did. Naming the zone makes
 * the text independent of the container (Node's bundled ICU carries the zone
 * data), the same approach ceilToMidnight and radiusDate already take.
 */
const TZ = 'Africa/Nairobi';

export const fmtNairobi = (d, opts) => new Date(d).toLocaleString('en-KE', { timeZone: TZ, ...opts });
export const fmtNairobiDate = (d) => new Date(d).toLocaleDateString('en-KE', { timeZone: TZ });

/** 'YYYY-MM-DD' for d's Nairobi calendar date — en-CA is the locale that happens to format that way. */
export const fmtNairobiIso = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });

/**
 * The UTC instant of Nairobi midnight, offsetDays from d's own Nairobi calendar date — 0 for "today
 * at 00:00 Nairobi time", 1 for tomorrow's, -6 for six days before today's. Same conversion
 * payments/apply.js's ceilToMidnight already uses: Nairobi has a fixed UTC+3 offset year-round (no
 * DST), so a Nairobi midnight is always that UTC calendar date at 00:00 UTC, minus 3 hours.
 */
export function nairobiMidnight(d = new Date(), offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + offsetDays, 0, 0, 0, 0) - 3 * 3600 * 1000);
}
