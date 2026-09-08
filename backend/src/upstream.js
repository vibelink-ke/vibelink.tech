/**
 * Auto-detect which carrier a router's internet actually comes from.
 *
 * The operator never types this: a router's public IP is looked up against
 * a free IP-to-ISP service and matched against known Kenyan (and Starlink's)
 * carrier names. This is what lets the platform-owner breakdown answer "how
 * many of our routers sit behind Safaricom" without anyone surveying tenants
 * by hand.
 */
import axios from 'axios';
import * as ros from './routeros.js';

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * RouterOS's IP Cloud feature detects the router's own public address as a
 * side effect of its (default-on) check-in with MikroTik's cloud service —
 * no DDNS record or WAN configuration knowledge needed on our end. A router
 * behind CGNAT or with cloud disabled simply reports nothing, which is a
 * legitimate outcome, not an error.
 */
async function publicAddress(conn) {
  const [row] = await conn.write('/ip/cloud/print', []);
  const ip = row?.['public-address'];
  return ip && IPV4.test(ip) ? ip : null;
}

/**
 * Known carriers, checked in order against whatever ip-api.com returns for
 * "isp"/"org"/"as" — free-text fields that vary in exact wording between
 * providers and even between two IPs from the same one. First match wins;
 * an unmatched carrier is still recorded (as its raw name) rather than
 * discarded, since "unknown" is worse than a name nobody normalized yet.
 */
const KNOWN_CARRIERS = [
  { name: 'Safaricom', pattern: /safaricom/i },
  { name: 'Airtel', pattern: /airtel/i },
  { name: 'Telkom', pattern: /telkom/i },
  { name: 'Starlink', pattern: /starlink|spacex/i },
  { name: 'Liquid Telecom', pattern: /liquid/i },
  { name: 'Zuku / JTL', pattern: /zuku|jamii\s*tele/i },
  { name: 'Faiba', pattern: /faiba/i },
  { name: 'MTN', pattern: /\bmtn\b/i },
  { name: 'Jamii Telecommunications', pattern: /jtl\b/i },
];

function normalize(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const known = KNOWN_CARRIERS.find((c) => c.pattern.test(text));
  return known?.name ?? text;
}

/**
 * ip-api.com's free tier: no key, HTTP only, ~45 req/min — comfortably
 * enough for a periodic per-router sweep, never called per-request.
 */
async function lookupIsp(ip) {
  const { data } = await axios.get(`http://ip-api.com/json/${ip}`, {
    params: { fields: 'status,isp,org,as' },
    timeout: 5000,
  });
  if (data?.status !== 'success') return null;
  return normalize(data.isp) ?? normalize(data.org) ?? normalize(data.as);
}

/**
 * Detect one router's upstream. Returns null (not a thrown error) for every
 * expected non-outcome — no service account yet, router unreachable, no
 * public IP exposed, lookup service unavailable — so a caller sweeping the
 * whole fleet can treat "nothing changed this router" uniformly.
 */
export async function detectRouterUpstream(router, password) {
  if (!password) return null;
  let conn;
  try {
    conn = await ros.connect({
      host: String(router.host).split('/')[0],
      port: router.api_port ?? 8728,
      user: router.service_user,
      password,
    });
    const ip = await publicAddress(conn);
    if (!ip) return null;
    const provider = await lookupIsp(ip);
    return provider ? { provider, ip } : null;
  } catch {
    return null;
  } finally {
    if (conn) ros.close(conn);
  }
}
