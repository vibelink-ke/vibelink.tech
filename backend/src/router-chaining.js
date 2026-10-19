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
import { FAMILY_SPAN, makerOf, maybeOnuVendorOf, onuVendorOf, sameDevice, vendorOf } from './router-ouis.js';

export const OFFLINE_MINUTES = 3;
const PINGS_PER_ROUTER = 20;
const MAX_NEW_PER_PASS = 200;
const MAX_PER_ROUTER = 500;

/** Names an extender gives itself when it asks for an address. */
const EXTENDER_NAME = /tenda|tp-?link|mercusys|ruijie|totolink|d-?link|netis|wavlink|cudy|mikrotik|ubnt|unifi|(?:^|[^a-z0-9])(?:tl-|mw\d|repeater|extender|access.?point|mesh|ap[-_ ]?\d*|cpe[-_ ]?\d*)(?:[^a-z0-9]|$)/i;
/** Model names optical units (xPON/GPON/EPON ONT/ONU) call themselves: Huawei HG8xxx/EchoLife, ZTE ZXHN/F6xx, FiberHome AN5xxx, V-SOL, and the plain words. */
const ONU_NAME = /echolife|zxhn|zxa10|fiberhome|v-?sol|hg[68]\d{3}|hs8\d{3}|hn8\d{3}|an5\d{3}|ftth|gpon|epon|xpon|xgs-?pon|(?:^|[^a-z0-9])(?:onu|ont|f[46]\d{2}[a-z]?\d?|xz\d{3}|g-0\d{2}[a-z0-9-]*|hgw)(?:[^a-z0-9]|$)/i;
/**
 * What a customer's own devices call themselves, or send in their DHCP request. Makers of routers (TP-Link, D-Link, Ubiquiti…) also make cameras,
 * plugs and bulbs, and a prefix alone would take one of those behind an extender for a router: a device that says it is one of these is never taken
 * for a router, whatever its prefix.
 */
const CLIENT_NAME = /(?:^|[^a-z0-9])(?:tapo|kasa|cam|camera|plug|bulb|switchbot|iphone|ipad|android|galaxy|redmi|desktop|laptop|macbook|tv|printer|phone|oppo|tecno|infinix|itel|vivo|realme|pc)(?:[^a-z0-9]|$)/i;
const CLIENT_DHCP = /^android|^msft/i;
/** What embedded router firmware (BusyBox udhcp) puts in its DHCP request: phones send "android-dhcp", Windows "MSFT", iPhones nothing. */
const EMBEDDED_DHCP = /^udhcp|busybox/i;

/** Any way of writing a MAC (AA:BB:.., AA-BB-.., AABB.CCDD.EEFF, aabbccddeeff) as AA:BB:CC:DD:EE:FF; anything else is returned as typed, upper case. */
export const normMac = (m) => {
  const t = String(m ?? '').trim().toUpperCase();
  const hex = t.replace(/[s:.-]/g, '');
  return /^[0-9A-F]{12}$/.test(hex) ? hex.match(/../g).join(':') : t.replace(/-/g, ':');
};
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
export function lanScope({ ifaces = [], hotspots = [], lists = [], routes = [], dhcpClients = [], pppoe = [], vlans = [], bridgePorts = [], pppoeServers = [] }) {
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
  // Where a PPPoE server listens, the devices are PPPoE customers, not routers plugged in to extend the hotspot: such a port (or every port of such a
  // bridge) is not the hotspot's LAN, unless it is the hotspot's own bridge (then only the MACs of PPP sessions can be told apart: see pppSetFor).
  const ppp = new Set();
  const addPpp = (name, depth = 0) => {
    if (!name || ppp.has(name) || lan.has(name) || depth > 4) return;
    ppp.add(name);
    if (vlanParent.has(name)) addPpp(vlanParent.get(name), depth + 1);
    for (const p of portsOf.get(name) ?? []) addPpp(p, depth + 1);
  };
  for (const sv of pppoeServers) addPpp(String(sv.interface ?? ''));
  return { wan, lanBridges: lan.size ? lan : null, ppp };
}

// PPPoE devices are NOT left out: the scan found far more routers (66 on one router) before PPPoE customers were filtered out, and the filter dropped real
// chained routers on routers where PPPoE and the hotspot share a bridge. Set to true to bring the filtering back.
const EXCLUDE_PPP = false;
const MAX_PORT_HOSTS = 100000;    // a safety stop only: a port is read however many devices it carries (a big hotspot takes minutes over a slow tunnel, and that is allowed)
const OR_CHUNK = 28;              // MACs asked for in one query

/** The MACs of one router's own interfaces: this one and the few either side of it (the label address may not be the one the bridge sees). */
function familyOf(mac) {
  const h = String(mac).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (h.length !== 12) return [normMac(mac)];
  const base = parseInt(h.slice(6), 16);
  const out = [];
  for (let d = -FAMILY_SPAN; d <= FAMILY_SPAN; d += 1) {
    const n = base + d;
    if (n < 0 || n > 0xffffff) continue;
    const t = n.toString(16).toUpperCase().padStart(6, '0');
    out.push(`${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}:${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`);
  }
  return out;
}

/** "field is A or B or C" as a RouterOS API query. */
const orQuery = (field, values) => [...values.map((v) => `?${field}=${v}`), ...(values.length > 1 ? [`?#${'|'.repeat(values.length - 1)}`] : [])];

