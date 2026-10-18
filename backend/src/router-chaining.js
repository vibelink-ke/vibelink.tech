/**
 * Router chaining monitor.
 *
 * On a hotspot, the main router bridges its guest network and an ISP then plugs other routers (Tenda, TP-Link and the like) into its Ethernet
 * ports, or into each other, to carry the signal further: the extenders are wired in by a LAN port, so they act as access points and every phone
 * behind them shows up as one more MAC on the same bridge port. A site can end up with over a hundred of them and nobody keeps the list.
 *
 * Every pass (a few minutes) the hotspot router's bridge host table, DHCP leases and ports are read, the chained routers are picked out by
 * their MAC, remembered, and watched: present on the bridge (or leased, or answering a ping) is up; two misses in a row is down, and the owner
 * is told once, summarised so a switch that dies with fifty extenders behind it is one message and not fifty.
 *
 * Reading a router is read-only. Nothing here changes a router.
 */
import { pool, enabledTenants } from './db.js';
import { makerOf, onuVendorOf, sameDevice, vendorOf } from './router-ouis.js';

export const OFFLINE_MINUTES = 3;
const PINGS_PER_ROUTER = 20;
const MAX_NEW_PER_PASS = 200;
const MAX_PER_ROUTER = 500;

/** Names an extender gives itself when it asks for an address. */
const EXTENDER_NAME = /tenda|tp-?link|^tl-|mercusys|^mw\d|repeater|extender|access.?point|\bmesh\b|ruijie|totolink|d-?link|netis|wavlink|cudy|mikrotik|ubnt|unifi|^ap[-_ ]?\d|^cpe/i;
/** Model names optical units (xPON/GPON/EPON ONT/ONU) call themselves: Huawei HG8xxx/EchoLife, ZTE ZXHN/F6xx, FiberHome AN5xxx, V-SOL, and the plain words. */
const ONU_NAME = /echolife|^hg8\d{2,3}|^hs8\d{3}|zxhn|^f(4|6)\d{2}[a-z]?\d?$|fiberhome|^an5\d{3}|v-?sol|\b(gpon|epon|xpon|xgs-?pon|onu|ont)\b|^xz\d{3}|^g-0\d{2}/i;
/**
 * What a customer's own devices call themselves, or send in their DHCP request. Makers of routers (TP-Link, D-Link, Ubiquiti…) also make cameras,
 * plugs and bulbs, and a prefix alone would take one of those behind an extender for a router: a device that says it is one of these is never taken
 * for a router, whatever its prefix.
 */
const CLIENT_NAME = /(?:^|[^a-z0-9])(?:tapo|kasa|cam|camera|plug|bulb|switchbot|iphone|ipad|android|galaxy|redmi|desktop|laptop|macbook|tv|printer|phone|oppo|tecno|infinix|itel|vivo|realme|pc)(?:[^a-z0-9]|$)/i;
const CLIENT_DHCP = /^android|^msft/i;
/** What embedded router firmware (BusyBox udhcp) puts in its DHCP request: phones send "android-dhcp", Windows "MSFT", iPhones nothing. */
const EMBEDDED_DHCP = /^udhcp|busybox/i;

export const normMac = (m) => String(m ?? '').trim().toUpperCase().replace(/-/g, ':');
const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
export const validMac = (m) => MAC.test(normMac(m));
/** A MAC with the "locally administered" bit set is a phone's private address or a virtual one, never an extender's own burned-in one. */
const universal = (mac) => (parseInt(mac.slice(0, 2), 16) & 0x02) === 0;
const multicast = (mac) => (parseInt(mac.slice(0, 2), 16) & 0x01) === 1;

/** RouterOS durations ("3m12s", "45s", "1h2m", "2d3h") in seconds; unreadable is "a long time". */
export function parseRosAge(v) {
  const s = String(v ?? '').trim();
  if (!s) return Infinity;
  let total = 0; let hit = false;
  for (const m of s.matchAll(/(\d+)(w|d|h|m|s)/g)) {
    hit = true;
    total += Number(m[1]) * { w: 604800, d: 86400, h: 3600, m: 60, s: 1 }[m[2]];
  }
  return hit ? total : Infinity;
}

