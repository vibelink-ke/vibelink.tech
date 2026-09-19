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