/**
 * What one router can tell us: the MACs on its cable ports, who holds a lease, which interfaces are wired, and which side is the LAN.
 * A busy hotspot router has thousands of hosts and leases, and over a slow tunnel reading them all is slower than any deadline, so none of the big
 * tables is read whole: the small tables first (they say which bridge is the hotspot's and which ports are cables), then one cable port at a time,
 * counted first so progress can say how many there are, then only the leases of the MACs found and of the routers already being watched, asked for by
 * MAC. It takes as long as it takes: nothing is skipped for being big.
 *   opts.watchMacs  the MACs of chained routers already known, looked up directly
 *   opts.progress   called with a sentence about what is being read now (shown on the screen while the scan runs)
 */
export async function chainSnapshot(conn, trace = null, opts = {}) {
  // `trace` names the calls still waiting, so a read that times out can say which one it was stuck on.
  const track = (label, p) => { trace?.add(label); return p.finally(() => trace?.delete(label)); };
  const soft = (path, query = []) => track(`${path} ${query.filter((q) => q.startsWith('?')).join(' ')}`.trim(), conn.write(path, query).catch(() => []));
  // A QUICK check (every 2 minutes) reads only the devices already watched, by MAC: a handful of small queries. The full read of every port (hundreds or
  // thousands of devices, plus leases, ARP and the hotspot hosts) is what loads a busy router enough to drop guests, so it runs rarely (see FULL_EVERY).
  if (opts.light) {
    const watchL = [...new Set((opts.watchMacs ?? []).flatMap(familyOf))];
    const rowsL = [];
    for (let i = 0; i < watchL.length; i += OR_CHUNK) {
      rowsL.push(...await soft('/interface/bridge/host/print', [...orQuery('mac-address', watchL.slice(i, i + OR_CHUNK)), '=.proplist=mac-address,on-interface,bridge,local,age']));
    }
    const hostsL = []; const seenL = new Set();
    for (const r of rowsL) {
      const h = { mac: normMac(r['mac-address']), port: String(r['on-interface'] ?? ''), bridge: String(r.bridge ?? ''), local: String(r.local) === 'true', ageSec: parseRosAge(r.age) };
      const k = `${h.mac}|${h.port}`;
      if (h.mac && h.port && !seenL.has(k)) { seenL.add(k); hostsL.push(h); }
    }
    const leaseL = [];
    for (let i = 0; i < watchL.length; i += OR_CHUNK) {
      leaseL.push(...await soft('/ip/dhcp-server/lease/print', [...orQuery('mac-address', watchL.slice(i, i + OR_CHUNK)), '=.proplist=mac-address,active-mac-address,address,active-address,host-name,class-id,last-seen']));
    }
    const leasesL = leaseL.map((r) => ({ mac: normMac(r['active-mac-address'] || r['mac-address']), address: String(r['active-address'] || r.address || ''), hostname: String(r['host-name'] ?? ''), classId: String(r['class-id'] ?? ''), seenSec: parseRosAge(r['last-seen']) })).filter((l) => l.mac);
    return { hosts: hostsL, leases: leasesL, arp: new Map(), arpOff: new Map(), nat: new Map(), wired: new Set(), wan: new Set(), pppPorts: new Set(), lanBridges: null, hotspotOn: [], bigPorts: [] };
  }
  // Only the interface types that matter: cable ports (the only place a chained router plugs in), bridges, VLANs and PPPoE clients (uplinks).
  // A bare /interface/print on a PPPoE router also lists every customer's dynamic session interface, which is thousands of rows.
  const IFACE = (type) => soft('/interface/print', [`?type=${type}`, '=.proplist=name,type,comment']);
  const [ether, bridges, vlanIfaces, pppoeOut, hotspots, lists, routes, dhcpClients, pppoe, vlans, bridgePorts, pppoeServers] = await Promise.all([
    track('/interface/print ?type=ether', conn.write('/interface/print', ['?type=ether', '=.proplist=name,type,comment'])),
    IFACE('bridge'), IFACE('vlan'), IFACE('pppoe-out'),
    soft('/ip/hotspot/print', ['=.proplist=interface']),
    soft('/interface/list/member/print', ['=.proplist=list,interface']),
    soft('/ip/route/print', ['?dst-address=0.0.0.0/0', '=.proplist=gateway,immediate-gw,gateway-status,active,disabled']),
    soft('/ip/dhcp-client/print', ['=.proplist=interface']),
    soft('/interface/pppoe-client/print', ['=.proplist=interface']),
    soft('/interface/vlan/print', ['=.proplist=name,interface']),
    soft('/interface/bridge/port/print', ['=.proplist=interface,bridge']),
    soft('/interface/pppoe-server/server/print', ['=.proplist=interface']),
  ]);
  const ifaceRows = [...ether, ...bridges, ...vlanIfaces, ...pppoeOut];
  const scope = lanScope({ ifaces: ifaceRows, hotspots, lists, routes, dhcpClients, pppoe, vlans, bridgePorts, pppoeServers });
  const wired = new Set(ifaceRows.filter((i) => String(i.type) === 'ether').map((i) => String(i.name)));

  // the cable ports of the LAN side, and for each how many devices are on it
  const HOST_FIELDS = '=.proplist=mac-address,on-interface,bridge,local,age';
  const HOSTS = '/interface/bridge/host/print';
  const lanPorts = bridgePorts
    .map((b) => ({ port: String(b.interface ?? ''), bridge: String(b.bridge ?? '') }))
    .filter((b) => b.port && (opts.allPorts || (wired.has(b.port) && !scope.wan.has(b.port) && !scope.wan.has(b.bridge) && (!EXCLUDE_PPP || (!scope.ppp.has(b.port) && !scope.ppp.has(b.bridge))) && (!scope.lanBridges || scope.lanBridges.has(b.bridge)))));
  const hostRows = []; const bigPorts = [];
  const say = (t) => { try { opts.progress?.(t); } catch { /* progress is only a courtesy */ } };
  say(opts.allPorts ? `Scanning all ports: found ${lanPorts.length} bridge port${lanPorts.length === 1 ? '' : 's'}. Counting the devices on each…` : `Found ${lanPorts.length} cable port${lanPorts.length === 1 ? '' : 's'} on the hotspot side. Counting the devices on each…`);
  let portNo = 0;
  for (const { port, bridge } of lanPorts) {
    portNo += 1;
    const q = [`?bridge=${bridge}`, `?on-interface=${port}`];
    let n = null;
    try {
      const c = await track(`${HOSTS} count ${port}`, conn.write(HOSTS, ['=count-only=', ...q]));
      n = Number(Array.isArray(c) ? c[0]?.ret : c?.ret);
    } catch { n = null; }
    if (Number.isFinite(n) && n > MAX_PORT_HOSTS) { bigPorts.push({ port, bridge, count: n }); continue; }
    say(`Reading ${port} (${portNo} of ${lanPorts.length})${Number.isFinite(n) ? `: ${n} device${n === 1 ? '' : 's'}` : ''}…`);
    hostRows.push(...await track(`${HOSTS} ${port}`, conn.write(HOSTS, [...q, HOST_FIELDS])));
  }

  // routers already watched, asked for by MAC (and the few addresses either side), wherever they are: a router on a skipped port is still seen
  const watch = [...new Set((opts.watchMacs ?? []).flatMap(familyOf))];
  if (watch.length) say(`Looking up the ${opts.watchMacs.length} router${opts.watchMacs.length === 1 ? '' : 's'} already watched…`);
  for (let i = 0; i < watch.length; i += OR_CHUNK) {
    hostRows.push(...await track(`${HOSTS} by MAC`, conn.write(HOSTS, [...orQuery('mac-address', watch.slice(i, i + OR_CHUNK)), HOST_FIELDS])));
  }

  const hosts = [];
  const seenHost = new Set();
  for (const r of hostRows) {
    const h = { mac: normMac(r['mac-address']), port: String(r['on-interface'] ?? ''), bridge: String(r.bridge ?? ''), local: String(r.local) === 'true', ageSec: parseRosAge(r.age) };
    const key = `${h.mac}|${h.port}`;
    if (h.mac && h.port && !seenHost.has(key)) { seenHost.add(key); hosts.push(h); }
  }

  // leases: only those of the MACs just read
  const LEASE_FIELDS = '=.proplist=mac-address,active-mac-address,address,active-address,host-name,class-id,last-seen';
  const want = [...new Set([...hosts.map((h) => h.mac), ...watch])];
  say(`Reading the names of ${want.length} device${want.length === 1 ? '' : 's'}…`);
  const leaseRows = [];
  for (let i = 0; i < want.length; i += OR_CHUNK) {
    leaseRows.push(...await soft('/ip/dhcp-server/lease/print', [...orQuery('mac-address', want.slice(i, i + OR_CHUNK)), LEASE_FIELDS]));
  }
  const leases = leaseRows.map((r) => ({
    mac: normMac(r['active-mac-address'] || r['mac-address']), address: String(r['active-address'] || r.address || ''),
    hostname: String(r['host-name'] ?? ''), classId: String(r['class-id'] ?? ''), seenSec: parseRosAge(r['last-seen']),
  })).filter((l) => l.mac);
  // A device with an address on the hotspot's own bridge is on the hotspot. A PPPoE customer's router has none there (its traffic rides inside the
  // PPPoE session), and neither does a bridged extender that says nothing: so for a MAC that has a router maker's prefix and no lease, the ARP table says
  // which it is. Asked by MAC, for those MACs only.
  const leaseMacs = new Set(leases.map((l) => l.mac));
  const arpWant = [...new Set(hosts.filter((h) => !leaseMacs.has(h.mac) && (vendorOf(h.mac) || onuVendorOf(h.mac) || maybeOnuVendorOf(h.mac))).map((h) => h.mac))];
  const arp = new Map();
  const arpOff = new Map();      // an address the MAC holds somewhere that is NOT the hotspot (a PPPoE customer's, another network)
  if (arpWant.length) say(`Checking which of ${arpWant.length} router-maker device${arpWant.length === 1 ? '' : 's'} have an address on the hotspot…`);
  for (let i = 0; i < arpWant.length; i += OR_CHUNK) {
    const rows = await soft('/ip/arp/print', [...orQuery('mac-address', arpWant.slice(i, i + OR_CHUNK)), '=.proplist=mac-address,address,interface']);
    for (const row of rows) {
      const onLan = !scope.lanBridges || scope.lanBridges.has(String(row.interface ?? ''));
      if (onLan && row.address) arp.set(normMac(row['mac-address']), String(row.address));
      else if (row.address) arpOff.set(normMac(row['mac-address']), { address: String(row.address), interface: String(row.interface ?? '') });
    }
  }
  // A router in router mode plugged into the hotspot (a Tenda, TP-Link ... used as an extender with its own LAN) shows up in the hotspot's host list as a
  // device whose own address (192.168.x.x, its LAN) differs from the address the hotspot gave it ("to-address"): the hotspot is translating it. Ordinary
  // guests have the same address on both sides. Only the dynamic hosts are asked for, and only the MAC and the two addresses.
  const nat = new Map();
  const natRows = await soft('/ip/hotspot/host/print', ['?dynamic=true', '=.proplist=mac-address,address,to-address']);
  for (const row of natRows) {
    const mac = normMac(row['mac-address']);
    if (mac && row.address && row['to-address'] && row.address !== row['to-address']) nat.set(mac, { address: String(row.address), to: String(row['to-address']) });
  }
  // With opts.allPorts nothing is left out for being the uplink, a PPPoE port, another bridge or a wireless port: every port that was read counts.
  const open = !!opts.allPorts;
  return { hosts, leases, arp, arpOff, nat, wired: open ? new Set([...wired, ...lanPorts.map((x) => x.port)]) : wired, wan: open ? new Set() : scope.wan, pppPorts: open || !EXCLUDE_PPP ? new Set() : scope.ppp, lanBridges: open ? null : scope.lanBridges, hotspotOn: hotspots.map((h) => String(h.interface ?? '')).filter(Boolean), bigPorts };
}