const WAN_NAME = /\b(wan|uplink|upstream|internet)\b|^wan/i;

/** The interface names a RouterOS value mentions ("10.0.0.1%ether1", "10.0.0.1 reachable via ether1"). */
function namesIn(value, known) {
  const v = String(value ?? '');
  return [...known].filter((n) => new RegExp('(^|[^A-Za-z0-9_-])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_-])').test(v));
}

/**
 * Which side is the LAN. A chained router hangs off the hotspot's own bridge; the port facing the fibre, the ISP or the internet is not a place
 * to look for one (whatever is on it is upstream, not something plugged in to extend the signal).
 *   wan        the ports and bridges that face the uplink: members of a WAN interface list, the interface the default route leaves by, DHCP and
 *              PPPoE clients, and anything named or commented wan / uplink / upstream / internet. A WAN bridge or VLAN counts for its ports too.
 *   lanBridges the bridges the hotspot runs on (null when it cannot be told: then every bridge that is not WAN counts).
 */
export function lanScope({ ifaces = [], hotspots = [], lists = [], routes = [], dhcpClients = [], pppoe = [], vlans = [], bridgePorts = [] }) {
  const known = new Set(ifaces.map((i) => String(i.name)));
  const vlanParent = new Map(vlans.map((v) => [String(v.name), String(v.interface ?? '')]));
  const portsOf = new Map();
  for (const b of bridgePorts) {
    const br = String(b.bridge ?? ''); const port = String(b.interface ?? '');
    if (!br || !port) continue;
    if (!portsOf.has(br)) portsOf.set(br, new Set());
    portsOf.get(br).add(port);
  }
  const wan = new Set();
  const addWan = (name, depth = 0) => {
    if (!name || wan.has(name) || depth > 4) return;
    wan.add(name);
    if (vlanParent.has(name)) addWan(vlanParent.get(name), depth + 1);                    // a WAN VLAN: its parent port faces the uplink too
    for (const p of portsOf.get(name) ?? []) addWan(p, depth + 1);                        // a WAN bridge: so do its ports
  };
  for (const m of lists) if (WAN_NAME.test(String(m.list ?? ''))) addWan(String(m.interface ?? ''));
  for (const r of routes) {
    if (String(r.active) === 'false' || String(r.disabled) === 'true') continue;
    for (const n of [...namesIn(r['immediate-gw'], known), ...namesIn(r['gateway-status'], known), ...namesIn(r.gateway, known)]) addWan(n);
  }
  for (const d of dhcpClients) addWan(String(d.interface ?? ''));
  for (const c of pppoe) addWan(String(c.interface ?? ''));
  for (const i of ifaces) if (WAN_NAME.test(`${i.name ?? ''} ${i.comment ?? ''}`)) addWan(String(i.name));

  const lan = new Set();
  for (const h of hotspots) {
    let n = String(h.interface ?? '');
    for (let d = 0; n && d < 4 && vlanParent.has(n); d += 1) n = vlanParent.get(n) ?? '';        // a hotspot on a VLAN runs over the bridge under it
    if (n && portsOf.has(n) && !wan.has(n)) lan.add(n);
  }
  return { wan, lanBridges: lan.size ? lan : null };
}

