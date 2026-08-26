import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pool } from './db.js';

const run = promisify(execFile);

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

// Addresses come from the tenant's own /24 (see tunnel.js) rather than one shared
// block, so two ISPs' routers can never be handed the same address.
import { ensureSubnet, nextHostIp, SERVER_IP, SUPERNET } from './tunnel.js';

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

/**
 * Mint a peer. The private key is returned once, for the router's config, and
 * never stored — only the public key is kept, which is all the server needs.
 */
export async function createPeer(tenantId, { name, routerId = null }) {
  const { privateKey, publicKey } = keypair();
  const psk = presharedKey();
  const subnet = await ensureSubnet(tenantId);
  const ip = await nextHostIp(tenantId);

  const { rows: [peer] } = await pool.query(
    `insert into wg_peers (tenant_id, router_id, name, public_key, preshared_key, assigned_ip)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [tenantId, routerId, name, publicKey, psk, ip]
  );

  return { peer, privateKey, presharedKey: psk, assignedIp: ip, subnet, serverIp: SERVER_IP };
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
    // Unlike wg-quick on Linux, RouterOS's WireGuard peer allowed-address
    // only governs which packets are *accepted* from a peer — it never
    // installs a route, so without this the router has no idea how to send
    // anything back to us: it can decrypt an inbound ping fine, then drop
    // its own reply for lack of a route, which looks exactly like a dead
    // tunnel from our side despite a perfectly healthy handshake.
    '/ip/route',
    `add dst-address=${SERVER_IP}/32 gateway=billing-wg`,
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
    // /32, not /16: wg0 now shares a network namespace with OpenVPN's tun0
    // (both api and freeradius need to reach routers on either transport),
    // and tun0 already holds a /16 covering this same supernet. A /16 here
    // too would install a second, equally-broad connected route for it —
    // an OVPN-onboarded router's address matches both, and which interface
    // the kernel actually picks for it is undefined. /32 installs no
    // connected route at all; each WireGuard peer's own /32 AllowedIPs
    // entry below is what actually routes to it, and that's always more
    // specific than tun0's /16 regardless, so nothing but this interface's
    // own identity address needs to be this narrow.
    `Address = ${SERVER_IP}/32`,
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

/**
 * Write wg0.conf and try to hot-reload it — the two steps scripts/wg-sync.mjs
 * always required a human to remember to run by hand after every peer create
 * or delete. "Onboard via WireGuard" minted a peer and handed over a router
 * script with nothing on this side ever making the server's own wg0 aware of
 * it — the router dialled a peer the server had never heard of, and the
 * handshake just never completed, silently, with no error anywhere to point
 * at. Calling this from the peer routes closes that gap for the file-write
 * half unconditionally.
 *
 * The reload half stays best-effort: this runs in the api container, and wg0
 * itself lives in the separate `wireguard` compose service — a bare `wg`
 * command here can only ever act on this container's own network namespace,
 * which does not have the interface. Same fallback wg-sync.mjs already prints
 * for that case, just returned to the caller instead of only logged, so the
 * peer-creation response can hand the operator the one-liner right there
 * instead of pointing at documentation.
 */
export async function syncServer() {
  const serverPrivateKey = process.env.WG_SERVER_PRIVATE_KEY;
  if (!serverPrivateKey) return { written: false, reloaded: false, reason: 'WG_SERVER_PRIVATE_KEY not set' };

  const configPath = process.env.WG_CONFIG_PATH ?? '/config/wg_confs/wg0.conf';
  const port = Number(process.env.WG_PORT ?? 51820);
  const conf = await renderServerConfig(serverPrivateKey, port);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, conf, { mode: 0o600 });

  try {
    await run('wg', ['syncconf', 'wg0', configPath]);
    return { written: true, reloaded: true };
  } catch (e) {
    const fallbackCmd = `docker compose -f docker-compose.prod.yml exec wireguard wg syncconf wg0 ${configPath}`;
    console.log(`wg syncconf not reloaded from api (${String(e.message ?? '').trim().slice(0, 120)}) — run: ${fallbackCmd}`);
    return { written: true, reloaded: false, fallbackCmd };
  }
}

export { SERVER_IP, SUPERNET };
