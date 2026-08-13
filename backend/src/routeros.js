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
import pkg from 'node-routeros';
const { RouterOSAPI } = pkg;

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