/** What one router can tell us: the MACs on its bridge, who holds a lease, which interfaces are wired, and which side is the LAN. */
export async function chainSnapshot(conn) {
  const soft = (path, query = []) => conn.write(path, query).catch(() => []);
  const [hostRows, leaseRows, ifaceRows, hotspots, lists, routes, dhcpClients, pppoe, vlans, bridgePorts] = await Promise.all([
    conn.write('/interface/bridge/host/print', []),
    soft('/ip/dhcp-server/lease/print'),
    conn.write('/interface/print', []),
    soft('/ip/hotspot/print'), soft('/interface/list/member/print'), soft('/ip/route/print', ['?dst-address=0.0.0.0/0']),
    soft('/ip/dhcp-client/print'), soft('/interface/pppoe-client/print'), soft('/interface/vlan/print'), soft('/interface/bridge/port/print'),
  ]);
  const scope = lanScope({ ifaces: ifaceRows, hotspots, lists, routes, dhcpClients, pppoe, vlans, bridgePorts });
  const hosts = hostRows.map((r) => ({
    mac: normMac(r['mac-address']), port: String(r['on-interface'] ?? ''), bridge: String(r.bridge ?? ''), local: String(r.local) === 'true',
    ageSec: parseRosAge(r.age),
  })).filter((h) => h.mac && h.port);
  const leases = leaseRows.map((r) => ({
    mac: normMac(r['active-mac-address'] || r['mac-address']), address: String(r['active-address'] || r.address || ''),
    hostname: String(r['host-name'] ?? ''), classId: String(r['class-id'] ?? ''), seenSec: parseRosAge(r['last-seen']),
  })).filter((l) => l.mac);
  const wired = new Set(ifaceRows.filter((i) => String(i.type) === 'ether').map((i) => String(i.name)));
  return { hosts, leases, wired, wan: scope.wan, lanBridges: scope.lanBridges, hotspotOn: hotspots.map((h) => String(h.interface ?? '')).filter(Boolean) };
}

/**
 * Go through each port of the snapshot, say what was decided about it, and pick the chained routers. Only a device that identifies itself as a
 * router is added by itself: it names itself like one (Tenda, TP-Link, "extender"…), or its DHCP request carries the signature embedded router
 * firmware sends (BusyBox "udhcp"), which phones and laptops do not. Every such device on a port is found, so extenders chained one behind the
 * other are all picked up. Anything else on the port is a customer's device as far as billing can tell, so it is never added by itself: the scan
 * lists those devices so a router that gives nothing away can be added by hand.
 * Returns { found: [{ mac, port, behind, ip, hostname, confidence }], report: [{ port, bridge, devices, verdict, router, candidates }] }.
 */
export function analysePorts({ hosts, leases, wired, wan = new Set(), lanBridges = null }) {
  const lease = new Map(leases.map((l) => [l.mac, l]));
  const ports = new Map();
  for (const h of hosts) {
    if (h.local || !MAC.test(h.mac) || multicast(h.mac)) continue;
    let p = ports.get(h.port);
    if (!p) {
      p = { port: h.port, bridge: h.bridge || '', macs: new Set(), skip: null };
      if (wan.has(h.port) || (h.bridge && wan.has(h.bridge))) p.skip = 'Uplink: skipped';              // upstream, not a router plugged in to extend the signal
      else if (lanBridges && h.bridge && !lanBridges.has(h.bridge)) p.skip = 'Not the hotspot bridge: skipped';
      else if (!wired.has(h.port)) p.skip = 'Not a cable port (wireless or virtual): skipped';
      ports.set(h.port, p);
    }
    p.macs.add(h.mac);
  }
  const found = []; const report = [];
  for (const p of ports.values()) {
    const row = { port: p.port, bridge: p.bridge, devices: p.macs.size, verdict: p.skip, router: null, candidates: [] };
    report.push(row);
    if (p.skip) continue;
    const all = [...p.macs].map((mac) => {
      const l = lease.get(mac);
      const hostname = l?.hostname ?? '';
      const classId = l?.classId ?? '';
      return { mac, hostname, classId, ip: l?.address || null, client: CLIENT_NAME.test(hostname) || CLIENT_DHCP.test(classId), vendor: vendorOf(mac), onuVendor: onuVendorOf(mac), onuNamed: ONU_NAME.test(hostname), named: EXTENDER_NAME.test(hostname), embedded: EMBEDDED_DHCP.test(classId) };
    });
    // A router's own interfaces (LAN, radios) take addresses a few apart, so two such MACs on one port are one router: keep the first.
    const routers = [];
    for (const d of all.filter((x) => !x.client && (x.named || x.embedded || x.vendor || x.onuNamed || x.onuVendor)).sort((a, b) => (a.mac < b.mac ? -1 : 1))) {
      if (!routers.some((r2) => sameDevice(r2.mac, d.mac))) routers.push(d);
    }
    if (!routers.length) {
      row.verdict = p.macs.size === 1 ? 'One device, not identifying itself as a router' : `${p.macs.size} devices, none identifies itself as a router`;
      // For adding one by hand: the devices with a real (not private) MAC first, since a router's own address is never a phone's private one.
      row.candidates = all.sort((a, b) => Number(universal(b.mac)) - Number(universal(a.mac)) || (a.mac < b.mac ? -1 : 1)).slice(0, 8)
        .map((d) => ({ mac: d.mac, hostname: d.hostname, classId: d.classId, ip: d.ip, vendor: d.vendor }));
      continue;
    }
    const kindOf = (c) => (c.onuNamed || c.onuVendor ? 'onu' : 'router');
    for (const c of routers) found.push({ mac: c.mac, port: p.port, behind: p.macs.size - routers.length, ip: c.ip, hostname: c.hostname, vendor: c.vendor ?? c.onuVendor, kind: kindOf(c), confidence: 'high' });
    row.router = routers.map((c) => c.hostname || c.mac).join(', ');
    const what = [...new Set(routers.map((c) => (kindOf(c) === 'onu' ? 'ONU' : 'Router')))].join(' and ');
    const makers = [...new Set(routers.map((c) => c.vendor ?? c.onuVendor).filter(Boolean))];
    row.verdict = makers.length ? `${what} found (by its MAC: ${makers.join(', ')})`
      : routers.some((c) => c.named || c.onuNamed) ? `${what} found (by its name)` : `${what} found (by its DHCP signature)`;
  }
  return { found, report };
}

