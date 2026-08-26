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

/**
 * Tags every object we own — with what it is actually for, not one identical
 * blanket comment on every rule the push touches. An operator reading the
 * router's own config should be able to tell an anti-sharing mangle rule from
 * a DNS block from the expired-customer block at a glance, the same as they
 * would for anything they wrote themselves.
 *
 * The (managed) tail is the only part our own idempotency checks rely on —
 * isManaged() matches on that, not on the label before it, so every rule can
 * carry its own description and still be found, updated, and left alone by
 * the next push exactly as before.
 *
 * Kept brand-neutral on purpose — this shows up in the router's own config,
 * which a tenant's own technician reads, not just us. OLD_TAG stays matched
 * (not written) so a router tagged by an older push before this rename still
 * gets recognised as ours and relabelled the next time each rule is touched,
 * rather than orphaned and duplicated.
 */
/**
 * A short breather between heavy config-push steps (bridge, PPPoE server,
 * hotspot server, DNS proxy…), each of which makes RouterOS recompute
 * interface/routing/connection-tracking state. Fired back-to-back with no
 * gap at all, that recomputation stacked up into a CPU spike big enough to
 * starve the management tunnel mid-push on weaker boards — see the Configure
 * handler in server.js, which calls this between the biggest steps.
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TAG = '(managed)';
const OLD_TAG = '(vibelink)';
const managed = (label) => `${label} ${TAG}`;
const isManaged = (row) => typeof row?.comment === 'string'
  && (row.comment.endsWith(TAG) || row.comment.endsWith(OLD_TAG));

/** Back-compat for anywhere still asking for the old blanket tag directly. */
export const MANAGED_COMMENT = managed('managed');

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

/**
 * RouterOS's own HH:MM:SS shape for an interim-update interval, from a
 * plain seconds count — the three interim-update writes below used to
 * format their minutes-only parameter straight into the MM slot
 * (`00:${mm}:00`), which cannot express anything under a minute at all;
 * a 30-second interval needed the SS slot instead.
 */
