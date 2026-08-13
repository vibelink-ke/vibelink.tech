/**
 * Pushing configuration to a MikroTik over its API, so operators do not paste
 * commands by hand.
 *
 * Reachable because the router sits on the management tunnel: the API container
 * shares the OpenVPN namespace, so 10.50.x.y:8728 is routable. Plaintext 8728 is
 * acceptable *only* because of that — this must never be aimed at a public IP.
 *
 * Everything here is idempotent. Operators re-run it after changing a secret or
 * adding a hotspot, and a second run must be a no-op rather than a duplicate
 * /radius entry, which RouterOS will happily accept and then load-balance across.
 */
import { createRequire } from 'node:module';
import pkg from 'node-routeros';
const { RouterOSAPI } = pkg;

/**
 * node-routeros cannot read `!empty`, and RouterOS sends it whenever a query
 * matches nothing — no bridges yet, no user by that name, no hotspot profiles.
 *
 * Its packet handler falls through to a `default` branch that emits 'unknown',
 * whose listener throws from inside the socket's data callback. Nothing can catch
 * that, so it became an uncaught exception and killed the API process: the
 * browser saw a bare 502 from the proxy and the container quietly restarted.
 * Onboarding a fresh router hits it immediately, because a fresh router has none
 * of the things we look for.
 *
 * `!empty` means "done, nothing matched", which is exactly `!done` with no rows,
 * so translate it before the switch sees it. Patching a dependency is not
 * pleasant, but the alternative is writing the API protocol ourselves.
 */
{
  const require = createRequire(import.meta.url);
  const { Channel } = require('node-routeros/dist/Channel');
  if (!Channel.prototype.__emptyReplyPatched) {
    const original = Channel.prototype.processPacket;
    Channel.prototype.processPacket = function processPacket(packet) {
      if (Array.isArray(packet) && packet[0] === '!empty') packet[0] = '!done';
      return original.call(this, packet);
    };

    // Belt and braces. `!empty` is the one we hit, but the same default branch
    // catches anything else RouterOS ever sends that this library predates, and
    // the consequence is always the same: an exception thrown from inside a
    // socket callback, which nothing can catch and which ends the process.
    //
    // A reply we cannot interpret should fail the one command, not the server.
    Channel.prototype.onUnknown = function onUnknown(reply) {
      this.emit('done', this.data ?? []);
    };

    Channel.prototype.__emptyReplyPatched = true;
  }
}

/** Tags every object we own, so we can find ours again and humans leave it alone. */
export const MANAGED_COMMENT = 'vibelink billing - do not delete';

/** The service account. Same name on every router; the password differs per router. */
export const SERVICE_USER = 'vibelink-svc';

export async function connect({ host, port = 8728, user, password, timeoutSec = 8 }) {
  const conn = new RouterOSAPI({
    host: String(host).split('/')[0],   // routers.host is an inet and may carry /32
    port: Number(port) || 8728,
    user,
    password,
    timeout: timeoutSec,
    keepalive: false,
  });

  // RouterOSAPI is an EventEmitter, and once a connection is established it
  // re-emits every later socket error and timeout as an 'error' event. Node turns
  // an unhandled 'error' event into an uncaught exception, so a router that
  // accepted the login and then dropped the socket mid-conversation took the
  // whole API process down with it — the browser saw a bare 502 from the proxy
  // with no message, and nothing was logged because the process was already gone.
  //
  // A listener keeps it an ordinary failure. The in-flight write rejects on its
  // own, and this records why so the caller can say something useful.
  conn.on('error', (e) => { conn.__socketError = e; });

  await conn.connect();
  return conn;
}

/** RouterOS returns the internal id as ".id"; every write that edits a row needs it. */
const idOf = (row) => row?.['.id'];

/**
 * Create or refresh our own login.
 *
 * The point of this account is surviving the operator changing their own
 * password — which they will, and which would otherwise silently break every
 * push until someone noticed. The password is ours, random per router, and
 * stored encrypted; nobody needs to know it.
 */