export const detectChained = (snap) => analysePorts(snap).found;

/** The list with each router's maker (from the prefix of its MAC). */
export async function listChained(tenantId) {
  return (await listChainedRaw(tenantId)).map((c) => ({ ...c, vendor: makerOf(c.mac) }));
}

/** Is a chained router alive right now: on the bridge recently, or leased recently. */
/**
 * Is a chained router there right now, and what showed it. Being listed on the bridge at all is enough: RouterOS drops a MAC from its host table by
 * itself after the ageing time (5 minutes by default), so "listed" already means "seen recently", and an extender with nobody connected can be quiet
 * for minutes (asking for "seen in the last 3 minutes" marked online routers down). A lease renewed in the last 15 minutes counts too.
 * The address on a router's label is one of its interfaces and the bridge may see another: same prefix and a few apart is the same router.
 */
export function presence(mac, snap) {
  const same = (x) => x === mac || sameDevice(x, mac);
  const h = snap.hosts.find((x) => same(x.mac));
  if (h) return { alive: true, why: `seen on the bridge (${h.port}${Number.isFinite(h.ageSec) ? `, ${h.ageSec}s ago` : ''})` };
  const l = snap.leases.find((x) => same(x.mac) && x.seenSec <= 900);
  if (l) return { alive: true, why: 'its DHCP lease was renewed recently' };
  return { alive: false, why: 'not on the bridge and no recent lease' };
}
export const aliveFromSnapshot = (mac, snap) => presence(mac, snap).alive;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const label = (c) => c.name || c.hostname || c.mac;

/** What the last scan of a router did (shown under Routers on the screen). */
async function recordScan(r, { ok = true, note = '', hosts = 0, found = 0, watched = 0 }) {
  try {
    await pool.query(
      `insert into chained_scans (router_id, tenant_id, at, ok, note, hosts, found, watched) values ($1,$2, now(), $3,$4,$5,$6,$7)
       on conflict (router_id) do update set at = now(), ok = excluded.ok, note = excluded.note, hosts = excluded.hosts, found = excluded.found, watched = excluded.watched`,
      [r.id, r.tenant_id, ok, String(note).slice(0, 300), hosts, found, watched]);
  } catch { /* the screen just shows no scan yet */ }
}