function hhmmss(totalSeconds) {
  const s = Math.max(1, Math.round(Number(totalSeconds) || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

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
    /**
     * "no such command or directory" names a missing menu, not a missing item.
     *
     * RouterOS uses that exact wording only when a whole submenu does not
     * exist — "no such item" is the answer for an empty or absent row inside a
     * menu that is really there. /ip/hotspot and /ip/dhcp-server/... only exist
     * when the matching package is installed, enabled, and at the same version
     * as the base system, and MikroTik ships several of them as separate
     * packages that update independently. A router that served a hotspot
     * minutes earlier can still land here without the package ever being
     * disabled: `/system package print` on the router that produced this had
     * hotspot sitting at 7.21.5 against routeros and wireless at 7.24, built
     * over a month apart — a routeros upgrade that installed but has not been
     * rebooted into yet, leaving the older hotspot build unable to answer
     * anything under /ip/hotspot until the reboot reconciles the versions.
     * "Enable the package" would have been the wrong advice for exactly that
     * router, so the message covers both causes rather than guessing which.
     */
    // RouterOS names the missing segment itself, in parentheses — reading it
    // from the message rather than guessing from `path` matters because the
    // failing segment is rarely the first one: /ip/hotspot/profile/print fails
    // on "hotspot", not "ip", and picking the wrong word here failed silently,
    // falling through to the raw, unexplained RouterOS sentence exactly as
    // before.
    const missing = /^no such command.*\(([\w-]+)\)/i.exec(String(e.message ?? ''))?.[1];
    if (missing) {
      const err = new Error(
        `The router says the "${missing}" package is unavailable. Check /system package print: `
        + `if it is marked X, enable it with /system package enable ${missing} and reboot; if it `
        + `is present but its version and build date do not match routeros, an upgrade is `
        + `installed but not yet applied — reboot to bring it in line.`);
      err.step = label;
      throw err;
    }
    /**
     * A property this menu does not accept — because the menu is on an older
     * RouterOS, on a different board, or simply predates the property — is not
     * a reason to fail the whole push over it. RouterOS names the exact
     * argument it rejected ("unknown parameter comment", "unknown parameter
     * one-session-per-host"), so it can be dropped and the command sent again
     * rather than treating every optional refinement as load-bearing.
     *
     * This started narrower — comment alone, because that was the property
     * caught failing a push in practice. Generalising it is what "support
     * RouterOS 6+" has to mean in code that cannot enumerate, from memory,
     * every property RouterOS 6 lacks that a later RouterOS 7 added: PPPoE's
     * one-session-per-host, MAC-cookie fields on older hotspot builds, and
     * whatever the next board turns out to be missing. Guessing that list
     * and hardcoding it would be confidently wrong the first time a board
     * disagreed; asking the router what it just rejected is never wrong.
     *
     * Looped rather than tried once: a router can reject more than one
     * property in the same command, and each retry can only remove the one
     * RouterOS names this time. Capped at four rounds so a router that is
     * rejecting everything about a command — the wrong menu entirely, not an
     * unsupported property — fails with its real error rather than looping
     * silently.
     *
     * The cost is the same one comment-stripping always had: a row written
     * this way cannot be found again by the property that was dropped. Every
     * matcher elsewhere already keys on something the router is guaranteed to
     * accept — a name, an address, a chain — for exactly this reason.
     */
    let current = args;
    for (let round = 0; round < 4; round++) {
      // Trailing punctuation trimmed defensively — RouterOS's own wording has
      // never carried any in what has actually been seen, but matching one
      // extra character would silently fail to strip anything.
      const bad = /unknown parameter\s+(\S+)/i.exec(String(e?.message ?? ''))?.[1]?.replace(/[.,;:]+$/, '');
      if (!bad) break;
      const without = current.filter((a) => !String(a).startsWith(`=${bad}=`) && String(a) !== `=!${bad}=`);
      if (without.length === current.length) break;   // the named property was not actually in this call
      current = without;
      // Silent until now — a write that got quietly narrowed left no trace
      // an operator could ever find without reading this file. Worth knowing
      // about even though it is usually harmless (an older board lacking an
      // optional property), because "harmless" stops being true the day a
      // call site passes something that mattered.
      console.warn(`routeros: ${label} — RouterOS rejected "${bad}" as unknown, retrying without it`);
      try {
        return await conn.write(path, current);
      } catch (retry) {
        e = retry;   // try again with whatever RouterOS objects to next
      }
    }
    e.step = e.step ?? `${label} (${path} ${args.join(' ')})`;
    throw e;
  }
}

/** RouterOS returns the internal id as ".id"; every write that edits a row needs it. */
const idOf = (row) => row?.['.id'];

/**
 * Is this row already exactly what we are about to write?
 *
 * Every push is mostly a re-push — an operator presses Configure again after
 * changing one thing, or Send again after a failure — and each write is a
 * round trip over a tunnel to a router on a domestic connection, where the
 * latency, not the work, is the cost. Skipping the writes that would change
 * nothing is most of the time a second run takes.
 *
 * Deliberately pessimistic. A property missing from the printed row, a value
 * RouterOS renders differently from the way it accepts it (`disabled=no` comes
 * back as `false`), an interface returned as an internal id — all of those read
 * as "different" and the write happens. The only outcome of being wrong here is
 * a write we did not need; never a change we skipped.
 */
function unchanged(row, fields) {
  if (!row) return false;
  for (const field of fields) {
    const s = String(field);
    if (!s.startsWith('=')) return false;
    const eq = s.indexOf('=', 1);
    if (eq < 0) return false;
    const key = s.slice(1, eq);
    const value = s.slice(eq + 1);
    if (key === '.id') continue;
    // "=!x=" removes x, so the row matches only if x is already absent.
    if (key.startsWith('!')) {
      if (String(row[key.slice(1)] ?? '') !== '') return false;
      continue;
    }
    if (!(key in row)) return false;
    if (String(row[key]) !== value) return false;
  }
  return true;
}

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
    await cmd(conn, 'update service user', '/user/set', [
      `=.id=${idOf(existing[0])}`,
      `=password=${password}`,
      '=group=full',
      `=comment=${managed('ispBilling login')}`,
    ]);
    return { created: false };
  }
  await cmd(conn, 'create service user', '/user/add', [
    `=name=${user}`,
    `=password=${password}`,
    '=group=full',
    `=comment=${managed('ispBilling login')}`,
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
  const mine = (await cmd(conn, 'list RADIUS servers', '/radius/print', []))
    .filter((r) => String(r.address) === String(serverIp));

  const fields = [
    `=service=${services}`,
    `=address=${serverIp}`,
    `=secret=${secret}`,
    '=timeout=3s',
    `=comment=${managed('ispBilling RADIUS')}`,
  ];

  if (mine.length) {
    if (!unchanged(mine[0], fields)) {
      await cmd(conn, 'update RADIUS server', '/radius/set', [`=.id=${idOf(mine[0])}`, ...fields]);
    }
    // Any other entry for this server is debris — an interrupted run, or one
    // added by hand during setup. Leaving it means half the requests get signed
    // with a stale secret and dropped.
    for (const dupe of mine.slice(1)) {
      await cmd(conn, 'remove duplicate RADIUS server', '/radius/remove', [`=.id=${idOf(dupe)}`]);
    }
  } else {
    await cmd(conn, 'add RADIUS server', '/radius/add', fields);
  }

  // Without this the router ignores CoA entirely and speed changes wait for the
  // subscriber to reconnect — the failure everyone hits first.
  await cmd(conn, 'enable CoA', '/radius/incoming/set', ['=accept=yes', `=port=${coaPort}`]);

  return { replaced: mine.length > 1 ? mine.length - 1 : 0 };
}

/**
 * PPPoE authentication and accounting.
 *
 * interim-update matters more than it looks: without it the router reports usage
 * only when a session ends, so fair-use sees zero all day and then a cliff.
 */
export async function applyPpp(conn, { interimSeconds = 30 } = {}) {
  await conn.write('/ppp/aaa/set', [
    '=use-radius=yes',
    '=accounting=yes',
    `=interim-update=${hhmmss(interimSeconds)}`,
  ]);
}

/**
 * Same for hotspot: every profile on the box, since a router may serve several
 * sites. Routed through cmd() rather than a bare read, purely so a router
 * with no hotspot package gets the same translated message as every write
 * below — "the hotspot package is not installed" — instead of RouterOS's raw
 * "no such command or directory (hotspot)".
 */
export async function applyHotspot(conn, { interimSeconds = 30 } = {}) {
  const profiles = await cmd(conn, 'read hotspot profiles', '/ip/hotspot/profile/print', []);
  const fields = ['=use-radius=yes', `=radius-interim-update=${hhmmss(interimSeconds)}`];
  let changed = 0;
  for (const p of profiles) {
    if (unchanged(p, fields)) continue;
    await conn.write('/ip/hotspot/profile/set', [`=.id=${idOf(p)}`, ...fields]);
    changed++;
  }
  return { profiles: changed };
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
  interimSeconds = 30,
  dnsName = 'billing.spot',
  sharedUsers = 1,
  idleSeconds = 30,
  bindMac = true,
} = {}) {
  const { network: cidr, gateway, poolRange, bits } = planNetwork(network);
  const POOL = 'hotspot-pool';
  const done = [];

  // The gateway address on the bridge. Without this the hotspot has nothing to
  // intercept on and the server silently refuses to come up.
  /**
   * Matched on the address, and asked for by interface rather than compared.
   *
   * `interface` comes back as an internal id, so comparing it to "bridge-lan"
   * never matched and each run would have added the gateway address again —
   * RouterOS allows duplicate addresses on an interface, so this one fails
   * quietly rather than loudly, which is worse.
   */
  const addrs = await conn.write('/ip/address/print', [`?interface=${bridge}`]);
  const existing = addrs.find((a) => String(a.address).startsWith(`${gateway}/`));
  if (!existing) {
    await cmd(conn, 'gateway address', '/ip/address/add', [
      `=address=${gateway}/${bits}`, `=interface=${bridge}`, `=comment=${managed('ispHotspot gateway')}`,
    ]);
    done.push(`address ${gateway}/${bits} on ${bridge}`);
  }

  // Filtered by the router rather than printed in full and searched here: on a
  // box with a long pool list that is a needless transfer over the tunnel.
  const pool = (await conn.write('/ip/pool/print', [`?name=${POOL}`]))[0];
  if (pool) await cmd(conn, 'address pool', '/ip/pool/set', [`=.id=${idOf(pool)}`, `=ranges=${poolRange}`]);
  else {
    await cmd(conn, 'address pool', '/ip/pool/add', [`=name=${POOL}`, `=ranges=${poolRange}`]);
    done.push(`pool ${poolRange}`);
  }

  /**
   * Found by the name we give it, not by its interface.
   *
   * RouterOS returns a DHCP server's `interface` as an internal id — the same
   * thing that made bridge ports look like they belonged to a bridge called
   * "*11". Comparing it to "bridge-lan" never matched, so every re-run decided
   * there was no server and tried to add a second one: "server with such name
   * already exists", and a push that had fully succeeded the first time failed
   * every time after.
   *
   * The name is ours and stable, so it is the reliable key. Asking RouterOS to
   * filter (?name=) rather than filtering here also sidesteps the question of
   * what shape any other field comes back in.
   */
  const DHCP = 'hotspot-dhcp';
  const dhcp = (await conn.write('/ip/dhcp-server/print', [`?name=${DHCP}`]))[0];
  const dhcpFields = [`=interface=${bridge}`, `=address-pool=${POOL}`, '=disabled=no',
                      `=lease-time=1h`, `=comment=${managed('ispHotspot DHCP')}`];
  if (dhcp) {
    if (!unchanged(dhcp, dhcpFields)) {
      await cmd(conn, 'DHCP server', '/ip/dhcp-server/set', [`=.id=${idOf(dhcp)}`, ...dhcpFields]);
    }
  }
  else {
    await cmd(conn, 'DHCP server', '/ip/dhcp-server/add', [`=name=${DHCP}`, ...dhcpFields]);
    done.push('dhcp server');
  }

  // The network statement is what actually gives clients a gateway and DNS. A
  // DHCP server without it leases addresses that cannot route anywhere.
  const nets = await conn.write('/ip/dhcp-server/network/print', []);
  const netRow = nets.find((n) => String(n.address) === cidr);
  const netFields = [`=address=${cidr}`, `=gateway=${gateway}`, `=dns-server=${gateway}`,
                     `=comment=${managed('ispHotspot DHCP network')}`];
  if (netRow) {
    if (!unchanged(netRow, netFields)) {
      await cmd(conn, 'DHCP network', '/ip/dhcp-server/network/set', [`=.id=${idOf(netRow)}`, ...netFields]);
    }
  }
  else {
    await cmd(conn, 'DHCP network', '/ip/dhcp-server/network/add', netFields);
    done.push('dhcp network');
  }

  const PROFILE = 'hsprof-billing';
  const profile = (await conn.write('/ip/hotspot/profile/print', [`?name=${PROFILE}`]))[0];
  const profileFields = [
    `=hotspot-address=${gateway}`,
    `=dns-name=${dnsName}`,
    '=use-radius=yes',
    `=radius-interim-update=${hhmmss(interimSeconds)}`,
    // http-chap needs the login page to do the hashing; plain http-pap is what
    // actually works against a Cleartext-Password in radcheck, which is what we
    // store. Offering chap here is how you get a login page that always fails.
    '=login-by=http-pap',
    /**
     * Deliberately always cleared, never set.
     *
     * This used to redirect guests to the live page instead of a locally
     * cached copy — a real fix for pushHotspotPage's /tool/fetch approach
     * having its own hard-to-diagnose failures on some boards. It does not
     * work: RouterOS's own CLI and API both collapse the "//" in the https://
     * scheme down to a single slash when this property is stored (confirmed
     * against a live router — the profile came back with
     * "html-directory-override=https:/vibelink.vibelink.tech/..."), and a
     * redirect to a malformed URL does not serve a working page. Worse, a
     * value set here silently takes priority over html-directory, so once
     * it is set — including from a push made before this was understood —
     * every subsequent guest keeps getting redirected to a broken URL until
     * something explicitly clears it. That is not hypothetical: it happened
     * on this project's own router and looked like the login page itself
     * had broken, when the actual page and its styling were fine and simply
     * never being served.
     *
     * Explicitly clearing it (rather than only setting it when a value is
     * given) is what makes a push self-healing: any router still carrying a
     * stale value from before this was understood gets fixed by the next
     * ordinary Hotspot or Configure push, with no manual CLI step required.
     */
    '=html-directory-override=',
  ];
  if (profile) {
    if (!unchanged(profile, profileFields)) {
      await cmd(conn, 'hotspot profile', '/ip/hotspot/profile/set', [`=.id=${idOf(profile)}`, ...profileFields]);
    }
  }
  else {
    await cmd(conn, 'hotspot profile', '/ip/hotspot/profile/add', [`=name=${PROFILE}`, ...profileFields]);
    done.push('hotspot profile');
  }

  // Same reasoning as the DHCP server: matched on our own name, because the
  // interface comes back as an id and a second add fails on the name clash.
  const SERVER = 'hotspot-billing';
  const server = (await conn.write('/ip/hotspot/print', [`?name=${SERVER}`]))[0];
  const serverFields = [`=interface=${bridge}`, `=profile=${PROFILE}`,
                        `=address-pool=${POOL}`, '=disabled=no'];
  if (server) {
    if (!unchanged(server, serverFields)) {
      await cmd(conn, 'hotspot server', '/ip/hotspot/set', [`=.id=${idOf(server)}`, ...serverFields]);
    }
  }
  else {
    await cmd(conn, 'hotspot server', '/ip/hotspot/add', [`=name=${SERVER}`, ...serverFields]);
    done.push('hotspot server');
  }

  /**
   * The user profile every voucher names.
   *
   * Created here, not only behind the Hotspot button, because vouchers carry
   * Mikrotik-Group=hs-default and a router that has been through Configure but
   * not Hotspot does not have it. The login then fails with "unknown user
   * profile <hs-default>" — the code and the password are perfect and the guest
   * is refused, which is the same trap that Mikrotik-Group set for PPPoE.
   *
   * Anything that builds a hotspot must build the profile its sessions will ask
   * for, or the two can drift apart again.
   */
  const profileResult = await ensureHotspotUserProfile(conn, { sharedUsers, idleSeconds, bindMac });
  if (profileResult.created) done.push(`user profile ${profileResult.profile}`);

  // Without this the guests have a lease and no internet, which is the single
  // most common "the hotspot does not work" report.
  const nat = await applyNat(conn, { subnet: cidr });
  if (nat.created) done.push(`NAT for ${cidr}${nat.wan ? ` out ${nat.wan}` : ''}`);

  return { gateway, pool: poolRange, changed: done, wan: nat.wan };
}