/**
 * Go through each port of the snapshot, say what was decided about it, and pick the chained routers. Only a device that identifies itself as a
 * router is added by itself: it names itself like one (Tenda, TP-Link, "extender"…), or its DHCP request carries the signature embedded router
 * firmware sends (BusyBox "udhcp"), which phones and laptops do not. Every such device on a port is found, so extenders chained one behind the
 * other are all picked up. Anything else on the port is a customer's device as far as billing can tell, so it is never added by itself: the scan
 * lists those devices so a router that gives nothing away can be added by hand.
 * Returns { found: [{ mac, port, behind, ip, hostname, confidence }], report: [{ port, bridge, devices, verdict, router, candidates }] }.
 */
export function analysePorts({ hosts, leases, nat = new Map(), arpOff = new Map(), wired, wan = new Set(), lanBridges = null, bigPorts = [], pppPorts = new Set(), pppMacs = new Set(), arp = new Map() }) {
  const isPpp = (mac) => pppMacs.has(mac) || [...pppMacs].some((m) => sameDevice(m, mac));
  const lease = new Map(leases.map((l) => [l.mac, l]));
  const ports = new Map();
  for (const h of hosts) {
    if (h.local || !MAC.test(h.mac) || multicast(h.mac)) continue;
    if (pppMacs.size && isPpp(h.mac)) continue;                                           // a PPPoE customer's router: a customer, never a chained router
    let p = ports.get(h.port);
    if (!p) {
      p = { port: h.port, bridge: h.bridge || '', macs: new Set(), skip: null };
      if (wan.has(h.port) || (h.bridge && wan.has(h.bridge))) p.skip = 'Uplink: skipped';
      else if (pppPorts.has(h.port) || (h.bridge && pppPorts.has(h.bridge))) p.skip = 'PPPoE service port: skipped';              // upstream, not a router plugged in to extend the signal
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
      const nt = nat.get(mac);
      const hostname = l?.hostname ?? '';
      const classId = l?.classId ?? '';
      const onLan = !!l || arp.has(mac);                                    // an address on the hotspot's bridge
      return { mac, hostname, classId, onLan, lease: !!l, ip: l?.address || arp.get(mac) || nt?.to || null, client: CLIENT_NAME.test(hostname) || CLIENT_DHCP.test(classId), vendor: vendorOf(mac), onuVendor: onuVendorOf(mac), maybeVendor: maybeOnuVendorOf(mac), onuNamed: ONU_NAME.test(hostname), named: EXTENDER_NAME.test(hostname), embedded: EMBEDDED_DHCP.test(classId), natted: nat.has(mac), off: !l && !arp.has(mac) ? arpOff.get(mac) ?? null : null };
    });
    // A router's own interfaces (LAN, radios) take addresses a few apart, so two such MACs on one port are one router: keep the first.
    const routers = [];
    // A router says what it is in its own words (name, DHCP signature: both come with a lease), or has a router maker's prefix. A prefix with no address on
    // the hotspot is seen only at layer 2 (a bridged extender looks exactly so, and so can a PPPoE customer's router where PPPoE shares the bridge): it is
    // added and marked "Check", never silently left out.
    const asCandidate = (d) => ({ mac: d.mac, hostname: d.hostname, classId: d.classId, ip: d.ip, vendor: d.vendor ?? d.onuVendor ?? (d.maybeVendor ? `${d.maybeVendor} (could be an xPON router or a phone)` : null), note: d.off ? `its address ${d.off.address} is on ${d.off.interface || 'another network'}, not on the hotspot: a customer's or another network's device` : (d.vendor || d.onuVendor || (d.maybeVendor && !d.hostname)) && !d.onLan ? "no address on the hotspot: maybe a PPPoE customer's router" : '' });
    const strong = (x) => x.named || x.embedded || x.onuNamed || x.natted;
    const byPrefix = (x) => x.vendor || x.onuVendor || (x.maybeVendor && !x.hostname);
    for (const d of all.filter((x) => !x.client && !(x.off && !x.natted) && (strong(x) || byPrefix(x))).sort((a, b) => (a.mac < b.mac ? -1 : 1))) {
      if (!routers.some((r2) => sameDevice(r2.mac, d.mac))) routers.push(d);
    }
    if (!routers.length) {
      const l2 = all.filter((x) => !x.client && byPrefix(x) && !x.onLan);
      row.verdict = l2.length ? `${l2.length} device${l2.length === 1 ? '' : 's'} with a router maker's prefix but no address on the hotspot: not added (could be a PPPoE customer's router)`
        : p.macs.size === 1 ? 'One device, not identifying itself as a router' : `${p.macs.size} devices, none identifies itself as a router`;
      // For adding one by hand: the devices with a real (not private) MAC first, since a router's own address is never a phone's private one.
      row.candidates = all.sort((a, b) => Number(universal(b.mac)) - Number(universal(a.mac)) || (a.mac < b.mac ? -1 : 1)).slice(0, 40)
        .map(asCandidate);
      continue;
    }
    const kindOf = (c) => (c.onuNamed || c.onuVendor || (c.maybeVendor && !c.named && !c.vendor) ? 'onu' : 'router');
    // Proof that hotspot guests pass through it: other devices on the same cable port that hold a hotspot (DHCP) lease. A device that is only a maker's prefix
    // on a LAN port is "Check"; once guests are seen behind it, it is confirmed.
    const guests = p.macs.size > 24 ? 0 : all.filter((x) => x.onLan && x.lease && !routers.some((r2) => sameDevice(r2.mac, x.mac))).length;
    for (const c of routers) found.push({ carries: guests, mac: c.mac, port: p.port, behind: p.macs.size - routers.length, ip: c.ip, hostname: c.hostname, vendor: c.vendor ?? c.onuVendor ?? c.maybeVendor, kind: kindOf(c), confidence: strong(c) || c.onLan || guests > 0 ? 'high' : 'likely' });
    row.router = routers.map((c) => c.hostname || c.mac).join(', ');
    row.candidates = all.filter((x) => !x.client && byPrefix(x) && !x.onLan && !routers.some((r2) => r2.mac === x.mac)).slice(0, 8).map(asCandidate);
    const what = [...new Set(routers.map((c) => (kindOf(c) === 'onu' ? 'ONU' : 'Router')))].join(' and ');
    const makers = [...new Set(routers.map((c) => c.vendor ?? c.onuVendor ?? c.maybeVendor).filter(Boolean))];
    const unsure = routers.filter((c) => !(strong(c) || c.onLan)).length;
    row.verdict = makers.length ? `${what} found (by its MAC: ${makers.join(', ')}${unsure ? `; ${unsure === routers.length ? 'no address' : `${unsure} with no address`} on the hotspot, so check ${unsure === 1 ? 'it is' : 'they are'} not a PPPoE customer's` : ''})`
      : routers.some((c) => c.named || c.onuNamed) ? `${what} found (by its name)`
      : routers.some((c) => c.natted) ? `${what} found (its own address differs from the one the hotspot gave it: a router with its own LAN)` : `${what} found (by its DHCP signature)`;
  }
  for (const b of bigPorts) {
    report.push({ port: b.port, bridge: b.bridge, devices: b.count, router: null, candidates: [], verdict: `${b.count} devices: too many to be one router (a switch or an access-point trunk), so not read` });
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

export const READ_DEADLINE_SECONDS = 900;     // a scan runs in the background and may take minutes on a big router; this is only a stop for one that never ends

/** Run one router's pass with a deadline: when it passes, the connection is closed and the pass fails with a message that says what happened. */
export async function withDeadline(r, ros, work, seconds = READ_DEADLINE_SECONDS) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { if (r.conn) ros.close(r.conn); } catch { /* it is going anyway */ }
      const waiting = r.trace && r.trace.size ? ` while waiting for ${[...r.trace].join(', ')}` : '';
      reject(new Error(`Gave up after ${seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`} reading the router${waiting}: that table is very large, or the tunnel to it is very slow`));
    }, seconds * 1000);
  });
  try { return await Promise.race([work, deadline]); } finally { clearTimeout(timer); }
}


/**
 * Which PPPoE customer (by name) owns each of these MACs: the caller-id of an active session, or the caller-id locked on a PPP secret. Used only to LABEL a
 * device ("PPPoE customer: John"); nothing is ever left out because of it. Asked by MAC, since a PPPoE router has thousands of sessions.
 */
export async function pppNamesFor(conn, macs) {
  const list = [...new Set(macs.filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;
  for (const path of ['/ppp/active/print', '/ppp/secret/print']) {
    for (let i = 0; i < list.length; i += OR_CHUNK) {
      const rows = await conn.write(path, [...orQuery('caller-id', list.slice(i, i + OR_CHUNK)), '=.proplist=name,caller-id']).catch(() => []);
      for (const row of rows ?? []) { const m = normMac(row['caller-id']); if (m && row.name && !out.has(m)) out.set(m, String(row.name)); }
    }
  }
  return out;
}

/**
 * Which of these MACs belong to PPPoE customers. Asked by MAC (a PPPoE router has thousands of sessions, so the lists are never read whole): the
 * caller-id of an active session, the caller-id locked on a PPP secret (a customer who is offline now), and a PPPoE server's own client entries.
 */
export async function pppSetFor(conn, macs) {
  const list = [...new Set(macs.filter(Boolean))];
  const out = new Set();
  const ask = async (path, field) => {
    for (let i = 0; i < list.length; i += OR_CHUNK) {
      const rows = await conn.write(path, [...orQuery(field, list.slice(i, i + OR_CHUNK)), `=.proplist=${field}`]).catch(() => []);
      for (const row of rows ?? []) { const m = normMac(row[field]); if (m) out.add(m); }
    }
  };
  if (!list.length) return out;
  await ask('/ppp/active/print', 'caller-id');
  await ask('/ppp/secret/print', 'caller-id');
  await ask('/interface/pppoe-server/print', 'remote-address');
  return out;
}

/** What the last scan of a router did (shown under Routers on the screen), and how far a running one has got. */
async function recordScan(r, { ok = true, note = '', hosts = 0, found = 0, watched = 0, running = false, starting = false, report = null }) {
  try {
    await pool.query(
      `insert into chained_scans (router_id, tenant_id, at, ok, note, hosts, found, watched, running, started_at, report)
       values ($1,$2, now(), $3,$4,$5,$6,$7,$8, case when $9 then now() end, $10)
       on conflict (router_id) do update set at = now(), ok = excluded.ok, note = excluded.note, running = excluded.running,
         hosts = case when excluded.running then chained_scans.hosts else excluded.hosts end,
         found = case when excluded.running then chained_scans.found else excluded.found end,
         watched = case when excluded.running then chained_scans.watched else excluded.watched end,
         started_at = case when $9 then now() else chained_scans.started_at end,
         report = coalesce(excluded.report, chained_scans.report)`,
      [r.id, r.tenant_id, ok, String(note).slice(0, 300), hosts, found, watched, running, starting, report ? JSON.stringify(report) : null]);
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
    r.conn = conn;                                   // so a read that hangs can be cut off from outside (see withDeadline)
    r.trace = new Set();
    const { rows: watching } = await pool.query('select mac from chained_routers where tenant_id=$1 and router_id=$2 and not ignored limit $3', [r.tenant_id, r.id, MAX_PER_ROUTER]);
    await recordScan(r, { running: true, starting: true, note: 'Connected. Reading the router…' });
    const snap = await chainSnapshot(conn, r.trace, { watchMacs: watching.map((x) => x.mac), progress: (t) => { void recordScan(r, { running: true, note: t }); }, allPorts: !!r.allPorts, light: !!r.light });
    const light = !!r.light;

    // ── learn: new chained routers are added by their MAC ──
    let analysis = analysePorts(snap);
    const suspects = [...analysis.found.map((f) => f.mac), ...analysis.report.flatMap((x) => x.candidates.map((c) => c.mac)), ...watching.map((x) => x.mac)];
    void recordScan(r, { running: true, note: r.allPorts ? 'Reading every device…' : 'Leaving out PPPoE customers…' });
    // "Scan all ports" means everything on the cable, PPPoE customers' devices included: nothing is left out for being a PPPoE session.
    const pppMacs = r.allPorts || !EXCLUDE_PPP ? new Set() : await pppSetFor(conn, suspects);
    if (pppMacs.size) analysis = analysePorts({ ...snap, pppMacs });
    // A router with no hotspot on it has no guest bridge to find extenders on; one whose hotspot could not be read (a PPPoE-only router has none) is
    // looked at only when its role says it has one.
    const learn = snap.hotspotOn.length > 0 || r.role !== 'pppoe' || !!r.allPorts;
    const found = learn && !light ? analysis.found : [];
    // What an all-ports scan finds was asked for by name: it is kept like one added by hand, and the automatic clean-ups never remove it.
    if (r.allPorts) for (const f of found) f.confidence = 'manual';
    const uplink = [...snap.wan];
    let cleaned = 0;
    if (uplink.length) {
      cleaned = (await pool.query(
        `delete from chained_routers where tenant_id=$1 and router_id=$2 and confidence <> 'manual' and port = any($3::text[])`, [r.tenant_id, r.id, uplink])).rowCount;
    }
    if (pppMacs.size) {
      cleaned += (await pool.query(`delete from chained_routers where tenant_id=$1 and router_id=$2 and confidence <> 'manual' and mac = any($3::text[])`, [r.tenant_id, r.id, [...pppMacs]])).rowCount;
    }
    // Label (never remove) the devices that are a PPPoE customer's router, so it is clear which cable a chain starts from.
    if (!light) try {
      const labels = await pppNamesFor(conn, suspects);
      if (labels.size) {
        for (const [mac, name] of labels) {
          await pool.query(`update chained_routers set via = $4 where tenant_id=$1 and router_id=$2 and mac=$3`, [r.tenant_id, r.id, mac, `PPPoE customer: ${name}`]);
        }
      }
      await pool.query(`update chained_routers set via = null where tenant_id=$1 and router_id=$2 and via is not null and not (mac = any($3::text[]))`, [r.tenant_id, r.id, [...labels.keys()]]);
    } catch { /* the label column is not there yet (schema not applied): scanning goes on without labels */ }
    const { rows: known } = await pool.query('select * from chained_routers where tenant_id=$1 and router_id=$2 limit $3', [r.tenant_id, r.id, MAX_PER_ROUTER]);
    const byMac = new Map(known.map((k) => [k.mac, k]));
    let added = 0;
    for (const f of found) {
      const have = byMac.get(f.mac);
      if (have) {
        await pool.query(
          `update chained_routers set port=$2, behind=$3, ip=coalesce($4, ip), hostname=coalesce(nullif($5,''), hostname),
                  kind = case when confidence = 'manual' then kind else $6 end,
                  confidence = case when $7 then 'manual' when confidence in ('likely','high') then $8 else confidence end where id=$1`,
          [have.id, f.port, f.behind, f.ip, f.hostname, f.kind, !!r.allPorts, f.confidence]);
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
        // A device seen online by its MAC on a LAN port (listed on the hotspot bridge, or holding a lease) is confirmed: Check turns to Found.
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
      report: light ? null : { seen: analysis.report.slice(0, 80), hostsRead: snap.hosts.length, hotspotOn: snap.hotspotOn, lan: snap.lanBridges ? [...snap.lanBridges] : null, uplink },
      note: light ? `Quick check of ${watching.length} watched device${watching.length === 1 ? '' : 's'} (the full scan of every port runs every 30 minutes, so a busy router is not loaded all day).` : `${r.allPorts ? 'Scanned ALL ports: every bridge port, including the uplink and the PPPoE ports. ' : snap.lanBridges ? `Looked at the hotspot bridge (${[...snap.lanBridges].join(', ')})` : 'Looked at every bridge except the uplink'}${uplink.length ? `, skipped the uplink (${uplink.join(', ')})` : ''}. ${learn ? '' : 'No hotspot on this router, so not looking for new ones. '}Read ${snap.hosts.length} device addresses.${pppMacs.size ? ` Left out ${pppMacs.size} PPPoE customer device${pppMacs.size === 1 ? '' : 's'}.` : ''}${snap.pppPorts?.size ? ` Skipped the PPPoE service port${snap.pppPorts.size === 1 ? '' : 's'} (${[...snap.pppPorts].join(', ')}).` : ''}${snap.bigPorts?.length ? ` Skipped ${snap.bigPorts.map((b) => `${b.port} (${b.count} devices)`).join(', ')}: too many devices to be one router.` : ''}`,
    });
    return { added, watched: byMac.size, down: downNow.length, cleaned, lan: snap.lanBridges ? [...snap.lanBridges] : null, uplink,
      routerId: r.id, seen: analysis.report.slice(0, 60), hostsRead: snap.hosts.length, hotspotOn: snap.hotspotOn, router: r.name };
  } finally {
    if (conn) ros.close(conn);
  }
}

/** The scheduled job: every hotspot router that is up. A router that is down says nothing about what is behind it, so those are "unknown". */
const inFlight = new Map();          // router id -> when its scan started
const MAX_PARALLEL = 4;
// The full scan (every port, every device) happens at most this often per router; in between only the watched devices are checked, by MAC.
const FULL_EVERY = 30 * 60 * 1000;
const lastFull = new Map();

/** Start one router's scan in the background. False when it is already running. */
function launch(r, deps) {
  if (inFlight.has(r.id)) return false;
  inFlight.set(r.id, Date.now());
  void recordScan(r, { running: true, starting: true, note: 'Starting…' });
  (async () => {
    try { await withDeadline(r, deps.ros, pass(r, deps)); } catch (e) {
      console.warn('watchChainedRouters:', r.name, '-', e.message);
      await recordScan(r, { ok: false, note: e.message.startsWith('Gave up') ? e.message : `Could not read the router: ${e.message}` });
    } finally { inFlight.delete(r.id); }
  })();
  return true;
}

export async function watchChainedRouters({ notify }) {
  const { rows: routers } = await pool.query(
    `select r.id, r.tenant_id, r.name, r.host, r.api_port, r.role, r.status, r.service_user, r.service_password_enc
       from routers r left join chained_scans s on s.router_id = r.id
      where r.tenant_id in (${enabledTenants})
      order by coalesce(s.at, 'epoch') asc`, ['watchChainedRouters']);          // the one scanned longest ago first, so a slow router cannot starve the rest
  await pool.query(
    `update chained_routers c set status='unknown', ping_fails=0
       from routers r where r.id = c.router_id and r.status <> 'up' and c.status <> 'unknown'`);
  // a scan the server lost track of (it restarted while one ran) is not running any more
  await pool.query(`update chained_scans set running = false, ok = false, note = 'The scan was interrupted (the server restarted).' where running and router_id <> all($1::uuid[])`, [[...inFlight.keys()]]);
  if (!routers.length) return;
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  for (const r of routers) {
    if (inFlight.has(r.id)) continue;
    if (r.status !== 'up') { await recordScan(r, { ok: false, note: 'The router is down, so it was skipped.' }); continue; }
    if (!r.service_user || !r.service_password_enc) { await recordScan(r, { ok: false, note: 'No login is stored for this router, so billing cannot read it.' }); continue; }
    if (inFlight.size >= MAX_PARALLEL) break;
    r.light = Date.now() - (lastFull.get(r.id) ?? 0) < FULL_EVERY;
    if (!r.light) lastFull.set(r.id, Date.now());
    launch(r, { ros, secrets, notify });
  }
}

/** The Scan button: start a scan of one router now, in the background, without telling anyone. It can take minutes; the screen shows how far it has got. */
export async function scanRouter(tenantId, routerId, opts = {}) {
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
  r.allPorts = !!opts.allPorts;
  lastFull.set(r.id, Date.now());
  const started = launch(r, { ros, secrets, notify: async () => {} });
  return { started, running: true };
}

/** Every router with what its last scan did, so one that is skipped or failing says why. */
export async function listScans(tenantId) {
  const { rows } = await pool.query(
    `select r.id, r.name, r.role, r.status, s.at, s.ok, s.note, s.hosts, s.found, s.watched, coalesce(s.running, false) as running, s.started_at, s.report,
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


/**
 * Which ports of a router are the LAN side and which are not (uplink, PPPoE service ports, other bridges), read the same way a scan reads them. Used to
 * refuse a MAC added by hand that is really on the WAN side. Never throws: an unreadable router gives null and the add goes ahead.
 */
async function portScopeOf(conn) {
  try {
    const soft = (path, query = []) => conn.write(path, query).catch(() => []);
    const IFACE = (type) => soft('/interface/print', [`?type=${type}`, '=.proplist=name,type,comment']);
    const [ether, bridges, vlanIfaces, pppoeOut, hotspots, lists, routes, dhcpClients, pppoe, vlans, bridgePorts, pppoeServers] = await Promise.all([
      IFACE('ether'), IFACE('bridge'), IFACE('vlan'), IFACE('pppoe-out'),
      soft('/ip/hotspot/print', ['=.proplist=interface']),
      soft('/interface/list/member/print', ['=.proplist=list,interface']),
      soft('/ip/route/print', ['?dst-address=0.0.0.0/0', '=.proplist=gateway,immediate-gw,gateway-status,active,disabled']),
      soft('/ip/dhcp-client/print', ['=.proplist=interface']),
      soft('/interface/pppoe-client/print', ['=.proplist=interface']),
      soft('/interface/vlan/print', ['=.proplist=name,interface']),
      soft('/interface/bridge/port/print', ['=.proplist=interface,bridge']),
      soft('/interface/pppoe-server/server/print', ['=.proplist=interface']),
    ]);
    return lanScope({ ifaces: [...ether, ...bridges, ...vlanIfaces, ...pppoeOut], hotspots, lists, routes, dhcpClients, pppoe, vlans, bridgePorts, pppoeServers });
  } catch { return null; }
}

/** Add one by hand (a chained router the scan cannot tell apart). */
export async function addChained(tenantId, { routerId, mac, name, kind }) {
  const mac_ = mac;
  if (!validMac(mac)) throw bad('The MAC address must be 12 hex digits, such as AA:BB:CC:DD:EE:FF (AA-BB-CC-DD-EE-FF or aabbccddeeff also work).');
  const { rows: [r] } = await pool.query('select id, host, api_port, status, service_user, service_password_enc from routers where id=$1 and tenant_id=$2', [routerId, tenantId]);
  if (!r) throw bad('Choose the router it hangs off.');
  // Only a device on the LAN side belongs here: if the router can be asked and the MAC is on its uplink, a PPPoE service port or a bridge that is not the
  // hotspot's, say so instead of adding the ISP's or an upstream device. A MAC the router has not seen (switched off, aged out) is accepted: it cannot be placed.
  if (r.status === 'up' && r.service_user && r.service_password_enc) {
    let conn; let ros;
    try {
      ros = await import('./routeros.js');
      const secrets = await import('./secrets.js');
      conn = await ros.connect({ host: String(r.host).split('/')[0], port: r.api_port ?? 8728, user: r.service_user, password: secrets.decrypt(r.service_password_enc), timeoutSec: 8 });
      const mac = normMac(mac_);
      const rows = (await conn.write('/interface/bridge/host/print', [`?mac-address=${mac}`, '=.proplist=mac-address,on-interface,bridge,local']).catch(() => []))
        .filter((h) => String(h.local) !== 'true');
      if (rows.length) {
        const scope = await portScopeOf(conn);
        if (scope) {
          const wrong = rows.every((h) => scope.wan.has(h['on-interface']) || scope.wan.has(h.bridge) || scope.ppp.has(h['on-interface']) || scope.ppp.has(h.bridge)
            || (scope.lanBridges && h.bridge && !scope.lanBridges.has(h.bridge)));
          if (wrong) throw bad(`${mac} is on ${rows[0]['on-interface']}, which is the uplink side of this router, not a LAN port. Only devices on the LAN side are added.`);
        }
      }
    } catch (e) {
      if (e.status) throw e;                          // our own refusal; a router that could not be read does not block the add
    } finally {
      if (conn) try { ros.close(conn); } catch { /* gone */ }
    }
  }
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
