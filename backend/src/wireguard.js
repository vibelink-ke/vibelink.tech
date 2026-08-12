import crypto from 'node:crypto';
import { pool } from './db.js';

/**
 * WireGuard peer management.
 *
 * Why a tunnel at all: the MikroTiks live at customer sites behind CGNAT or a
 * dynamic IP, so the server cannot reach them. RADIUS CoA — the thing that
 * changes a live session's speed or pushes it into the walled garden — is the
 * server calling the router, not the other way round. The tunnel gives every
 * router a stable private address the server can always dial.
 *
 * WireGuard over OpenVPN: RouterOS 7 has WireGuard in-kernel and it is far
 * faster than RouterOS's single-threaded OpenVPN. The catch is that RouterOS 6
 * has no WireGuard at all — check `/system resource print` before choosing.
 *
 * Keys are X25519. node:crypto can generate them, so nothing shells out to `wg`.
 */

const SUBNET_PREFIX = process.env.WG_SUBNET_PREFIX ?? '10.51.0';
const SERVER_IP = `${SUBNET_PREFIX}.1`;

/** A WireGuard keypair, base64 of the raw 32 bytes — the format `wg` prints. */
export function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  // Strip the DER wrappers: PKCS#8 private is 16 header bytes + 32 key,
  // SPKI public is 12 header bytes + 32 key.
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(16).toString('base64'),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64'),
  };
}

export const presharedKey = () => crypto.randomBytes(32).toString('base64');

/** Lowest free address in the subnet. .1 is the server. */
async function nextIp(tenantId) {
  const { rows } = await pool.query('select assigned_ip from wg_peers order by assigned_ip');
  const taken = new Set(rows.map((r) => String(r.assigned_ip).split('/')[0]));
  for (let i = 2; i < 255; i++) {
    const ip = `${SUBNET_PREFIX}.${i}`;
    if (!taken.has(ip)) return ip;
  }
  throw new Error(`WireGuard subnet ${SUBNET_PREFIX}.0/24 is full`);
}

/**
 * Mint a peer. The private key is returned once, for the router's config, and
 * never stored — only the public key is kept, which is all the server needs.
 */
export async function createPeer(tenantId, { name, routerId = null }) {
  const { privateKey, publicKey } = keypair();
  const psk = presharedKey();
  const ip = await nextIp(tenantId);

  const { rows: [peer] } = await pool.query(
    `insert into wg_peers (tenant_id, router_id, name, public_key, preshared_key, assigned_ip)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [tenantId, routerId, name, publicKey, psk, ip]
  );

  return { peer, privateKey, presharedKey: psk, assignedIp: ip };
}

/**
 * RouterOS 7 commands to paste into the MikroTik terminal.
 * `allowed-address` is the server subnet only — this is a management tunnel, not
 * a default route, so customer traffic keeps taking its normal path.
 */
export function mikrotikScript({ privateKey, presharedKey: psk, assignedIp, endpoint, serverPublicKey, port = 51820 }) {
  return [
    '# RouterOS 7 only — check with: /system resource print',
    '/interface/wireguard',
    `add name=billing-wg listen-port=${port} private-key="${privateKey}"`,
    '',
    '/interface/wireguard/peers',
    `add interface=billing-wg public-key="${serverPublicKey}" preshared-key="${psk}" \\`,
    `    endpoint-address=${endpoint} endpoint-port=${port} \\`,
    `    allowed-address=${SERVER_IP}/32 persistent-keepalive=25s`,
    '',
    '/ip/address',
    `add address=${assignedIp}/24 interface=billing-wg`,
    '',
    '# Let the billing server reach this router for RADIUS CoA',
    '/ip/firewall/filter',
    `add chain=input src-address=${SERVER_IP} action=accept comment="billing server" place-before=0`,
    '',
    `:log info "billing WireGuard up on ${assignedIp}"`,
  ].join('\n');
}

/** Server-side wg0.conf, rendered from the database. */
export async function renderServerConfig(serverPrivateKey, port = 51820) {
  const { rows } = await pool.query(
    'select name, public_key, preshared_key, assigned_ip from wg_peers where enabled order by assigned_ip'
  );
  const head = [
    '# Generated from wg_peers — edit the database, not this file.',
    '[Interface]',
    `Address = ${SERVER_IP}/24`,
    `ListenPort = ${port}`,
    `PrivateKey = ${serverPrivateKey}`,
    '',
  ];
  const peers = rows.map((p) =>
    [
      `# ${p.name}`,
      '[Peer]',
      `PublicKey = ${p.public_key}`,
      p.preshared_key ? `PresharedKey = ${p.preshared_key}` : null,
      `AllowedIPs = ${String(p.assigned_ip).split('/')[0]}/32`,
      '',
    ]
      .filter(Boolean)
      .join('\n')
  );
  return head.concat(peers).join('\n');
}

export { SERVER_IP, SUBNET_PREFIX };