/** One router: learn the chained routers behind it, then check each. */
async function pass(r, { ros, secrets, notify }) {
  let conn;
  try {
    conn = await ros.connect({
      host: String(r.host).split('/')[0], port: r.api_port ?? 8728,
      user: r.service_user, password: secrets.decrypt(r.service_password_enc), timeoutSec: 8,
    });
    const snap = await chainSnapshot(conn);

    // ── learn: new chained routers are added by their MAC ──
    const analysis = analysePorts(snap);
    // A router with no hotspot on it has no guest bridge to find extenders on; one whose hotspot could not be read (a PPPoE-only router has none) is
    // looked at only when its role says it has one.
    const learn = snap.hotspotOn.length > 0 || r.role !== 'pppoe';
    const found = learn ? analysis.found : [];
    const uplink = [...snap.wan];
    let cleaned = 0;
    if (uplink.length) {
      cleaned = (await pool.query(
        `delete from chained_routers where tenant_id=$1 and router_id=$2 and confidence <> 'manual' and port = any($3::text[])`, [r.tenant_id, r.id, uplink])).rowCount;
    }
    cleaned += (await pool.query(`delete from chained_routers where tenant_id=$1 and router_id=$2 and confidence = 'likely'`, [r.tenant_id, r.id])).rowCount;
    const { rows: known } = await pool.query('select * from chained_routers where tenant_id=$1 and router_id=$2 limit $3', [r.tenant_id, r.id, MAX_PER_ROUTER]);
    const byMac = new Map(known.map((k) => [k.mac, k]));
    let added = 0;
    for (const f of found) {
      const have = byMac.get(f.mac);
      if (have) {
        await pool.query(
          `update chained_routers set port=$2, behind=$3, ip=coalesce($4, ip), hostname=coalesce(nullif($5,''), hostname),
                  kind = case when confidence = 'manual' then kind else $6 end where id=$1`,
          [have.id, f.port, f.behind, f.ip, f.hostname, f.kind]);
        continue;
      }
      if (added >= MAX_NEW_PER_PASS) break;
      const { rows: [made] } = await pool.query(
        `insert into chained_routers (tenant_id, router_id, mac, ip, hostname, port, behind, confidence, status, last_seen, kind)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'up', now(), $9)
         on conflict (tenant_id, mac) do update set router_id = excluded.router_id, port = excluded.port, behind = excluded.behind
         returning *`,
        [r.tenant_id, r.id, f.mac, f.ip, f.hostname || null, f.port, f.behind, f.confidence, f.kind]);
      added += 1;
      if (made) byMac.set(made.mac, made);
    }

    // ── watch: every chained router on this router that is not ignored ──
    const downNow = []; const recovered = [];
    let pings = 0;
    for (const c of byMac.values()) {
      if (c.ignored || c.router_id !== r.id) continue;
      const seen = presence(c.mac, snap);
      let alive = seen.alive;
      let why = seen.why;
      const ip = c.ip && IPV4.test(c.ip) ? c.ip : null;
      if (!alive && ip && pings < PINGS_PER_ROUTER) {
        pings += 1;
        const res = await ros.pingHost(conn, ip, 2).catch(() => null);
        if (res === null) continue;                          // the router could not ping: no answer either way
        alive = res.received > 0;
        why = alive ? 'not on the bridge, but it answered a ping' : 'not on the bridge, no recent lease, and it did not answer a ping';
      }
      if (!alive && !ip) why += ' (no address to ping)';
      if (alive) {
        await pool.query(`update chained_routers set status='up', last_seen=now(), ping_fails=0, offline_since=null, offline_notified=false, note=$2 where id=$1`, [c.id, why]);
        if (c.offline_notified) recovered.push(c);
        continue;
      }
      const fails = Number(c.ping_fails) + 1;
      if (fails < 2) { await pool.query('update chained_routers set ping_fails=$2, note=$3 where id=$1', [c.id, fails, `${why} (missed once)`]); continue; }
      await pool.query(`update chained_routers set status='down', ping_fails=$2, offline_since=coalesce(offline_since, now()), note=$3 where id=$1`, [c.id, fails, why]);
      const since = c.offline_since ? new Date(c.offline_since) : new Date();
      if (!c.offline_notified && (Date.now() - since) / 60000 >= OFFLINE_MINUTES) {
        await pool.query('update chained_routers set offline_notified=true where id=$1', [c.id]);
        downNow.push(c);
      }
    }

    // ── tell the owner: one message however many went down together ──
    const opts = { url: '/hotspot/chaining', title: 'Chained device' };
    const noun = (list) => (list.every((c) => c.kind === 'onu') ? 'ONU' : list.every((c) => c.kind !== 'onu') ? 'router' : 'device');
    if (downNow.length) {
      const names = downNow.slice(0, 6).map(label).join(', ');
      const ports = [...new Set(downNow.map((c) => c.port).filter(Boolean))];
      await notify(r.tenant_id, downNow.length === 1
        ? `${label(downNow[0])} (${downNow[0].mac}), ${noun(downNow) === 'ONU' ? 'an' : 'a'} ${noun(downNow)} chained to ${r.name}${downNow[0].port ? ` on ${downNow[0].port}` : ''}, has stopped answering. About ${downNow[0].behind} device${downNow[0].behind === 1 ? '' : 's'} were behind it.`
        : `${downNow.length} ${noun(downNow)}s chained to ${r.name} have stopped answering${ports.length === 1 ? ` (all on ${ports[0]}: check that cable or switch first)` : ''}: ${names}${downNow.length > 6 ? ', …' : ''}.`, opts);
    }
    if (recovered.length) {
      await notify(r.tenant_id, recovered.length === 1 ? `${label(recovered[0])} (chained to ${r.name}) is back.` : `${recovered.length} chained ${noun(recovered)}s on ${r.name} are back.`, opts);
    }
    await recordScan(r, {
      ok: true, hosts: snap.hosts.length, found: found.length, watched: byMac.size,
      note: `${snap.lanBridges ? `Looked at the hotspot bridge (${[...snap.lanBridges].join(', ')})` : 'Looked at every bridge except the uplink'}${uplink.length ? `, skipped the uplink (${uplink.join(', ')})` : ''}. ${learn ? '' : 'No hotspot on this router, so not looking for new ones. '}Read ${snap.hosts.length} device addresses.`,
    });
    return { added, watched: byMac.size, down: downNow.length, cleaned, lan: snap.lanBridges ? [...snap.lanBridges] : null, uplink,
      routerId: r.id, seen: analysis.report.slice(0, 60), hostsRead: snap.hosts.length, hotspotOn: snap.hotspotOn, router: r.name };
  } finally {
    if (conn) ros.close(conn);
  }
}

