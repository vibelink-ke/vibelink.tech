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
import nodeCrypto from 'node:crypto';
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

  // The other half. Receiver.sendTagData throws UNREGISTEREDTAG when a reply
  // arrives for a tag nobody is waiting on any more — also from inside the
  // socket's data handler, also fatal.
  //
  // Ending a command early makes that certain rather than unlikely: the tag is
  // unregistered and the router's real reply for it lands a moment later. So the
  // patch above guaranteed this crash. A late or duplicate reply is not a reason
  // to take the server down; drop it.
  const { Receiver } = require('node-routeros/dist/connector/Receiver');
  if (!Receiver.prototype.__strayTagPatched) {
    Receiver.prototype.sendTagData = function sendTagData(currentTag) {
      const tag = this.tags.get(currentTag);
      if (tag) tag.callback(this.currentPacket);
      this.cleanUp();
    };
    Receiver.prototype.__strayTagPatched = true;
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
  // Every entry aimed at our server, not only the ones we commented.
  //
  // Matching on the comment alone left hand-made entries in place: an operator
  // who ran `/radius add` themselves during setup ended up with two entries for
  // the same address holding different secrets, and RouterOS signs with whichever
  // it reaches first. FreeRADIUS then reports "invalid Message-Authenticator" and
  // drops the request, which looks like a broken secret rather than a duplicate.
  //
  // Anything pointing at this server is ours to own, however it got there.
  const mine = (await conn.write('/radius/print', []))
    .filter((r) => String(r.address) === String(serverIp));

  const fields = [
    `=service=${services}`,
    `=address=${serverIp}`,
    `=secret=${secret}`,
    '=timeout=3s',
    `=comment=${MANAGED_COMMENT}`,
  ];

  if (mine.length) {
    await conn.write('/radius/set', [`=.id=${idOf(mine[0])}`, ...fields]);
    // Any other entry for this server is debris — an interrupted run, or one
    // added by hand during setup. Leaving it means half the requests get signed
    // with a stale secret and dropped.
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
 * Everything a hotspot needs, on a bridge that already exists.
 *
 * Doing this by hand is six screens in Winbox and the usual failure is a working
 * hotspot that hands out addresses from a pool the DHCP server does not own, so
 * clients associate and then sit there with no lease.
 *
 * Idempotent throughout: each step looks for the managed object by name and
 * updates it rather than adding a second one. Running it twice on a live site is
 * a no-op, which matters because the operator's instinct after any doubt is to
 * press the button again.
 */
/**
 * Run one RouterOS command and, if it fails, say which one.
 *
 * RouterOS errors are terse and context-free -- "invalid network", "no such
 * item", "failure" -- and a push issues a dozen commands, so the message alone
 * does not identify the culprit. Real example: a hotspot push failed with
 * "invalid network" after seven successful steps, and nothing said whether that
 * was the address, the pool, the DHCP server or its network statement.
 */
async function cmd(conn, label, path, args = []) {
  try {
    return await conn.write(path, args);
  } catch (e) {
    e.step = e.step ?? `${label} (${path} ${args.join(' ')})`;
    throw e;
  }
}

/**
 * Turn an operator-supplied subnet into the exact values RouterOS wants.
 *
 * Two bugs this closes. The old code took the first three octets verbatim and
 * appended .1/.10/.254, which is only right for a /24 and silently wrong for
 * anything else. And it passed the string through untouched, so a value like
 * 10.5.50.1/24 -- an address, not a network -- went to the router and came back
 * as a bare "invalid network" with nothing to say which field was at fault.
 *
 * Masking to the true network address makes 10.5.50.1/24 and 10.5.50.0/24 mean
 * the same thing, which is what the person typing it intended either way.
 *
 * .1 is the router and .10 upward the guests; below .10 stays free for printers
 * and access points that people give static addresses to.
 */
export function planNetwork(input) {
  const [addr, maskBits] = String(input ?? '').trim().split('/');
  const bits = Number(maskBits);
  const octets = String(addr).split('.').map(Number);

  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    throw new Error(`"${input}" is not a valid IPv4 subnet. Expected something like 10.5.50.0/24.`);
  }
  // /30 is four addresses: network, gateway, one guest, broadcast. Below /8 is
  // never what anyone means on a LAN.
  if (!Number.isInteger(bits) || bits < 8 || bits > 30) {
    throw new Error(`"${input}" needs a prefix between /8 and /30. Expected something like 10.5.50.0/24.`);
  }

  const toInt = (o) => ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const toStr = (n) => [24, 16, 8, 0].map((sh) => (n >>> sh) & 255).join('.');

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const base = (toInt(octets) & mask) >>> 0;
  const broadcast = (base | (~mask >>> 0)) >>> 0;

  const gatewayInt = base + 1;
  const firstGuest = Math.min(base + 10, broadcast - 1);
  const lastGuest = broadcast - 1;

  if (gatewayInt >= broadcast) {
    throw new Error(`"${input}" is too small to run a hotspot on.`);
  }

  return {
    network: `${toStr(base)}/${bits}`,
    gateway: toStr(gatewayInt),
    poolRange: `${toStr(firstGuest)}-${toStr(lastGuest)}`,
    bits,
  };
}

export async function applyHotspotServer(conn, {
  bridge = 'bridge-lan',
  network = '10.5.50.0/24',
  interimMinutes = 5,
  dnsName = 'wifi.local',
} = {}) {
  const { network: cidr, gateway, poolRange, bits } = planNetwork(network);
  const POOL = 'hotspot-pool';
  const done = [];

  // The gateway address on the bridge. Without this the hotspot has nothing to
  // intercept on and the server silently refuses to come up.
  const addrs = await conn.write('/ip/address/print', []);
  const existing = addrs.find((a) => a.interface === bridge && String(a.address).startsWith(`${gateway}/`));
  if (!existing) {
    await cmd(conn, 'gateway address', '/ip/address/add', [
      `=address=${gateway}/${bits}`, `=interface=${bridge}`, `=comment=${MANAGED_COMMENT}`,
    ]);
    done.push(`address ${gateway}/${bits} on ${bridge}`);
  }

  const pools = await conn.write('/ip/pool/print', []);
  const pool = pools.find((p) => p.name === POOL);
  if (pool) await cmd(conn, 'address pool', '/ip/pool/set', [`=.id=${idOf(pool)}`, `=ranges=${poolRange}`]);
  else {
    await cmd(conn, 'address pool', '/ip/pool/add', [`=name=${POOL}`, `=ranges=${poolRange}`]);
    done.push(`pool ${poolRange}`);
  }

  const dhcps = await conn.write('/ip/dhcp-server/print', []);
  const dhcp = dhcps.find((d) => d.interface === bridge);
  const dhcpFields = [`=interface=${bridge}`, `=address-pool=${POOL}`, '=disabled=no',
                      `=lease-time=1h`, `=comment=${MANAGED_COMMENT}`];
  if (dhcp) await cmd(conn, 'DHCP server', '/ip/dhcp-server/set', [`=.id=${idOf(dhcp)}`, ...dhcpFields]);
  else {
    await cmd(conn, 'DHCP server', '/ip/dhcp-server/add', [`=name=hotspot-dhcp`, ...dhcpFields]);
    done.push('dhcp server');
  }

  // The network statement is what actually gives clients a gateway and DNS. A
  // DHCP server without it leases addresses that cannot route anywhere.
  const nets = await conn.write('/ip/dhcp-server/network/print', []);
  const netRow = nets.find((n) => String(n.address) === cidr);
  const netFields = [`=address=${cidr}`, `=gateway=${gateway}`, `=dns-server=${gateway}`,
                     `=comment=${MANAGED_COMMENT}`];
  if (netRow) await cmd(conn, 'DHCP network', '/ip/dhcp-server/network/set', [`=.id=${idOf(netRow)}`, ...netFields]);
  else {
    await cmd(conn, 'DHCP network', '/ip/dhcp-server/network/add', netFields);
    done.push('dhcp network');
  }

  const mm = String(interimMinutes).padStart(2, '0');
  const PROFILE = 'hsprof-billing';
  const profiles = await conn.write('/ip/hotspot/profile/print', []);
  const profile = profiles.find((p) => p.name === PROFILE);
  const profileFields = [
    `=hotspot-address=${gateway}`,
    `=dns-name=${dnsName}`,
    '=use-radius=yes',
    `=radius-interim-update=00:${mm}:00`,
    // http-chap needs the login page to do the hashing; plain http-pap is what
    // actually works against a Cleartext-Password in radcheck, which is what we
    // store. Offering chap here is how you get a login page that always fails.
    '=login-by=http-pap',
  ];
  if (profile) await cmd(conn, 'hotspot profile', '/ip/hotspot/profile/set', [`=.id=${idOf(profile)}`, ...profileFields]);
  else {
    await cmd(conn, 'hotspot profile', '/ip/hotspot/profile/add', [`=name=${PROFILE}`, ...profileFields]);
    done.push('hotspot profile');
  }

  const servers = await conn.write('/ip/hotspot/print', []);
  const server = servers.find((s) => s.interface === bridge);
  const serverFields = [`=interface=${bridge}`, `=profile=${PROFILE}`,
                        `=address-pool=${POOL}`, '=disabled=no'];
  if (server) await cmd(conn, 'hotspot server', '/ip/hotspot/set', [`=.id=${idOf(server)}`, ...serverFields]);
  else {
    await cmd(conn, 'hotspot server', '/ip/hotspot/add', [`=name=hotspot-billing`, ...serverFields]);
    done.push('hotspot server');
  }

  return { gateway, pool: poolRange, changed: done };
}

/**
 * Hosts reachable before anyone logs in.
 *
 * Without this a customer with no credit cannot reach M-Pesa to buy any, and the
 * hotspot is a shop with the door locked from the inside. The billing portal
 * itself has to be reachable for the same reason.
 *
 * Entries we manage carry MANAGED_COMMENT and are replaced wholesale on each
 * run; anything an operator added by hand is left alone.
 */
export async function applyWalledGarden(conn, hosts = []) {
  const wanted = [...new Set(hosts.map((h) => String(h).trim()).filter(Boolean))];

  const current = await conn.write('/ip/hotspot/walled-garden/print', []);
  for (const row of current.filter((r) => r.comment === MANAGED_COMMENT)) {
    await conn.write('/ip/hotspot/walled-garden/remove', [`=.id=${idOf(row)}`]);
  }
  for (const host of wanted) {
    await conn.write('/ip/hotspot/walled-garden/add', [
      `=dst-host=${host}`, '=action=allow', `=comment=${MANAGED_COMMENT}`,
    ]);
  }
  return { allowed: wanted.length };
}

/**
 * A rate-limited user profile for hotspot sessions.
 *
 * RADIUS supplies the per-customer speed, so this only carries what a profile
 * must have regardless: the shared-users limit and the idle timeout. It exists
 * so the hotspot server has a default profile that is ours rather than the
 * built-in one, which we would otherwise be editing on a box we do not own.
 */
export async function ensureHotspotUserProfile(conn, {
  name = 'hs-default', sharedUsers = 1, idleMinutes = 10,
} = {}) {
  const rows = await conn.write('/ip/hotspot/user/profile/print', []);
  const found = rows.find((p) => p.name === name);
  const fields = [
    `=shared-users=${sharedUsers}`,
    `=idle-timeout=00:${String(idleMinutes).padStart(2, '0')}:00`,
    '=status-autorefresh=1m',
    `=comment=${MANAGED_COMMENT}`,
  ];
  if (found) {
    await conn.write('/ip/hotspot/user/profile/set', [`=.id=${idOf(found)}`, ...fields]);
    return { profile: name, created: false };
  }
  await conn.write('/ip/hotspot/user/profile/add', [`=name=${name}`, ...fields]);
  return { profile: name, created: true };
}

/**
 * Stop one paid session being shared with the whole building.
 *
 * Packets leaving towards the guest LAN get TTL 1. A phone that has paid can use
 * them; the moment someone routes them onward — a tethered hotspot, a second
 * router — the TTL hits zero and the packet dies. This is the standard trick
 * because it needs nothing on the client and cannot be turned off from there.
 *
 * shared-users on the profile is the other half: TTL stops re-routing, the
 * profile stops the same code being used on several devices directly.
 *
 * Note this is not absolute. A determined user can rewrite TTL on their own
 * router, so treat it as a deterrent rather than enforcement.
 */
export async function applyAntiSharing(conn, { bridge = 'bridge-lan' } = {}) {
  const rules = await conn.write('/ip/firewall/mangle/print', []);
  const mine = rules.filter((r) => r.comment === MANAGED_COMMENT
    && String(r.chain) === 'postrouting' && String(r['out-interface']) === bridge);

  const fields = [
    '=chain=postrouting',
    `=out-interface=${bridge}`,
    '=action=change-ttl',
    '=new-ttl=set:1',
    `=comment=${MANAGED_COMMENT}`,
  ];
  if (mine.length) {
    await conn.write('/ip/firewall/mangle/set', [`=.id=${idOf(mine[0])}`, ...fields]);
    // Duplicates would each rewrite the TTL; harmless but they accumulate on
    // every run and make the firewall unreadable.
    for (const dupe of mine.slice(1)) {
      await conn.write('/ip/firewall/mangle/remove', [`=.id=${idOf(dupe)}`]);
    }
    return { created: false, removed: mine.length - 1 };
  }
  await conn.write('/ip/firewall/mangle/add', fields);
  return { created: true, removed: 0 };
}

/**
 * Replace the router's captive-portal page with the tenant's own.
 *
 * The RouterOS API cannot upload a file — there is no command that carries
 * content — so the router is told to fetch it instead. /tool/fetch pulls the
 * page from the tenant's subdomain over HTTPS and writes it into the hotspot
 * directory, replacing MikroTik's stock login.html.
 *
 * Only login.html is replaced. The stock directory also holds error, status and
 * logout pages; overwriting the whole directory would mean shipping all of them
 * and getting every RouterOS-version quirk right, and a missing one breaks the
 * hotspot outright.
 *
 * The router needs to reach the internet for this. It has a default route (the
 * management tunnel rides over it), and the walled garden is irrelevant here
 * because the router is not a hotspot client of itself.
 */
export async function pushHotspotPage(conn, { url, bridge }) {
  if (!/^https?:\/\//i.test(String(url ?? ''))) {
    throw new Error(`"${url}" is not a usable URL for the hotspot page.`);
  }

  /**
   * Write where the router actually reads from.
   *
   * This used to write to "hotspot/" on the assumption that every hotspot uses
   * the default directory. A profile can point html-directory anywhere, and
   * RouterOS 7 ships some builds pointing at "hotspot" while others use
   * "flash/hotspot" — so the file landed somewhere real, the push reported
   * success, and the guest carried on seeing MikroTik's stock page. Ask the
   * profile the server is actually using instead of assuming.
   */
  const servers = await conn.write('/ip/hotspot/print', []);
  const server = servers.find((h) => !bridge || h.interface === bridge) ?? servers[0];
  let dir = 'hotspot';
  if (server?.profile) {
    const profiles = await conn.write('/ip/hotspot/profile/print', [`?name=${server.profile}`]);
    dir = String(profiles[0]?.['html-directory'] ?? 'hotspot').replace(/\/+$/, '');
  }

  const dst = `${dir}/login.html`;
  await cmd(conn, 'fetch login page', '/tool/fetch', [
    `=url=${url}`,
    `=dst-path=${dst}`,
    // check-certificate=no because a tenant may still be on a self-signed or
    // freshly-issued certificate, and a captive portal that refuses to install
    // over a certificate detail is worse than one that installs.
    '=check-certificate=no',
    '=mode=https',
  ]);

  // Confirm it landed and is not a truncated or empty download. RouterOS reports
  // a failed fetch as an error, but a proxy or a redirect to a login page can
  // produce a file that exists and is useless.
  const files = await conn.write('/file/print', [`?name=${dst}`]);
  const size = Number(files[0]?.size ?? 0);
  if (!size) throw new Error(`The page downloaded to ${dst} but is empty.`);

  return { bytes: size, path: dst };
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

  // Which bridge each port is already in, resolved to a name. RouterOS 7 reports
  // the bridge as an internal id here too, and "in *11" means nothing to the
  // person choosing ports — showing it as "in bridge-lan" is the difference
  // between understanding the current state and guessing at it.
  const bridgeRows = await conn.write('/interface/bridge/print', []);
  const nameById = new Map(bridgeRows.map((b) => [idOf(b), b.name]));
  const members = await conn.write('/interface/bridge/port/print', []);
  const bridgeOf = new Map(
    members.map((m) => [m.interface, nameById.get(m.bridge) ?? m.bridge]));

  return all
    .filter((i) => ['ether', 'wlan', 'sfp'].includes(String(i.type ?? '').split('-')[0]))
    .filter((i) => i.name !== 'billing-ovpn' && !i['slave'])
    .map((i) => ({
      name: i.name,
      type: i.type,
      running: i.running === 'true',
      comment: i.comment ?? null,
      bridge: bridgeOf.get(i.name) ?? null,
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

  // Re-read: we may have just created it, and we need its internal id.
  const self = (await conn.write('/interface/bridge/print', [`?name=${name}`]))[0];
  const selfId = idOf(self);

  // A bridge port's `bridge` field comes back as the bridge's internal id
  // ("*11") on RouterOS 7, not its name. Comparing against the name alone
  // therefore matched nothing, so ports that were already in our own bridge
  // were reported as belonging to some other bridge called "*11" and skipped.
  // The push then built the PPPoE server and hotspot on a bridge it believed
  // was empty — configuration that applies cleanly and serves nobody.
  //
  // Names are still accepted: older RouterOS does return them.
  const isOurs = (m) => m.bridge === name || (selfId && m.bridge === selfId);

  // Resolve ids to names so "already in ether-lan" is readable rather than
  // "already in *11", which tells an operator nothing they can act on.
  const bridges = await conn.write('/interface/bridge/print', []);
  const nameById = new Map(bridges.map((b) => [idOf(b), b.name]));
  const label = (ref) => nameById.get(ref) ?? ref;

  const members = await conn.write('/interface/bridge/port/print', []);
  const already = new Set(members.filter(isOurs).map((m) => m.interface));
  const elsewhere = new Map(
    members.filter((m) => !isOurs(m)).map((m) => [m.interface, label(m.bridge)]));

  const added = [];
  const skipped = [];
  for (const port of ports) {
    if (already.has(port)) continue;
    if (elsewhere.has(port)) { skipped.push(`${port} (already in ${elsewhere.get(port)})`); continue; }
    try {
      await conn.write('/interface/bridge/port/add', [
        `=bridge=${name}`, `=interface=${port}`, `=comment=${MANAGED_COMMENT}`,
      ]);
    } catch (e) {
      // Name the port. Enslaving one is the step most likely to cut the very
      // connection carrying the request: if the port is the uplink, or if
      // bridging it to another already-bridged port closes a loop, the tunnel
      // drops mid-command and every later step reports a bare timeout. Knowing
      // which port did it is the difference between a one-tick fix and
      // bisecting the list by hand.
      e.step = e.step ?? `bridge port ${port}`;
      throw e;
    }
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
    // Windows dials PPPoE with MS-CHAPv2 and refuses to fall back on its own —
    // it reports "the selected authentication protocol is not permitted on the
    // remote access server" and never sends credentials at all. Offering only
    // pap,chap therefore locked out every Windows client.
    //
    // All four work against a Cleartext-Password in radcheck, and the client
    // picks the strongest both ends share.
    '=authentication=pap,chap,mschap1,mschap2',
  ];
  const server = (await conn.write('/interface/pppoe-server/server/print', [`?interface=${bridge}`]))[0];
  if (server) await conn.write('/interface/pppoe-server/server/set', [`=.id=${idOf(server)}`, ...serverFields]);
  else await conn.write('/interface/pppoe-server/server/add', serverFields);

  return { bridge, pool: poolName, profile: profileName };
}

/**
 * Read back what the router actually believes about RADIUS.
 *
 * Pushing configuration and assuming it took is how the last few days went. This
 * compares the router's own view against what the server expects and names each
 * mismatch, so "RADIUS is not working" becomes a specific wrong value.
 */
/**
 * A description of a secret that is safe to put on screen: how long it is, and
 * six hex characters of its SHA-256. Enough to tell two values apart, useless to
 * anyone reading over a shoulder.
 */
function fingerprint(v) {
  if (v == null || v === '') return 'nothing';
  const s = String(v);
  const hash = nodeCrypto.createHash('sha256').update(s).digest('hex').slice(0, 6);
  const padded = s !== s.trim() ? ', has surrounding whitespace' : '';
  return `${s.length} chars #${hash}${padded}`;
}

export async function radiusCheck(conn, { serverIp, secret, coaPort = 3799 }) {
  const [servers, incoming, aaa] = await Promise.all([
    conn.write('/radius/print', []),
    conn.write('/radius/incoming/print', []),
    conn.write('/ppp/aaa/print', []),
  ]);

  const mine = servers.filter((s) => String(s.address) === String(serverIp));
  const inc = incoming[0] ?? {};
  const ppp = aaa[0] ?? {};
  const yes = (v) => v === 'true' || v === 'yes';

  const checks = [
    {
      name: `RADIUS server ${serverIp} configured`,
      ok: mine.length > 0,
      detail: mine.length ? `${mine.length} entr${mine.length === 1 ? 'y' : 'ies'}`
        : `router lists ${servers.length} RADIUS server(s), none at ${serverIp}`,
    },
    {
      name: 'shared secret matches',
      ok: mine.some((s) => s.secret === secret),
      /*
       * When they differ, say *how* without printing either.
       *
       * "The secret is wrong" has been the answer for days without being
       * actionable. A length and a short fingerprint distinguish the cases that
       * matter: different lengths means the wrong value was written, same length
       * with different fingerprints means two different values, and identical
       * fingerprints with a failing comparison means whitespace or encoding
       * rather than the value itself.
       */
      detail: mine.length
        ? `server holds ${fingerprint(secret)}, router holds ${mine.map((m) => fingerprint(m.secret)).join(' / ')}`
        : 'no entry to compare',
    },
    {
      name: 'used for PPPoE',
      ok: mine.some((s) => String(s.service ?? '').includes('ppp')),
      detail: mine[0]?.service ? `service=${mine[0].service}` : 'no entry',
    },
    {
      name: 'accepts CoA',
      ok: yes(inc.accept),
      detail: `accept=${inc.accept ?? '?'} — /radius incoming set accept=yes`,
    },
    {
      name: `CoA port ${coaPort}`,
      ok: String(inc.port ?? '') === String(coaPort),
      detail: `router listens on ${inc.port ?? '?'}`,
    },
    {
      name: 'PPP uses RADIUS',
      ok: yes(ppp['use-radius']),
      detail: `use-radius=${ppp['use-radius'] ?? '?'}`,
    },
    {
      name: 'PPP accounting on',
      ok: yes(ppp.accounting),
      detail: `accounting=${ppp.accounting ?? '?'}`,
    },
    {
      name: 'interim updates set',
      ok: !!ppp['interim-update'] && ppp['interim-update'] !== '00:00:00',
      detail: `interim-update=${ppp['interim-update'] ?? '?'} — without it usage only lands when a session ends`,
    },
  ];

  return { checks, ok: checks.every((c) => c.ok) };
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