export async function ensureServiceUser(conn, { user = SERVICE_USER, password }) {
  const existing = await conn.write('/user/print', [`?name=${user}`]);
  if (existing.length) {
    await conn.write('/user/set', [
      `=.id=${idOf(existing[0])}`,
      `=password=${password}`,
      '=group=full',
      `=comment=${MANAGED_COMMENT}`,
    ]);
    return { created: false };
  }
  await conn.write('/user/add', [
    `=name=${user}`,
    `=password=${password}`,
    '=group=full',
    `=comment=${MANAGED_COMMENT}`,
  ]);
  return { created: true };
}

/**
 * Point the router at our RADIUS, and let us change live sessions.
 *
 * `address` is the server's tunnel address, not its public one: RADIUS is not
 * exposed to the internet and the reply has to come back down the same tunnel.
 */
export async function applyRadius(conn, { serverIp, secret, coaPort = 3799, services = 'ppp,hotspot' }) {
  const mine = (await conn.write('/radius/print', []))
    .filter((r) => r.comment === MANAGED_COMMENT);

  const fields = [
    `=service=${services}`,
    `=address=${serverIp}`,
    `=secret=${secret}`,
    '=timeout=3s',
    `=comment=${MANAGED_COMMENT}`,
  ];

  if (mine.length) {
    await conn.write('/radius/set', [`=.id=${idOf(mine[0])}`, ...fields]);
    // A second managed entry can only be debris from an interrupted run; leaving
    // it would send half the auth requests somewhere stale.
    for (const dupe of mine.slice(1)) await conn.write('/radius/remove', [`=.id=${idOf(dupe)}`]);
  } else {
    await conn.write('/radius/add', fields);
  }

  // Without this the router ignores CoA entirely and speed changes wait for the
  // subscriber to reconnect — the failure everyone hits first.
  await conn.write('/radius/incoming/set', ['=accept=yes', `=port=${coaPort}`]);

  return { replaced: mine.length > 1 ? mine.length - 1 : 0 };
}

/**
 * PPPoE authentication and accounting.
 *
 * interim-update matters more than it looks: without it the router reports usage
 * only when a session ends, so fair-use sees zero all day and then a cliff.
 */
export async function applyPpp(conn, { interimMinutes = 5 } = {}) {
  const mm = String(interimMinutes).padStart(2, '0');
  await conn.write('/ppp/aaa/set', [
    '=use-radius=yes',
    '=accounting=yes',
    `=interim-update=00:${mm}:00`,
  ]);
}

/** Same for hotspot: every profile on the box, since a router may serve several sites. */
export async function applyHotspot(conn, { interimMinutes = 5 } = {}) {
  const profiles = await conn.write('/ip/hotspot/profile/print', []);
  const mm = String(interimMinutes).padStart(2, '0');
  for (const p of profiles) {
    await conn.write('/ip/hotspot/profile/set', [
      `=.id=${idOf(p)}`,
      '=use-radius=yes',
      `=radius-interim-update=00:${mm}:00`,
    ]);
  }
  return { profiles: profiles.length };
}

/**
 * Physical ports worth offering as LAN members.
 *
 * Excludes the tunnel we arrived on, anything already enslaved to a bridge, and
 * the bridges themselves — offering those would let someone cut the connection
 * this very request is travelling over.
 */
export async function lanCandidates(conn) {
  const all = await conn.write('/interface/print', []);
  return all
    .filter((i) => ['ether', 'wlan', 'sfp'].includes(String(i.type ?? '').split('-')[0]))
    .filter((i) => i.name !== 'billing-ovpn' && !i['slave'])
    .map((i) => ({
      name: i.name,
      type: i.type,
      running: i.running === 'true',
      comment: i.comment ?? null,
    }));
}

/** Bridges already on the box, so we can offer to reuse one. */
export async function bridges(conn) {
  const rows = await conn.write('/interface/bridge/print', []);
  return rows.map((b) => ({ name: b.name, comment: b.comment ?? null }));
}

/**
 * Put the chosen ports into one bridge — the LAN subscribers plug into.
 *
 * Ports already in another bridge are left alone rather than moved: taking a port
 * out from under an existing configuration is how you cut off a working site.
 */