/** The scheduled job: every hotspot router that is up. A router that is down says nothing about what is behind it, so those are "unknown". */
export async function watchChainedRouters({ notify }) {
  const { rows: routers } = await pool.query(
    `select id, tenant_id, name, host, api_port, role, status, service_user, service_password_enc
       from routers where tenant_id in (${enabledTenants})`, ['watchChainedRouters']);
  await pool.query(
    `update chained_routers c set status='unknown', ping_fails=0
       from routers r where r.id = c.router_id and r.status <> 'up' and c.status <> 'unknown'`);
  if (!routers.length) return;
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  for (const r of routers) {
    if (r.status !== 'up') { await recordScan(r, { ok: false, note: 'The router is down, so it was skipped.' }); continue; }
    if (!r.service_user || !r.service_password_enc) { await recordScan(r, { ok: false, note: 'No login is stored for this router, so billing cannot read it.' }); continue; }
    try { await pass(r, { ros, secrets, notify }); } catch (e) {
      console.warn('watchChainedRouters:', r.name, '-', e.message);
      await recordScan(r, { ok: false, note: `Could not read the router: ${e.message}` });
    }
  }
}

/** Look at one router now (the Scan button): learn and check it once, without telling anyone. */
export async function scanRouter(tenantId, routerId) {
  const { rows: [r] } = await pool.query(
    `select id, tenant_id, name, host, api_port, role, service_user, service_password_enc, status
       from routers where id=$1 and tenant_id=$2`, [routerId, tenantId]);
  if (!r) throw Object.assign(new Error('No such router'), { status: 404 });
  if (r.status !== 'up' || !r.service_user || !r.service_password_enc) {
    const why = r.status !== 'up' ? 'The router is down, so it cannot be scanned.' : 'No login is stored for this router, so billing cannot read it.';
    await recordScan(r, { ok: false, note: why });
    throw Object.assign(new Error(why), { status: 409 });
  }
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  try { return await pass(r, { ros, secrets, notify: async () => {} }); } catch (e) {
    await recordScan(r, { ok: false, note: `Could not read the router: ${e.message}` });
    throw e;
  }
}