/**
 * Which interface the internet is on.
 *
 * Read from the default route rather than guessed at. Every site wires its
 * uplink differently — ether1 on one box, a PPPoE client or an LTE modem on the
 * next — and a masquerade rule pointed at the wrong interface silently does
 * nothing.
 */
export async function wanInterface(conn, ifaceNames = null) {
  const routes = await conn.write('/ip/route/print', ['?dst-address=0.0.0.0/0']);
  const live = routes.find((r) => r.active === 'true' && r['gateway-status']) ?? routes[0];

  // gateway-status reads like "41.90.1.1 reachable via ether1", so the name is
  // after " via ". On a route with no gateway-status the `gateway` field is an
  // address, not an interface — and feeding that to out-interface fails with
  // "input does not match any value of interface", taking the whole push down
  // at the firewall step. Both candidates are therefore checked against the
  // interfaces the router actually has.
  //
  // ifaceNames lets a caller that already has the list hand it in, rather than
  // this fetching its own copy — ensureBridge calls this from inside
  // uplinkPorts, and a second /interface/print over a slow tunnel was cheap to
  // avoid and not free to pay for twice on every push.
  const names = ifaceNames ?? new Set((await conn.write('/interface/print', [])).map((i) => i.name));

  const status = String(live?.['gateway-status'] ?? '');
  const via = status.includes(' via ') ? status.split(' via ').pop().trim() : null;
  if (via && names.has(via)) return via;

  /**
   * `immediate-gw`, for the route gateway-status never has an answer for.
   *
   * A static or PPPoE-assigned default route carries gateway-status —
   * "41.90.1.1 reachable via ether1" — and the check above reads it. A
   * DHCP-client-installed default route does not: RouterOS names the
   * interface a different way instead, as a %-suffix on immediate-gw itself
   * — immediate-gw=192.168.1.1%ether1 — confirmed from a router this failed
   * on, whose uplink is fed by DHCP from an upstream router rather than a
   * static gateway. Nothing here read that field before, so a router shaped
   * exactly like that one always fell through every check below and reported
   * no identifiable uplink — safe, since nothing was opened unprotected, but
   * wrong: the uplink was knowable, this just never asked the right field.
   */
  const immediate = String(live?.['immediate-gw'] ?? '');
  const viaImmediate = immediate.includes('%') ? immediate.split('%').pop().trim() : null;
  if (viaImmediate && names.has(viaImmediate)) return viaImmediate;

  const gateway = String(live?.gateway ?? '').trim();
  if (gateway && names.has(gateway)) return gateway;   // some routes name the interface directly

  // Nothing identifiable. The caller masquerades without out-interface, which
  // is broader than ideal but gets customers online — naming a wrong interface
  // achieves nothing and is far harder to spot.
  return null;
}

/**
 * Let hotspot guests resolve a name at all — which the captive-portal popup
 * depends on entirely, not just on being reachable once it appears.
 *
 * applyHotspotServer hands guests the gateway as their DNS server, but a fresh
 * RouterOS refuses queries from anyone but itself until told otherwise:
 * `/ip dns` ships with `allow-remote-requests=no`. A phone given a DNS server
 * that refuses to answer cannot resolve anything — not Apple's or Google's
 * connectivity-check host, which is what triggers the OS's own captive-portal
 * popup, and not the tenant's own domain for the login page either. The guest
 * sees "no internet" and never gets the prompt; RouterOS's own redirect never
 * gets a chance to run, because the browser never manages to open a
 * connection to redirect. This is indistinguishable from "the popup is not
 * working" and is a more common cause of it than anything in the portal page
 * itself.
 *
 * Turning `allow-remote-requests` on is not free, and MikroTik says so in its
 * own documentation: an open resolver reachable from the WAN is a standing
 * invitation to DNS amplification abuse. So this does not merely flip the
 * setting — it also blocks port 53 on the WAN interface specifically, which
 * nothing in this file has touched before. Narrow on purpose: it drops only
 * DNS queries arriving from the internet side, and nothing else — nothing
 * touches winbox, ssh, the API, or the RADIUS/OpenVPN/WireGuard traffic this
 * whole system depends on, all of which arrive on other interfaces or other
 * ports. If the uplink cannot be identified, the DNS proxy is left exactly as
 * it was found: no resolution for guests is the honest fallback next to
 * accidentally opening a resolver to the internet, the same choice applyNat
 * already makes when it cannot name an interface.
 */
export async function applyDnsProxy(conn, { hotspotSubnet = null } = {}) {
  const [dns] = await conn.write('/ip/dns/print', []);
  const already = dns?.['allow-remote-requests'] === 'true' || dns?.['allow-remote-requests'] === 'yes';

  const wan = await wanInterface(conn);
  if (!wan) {
    return already
      ? { enabled: true, protected: false, note: 'DNS proxy was already open; could not confirm the uplink to firewall it' }
      : { enabled: false, protected: false, note: 'could not identify the uplink, so the DNS proxy was left off rather than opened unprotected' };
  }

  if (!already) {
    await cmd(conn, 'DNS proxy', '/ip/dns/set', ['=allow-remote-requests=yes']);
  }

  // Matched by comment prefix, not bare chain+port — a rate-limit pair added
  // below shares both of those with this rule, and matching on just chain and
  // port would have made each "fix" the other's own idempotency check thought
  // was a stray duplicate of itself.
  const rules = await conn.write('/ip/firewall/filter/print', []);
  const mine = rules.filter((r) => isManaged(r)
    && String(r.chain) === 'input' && String(r['dst-port']) === '53'
    && String(r.comment ?? '').startsWith('ispBlocking WAN DNS'));
  const fields = [
    '=chain=input', `=in-interface=${wan}`, '=protocol=udp', '=dst-port=53',
    '=action=drop', `=comment=${managed('ispBlocking WAN DNS')}`,
  ];
  if (mine.length) {
    if (!unchanged(mine[0], fields)) {
      await cmd(conn, 'block WAN DNS', '/ip/firewall/filter/set', [`=.id=${idOf(mine[0])}`, ...fields]);
    }
  } else {
    // place-before=0: a filter rule added at the end only takes effect after
    // whatever earlier rule already accepts the traffic in question, and an
    // established/related accept near the top of a typical input chain would
    // otherwise let a DNS reply through before this rule is ever reached.
    // "0" is a position in the router's whole filter list, not the input
    // chain alone — on a fresh or freshly-reset router with no firewall
    // rules at all yet, that position doesn't exist, and RouterOS rejects it
    // with "no such item" rather than just appending. Only meaningful (and
    // only valid) when there is an existing rule to land ahead of.
    await cmd(conn, 'block WAN DNS', '/ip/firewall/filter/add',
      rules.length ? [...fields, '=place-before=0'] : fields);
  }
  for (const dupe of mine.slice(1)) {
    await cmd(conn, 'remove duplicate WAN DNS block', '/ip/firewall/filter/remove', [`=.id=${idOf(dupe)}`]);
  }

  /**
   * DNS tunneling — the standard way a captive portal gets bypassed for
   * free, and exactly what a "VPN injector" app does when it finds one open.
   * `allow-remote-requests=yes` above is not optional (a guest cannot even
   * see the login popup without it — see this function's own top comment),
   * so an unauthenticated guest and a paying one reach the identical open
   * resolver either way. Nothing about the walled garden touches this: it
   * matches HTTP hosts, and a DNS query addressed to the router itself
   * never goes near it. Tools like iodine or dnscat2 — and every
   * commercial "free internet" injector app doing the same trick by
   * hand — tunnel arbitrary TCP/IP through exactly this open recursive
   * resolver, before ever paying for a voucher.
   *
   * Not blockable outright — real name resolution has to keep working, for
   * everyone, paid or not, or the portal itself stops appearing. Rate-limited
   * instead: RouterOS's own leaky-bucket `limit` matcher accepts up to 40
   * packets/sec (bursting to 80) per guest address, and anything over that
   * budget falls through to the drop rule beneath it. Ordinary browsing
   * fires a handful of small queries per page; a tunnel needs sustained
   * throughput through the same 53/udp path to be worth anything, and this
   * caps it at a small fraction of dial-up speed — resolvable, not usable.
   */
  if (hotspotSubnet) {
    const dnsRules = await conn.write('/ip/firewall/filter/print', []);
    const mineAccept = dnsRules.filter((r) => isManaged(r)
      && String(r.comment ?? '').startsWith('ispBlocking guest DNS rate accept'));
    const mineDrop = dnsRules.filter((r) => isManaged(r)
      && String(r.comment ?? '').startsWith('ispBlocking guest DNS rate drop'));

    const acceptFields = [
      '=chain=input', `=src-address=${hotspotSubnet}`, '=protocol=udp', '=dst-port=53',
      '=limit=40,80:packet', '=action=accept', `=comment=${managed('ispBlocking guest DNS rate accept')}`,
    ];
    const dropFields = [
      '=chain=input', `=src-address=${hotspotSubnet}`, '=protocol=udp', '=dst-port=53',
      '=action=drop', `=comment=${managed('ispBlocking guest DNS rate drop')}`,
    ];

    /**
     * Drop created first, accept created second — both only ever with
     * place-before=0, the one placement value the rest of this file trusts
     * (see the WAN-block rule above; an id-based place-before was tried here
     * first and dropped for mixing conventions nothing else in this codebase
     * relies on). Each successive place-before=0 insert becomes the new
     * front of the whole filter list, so creating drop and then accept, in
     * that order, is what leaves accept sitting ahead of drop — traffic
     * still inside the budget matches accept first and never reaches drop
     * at all. Only matters on the first push that creates both; an idempotent
     * re-push updates each rule in place without touching order again.
     */
    if (mineDrop.length) {
      if (!unchanged(mineDrop[0], dropFields)) {
        await cmd(conn, 'guest DNS rate drop', '/ip/firewall/filter/set', [`=.id=${idOf(mineDrop[0])}`, ...dropFields]);
      }
    } else {
      await cmd(conn, 'guest DNS rate drop', '/ip/firewall/filter/add', [...dropFields, '=place-before=0']);
    }
    for (const dupe of mineDrop.slice(1)) {
      await cmd(conn, 'remove duplicate guest DNS drop', '/ip/firewall/filter/remove', [`=.id=${idOf(dupe)}`]);
    }

    if (mineAccept.length) {
      if (!unchanged(mineAccept[0], acceptFields)) {
        await cmd(conn, 'guest DNS rate limit', '/ip/firewall/filter/set', [`=.id=${idOf(mineAccept[0])}`, ...acceptFields]);
      }
    } else {
      await cmd(conn, 'guest DNS rate limit', '/ip/firewall/filter/add', [...acceptFields, '=place-before=0']);
    }
    for (const dupe of mineAccept.slice(1)) {
      await cmd(conn, 'remove duplicate guest DNS accept', '/ip/firewall/filter/remove', [`=.id=${idOf(dupe)}`]);
    }
  }

  return { enabled: true, protected: true, wan };
}