export async function ensureBridge(conn, { name = 'bridge-lan', ports = [] }) {
  const existing = (await conn.write('/interface/bridge/print', [`?name=${name}`]))[0];
  if (!existing) {
    await conn.write('/interface/bridge/add', [`=name=${name}`, `=comment=${MANAGED_COMMENT}`]);
  }

  const members = await conn.write('/interface/bridge/port/print', []);
  const already = new Set(members.filter((m) => m.bridge === name).map((m) => m.interface));
  const elsewhere = new Map(members.filter((m) => m.bridge !== name).map((m) => [m.interface, m.bridge]));

  const added = [];
  const skipped = [];
  for (const port of ports) {
    if (already.has(port)) continue;
    if (elsewhere.has(port)) { skipped.push(`${port} (already in ${elsewhere.get(port)})`); continue; }
    await conn.write('/interface/bridge/port/add', [
      `=bridge=${name}`, `=interface=${port}`, `=comment=${MANAGED_COMMENT}`,
    ]);
    added.push(port);
  }
  return { bridge: name, added, skipped };
}

/**
 * The PPPoE server itself, plus the address pool and profile it hands out.
 *
 * Speeds are deliberately absent from the profile: they come from RADIUS per
 * subscriber, and a rate limit set here would override the plan for everyone.
 */
export async function applyPppoeServer(conn, {
  bridge = 'bridge-lan',
  poolName = 'vibelink-pppoe',
  poolRange = '10.100.0.2-10.100.255.254',
  gateway = '10.100.0.1',
  profileName = 'vibelink-pppoe',
  serviceName = 'vibelink',
} = {}) {
  const pool = (await conn.write('/ip/pool/print', [`?name=${poolName}`]))[0];
  if (pool) await conn.write('/ip/pool/set', [`=.id=${idOf(pool)}`, `=ranges=${poolRange}`]);
  else await conn.write('/ip/pool/add', [`=name=${poolName}`, `=ranges=${poolRange}`, `=comment=${MANAGED_COMMENT}`]);

  // The gateway address has to exist on the bridge or clients get a route to nowhere.
  const addrs = await conn.write('/ip/address/print', [`?interface=${bridge}`]);
  if (!addrs.some((a) => String(a.address).startsWith(`${gateway}/`))) {
    await conn.write('/ip/address/add', [
      `=address=${gateway}/24`, `=interface=${bridge}`, `=comment=${MANAGED_COMMENT}`,
    ]);
  }

  const profileFields = [
    `=local-address=${gateway}`,
    `=remote-address=${poolName}`,
    '=use-compression=no',
    '=use-encryption=no',
    '=only-one=yes',        // one session per subscriber, so a shared password is obvious
    `=comment=${MANAGED_COMMENT}`,
  ];
  const profile = (await conn.write('/ppp/profile/print', [`?name=${profileName}`]))[0];
  if (profile) await conn.write('/ppp/profile/set', [`=.id=${idOf(profile)}`, ...profileFields]);
  else await conn.write('/ppp/profile/add', [`=name=${profileName}`, ...profileFields]);

  const serverFields = [
    `=interface=${bridge}`,
    `=default-profile=${profileName}`,
    `=service-name=${serviceName}`,
    '=disabled=no',
    '=one-session-per-host=yes',
    '=authentication=pap,chap',   // what radcheck's Cleartext-Password supports
  ];
  const server = (await conn.write('/interface/pppoe-server/server/print', [`?interface=${bridge}`]))[0];
  if (server) await conn.write('/interface/pppoe-server/server/set', [`=.id=${idOf(server)}`, ...serverFields]);
  else await conn.write('/interface/pppoe-server/server/add', serverFields);

  return { bridge, pool: poolName, profile: profileName };
}

/** Identity and version, for the Routers screen and for choosing OVPN cipher names. */
export async function identify(conn) {
  const [res] = await conn.write('/system/resource/print', []);
  const [ident] = await conn.write('/system/identity/print', []);
  return {
    version: res?.version ?? null,
    board: res?.['board-name'] ?? null,
    identity: ident?.name ?? null,
  };
}

export const close = (conn) => { try { conn.close(); } catch { /* already gone */ } };
