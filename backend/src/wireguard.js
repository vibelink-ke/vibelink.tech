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
 *
 * `ip`, when given, skips the normal allocation and uses that address
 * instead — the WireGuard/OVPN failover onboarding needs both transports to
 * carry the identical tunnel address, since RADIUS CoA and the watchdog only
 * ever know a router by that one address regardless of which tunnel is
 * actually carrying it at a given moment.
 */
export async function createPeer(tenantId, { name, routerId = null, ip: presetIp = null }) {
  const { privateKey, publicKey } = keypair();
  const psk = presharedKey();
  const subnet = await ensureSubnet(tenantId);
  const ip = presetIp ?? await nextHostIp(tenantId);

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

/**
 * The router-side half of WireGuard/OVPN failover: a script that watches
 * billing-wg's own handshake age and switches to billing-ovpn (added
 * disabled, by the OVPN onboarding script pasted alongside this one) if it
 * goes stale, then switches back once WireGuard recovers.
 *
 * Router-side rather than server-side because the server has no way to
 * distinguish "this router's WireGuard is down" from "this router is down" —
 * both look identical from here (nothing answers on that address). The
 * router itself is the only place that actually knows which transport last
 * worked, so it is the only place that can decide.
 *
 * Never both interfaces enabled at once for longer than the ~10s retest
 * window below: they would both try to hold the same tunnel address, and
 * OVPN's own address comes from the server assigning it dynamically by
 * username, not from anything set here — RADIUS CoA and the watchdog only
 * ever address the router by that one shared address, so only one interface
 * may be carrying it for any real length of time.
 *
 * staleAfter is a RouterOS time literal ("90s", "2m") — three times
 * mikrotikScript's own persistent-keepalive=25s, so one or two missed
 * keepalives do not trigger a failover on their own.
 *
 * A disabled WireGuard interface does not attempt handshakes at all, so its
 * peer's own last-handshake value simply freezes the moment it is disabled
 * and only ever grows staler from there — reading it while still disabled
 * can never show a recovery, no matter how long WireGuard has actually been
 * back up on the server end. Once failed over to OVPN this used to mean
 * staying there forever, since the condition that would trigger a failback
 * could never become true on its own. So while on OVPN, this now briefly
 * re-enables WireGuard, waits long enough for a real handshake attempt, and
 * checks a fresh reading before deciding: recovered means committing to the
 * switch back, still down means disabling it again and trying once more on
 * the next scheduled run.
 */
export function failoverScript({ staleAfter = '90s' } = {}) {
  return [
    '/system script',
    'remove [find name=billing-failover]',
    'add name=billing-failover policy=read,write,test source={',
    '  :local wg [/interface wireguard find where name=billing-wg];',
    '  :local ovpn [/interface ovpn-client find where name=billing-ovpn];',
    '  :local wgDisabled [/interface wireguard get $wg disabled];',
    '',
    '  :if ($wgDisabled = false) do={',
    '    :local peer [/interface wireguard peers find where interface=billing-wg];',
    '    :local age 1d;',
    '    :if ([:len $peer] > 0) do={ :set age [/interface wireguard peers get $peer last-handshake] };',
    `    :if ($age > ${staleAfter}) do={`,
    '      :log warning "billing-wg stale ($age) -- failing over to OVPN";',
    '      /interface wireguard set $wg disabled=yes;',
    '      /interface ovpn-client set $ovpn disabled=no;',
    '    }',
    '  } else={',
    '    :log info "on OVPN -- retesting billing-wg";',
    '    /interface wireguard set $wg disabled=no;',
    '    :delay 10s;',
    '    :local peer [/interface wireguard peers find where interface=billing-wg];',
    '    :local age 1d;',
    '    :if ([:len $peer] > 0) do={ :set age [/interface wireguard peers get $peer last-handshake] };',
    `    :if ($age <= ${staleAfter}) do={`,
    '      :log info "billing-wg recovered -- switching back from OVPN";',
    '      /interface ovpn-client set $ovpn disabled=yes;',
    '    } else={',
    '      :log info "billing-wg still down ($age) -- staying on OVPN";',
    '      /interface wireguard set $wg disabled=yes;',
    '    }',
    '  }',
    '}',
    '',
    '/system scheduler',
    'remove [find name=billing-failover-check]',
    'add name=billing-failover-check interval=2m on-event=billing-failover',
  ].join('\n');
}

// Higher than the implicit metric-0 OpenVPN installs for a connected
// client's own host route (client-config-dir/iroute) — so when a router is
// provisioned on both transports for failover and both routes exist at
// once, OpenVPN's wins outright, exactly matching which interface is
// actually carrying live traffic to it. Precedence barely matters in
// practice since only one side is ever really handshaking (the router
// itself only enables one interface at a time — see failoverScript above);
// what matters is that this route can always be *installed* alongside
// OpenVPN's without a collision.
const WG_ROUTE_METRIC = 100;

/**
 * Server-side wg0.conf, rendered from the database.
 *
 * A router onboarded on both WireGuard and OpenVPN for failover carries the
 * identical tunnel address on each — OpenVPN installs its own host route for
 * it the moment that client connects (client-config-dir), so this image's
 * own bring-up script's default route management (a plain, non-idempotent
 * `ip route add` per [Peer]'s AllowedIPs) fails the instant it collides with
 * that. Its response to any single route failure is to tear the *entire*
 * interface back down — every other peer's tunnel along with it — which is
 * exactly how one dual-provisioned router once took every router on this
 * tunnel offline for hours with nothing visibly wrong (the container itself
 * stayed "Up"; only its wg0 interface silently never came up).
 *
 * `Table = off` is the documented wg-quick way to hand route management
 * over entirely — but this image's bring-up script does not honour it (confirmed
 * live: the exact same "File exists" crash recurred with Table = off already
 * in the file), so it is not a fix here, only left in as a harmless no-op in
 * case a future image image does respect it. The actual fix: a peer that is
 * *also* an OpenVPN client (same assigned_ip in ovpn_clients) is left out of
 * this file's own [Peer] blocks entirely, so the bring-up script's internal
 * per-peer route-add loop never iterates it and can never crash on it. It is
 * instead added after the interface is already up, via a PostUp line that
 * calls `wg set` directly (a pure crypto/peer-config command with no routing
 * side effect of its own) and then installs its own route with `ip route
 * replace` (never fails on an existing route, unlike `add`) at a metric that
 * lets OpenVPN's route win when both exist.
 */
async function loadPeerGroups() {
  const { rows } = await pool.query(
    'select name, public_key, preshared_key, assigned_ip from wg_peers where enabled order by assigned_ip'
  );
  const { rows: ovpnRows } = await pool.query('select assigned_ip from ovpn_clients');
  const ovpnAddresses = new Set(ovpnRows.map((o) => String(o.assigned_ip).split('/')[0]));

  const filePeers = [];
  const injectedPeers = [];
  for (const p of rows) {
    const ip = String(p.assigned_ip).split('/')[0];
    (ovpnAddresses.has(ip) ? injectedPeers : filePeers).push({ ...p, ip });
  }
  return { filePeers, injectedPeers };
}

export async function renderServerConfig(serverPrivateKey, port = 51820) {
  const { filePeers, injectedPeers } = await loadPeerGroups();

  const head = [
    '# Generated from wg_peers — edit the database, not this file.',
    '[Interface]',
    // /32, not /16: wg0 now shares a network namespace with OpenVPN's tun0
    // (both api and freeradius need to reach routers on either transport),
    // and tun0 already holds a /16 covering this same supernet. A /16 here
    // too would install a second, equally-broad connected route for it —
    // an OVPN-onboarded router's address matches both, and which interface
    // the kernel actually picks for it is undefined. /32 installs no
    // connected route at all; each plain WireGuard-only peer's own /32
    // AllowedIPs entry below is what actually routes to it, and that's
    // always more specific than tun0's /16 regardless, so nothing but this
    // interface's own identity address needs to be this narrow.
    `Address = ${SERVER_IP}/32`,
    `ListenPort = ${port}`,
    `PrivateKey = ${serverPrivateKey}`,
    'Table = off',
    ...injectedPeers.map((p) => {
      // wg set's own preshared-key flag only accepts a file path, not the
      // key inline — /dev/stdin via a plain pipe works in any POSIX sh, no
      // bashisms (herestrings, process substitution) required, which matters
      // since PostUp runs through whatever minimal shell this image uses.
      const addPeer = p.preshared_key
        ? `printf '%s' '${p.preshared_key}' | wg set %i peer ${p.public_key} allowed-ips ${p.ip}/32 preshared-key /dev/stdin`
        : `wg set %i peer ${p.public_key} allowed-ips ${p.ip}/32`;
      return `PostUp = ${addPeer}; ip route replace ${p.ip}/32 dev %i metric ${WG_ROUTE_METRIC} || true`;
    }),
    ...injectedPeers.map((p) =>
      `PostDown = wg set %i peer ${p.public_key} remove || true; ip route del ${p.ip}/32 dev %i metric ${WG_ROUTE_METRIC} || true`),
    // Plain WireGuard-only peers stay in their normal [Peer] blocks below —
    // no OpenVPN route ever exists for them to collide with, so the
    // container's own built-in route-add for their AllowedIPs is safe as-is
    // and needs no help from PostUp/PostDown here.
    '',
  ];
  const peers = filePeers.map((p) =>
    [
      `# ${p.name}`,
      '[Peer]',
      `PublicKey = ${p.public_key}`,
      p.preshared_key ? `PresharedKey = ${p.preshared_key}` : null,
      `AllowedIPs = ${p.ip}/32`,
      '',
    ]
      .filter(Boolean)
      .join('\n')
  );
  const injectedComment = injectedPeers.length
    ? [`# Added via PostUp above, not as [Peer] blocks here — see the comment on`,
       `# renderServerConfig for why: ${injectedPeers.map((p) => p.name).join(', ')}`, '']
    : [];
  return head.concat(injectedComment).concat(peers).join('\n');
}

/**
 * The same peer set as renderServerConfig, but in the bare format `wg
 * syncconf` actually understands.
 *
 * `wg syncconf`/`wg setconf` speak the kernel's own [Interface]/[Peer]
 * vocabulary only — PrivateKey, ListenPort, FwMark, PublicKey, PresharedKey,
 * AllowedIPs, Endpoint, PersistentKeepalive. Handing them wg-quick-only
 * directives (Address, Table, PostUp, PostDown — all of which the real
 * config needs) fails outright with "Line unrecognized". This is a second,
 * separate rendering rather than a stripped version of the same one because
 * injectedPeers need actual [Peer] blocks here — the PostUp `wg set` trick
 * that adds them exists only to keep this image's route-crashing bring-up
 * script from ever iterating them, and syncconf has no such script to crash.
 *
 * Also returns every peer's IP: syncconf only ever touches wg's own
 * peer/crypto-routing table, never the kernel routing table, so a peer
 * added this way still needs its own `ip route replace` afterwards — see
 * the big comment on renderServerConfig for why that route has to exist at
 * all (a /32 self-address on wg0 gives the kernel nothing to route on).
 */
async function renderSyncConfig(serverPrivateKey, port) {
  const { filePeers, injectedPeers } = await loadPeerGroups();
  const allPeers = [...filePeers, ...injectedPeers];

  const text = [
    '[Interface]',
    `PrivateKey = ${serverPrivateKey}`,
    `ListenPort = ${port}`,
    '',
    ...allPeers.map((p) =>
      [
        '[Peer]',
        `PublicKey = ${p.public_key}`,
        p.preshared_key ? `PresharedKey = ${p.preshared_key}` : null,
        `AllowedIPs = ${p.ip}/32`,
        '',
      ].filter(Boolean).join('\n')),
  ].join('\n');

  return { text, ips: allPeers.map((p) => p.ip) };
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
 * The reload half is best-effort: `api` shares wg0's network namespace with
 * the `wireguard` compose service (both are `network_mode: service:net`) and
 * carries the same `wireguard-tools`/`iproute2` packages and NET_ADMIN
 * capability, so `wg syncconf` and the route-replace below normally succeed
 * right here. If either ever fails anyway — the image changes, a capability
 * gets dropped — this falls back to logging (and returning) the exact
 * two-step command an operator can run by hand inside the `wireguard`
 * container instead, rather than leaving the new peer silently unreachable
 * with nothing anywhere saying why its handshake never completes.
 */
export async function syncServer() {
  const serverPrivateKey = process.env.WG_SERVER_PRIVATE_KEY;
  if (!serverPrivateKey) return { written: false, reloaded: false, reason: 'WG_SERVER_PRIVATE_KEY not set' };

  const configPath = process.env.WG_CONFIG_PATH ?? '/config/wg_confs/wg0.conf';
  const port = Number(process.env.WG_PORT ?? 51820);
  const conf = await renderServerConfig(serverPrivateKey, port);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, conf, { mode: 0o600 });

  const fallbackCmd = 'docker compose -f docker-compose.prod.yml exec wireguard sh -c '
    + `"wg-quick strip ${configPath} > /tmp/wg0.sync.conf && wg syncconf wg0 /tmp/wg0.sync.conf"`;

  // Not configPath itself — wg syncconf rejects wg-quick-only directives
  // (Address, Table, PostUp/PostDown) with "Line unrecognized", which is
  // exactly the failure this used to hit unconditionally, for every peer,
  // regardless of which container ran it. Written into the same shared
  // /config/wg_confs directory as configPath (not os.tmpdir(), which is
  // private to this container) so infra/wireguard-init's own background
  // sync loop can read the identical, already-correct file instead of
  // deriving its own via `wg-quick strip` — which silently drops any peer
  // kept out of a [Peer] block on purpose (see renderServerConfig's own
  // comment for why some are), the exact failure that kept undoing this
  // fix every 15 seconds until both sides read the same file.
  const syncPath = path.join(path.dirname(configPath), 'wg0.sync.conf');

  try {
    const { text, ips } = await renderSyncConfig(serverPrivateKey, port);
    fs.writeFileSync(syncPath, text, { mode: 0o600 });
    await run('wg', ['syncconf', 'wg0', syncPath]);

    // syncconf only ever updates wg's own peer/crypto-routing table, never
    // the kernel routing table — a brand-new peer still needs this or
    // nothing on this side has any way to address a packet back to it. Safe
    // to redo for every peer every time: `replace`, not `add`, so an
    // already-correct route is a no-op rather than an error.
    for (const ip of ips) {
      await run('ip', ['route', 'replace', `${ip}/32`, 'dev', 'wg0', 'metric', String(WG_ROUTE_METRIC)]).catch(() => {});
    }
    return { written: true, reloaded: true };
  } catch (e) {
    console.log(`wg syncconf not reloaded from api (${String(e.message ?? '').trim().slice(0, 120)}) — run: ${fallbackCmd}`);
    return { written: true, reloaded: false, fallbackCmd };
  }
}

export { SERVER_IP, SUPERNET };