/**
 * Let a subnet reach the internet.
 *
 * Nothing here created a NAT rule, so a hotspot or PPPoE client got an address,
 * a gateway and DNS, associated happily — and could reach nothing. Private
 * addresses do not route on the internet; without masquerade the replies have
 * nowhere to come back to. It is the one step that turns a working lease into
 * working internet, and its absence looks exactly like "connected, no internet".
 *
 * Matched on the source subnet rather than the comment alone: an operator who
 * already added masquerade by hand should not end up with two rules doing the
 * same thing.
 */
export async function applyNat(conn, { subnet, wan = null }) {
  const out = wan ?? await wanInterface(conn);

  const rules = await conn.write('/ip/firewall/nat/print', []);
  const same = rules.filter((r) => String(r.chain) === 'srcnat'
    && String(r.action) === 'masquerade'
    && String(r['src-address'] ?? '') === String(subnet));

  const fields = [
    '=chain=srcnat',
    `=src-address=${subnet}`,
    '=action=masquerade',
    `=comment=${managed('ispNat subscriber masquerade')}`,
    // out-interface is deliberately omitted when the uplink cannot be
    // determined: masquerading out of every interface is wrong in principle but
    // still gets customers online, whereas naming the wrong interface does
    // nothing at all and is far harder to spot.
    ...(out ? [`=out-interface=${out}`] : []),
  ];

  if (same.length) {
    if (!unchanged(same[0], fields)) {
      await cmd(conn, 'NAT rule', '/ip/firewall/nat/set', [`=.id=${idOf(same[0])}`, ...fields]);
    }
    return { created: false, wan: out };
  }
  await cmd(conn, 'NAT rule', '/ip/firewall/nat/add', fields);
  return { created: true, wan: out };
}

/**
 * Hosts reachable before anyone logs in.
 *
 * Without this a customer with no credit cannot reach M-Pesa to buy any, and the
 * hotspot is a shop with the door locked from the inside. The billing portal
 * itself has to be reachable for the same reason.
 *
 * Entries we manage are tagged and diffed against the wanted list on each
 * run — only what actually changed is touched; anything an operator added
 * by hand is left alone.
 */
export async function applyWalledGarden(conn, hosts = []) {
  const wanted = [...new Set(hosts.map((h) => String(h).trim()).filter(Boolean))];

  /**
   * Diffed, not rebuilt — this used to remove every managed row and re-add
   * the entire list on every single push, even when nothing had changed. On
   * a walled garden of any real size that is dozens of back-to-back RouterOS
   * writes for zero actual change, every push, forever — on a weak board
   * that burst of control-plane work was enough to spike CPU to 100% and
   * knock the management tunnel out mid-push. Now it only touches rows that
   * actually need to move, so a re-push with an unchanged list is a no-op,
   * same as every other apply* function here.
   */
  const current = await conn.write('/ip/hotspot/walled-garden/print', []);
  const mine = current.filter((r) => isManaged(r));
  const have = new Set(mine.map((r) => r['dst-host']));

  const toRemove = mine.filter((r) => !wanted.includes(r['dst-host']));
  const toAdd = wanted.filter((h) => !have.has(h));

  // Still paced even after diffing to a minimal set — a router being onboarded
  // for the first time has nothing managed yet, so the whole list is new adds
  // in one go. A short gap between writes gives the router's control plane a
  // breath between each rather than saturating it in one unbroken burst.
  for (const row of toRemove) {
    await conn.write('/ip/hotspot/walled-garden/remove', [`=.id=${idOf(row)}`]);
    await sleep(40);
  }
  for (const host of toAdd) {
    await conn.write('/ip/hotspot/walled-garden/add', [
      `=dst-host=${host}`, '=action=allow', `=comment=${managed('ispHotspot walled garden')}`,
    ]);
    await sleep(40);
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
  name = 'hs-default', sharedUsers = 1, idleSeconds = 30, bindMac = true,
} = {}) {
  const rows = await conn.write('/ip/hotspot/user/profile/print', []);
  const found = rows.find((p) => p.name === name);
  // Built from total seconds, not assumed to be a whole number of minutes —
  // idleSeconds used to be idleMinutes formatted as `00:${minutes}:00`, which
  // could only ever express whole minutes and produced invalid RouterOS
  // syntax ("00:0.5:00") for anything shorter, like the 30-second timeout
  // this is meant to allow: a used voucher's username frees up for someone
  // else the moment the current holder goes idle, not up to ten minutes
  // later.
  const secs = Math.max(1, Math.round(idleSeconds));
  const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const fields = [
    `=shared-users=${sharedUsers}`,
    `=idle-timeout=${hh}:${mm}:${ss}`,
    '=status-autorefresh=1m',
    /**
     * MAC cookie: the device is remembered and logged back in by itself.
     *
     * Without it a guest who pays, then walks out of range or switches WiFi
     * off and on, is met by the login page again and has to find the code they
     * were sent. With it the router recognises the handset and reconnects it
     * for as long as the bundle lasts, which is what somebody who has already
     * paid expects to happen.
     *
     * add-mac-cookie writes the cookie; mac-cookie-timeout is how long it is
     * honoured. A day covers the common bundles and expires on its own.
     */
    ...(bindMac ? ['=add-mac-cookie=yes', '=mac-cookie-timeout=1d'] : ['=add-mac-cookie=no']),
    `=comment=${managed('ispHotspot user profile')}`,
  ];
  if (found) {
    if (!unchanged(found, fields)) {
      await cmd(conn, 'hotspot user profile', '/ip/hotspot/user/profile/set', [`=.id=${idOf(found)}`, ...fields]);
    }
    return { profile: name, created: false };
  }
  await cmd(conn, 'hotspot user profile', '/ip/hotspot/user/profile/add', [`=name=${name}`, ...fields]);
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
  const mine = rules.filter((r) => isManaged(r)
    && String(r.chain) === 'postrouting' && String(r['out-interface']) === bridge);

  const fields = [
    '=chain=postrouting',
    `=out-interface=${bridge}`,
    '=action=change-ttl',
    '=new-ttl=set:1',
    `=comment=${managed('ispHotspot anti-sharing')}`,
  ];
  if (mine.length) {
    if (!unchanged(mine[0], fields)) {
      await cmd(conn, 'anti-sharing rule', '/ip/firewall/mangle/set', [`=.id=${idOf(mine[0])}`, ...fields]);
    }
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
  // Ask RouterOS to filter by interface — comparing the printed value fails,
  // because it is returned as an id. Falling back to the only hotspot on the
  // box when the filter finds nothing, which is the common case.
  const servers = bridge
    ? [...(await conn.write('/ip/hotspot/print', [`?interface=${bridge}`])),
       ...(await conn.write('/ip/hotspot/print', []))]
    : await conn.write('/ip/hotspot/print', []);
  const server = servers[0];
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
  // So the picker can say which port must not be ticked, instead of asking the
  // operator to know. ensureBridge refuses these outright; this is the warning
  // that arrives before the mistake rather than after it.
  const uplinks = await uplinkPorts(conn);

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
      uplink: uplinks.get(i.name) ?? null,
    }));
}