/** Every router with what its last scan did, so one that is skipped or failing says why. */
export async function listScans(tenantId) {
  const { rows } = await pool.query(
    `select r.id, r.name, r.role, r.status, s.at, s.ok, s.note, s.hosts, s.found, s.watched,
            (select count(*)::int from chained_routers c where c.router_id = r.id and not c.ignored) as devices
       from routers r left join chained_scans s on s.router_id = r.id
      where r.tenant_id = $1 order by r.name`, [tenantId]);
  return rows;
}

// ── what the screen and the API use ──

export async function listChainedRaw(tenantId) {
  const { rows } = await pool.query(
    `select c.*, r.name as router_name
       from chained_routers c join routers r on r.id = c.router_id
      where c.tenant_id = $1
      order by (c.status = 'down') desc, c.ignored, r.name, c.port, c.name nulls last, c.mac`, [tenantId]);
  return rows;
}

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const text = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

/** Add one by hand (a chained router the scan cannot tell apart). */
export async function addChained(tenantId, { routerId, mac, name, kind }) {
  if (!validMac(mac)) throw bad('The MAC address must look like AA:BB:CC:DD:EE:FF.');
  const { rows: [r] } = await pool.query('select id from routers where id=$1 and tenant_id=$2', [routerId, tenantId]);
  if (!r) throw bad('Choose the router it hangs off.');
  try {
    const { rows: [c] } = await pool.query(
      `insert into chained_routers (tenant_id, router_id, mac, name, confidence, status, kind) values ($1,$2,$3,$4,'manual','unknown',$5) returning *`,
      [tenantId, routerId, normMac(mac), text(name, 80), kind === 'onu' ? 'onu' : 'router']);
    return c;
  } catch (e) {
    if (e.code === '23505') throw bad('That MAC is already in the list.', 409);
    throw e;
  }
}

/** Rename, ignore (stop watching and stop alerting) or watch again. */
export async function updateChained(tenantId, id, b) {
  const { rows: [cur] } = await pool.query('select * from chained_routers where id=$1 and tenant_id=$2', [id, tenantId]);
  if (!cur) return null;
  const name = b && 'name' in b ? text(b.name, 80) : cur.name;
  const ignored = b && 'ignored' in b ? !!b.ignored : cur.ignored;
  const ip = b && 'ip' in b ? text(b.ip, 45) : cur.ip;
  if (ip && !IPV4.test(ip)) throw bad('The address must look like 10.20.30.40.');
  const { rows: [c] } = await pool.query(
    `update chained_routers set name=$3, ignored=$4, ip=$5,
            status = case when $4 then 'unknown' else status end,
            ping_fails = case when $4 then 0 else ping_fails end,
            offline_since = case when $4 then null else offline_since end,
            offline_notified = case when $4 then false else offline_notified end
      where id=$1 and tenant_id=$2 returning *`, [id, tenantId, name, ignored, ip]);
  return c;
}

export async function deleteChained(tenantId, id) {
  const { rowCount } = await pool.query('delete from chained_routers where id=$1 and tenant_id=$2', [id, tenantId]);
  return rowCount > 0;
}
