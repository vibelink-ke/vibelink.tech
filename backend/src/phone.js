import { pool } from './db.js';

/**
 * Countries a tenant can operate in: the dialling code, how long the number is after it, and the local currency.
 * `lead` is the pattern the first digits of a mobile number must match (Kenya's 7xx and 1xx ranges), where one is known;
 * elsewhere any number of the right length is accepted and the mobile network or gateway is left to reject a bad one.
 */
export const COUNTRIES = {
  KE: { name: 'Kenya', cc: '254', len: 9, lead: /^[17]/, currency: 'KES' },
  UG: { name: 'Uganda', cc: '256', len: 9, lead: /^[37]/, currency: 'UGX' },
  TZ: { name: 'Tanzania', cc: '255', len: 9, lead: /^[67]/, currency: 'TZS' },
  RW: { name: 'Rwanda', cc: '250', len: 9, lead: /^7/, currency: 'RWF' },
  GH: { name: 'Ghana', cc: '233', len: 9, lead: /^[25]/, currency: 'GHS' },
  NG: { name: 'Nigeria', cc: '234', len: 10, lead: /^[789]/, currency: 'NGN' },
  ZM: { name: 'Zambia', cc: '260', len: 9, lead: /^[79]/, currency: 'ZMW' },
  ZA: { name: 'South Africa', cc: '27', len: 9, lead: /^[6-8]/, currency: 'ZAR' },
  MW: { name: 'Malawi', cc: '265', len: 9, lead: /^[189]/, currency: 'MWK' },
  ET: { name: 'Ethiopia', cc: '251', len: 9, lead: /^9/, currency: 'ETB' },
  CM: { name: 'Cameroon', cc: '237', len: 9, lead: /^6/, currency: 'XAF' },
  CI: { name: "Côte d'Ivoire", cc: '225', len: 10, lead: null, currency: 'XOF' },
  SN: { name: 'Senegal', cc: '221', len: 9, lead: /^7/, currency: 'XOF' },
};

/**
 * A mobile number in the form every gateway wants (country code, then the number, digits only), or null when it does not
 * look like one for that country. 0712 345 678, +254712345678 and 254712345678 all become 254712345678.
 */
export function normaliseMsisdn(raw, country = 'KE') {
  const c = COUNTRIES[country] ?? COUNTRIES.KE;
  let d = String(raw ?? '').replace(/[^0-9]/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  let national;
  if (d.startsWith(c.cc) && d.length === c.cc.length + c.len) national = d.slice(c.cc.length);
  else if (d.startsWith('0') && d.length === c.len + 1) national = d.slice(1);
  else if (d.length === c.len) national = d;
  else return null;
  if (c.lead && !c.lead.test(national)) return null;
  return `${c.cc}${national}`;
}

const cache = new Map();   // tenantId -> { country, at }

/** The country a tenant operates in (tenants.country), cached for a minute. Kenya when unset or the column is missing. */
export async function tenantCountry(tenantId) {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < 60000) return hit.country;
  let country = 'KE';
  try {
    const { rows: [t] } = await pool.query('select country from tenants where id=$1', [tenantId]);
    if (t?.country && COUNTRIES[String(t.country).trim()]) country = String(t.country).trim();
  } catch { /* before the migration has run */ }
  cache.set(tenantId, { country, at: Date.now() });
  return country;
}

export const forgetTenantCountry = (tenantId) => cache.delete(tenantId);

/** normaliseMsisdn for a tenant's own country. */
export async function msisdnFor(tenantId, raw) {
  return normaliseMsisdn(raw, await tenantCountry(tenantId));
}

/** The error text for a number that does not look right in the tenant's country. */
export async function badNumberMessage(tenantId) {
  const c = COUNTRIES[await tenantCountry(tenantId)] ?? COUNTRIES.KE;
  return `That does not look like a ${c.name} mobile number`;
}