/**
 * Throughput on every port, right now.
 *
 * `once` matters: without it monitor-traffic streams until the socket closes,
 * and this library resolves on the first reply anyway — leaving the router
 * talking to nobody and the command never finishing.
 *
 * Rates come from the router's own counters rather than being derived from byte
 * totals here. Two samples a few seconds apart would need state we do not keep,
 * and would report nonsense whenever a counter wraps or a port is reset.
 */
export async function portTraffic(conn) {
  const interfaces = await conn.write('/interface/print', []);
  const names = interfaces
    .filter((i) => ['ether', 'wlan', 'sfp', 'bridge'].includes(String(i.type ?? '').split('-')[0]))
    .map((i) => i.name);
  if (!names.length) return [];

  // One call for every port. Asking per interface is a round trip each over a
  // tunnel that may be on a rural link, and a dozen of those is a visible pause.
  const rows = await conn.write('/interface/monitor-traffic', [
    `=interface=${names.join(',')}`,
    '=once=',
  ]);

  const byName = new Map(interfaces.map((i) => [i.name, i]));
  return rows.map((r) => {
    const iface = byName.get(r.name) ?? {};
    return {
      name: r.name,
      type: iface.type ?? null,
      running: iface.running === 'true',
      disabled: iface.disabled === 'true',
      // bits per second, as RouterOS reports them
      rxBps: Number(r['rx-bits-per-second'] ?? 0),
      txBps: Number(r['tx-bits-per-second'] ?? 0),
      rxPps: Number(r['rx-packets-per-second'] ?? 0),
      txPps: Number(r['tx-packets-per-second'] ?? 0),
    };
  });
}

/**
 * Read the PPPoE accounts already on the router.
 *
 * An ISP moving onto this platform has their whole customer list in
 * /ppp/secret, and retyping several hundred of them is the reason migrations
 * stall. Passwords come back in clear over the API, which is how RouterOS
 * stores them — that is exactly why this is worth importing rather than asking
 * anyone to read them out.
 */
