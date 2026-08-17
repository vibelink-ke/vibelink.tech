import { pool } from './db.js';

/**
 * Tunnel address allocation, shared by the OVPN and WireGuard onboarding paths.
 *
 * Each tenant owns a /24 out of 10.50.0.0/16 — 256 tenants, 253 routers each.
 * Before this, both paths handed every tenant's first router 10.50.0.1, so two
 * ISPs would end up with the same NAS address. FreeRADIUS identifies a client by
 * its IP, so duplicates mean it cannot tell the routers apart and a CoA meant for
 * one ISP's customer would be sent to another's router.
 */

const BASE_SECOND_OCTET = Number(process.env.TUNNEL_BASE_OCTET ?? 50);

/**
 * The tunnel server holds a single address covering the whole supernet
 * (10.50.0.1/16), so it can reach every tenant's block without an address in
 * each. 10.50.0.0/24 is reserved for it; tenant blocks start at 10.50.1.0/24.
 */
export const SERVER_IP = `10.${BASE_SECOND_OCTET}.0.1`;
export const SUPERNET = `10.${BASE_SECOND_OCTET}.0.0/16`;

/** The tenant's /24, allocating one the first time it is needed. */
export async function ensureSubnet(tenantId) {
  const { rows: [t] } = await pool.query('select tunnel_subnet from tenants where id=$1', [tenantId]);
  if (t?.tunnel_subnet) return String(t.tunnel_subnet);

  // Lock the row so two concurrent onboardings cannot claim the same block.
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [locked] } = await c.query(
      'select tunnel_subnet from tenants where id=$1 for update', [tenantId]);
    if (locked?.tunnel_subnet) {
      await c.query('commit');
      return String(locked.tunnel_subnet);
    }

    const { rows: used } = await c.query(
      'select tunnel_subnet from tenants where tunnel_subnet is not null');
    const taken = new Set(used.map((r) => String(r.tunnel_subnet)));

    let subnet = null;
    // Start at 1 — 10.<base>.0.0/24 belongs to the server.
    for (let third = 1; third < 256; third++) {
      const candidate = `10.${BASE_SECOND_OCTET}.${third}.0/24`;
      if (!taken.has(candidate)) { subnet = candidate; break; }
    }
    if (!subnet) throw new Error(`No free /24 left in ${SUPERNET}`);

    await c.query('update tenants set tunnel_subnet=$2 where id=$1', [tenantId, subnet]);
    await c.query('commit');
    return subnet;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** `10.50.3.0/24` -> `10.50.3` */
export const prefixOf = (subnet) => String(subnet).split('/')[0].split('.').slice(0, 3).join('.');

/**
 * Lowest free host address in the tenant's /24.
 * Scans what is actually allocated rather than counting rows: counting hands out
 * an address that is already in use as soon as anything has been deleted.
 */
export async function nextHostIp(tenantId) {
  const prefix = prefixOf(await ensureSubnet(tenantId));

  const { rows } = await pool.query(
    `select host(assigned_ip) ip from ovpn_clients where tenant_id=$1
     union all
     select host(assigned_ip) ip from wg_peers where tenant_id=$1
     union all
     select host(host) ip from routers where tenant_id=$1`,
    [tenantId]
  );
  const taken = new Set(rows.map((r) => r.ip));

  for (let i = 2; i < 255; i++) {
    const ip = `${prefix}.${i}`;
    if (!taken.has(ip)) return ip;
  }
  throw new Error(`Tenant subnet ${prefix}.0/24 is full`);
}

/**
 * Which routers are connected right now, and on what address.
 *
 * This is the only source of truth for a router's tunnel address. Everything
 * else is an intention: ovpn_clients says what we allocated, routers.host says
 * what somebody typed. When a credential is reissued or a row is deleted while
 * the tunnel stays up, those two drift apart and the router is unreachable at
 * the address the UI shows — with no way to tell from the UI that it is wrong.
 *
 * OpenVPN rewrites the file every 10 seconds. Its ROUTING TABLE section maps
 * virtual address to common name, which is exactly the pairing we need.
 */
export async function liveTunnels() {
  const fs = await import('node:fs/promises');
  const path = process.env.OVPN_STATUS_FILE ?? '/run/openvpn/status.log';

  let text;
  try {
    text = await fs.readFile(path, 'utf8');
  } catch {
    // Not an error worth throwing: on a laptop there is no OpenVPN at all, and
    // the caller should show "no tunnels" rather than a broken screen.
    return [];
  }

  const out = [];
  let inRouting = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('ROUTING TABLE')) { inRouting = true; continue; }
    if (line.startsWith('GLOBAL STATS')) break;
    if (!inRouting) continue;
    if (line.startsWith('Virtual Address') || !line.trim()) continue;

    const [virtualAddress, commonName, realAddress, lastRef] = line.split(',');
    // Only host routes. A client pushing a subnet appears here too, and adopting
    // "10.5.50.0/24" as a router address would be nonsense.
    if (!virtualAddress || virtualAddress.includes('/')) continue;
    out.push({ address: virtualAddress.trim(), username: (commonName ?? '').trim(),
               realAddress: (realAddress ?? '').trim(), lastRef: (lastRef ?? '').trim() });
  }
  return out;
}