export async function pppSecrets(conn) {
  const rows = await conn.write('/ppp/secret/print', []);
  return rows.map((r) => ({
    name: r.name,
    password: r.password ?? null,
    profile: r.profile ?? null,
    service: r.service ?? null,
    // A per-secret address is the router's own IP assignment, which becomes
    // Framed-IP-Address once the customer is billed from here.
    remoteAddress: r['remote-address'] ?? null,
    comment: r.comment ?? null,
    disabled: r.disabled === 'true',
  })).filter((r) => r.name);
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
/**
 * The ports the router's own connection depends on.
 *
 * Enslaving one of these to a bridge is the single most destructive thing this
 * code can do. The port stops carrying its own IP the moment it becomes a
 * bridge member, so the uplink dies, the tunnel dies with it, and the command
 * that did it never gets an answer — the push reports a timeout at the bridge
 * step and the router is off the air. No later push can undo it, because there
 * is nothing left to push through: it is a drive to the site.
 *
 * Two signals, both read from the router rather than assumed. The default route
 * says where the internet actually is. A DHCP client says the port is being
 * given an address by an upstream network, which is the usual arrangement on a
 * board whose WAN is not the one the manual suggests.
 *
 * Interfaces come back as internal ids in these menus, so they are resolved to
 * names before comparing — the mistake that has caused this class of bug here
 * repeatedly.
 */
export async function uplinkPorts(conn, ifaces = null) {
  const reasons = new Map();
  const all = ifaces ?? (await conn.write('/interface/print', []));
  const byId = new Map(all.map((i) => [idOf(i), i.name]));
  const resolve = (ref) => byId.get(String(ref)) ?? String(ref ?? '');

  const wan = await wanInterface(conn, new Set(all.map((i) => i.name)));
  if (wan) reasons.set(wan, 'your internet arrives on it — it carries the default route');

  for (const c of await conn.write('/ip/dhcp-client/print', [])) {
    const name = resolve(c.interface);
    if (name && !reasons.has(name)) {
      reasons.set(name, 'it takes its address from an upstream network (it has a DHCP client)');
    }
  }

  /**
   * The port underneath the uplink, not only the uplink itself.
   *
   * A router whose internet arrives over PPPoE has its default route on
   * "pppoe-out1", which is not a port anyone can tick — but that client runs on
   * ether1, and bridging ether1 kills it just as surely. Checking only the
   * route's own interface therefore declared the real uplink safe. The same
   * applies to a board fed by a wireless link in station mode, which is a
   * common arrangement at a tower site.
   */
  for (const c of await conn.write('/interface/pppoe-client/print', [])) {
    const name = resolve(c.interface);
    if (name && !reasons.has(name)) {
      reasons.set(name, `your internet arrives over the PPPoE client ${c.name ?? ''} running on it`.replace('  ', ' '));
    }
  }
  try {
    for (const w of await conn.write('/interface/wireless/print', [])) {
      if (!/station/i.test(String(w.mode ?? ''))) continue;
      const name = String(w.name ?? '');
      if (name && !reasons.has(name)) {
        reasons.set(name, 'it is a wireless station, so it is how this router reaches the network');
      }
    }
  } catch {
    // No wireless package, or a board with no radio. Not an error.
  }
  return reasons;
}

export async function ensureBridge(conn, { name = 'bridge-lan', ports = [] }) {
  /**
   * One fetch of the interface list and one of the bridge list, not three of
   * the latter.
   *
   * This used to print /interface/bridge three times — once to check the
   * bridge existed, again after possibly creating it to get its id, a third
   * time unfiltered to build the id→name table — plus /interface/bridge/port
   * twice with no write between the two calls, plus /interface/print again
   * inside uplinkPorts and again inside wanInterface underneath it. On a rural
   * tunnel where each round trip is a second or more, that was enough on its
   * own to blow the 20s step budget: the push failed with "bridge: no reply
   * after 20s" on a router that was answering everything asked of it, just not
   * fast enough to answer it twelve times.
   *
   * ifaces is threaded into uplinkPorts below so it does not fetch its own
   * copy, and wanInterface inside that receives the same list rather than
   * asking a third time.
   */
  const ifaces = await conn.write('/interface/print', []);
  const bridges = await conn.write('/interface/bridge/print', []);
  const existing = bridges.find((b) => b.name === name);
  if (!existing) {
    await cmd(conn, 'create bridge', '/interface/bridge/add', [`=name=${name}`, `=comment=${managed('ispLan bridge')}`]);
    bridges.push({ '.id': undefined, name });   // placeholder; re-read below only if needed
  }

  // Re-read only when we just created it — the id from the print above cannot
  // be known until the add has happened.
  const self = existing ?? (await conn.write('/interface/bridge/print', [`?name=${name}`]))[0];
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
  const nameById = new Map(bridges.filter((b) => b['.id']).map((b) => [idOf(b), b.name]));
  const label = (ref) => nameById.get(ref) ?? ref;

  const members = await conn.write('/interface/bridge/port/print', []);
  const already = new Set(members.filter(isOurs).map((m) => m.interface));
  const elsewhere = new Map(
    members.filter((m) => !isOurs(m)).map((m) => [m.interface, label(m.bridge)]));

  /**
   * Refuse the uplink before touching anything.
   *
   * Checked up front rather than per port: half a bridge and a router off the
   * air is worse than no bridge at all, and the operator can untick one box far
   * more easily than they can drive to the site.
   *
   * A warning on the screen was not enough. It said "do not tick the port your
   * internet comes in on", which assumes the operator knows which that is — and
   * the router does know, so it should be the one answering.
   */
  const protectedPorts = await uplinkPorts(conn, ifaces);
  const fatal = ports.filter((p) => protectedPorts.has(p));
  if (fatal.length) {
    const list = fatal.map((p) => `${p} (${protectedPorts.get(p)})`).join('; ');
    throw new Error(
      `Refusing to bridge ${list}. Adding that to ${name} would take this router off the `
      + 'network the moment it applied, and it could only be recovered on site. Untick it and '
      + 'choose the ports your customers are on.');
  }

  /**
   * And the ports already in the bridge, which is the harder case.
   *
   * Refusing to *add* the uplink does nothing about a bridge that already
   * contains it — put there by hand, or by this code before the check existed.
   * Everything built on such a bridge afterwards lands on the uplink: the
   * gateway address, the DHCP server, the hotspot. Each of those is a command
   * that can cut the router's own connection, which is exactly the failure
   * being seen — a push that stops dead at the first write against the bridge,
   * with no answer and no explanation.
   *
   * So the bridge is not usable at all while the uplink is in it, and saying so
   * is far better than building on it and losing the site.
   *
   * Reuses `members` from above rather than printing again: nothing has been
   * written to the router between the two checks, so a second read would
   * answer with the identical rows at the cost of one more round trip.
   */
  const inBridge = members.filter(isOurs).map((m) => m.interface);
  const poisoned = inBridge.filter((iface) => protectedPorts.has(iface));
  if (poisoned.length) {
    const list = poisoned.map((iface) => `${iface} (${protectedPorts.get(iface)})`).join('; ');
    throw new Error(
      `${name} already contains ${list}. Anything built on this bridge would be built on the `
      + `port carrying this router's internet, which is what has been cutting the tunnel `
      + `mid-push. Remove it first — on the router: /interface bridge port remove `
      + `[find interface=${poisoned[0]}] — then run this again.`);
  }

  const added = [];
  const skipped = [];
  for (const port of ports) {
    if (already.has(port)) continue;
    if (elsewhere.has(port)) { skipped.push(`${port} (already in ${elsewhere.get(port)})`); continue; }
    try {
      await conn.write('/interface/bridge/port/add', [
        `=bridge=${name}`, `=interface=${port}`, `=comment=${managed('ispLan bridge port')}`,
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
/**
 * The PPPoE server, with no address pool of its own.
 *
 * Addresses come from here, not from the router: RADIUS sends
 * Framed-IP-Address with every login, so the system knows which customer holds
 * which address and can say so on the Clients page. A pool on the router hands
 * out addresses nothing here has recorded, which is how a customer ends up on
 * an address the operator cannot look up — and how two routers can hand the
 * same address to different people.
 *
 * The profile therefore sets local-address only. remote-address is deliberately
 * left empty so the router waits to be told.
 */
export async function applyPppoeServer(conn, {
  bridge = 'bridge-lan',
  gateway = null,
  profileName = 'vibelink-pppoe',
  serviceName = 'vibelink',
  natSubnet = null,
} = {}) {
  // No /ip/pool for PPPoE. Any pool we created on an earlier version is removed,
  // so the router cannot fall back to handing out addresses of its own.
  for (const stale of await conn.write('/ip/pool/print', ['?name=vibelink-pppoe'])) {
    await cmd(conn, 'remove the old PPPoE pool', '/ip/pool/remove', [`=.id=${idOf(stale)}`]);
  }

  /**
   * No address is ever added to the bridge for this, on purpose — agreed
   * explicitly, not merely never gotten around to. `gateway` still feeds
   * local-address on the PPP profile below, which is a value PPP hands each
   * dialling client during negotiation, not a real interface address; RouterOS
   * has never required one to exist for that to work. This used to also add
   * `${gateway}/24` to the bridge itself, hardcoded to /24 regardless of the
   * Networks pool's actual prefix — a /20 pool got a /24 address sitting on
   * top of it, wrong range, wrong mask, visible on the router as an address
   * nobody configured and nothing asked for. The range subscribers actually
   * get comes entirely from the pool configured under Networks (see natSubnet
   * below); this step never touches the router's own addressing.
   *
   * The cleanup runs unconditionally, not only when gateway is absent, so a
   * router still carrying one from before this changed gets it removed the
   * next time this runs, rather than left stranded forever.
   */
  const addrs = await conn.write('/ip/address/print', [`?interface=${bridge}`]);
  for (const stray of addrs.filter((a) => isManaged(a) && a.comment?.startsWith('ispPppoe gateway'))) {
    await cmd(conn, 'remove stray PPPoE gateway', '/ip/address/remove', [`=.id=${idOf(stray)}`]);
  }

  /**
   * No remote-address at all, rather than an empty one.
   *
   * Subscribers are addressed from here — the address arrives per login in
   * Framed-IP-Address — so the profile must not name a pool. Sending
   * `remote-address=` to say "none" looked like the way to express that, and
   * RouterOS 7 rejects it: it tries the value as a pool name, then as an
   * address, and fails both, which is why one empty argument produced
   * "input does not match any value of pool invalid value for argument
   * address" and stopped the whole push.
   *
   * An absent property is unset, which is what we wanted. On a profile that
   * already exists the property has to be actively cleared, and `!name` is the
   * API's way of removing a value — otherwise a profile left over from the
   * version that did create a pool would keep handing out its own addresses,
   * which is the bug this whole approach exists to prevent.
   */
  const profileFields = [
    // Same reasoning as remote-address just below: without a real gateway
    // there is nothing to set local-address to, and `!local-address=` clears
    // any value left over from a pool that existed on an earlier push and
    // has since been removed under Networks.
    ...(gateway ? [`=local-address=${gateway}`] : ['=!local-address=']),
    '=use-compression=no',
    '=use-encryption=no',
    '=only-one=yes',        // one session per subscriber, so a shared password is obvious
    `=comment=${managed('ispPppoe profile')}`,
  ];
  const profile = (await conn.write('/ppp/profile/print', [`?name=${profileName}`]))[0];
  if (profile) {
    const want = [...profileFields, '=!remote-address='];
    if (!unchanged(profile, want)) {
      await cmd(conn, 'PPP profile', '/ppp/profile/set', [`=.id=${idOf(profile)}`, ...want]);
    }
  } else {
    // A brand-new profile has no local-address to clear, and RouterOS 7
    // rejects `!local-address=` on /add the same way it rejects
    // `!remote-address=` there — "unset" only makes sense against something
    // that could already hold a value.
    const addFields = gateway ? profileFields : profileFields.filter((f) => f !== '=!local-address=');
    await cmd(conn, 'PPP profile', '/ppp/profile/add', [`=name=${profileName}`, ...addFields]);
  }

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
  if (server) {
    if (!unchanged(server, serverFields)) {
      await cmd(conn, 'PPPoE server', '/interface/pppoe-server/server/set',
        [`=.id=${idOf(server)}`, ...serverFields]);
    }
  } else {
    await cmd(conn, 'PPPoE server', '/interface/pppoe-server/server/add', serverFields);
  }

  // Same reason as the hotspot: a subscriber given an address out of a private
  // pool with no NAT connects, authenticates, and reaches nothing.
  //
  // The pool range itself, not a /24 derived from the gateway. The default range
  // runs to 10.100.255.254, so a /24 would have covered the first 253
  // subscribers and left everyone after them without internet — a fault that
  // only appears once a site grows, and looks nothing like a NAT problem.
  // NAT still needs to know the range subscribers will be given, which is the
  // pool configured under Networks rather than anything on the router.
  const nat = natSubnet ? await applyNat(conn, { subnet: natSubnet }) : { wan: null };

  return { bridge, profile: profileName, nat: natSubnet, wan: nat.wan };
}

/**
 * The static half of "suspended/expired customers get 0kb": one address-list
 * entry covering the whole expired-pool range, and one filter rule dropping
 * forward traffic from it. Both are set-and-forget — after this runs once,
 * radius.js only ever has to put a subscriber's address inside the range;
 * nothing per-subscriber needs pushing to the router again.
 *
 * `cidr` is the range from Networks → the tenant's ip_pools row with
 * purpose='expired', e.g. "10.100.250.0/24". Skipped entirely if the tenant
 * has not set one up — radius.js falls back to the normal pool at a near-zero
 * rate limit in that case, which is real but weaker than an IP-range block.
 */
export async function applyExpiredPool(conn, { cidr } = {}) {
  if (!cidr) return { configured: false };
  const LIST = 'ispblocking';
  const done = [];

  const entries = await conn.write('/ip/firewall/address-list/print', [`?list=${LIST}`]);
  const mine = entries.filter((e) => isManaged(e));
  const wantAddr = ['=list=' + LIST, `=address=${cidr}`, `=comment=${managed('ispBlocking expired customers')}`];
  if (mine.length) {
    if (!unchanged(mine[0], wantAddr)) {
      await cmd(conn, 'ispblocking address list', '/ip/firewall/address-list/set',
        [`=.id=${idOf(mine[0])}`, ...wantAddr]);
    }
  } else {
    await cmd(conn, 'ispblocking address list', '/ip/firewall/address-list/add', wantAddr);
    done.push(`address list ${LIST} = ${cidr}`);
  }
  for (const dupe of mine.slice(1)) {
    await cmd(conn, 'remove duplicate ispblocking entry', '/ip/firewall/address-list/remove',
      [`=.id=${idOf(dupe)}`]);
  }

  const rules = await conn.write('/ip/firewall/filter/print', []);
  const mineRules = rules.filter((r) => isManaged(r)
    && String(r.chain) === 'forward' && r['src-address-list'] === LIST);
  // action, then chain, then src-address-list — no in-/out-interface: this has
  // to catch an expired customer regardless of which physical port or bridge
  // they come in on, not just one interface.
  const wantRule = ['=action=drop', '=chain=forward', `=src-address-list=${LIST}`,
    `=comment=${managed('ispBlocking expired customers')}`];
  if (mineRules.length) {
    if (!unchanged(mineRules[0], wantRule)) {
      await cmd(conn, 'ispblocking rule', '/ip/firewall/filter/set',
        [`=.id=${idOf(mineRules[0])}`, ...wantRule]);
    }
  } else {
    // Near the top: a forward-chain accept rule earlier in the list (NAT
    // masquerade setups often have one) would otherwise let the traffic
    // through before this is ever reached. "0" is a position in the router's
    // whole filter list, not the forward chain alone — on a router with no
    // firewall filter rules at all yet, that position does not exist and
    // RouterOS rejects the add with "no such item" (same failure as the WAN
    // DNS block above). Only meaningful, and only valid, once a rule exists
    // to land ahead of.
    await cmd(conn, 'ispblocking rule', '/ip/firewall/filter/add',
      rules.length ? [...wantRule, '=place-before=0'] : wantRule);
    done.push('filter rule dropping forward traffic from ' + LIST);
  }
  for (const dupe of mineRules.slice(1)) {
    await cmd(conn, 'remove duplicate ispblocking rule', '/ip/firewall/filter/remove',
      [`=.id=${idOf(dupe)}`]);
  }

  /**
   * Belt and braces: expired customers are also excluded from NAT itself, not
   * only dropped at the forward filter. A masquerade rule covering the whole
   * PPPoE pool sits right next to this — visible on the router as "NAT for
   * the blocked customers' pool" even though the forward-drop rule above is
   * what actually stops them today. If that filter rule is ever missing,
   * reordered behind something that accepts first, or fails to apply (as it
   * could on an empty ruleset before the fix above), masquerade would still
   * hand an expired customer a working route out. An srcnat accept rule for
   * the same address list stops NAT processing for that traffic outright —
   * the packet keeps its private source address and gets nowhere, a second,
   * independent block rather than relying on the filter rule alone.
   */
  const natRules = await conn.write('/ip/firewall/nat/print', []);
  const mineNat = natRules.filter((r) => isManaged(r)
    && String(r.chain) === 'srcnat' && r['src-address-list'] === LIST);
  const wantNat = ['=chain=srcnat', `=src-address-list=${LIST}`, '=action=accept',
    `=comment=${managed('ispBlocking expired customers — no NAT')}`];
  if (mineNat.length) {
    if (!unchanged(mineNat[0], wantNat)) {
      await cmd(conn, 'ispblocking no-NAT rule', '/ip/firewall/nat/set',
        [`=.id=${idOf(mineNat[0])}`, ...wantNat]);
    }
  } else {
    // Ahead of the masquerade rule for the same reason as above: an accept
    // rule after masquerade never gets reached, because masquerade itself
    // already terminated processing for every packet it translated.
    await cmd(conn, 'ispblocking no-NAT rule', '/ip/firewall/nat/add',
      natRules.length ? [...wantNat, '=place-before=0'] : wantNat);
    done.push('NAT rule excluding expired customers from masquerade');
  }
  for (const dupe of mineNat.slice(1)) {
    await cmd(conn, 'remove duplicate ispblocking no-NAT rule', '/ip/firewall/nat/remove',
      [`=.id=${idOf(dupe)}`]);
  }

  return { configured: true, list: LIST, cidr, done };
}

/**
 * The manufacturer half of a MAC address — the first three octets, assigned
 * to one vendor by the IEEE and never reused. Good enough to turn "MAC
 * ending FF:00:11" into "Samsung Electronics" for a guest picking their TV
 * out of a list of devices they cannot otherwise tell apart; not meant to be
 * exhaustive, just to cover the streaming/TV brands that actually turn up
 * on a hotspot.
 */
const OUI_VENDORS = {
  '00:12:FB': 'Samsung Electronics', '00:1D:25': 'Samsung Electronics', '5C:497D': 'Samsung Electronics',
  '00:1F:CD': 'LG Electronics', '10:F1:F2': 'LG Electronics', 'A8:16:B2': 'LG Electronics',
  '00:24:BE': 'Sony', 'FC:0F:E6': 'Sony', '54:42:49': 'Sony',
  'DC:44:6D': 'TCL', '2C:AB:33': 'TCL',
  '74:E1:82': 'Hisense',
  '58:D5:6E': 'Roku', 'B0:A7:37': 'Roku', 'AC:3F:A4': 'Roku',
  'F0:81:73': 'Amazon (Fire TV)', '4C:EF:C0': 'Amazon (Fire TV)', '68:37:E9': 'Amazon (Fire TV)',
  '54:60:09': 'Google (Chromecast)', 'F4:F5:D8': 'Google (Chromecast)', 'DA:A1:19': 'Google (Chromecast)',
  '64:CC:2E': 'Xiaomi', '28:6C:07': 'Xiaomi',
  '20:DF:B9': 'Vizio', '00:19:FB': 'Vizio',
};

function vendorFor(mac) {
  const oui = String(mac ?? '').toUpperCase().split(':').slice(0, 3).join(':');
  return OUI_VENDORS[oui] ?? null;
}

/**
 * Devices seen on this router's hotspot that have not authenticated —
 * candidates for "add this device" on the portal, when a guest's TV or
 * console has no way to type in a code itself.
 *
 * Read-only: this never changes anything on the router, only reports what
 * is already there. Vendor and hostname are both best-effort hints, not a
 * guarantee — a guest still has to recognise their own device.
 */
export async function nearbyDevices(conn) {
  const [hosts, leases] = await Promise.all([
    conn.write('/ip/hotspot/host/print', []).catch(() => []),
    conn.write('/ip/dhcp-server/lease/print', []).catch(() => []),
  ]);
  const hostnameByMac = new Map(
    leases.map((l) => [String(l['mac-address'] ?? '').toUpperCase(), l['host-name'] || null])
  );

  return hosts
    // 'user' is set once RouterOS has actually authenticated the host —
    // already-online devices (including the guest's own phone) have no
    // business showing up as something still to add.
    .filter((h) => !h.user && !['true', 'yes'].includes(String(h.bypassed)))
    .map((h) => {
      const mac = String(h['mac-address'] ?? '').toUpperCase();
      return {
        mac,
        address: h.address ?? null,
        vendor: vendorFor(mac),
        hostname: hostnameByMac.get(mac) ?? null,
        idleSeconds: h['idle-time'] ? hhmmssToSeconds(h['idle-time']) : null,
      };
    })
    .filter((d) => d.mac);
}

/**
 * Get a device online with no login step at all — the actual answer for a TV
 * with no browser, as opposed to nearbyDevices()/the shared-code path, which
 * still needs *some* browser to submit the form.
 *
 * Two things happen: a static DHCP lease pins the device to one IP forever
 * (queues target an address, not a MAC, so this has to be stable), and an
 * ip-binding of type=bypassed tells the hotspot to wave that MAC straight
 * through with no login page at all. Bypassed skips RADIUS entirely, so it
 * carries no rate limit on its own — the queue is what actually enforces the
 * plan's speed; without it a bypassed device would run at the router's full
 * uncapped rate, backwards from what a paying customer bought.
 *
 * This is also the actual fix for "no code sharing": nothing here is a
 * secret that can be typed into a second device. Access is tied to this one
 * MAC, full stop — the router simply does not consult a shared code for it.
 */
export async function bindDeviceByMac(conn, { mac, downKbps, upKbps, comment = '' }) {
  const MAC = String(mac).toUpperCase();
  const label = managed(`ispHotspot device ${comment}`.trim());

  // Static lease: the same MAC always gets the same address, which is what
  // lets a queue keyed on that address actually mean anything over time.
  const leases = await conn.write('/ip/dhcp-server/lease/print', [`?mac-address=${MAC}`]);
  let ip = leases[0]?.address;
  if (leases[0]) {
    if (leases[0]['dynamic'] !== 'false' && leases[0]['dynamic'] !== undefined) {
      await cmd(conn, 'pin device DHCP lease', '/ip/dhcp-server/lease/make-static', [`=.id=${idOf(leases[0])}`]);
    }
  } else {
    throw new Error('This device has no DHCP lease yet — it needs to be connected to the WiFi first.');
  }

  // ip-binding: the actual bypass. Idempotent by MAC.
  const bindings = await conn.write('/ip/hotspot/ip-binding/print', [`?mac-address=${MAC}`]);
  const bindFields = [`=mac-address=${MAC}`, '=type=bypassed', `=comment=${label}`];
  if (bindings[0]) {
    if (!unchanged(bindings[0], bindFields)) {
      await cmd(conn, 'device ip-binding', '/ip/hotspot/ip-binding/set', [`=.id=${idOf(bindings[0])}`, ...bindFields]);
    }
  } else {
    await cmd(conn, 'device ip-binding', '/ip/hotspot/ip-binding/add', bindFields);
  }

  // The queue: the only thing standing between "bypassed" and unlimited speed.
  const queues = await conn.write('/queue/simple/print', [`?target=${ip}/32`]);
  const queueFields = [`=target=${ip}/32`, `=max-limit=${upKbps}k/${downKbps}k`, `=comment=${label}`];
  if (queues[0]) {
    if (!unchanged(queues[0], queueFields)) {
      await cmd(conn, 'device speed cap', '/queue/simple/set', [`=.id=${idOf(queues[0])}`, ...queueFields]);
    }
  } else {
    await cmd(conn, 'device speed cap', '/queue/simple/add', [`=name=${managed('ispHotspot-' + MAC.replace(/:/g, ''))}`, ...queueFields]);
  }

  return { mac: MAC, ip };
}

/**
 * Undo bindDeviceByMac — called once the underlying voucher/device expires.
 *
 * Removing the ip-binding stops the *next* connection from bypassing again,
 * but RouterOS already decided this MAC was bypassed the moment it first saw
 * it, and keeps forwarding its traffic under that decision until something
 * makes it look again — deleting the config it originally checked does not
 * reopen that check. That is the whole bug this once was: the DB moved to
 * 'expired', the ip-binding and queue were gone, and the TV kept browsing
 * anyway, because nothing had ever told the router this specific device was
 * still live and needed kicking. /ip/hotspot/active is that live table for a
 * bypassed host exactly as much as an authenticated one; removing this MAC's
 * row from it is what actually drops the session. /ip/hotspot/host is then
 * cleared too so a stale cache entry can't let it slide back through
 * bypassed on its very next packet before DHCP/ARP even notices it's gone.
 */
export async function unbindDeviceByMac(conn, { mac }) {
  const MAC = String(mac).toUpperCase();
  const bindings = await conn.write('/ip/hotspot/ip-binding/print', [`?mac-address=${MAC}`]);
  for (const b of bindings) {
    if (isManaged(b)) await cmd(conn, 'remove device ip-binding', '/ip/hotspot/ip-binding/remove', [`=.id=${idOf(b)}`]);
  }
  const leases = await conn.write('/ip/dhcp-server/lease/print', [`?mac-address=${MAC}`]);
  const ip = leases[0]?.address;
  if (ip) {
    const queues = await conn.write('/queue/simple/print', [`?target=${ip}/32`]);
    for (const q of queues) {
      if (isManaged(q)) await cmd(conn, 'remove device speed cap', '/queue/simple/remove', [`=.id=${idOf(q)}`]);
    }
  }

  const active = await conn.write('/ip/hotspot/active/print', [`?mac-address=${MAC}`]).catch(() => []);
  for (const a of active) {
    await cmd(conn, 'kick live hotspot session', '/ip/hotspot/active/remove', [`=.id=${idOf(a)}`]);
  }
  const hosts = await conn.write('/ip/hotspot/host/print', [`?mac-address=${MAC}`]).catch(() => []);
  for (const h of hosts) {
    await cmd(conn, 'clear stale hotspot host cache', '/ip/hotspot/host/remove', [`=.id=${idOf(h)}`]);
  }
}

/** "01:23:45" (RouterOS uptime/idle-time shape) -> seconds, for sorting by how recently a device was active. */
function hhmmssToSeconds(v) {
  const parts = String(v).match(/(\d+)d|(\d+)h|(\d+)m|(\d+)s/g) ?? [];
  let total = 0;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (p.endsWith('d')) total += n * 86400;
    else if (p.endsWith('h')) total += n * 3600;
    else if (p.endsWith('m')) total += n * 60;
    else if (p.endsWith('s')) total += n;
  }
  return total;
}

/**
 * Who is connected right now, asked of the router rather than inferred.
 *
 * The authoritative answer to "is this customer online". RADIUS accounting is
 * the usual source and is better when it works — it arrives by itself — but it
 * is silent whenever the tunnel is down or accounting was never enabled, and
 * silence there is indistinguishable from everybody being offline.
 *
 * Both services, because a router commonly serves both and the operator asked
 * one question. A missing menu is not an error: a PPPoE-only box has no
 * /ip/hotspot/active and should still report its PPPoE sessions.
 */
export async function activeSessions(conn) {
  const out = [];

  const read = async (path, service) => {
    try {
      return (await conn.write(path, [])).map((row) => ({
        service,
        username: String(row.name ?? row.user ?? '').trim(),
        // PPP calls it address, hotspot calls it address too, but a hotspot row
        // may carry only a MAC — an entry with no username is no use to us.
        address: String(row.address ?? '').trim() || null,
      })).filter((r) => r.username);
    } catch {
      return [];
    }
  };

  out.push(...await read('/ppp/active/print', 'pppoe'));
  out.push(...await read('/ip/hotspot/active/print', 'hotspot'));
  return out;
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

/**
 * Why the login page is not appearing.
 *
 * A captive portal that does not pop has half a dozen causes that all look
 * identical from the guest's phone: they associate, they get an address, and
 * nothing happens. Every one of them is visible on the router, so guessing at
 * them one at a time — which is how this has been going — is unnecessary.
 *
 * Reads only. Nothing here changes the router.
 */
export async function hotspotCheck(conn, { bridge = null } = {}) {
  const [servers, profiles, dhcpServers, addresses, ifaces, walled, dns] = await Promise.all([
    conn.write('/ip/hotspot/print', []),
    conn.write('/ip/hotspot/profile/print', []),
    conn.write('/ip/dhcp-server/print', []),
    conn.write('/ip/address/print', []),
    conn.write('/interface/print', []),
    conn.write('/ip/hotspot/walled-garden/print', []),
    conn.write('/ip/dns/print', []),
  ]);

  // Addresses and DHCP servers report `interface` as an internal id, so every
  // comparison here goes through the name. This has caught us out repeatedly.
  const nameById = new Map(ifaces.map((i) => [idOf(i), i.name]));
  const ifName = (ref) => nameById.get(String(ref)) ?? String(ref ?? '');

  const yes = (v) => v === 'true' || v === 'yes';
  const enabled = servers.filter((h) => !yes(h.disabled));
  const server = (bridge && enabled.find((h) => ifName(h.interface) === bridge)) ?? enabled[0];
  const iface = server ? ifName(server.interface) : null;

  const profile = server
    ? profiles.find((p) => p.name === server.profile)
    : null;

  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('a hotspot server exists and is enabled',
    !!server,
    servers.length
      ? `${servers.length} defined, ${enabled.length} enabled`
      : 'none on this router — press Hotspot and pick the LAN ports to build one');

  if (!server) return { checks, ok: false, interface: null };

  add(`it is running on ${iface}`, !!iface,
    `guests must be on ${iface || 'that interface'}; anyone on another port is never intercepted`);

  const addr = addresses.find((a) => ifName(a.interface) === iface
    && String(a.address).split('/')[0] === String(profile?.['hotspot-address'] ?? ''));
  add('the gateway address is on that interface',
    !!addr,
    addr ? `${addr.address}`
      : `the profile says hotspot-address=${profile?.['hotspot-address'] ?? '(unset)'}, `
        + `which is not an address on ${iface} — the portal has nothing to answer on`);

  const dhcp = dhcpServers.find((d) => ifName(d.interface) === iface && !yes(d.disabled));
  add('a DHCP server hands out addresses there',
    !!dhcp,
    dhcp ? `${dhcp.name}, pool ${dhcp['address-pool']}`
      : `no enabled DHCP server on ${iface} — a guest with no address never reaches the portal, `
        + 'and a phone that self-assigns shows "connected, no internet"');

  add('login is by http-pap',
    String(profile?.['login-by'] ?? '').includes('http-pap'),
    `login-by=${profile?.['login-by'] ?? '(unset)'} — http-chap needs the page to hash the `
      + 'password, and ours does not, so every voucher is refused');

  add('RADIUS is on for the hotspot',
    yes(profile?.['use-radius']),
    `use-radius=${profile?.['use-radius'] ?? 'no'} — without it vouchers are checked against `
      + 'the user list on the router itself, which is empty');

  /**
   * The page itself, in the directory the profile actually uses.
   *
   * html-directory varies between builds — "hotspot" on some, "flash/hotspot"
   * on others — and a login.html written to the wrong one leaves MikroTik's
   * stock page in place while every push reports success.
   */
  const dir = String(profile?.['html-directory'] ?? 'hotspot').replace(/\/+$/, '');
  const files = await conn.write('/file/print', [`?name=${dir}/login.html`]);
  const size = Number(files[0]?.size ?? 0);
  add('our login page is installed',
    size > 1000,
    size
      ? `${dir}/login.html is ${size} bytes`
      : `${dir}/login.html is missing — guests get MikroTik's stock page, or none`);

  add('the walled garden lets payment through',
    walled.length > 0,
    walled.length
      ? `${walled.length} rule(s)`
      : 'empty — a guest cannot reach M-Pesa before paying, so nobody can buy anything');

  /**
   * Whether a guest can resolve a name at all — checked here because it is
   * the single most common reason "the popup does not appear" turns out to
   * have nothing to do with the portal page, the walled garden, or anything
   * else this function already checks. The OS shows the captive-portal
   * prompt only after its own connectivity-check request fails in a
   * particular way; a DNS server that refuses to answer produces "no
   * internet" instead, silently, with every other setting here perfectly
   * correct.
   */
  const remote = dns[0]?.['allow-remote-requests'];
  add('the DNS proxy will answer guests',
    remote === 'true' || remote === 'yes',
    remote === 'true' || remote === 'yes'
      ? 'guests can resolve names through the router'
      : `allow-remote-requests=${remote ?? '(unset)'} — a phone handed this router as its DNS `
        + 'server cannot resolve anything at all, including the check the OS uses to decide '
        + 'whether to show the login prompt. Press Hotspot or Configure again to fix this.');

  return { checks, ok: checks.every((c) => c.ok), interface: iface, htmlDirectory: dir };
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
