/**
 * More than one internet link on a router: failover, or weighted load sharing with failover.
 *
 * Two modes.
 *   failover  the first link carries everything; when it stops answering, the next one takes over, and traffic goes back when it returns.
 *   balance   connections are shared across the links by weight (a link with share 2 gets twice the connections of a link with share 1),
 *             and a link that stops answering is left out until it returns.
 *
 * How a link is judged. Asking only "does the next hop answer" misses the usual failure, where the provider's own equipment is up and the
 * internet behind it is not. So each link has a test address on the internet that is reached only through that link (a /32 route), and the
 * default route through the link is hung on that address (a recursive route with check-gateway=ping). The link counts as up while its test
 * address answers.
 *
 * What is written to the router carries a comment starting "ispLb" and nothing else is removed. Three kinds of thing that the operator
 * owns are changed, and each is recorded so that removing the setup puts it back:
 *   - the default routes that were already there are moved to a very high distance (240 and up). They stay as a last resort: if no test
 *     address answers at all, traffic still leaves the way it did before this was set up.
 *   - a DHCP or PPPoE client that installs its own default route has that route's distance raised in the same way.
 *   - in balance mode, fasttrack rules are switched off: a fasttracked packet skips the rules that choose its link.
 *
 * A mistake here cuts the router off from billing, so applying arms a scheduler on the router first that undoes all of it after a few
 * minutes. It is cancelled only when billing has got back in through the new setup.
 */

const TAG = '(managed)';
const LB = 'ispLb';
const tag = (label) => `${LB} ${label} ${TAG}`;
const isMine = (row) => typeof row?.comment === 'string' && row.comment.startsWith(`${LB} `);
const isDynamic = (row) => row?.dynamic !== 'false' && row?.dynamic !== undefined;
const idOf = (row) => row?.['.id'];
const yes = (v) => ['true', 'yes'].includes(String(v ?? '').toLowerCase());

const TUNNELS = ['billing-wg', 'billing-ovpn'];
const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '224.0.0.0/4'];
const PARKED = 240;                    // distance given to the default routes that were there before
const WAN_LIST = 'ispLbWan';
const LOCAL_LIST = 'ispLbLocal';
const REVERT = 'ispLbRevert';
const connMark = (i) => `ispLbC${i + 1}`;
const table = (i) => `ispLbT${i + 1}`;

/** Test addresses offered by default. Chosen because they answer pings and are rarely anyone's main DNS server. */
export const DEFAULT_PROBES = ['1.1.1.2', '149.112.112.112', '1.0.0.2', '208.67.220.220'];
export const MAX_LINKS = 4;

const isIpv4 = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(String(s)) && String(s).split('.').every((x) => Number(x) <= 255);
const ipToInt = (ip) => String(ip).split('.').reduce((n, x) => (n * 256) + Number(x), 0);
function inCidr(ip, cidr) {
  const [net, bitsRaw] = String(cidr).split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!isIpv4(ip) || !isIpv4(net) || !(bits >= 0 && bits <= 32)) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(ipToInt(ip) / size) === Math.floor(ipToInt(net) / size);
}
const isPrivate = (ip) => PRIVATE.some((c) => inCidr(ip, c)) || inCidr(ip, '127.0.0.0/8') || inCidr(ip, '0.0.0.0/8');
/** A name that is safe inside the quoted strings of the undo script the router runs by itself. */
const plainName = (s) => /^[A-Za-z0-9_.\-+ ]{1,60}$/.test(String(s));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Everything the decisions below are made from, read once. Changes nothing. */
export async function read(conn) {
  const soft = (path, args = []) => conn.write(path, args).catch(() => []);
  const [res] = await conn.write('/system/resource/print', []);
  const version = String(res?.version ?? '');
  const major = Number(/^(\d+)/.exec(version)?.[1] ?? 7);
  const [ifaces, addrs, routes, dhcp, pppoe, dnsRows, mangle, filter, nat] = await Promise.all([
    conn.write('/interface/print', []),
    conn.write('/ip/address/print', []),
    conn.write('/ip/route/print', ['?dst-address=0.0.0.0/0']),
    soft('/ip/dhcp-client/print'),
    soft('/interface/pppoe-client/print'),
    soft('/ip/dns/print'),
    conn.write('/ip/firewall/mangle/print', []),
    conn.write('/ip/firewall/filter/print', []),
    conn.write('/ip/firewall/nat/print', []),
  ]);
  const inMain = (r) => (major >= 7 ? String(r['routing-table'] ?? 'main') === 'main' : !r['routing-mark']);
  const mainDefaults = routes.filter(inMain);
  const dns = dnsRows[0] ?? {};
  const dnsServers = [...String(dns.servers ?? '').split(','), ...String(dns['dynamic-servers'] ?? '').split(',')]
    .map((x) => x.trim()).filter(isIpv4);
  return {
    version, major, ifaces, addrs, routes, mainDefaults, dhcp, pppoe, mangle, filter, nat, dnsServers,
    dnsOpen: yes(dns['allow-remote-requests']),
  };
}

/** Which interface a gateway address is reached on: the one holding an address in the same network. */
function ifaceForGateway(st, gateway) {
  const row = st.addrs.find((a) => !yes(a.disabled) && inCidr(gateway, a.address));
  return row?.interface ?? null;
}

/** The links this router already has a way out through, offered as a starting point. */
export function candidates(st) {
  const out = [];
  const seen = new Set();
  const push = (c) => { if (c.iface && !seen.has(c.iface) && !TUNNELS.includes(c.iface)) { seen.add(c.iface); out.push(c); } };
  const statics = st.mainDefaults.filter((r) => !isMine(r) && !isDynamic(r) && !yes(r.disabled))
    .sort((a, b) => Number(a.distance ?? 1) - Number(b.distance ?? 1));
  for (const r of statics) {
    const raw = String(r.gateway ?? '').split(',')[0].trim();
    const [gw, viaIface] = raw.split('%');
    if (isIpv4(gw)) push({ iface: viaIface || ifaceForGateway(st, gw), gateway: gw, kind: 'static' });
    else if (st.ifaces.some((i) => i.name === gw)) push({ iface: gw, gateway: gw, kind: 'static' });
  }
  for (const p of st.pppoe) if (!yes(p.disabled)) push({ iface: p.name, gateway: p.name, kind: 'pppoe' });
  for (const d of st.dhcp) {
    if (yes(d.disabled) || String(d.status ?? '') !== 'bound' || !isIpv4(d.gateway)) continue;
    push({ iface: d.interface, gateway: String(d.gateway), kind: 'dhcp' });
  }
  return out;
}

/** The interfaces a link could be on, for the picker. */
export function interfaces(st) {
  return st.ifaces
    .filter((i) => !TUNNELS.includes(i.name) && !yes(i.dynamic) && !yes(i.slave)
      && !['bridge', 'loopback', 'wg', 'pppoe-in', 'ovpn-out', 'ovpn-in'].includes(String(i.type)))
    .map((i) => ({
      name: i.name, type: i.type, running: yes(i.running), disabled: yes(i.disabled),
      addresses: st.addrs.filter((a) => a.interface === i.name).map((a) => a.address),
    }));
}

/** What is on the router now from an earlier setup, and whether each link is carrying traffic. */
export function live(st) {
  const mine = st.mainDefaults.filter(isMine);
  const links = mine.map((r) => {
    const n = Number(/link (\d+)/.exec(r.comment)?.[1] ?? 0);
    return { n, probe: String(r.gateway ?? ''), up: yes(r.active) && !yes(r.inactive), distance: Number(r.distance ?? 1) };
  }).filter((l) => l.n > 0).sort((a, b) => a.n - b.n);
  const mode = st.mangle.some(isMine) ? 'balance' : 'failover';
  return { active: links.length > 0, mode: links.length ? mode : null, links };
}

/** The request, tidied: at most four links, whole-number shares from 1 to 10, a test address for every link. */
export function normalise(input) {
  const links = (Array.isArray(input?.links) ? input.links : []).slice(0, MAX_LINKS + 1).map((l, i) => ({
    iface: String(l?.iface ?? '').trim(),
    gateway: String(l?.gateway ?? '').trim(),
    weight: Math.min(10, Math.max(1, Math.round(Number(l?.weight) || 1))),
    probe: String(l?.probe ?? '').trim() || DEFAULT_PROBES[i] || '',
  }));
  return { mode: input?.mode === 'balance' ? 'balance' : 'failover', links };
}

/** What stops this setup (blockers) and what the operator should know before pressing Apply (warnings). Changes nothing. */
export function check(st, cfg) {
  const blockers = []; const warnings = [];
  const { links, mode } = cfg;
  if (links.length < 2) blockers.push('Add at least two links.');
  if (links.length > MAX_LINKS) blockers.push(`At most ${MAX_LINKS} links.`);
  const names = new Set(st.ifaces.map((i) => i.name));
  const usedIf = new Set(); const usedProbe = new Set();
  links.forEach((l, i) => {
    const n = i + 1;
    const row = st.ifaces.find((x) => x.name === l.iface);
    if (!l.iface || !names.has(l.iface)) return blockers.push(`Link ${n}: choose the interface it is on.`);
    if (TUNNELS.includes(l.iface)) return blockers.push(`Link ${n}: ${l.iface} is the tunnel to billing, not an internet link.`);
    if (!plainName(l.iface)) return blockers.push(`Link ${n}: the interface name "${l.iface}" has characters this cannot work with. Rename the interface on the router first.`);
    if (usedIf.has(l.iface)) blockers.push(`Link ${n}: ${l.iface} is already used by another link.`);
    usedIf.add(l.iface);
    const pointToPoint = /ppp|lte|l2tp|sstp/.test(String(row?.type ?? ''));
    if (isIpv4(l.gateway)) {
      if (!pointToPoint && ifaceForGateway(st, l.gateway) !== l.iface)
        warnings.push(`Link ${n}: no address on ${l.iface} is in the same network as the gateway ${l.gateway}. Check the gateway.`);
    } else if (l.gateway === l.iface && pointToPoint) {
      // a dial-up link: the interface is its own gateway
    } else {
      blockers.push(`Link ${n}: enter the gateway address the provider gave for ${l.iface}${pointToPoint ? `, or ${l.iface} itself` : ''}.`);
    }
    if (!isIpv4(l.probe) || isPrivate(l.probe)) blockers.push(`Link ${n}: the test address must be a public internet address, for example ${DEFAULT_PROBES[i] ?? '1.1.1.2'}.`);
    else {
      if (usedProbe.has(l.probe)) blockers.push(`Link ${n}: every link needs its own test address; ${l.probe} is used twice.`);
      usedProbe.add(l.probe);
      if (st.dnsServers.includes(l.probe))
        blockers.push(`Link ${n}: ${l.probe} is one of this router's own DNS servers. A test address is reached through one link only, so the router would lose that DNS server whenever link ${n} is down. Choose another.`);
      if (links.some((o) => o.gateway === l.probe)) blockers.push(`Link ${n}: the test address cannot be a gateway.`);
    }
    if (row && !yes(row.running)) warnings.push(`Link ${n}: ${l.iface} is not running right now, so it will start out as down.`);
    if (st.dhcp.some((d) => d.interface === l.iface && !yes(d.disabled)))
      warnings.push(`Link ${n}: ${l.iface} gets its address by DHCP. If the provider changes the gateway from ${l.gateway}, this link is treated as down until you apply again.`);
  });
  if (mode === 'balance') {
    const foreign = st.mangle.filter((r) => !isMine(r) && !yes(r.disabled) && !isDynamic(r)
      && ['mark-connection', 'mark-routing'].includes(String(r.action))
      && String(r['new-connection-mark'] ?? '') !== 'ispSniOk');
    if (foreign.length)
      blockers.push(`This router already marks connections or routes for something else (${foreign.length} mangle rule${foreign.length === 1 ? '' : 's'} not made by billing). Sharing the load would fight with them. Use failover only, or remove those rules first.`);
    const fast = st.filter.filter((r) => String(r.action) === 'fasttrack-connection' && !yes(r.disabled));
    if (fast.length) warnings.push(`Fasttrack will be switched off (${fast.length} rule${fast.length === 1 ? '' : 's'}): it skips the rules that choose a link. The router's processor will work somewhat harder.`);
  }
  if (st.pppoe.some((p) => yes(p['add-default-route']) && Number(p['default-route-distance'] ?? 1) < PARKED))
    warnings.push('A PPPoE uplink has its own default route. Changing it may make that uplink reconnect once, for a few seconds.');
  if (links.length > 1)
    warnings.push('Firewall rules you wrote for the first link by its interface name do not cover the other links. Check that the router is not left open on them.');
  return { blockers, warnings };
}

/** The shares as whole slots: shares 2 and 1 become three slots, two for the first link and one for the second. */
function slots(links) {
  const g = links.map((l) => l.weight).reduce(gcd);
  const out = [];
  links.forEach((l, i) => { for (let k = 0; k < l.weight / g; k++) out.push(i); });
  return out;
}

/** What Apply will do, in words, for the preview. */
export function describe(st, cfg) {
  const lines = [];
  const { links, mode } = cfg;
  links.forEach((l, i) => lines.push(`Link ${i + 1} is ${l.iface} through ${l.gateway}. It counts as up while ${l.probe} answers through it.`));
  if (mode === 'balance') {
    const total = slots(links).length;
    const share = links.map((l, i) => `link ${i + 1} about ${Math.round((slots(links).filter((x) => x === i).length / total) * 100)}%`).join(', ');
    lines.push(`New connections are shared: ${share}. One customer talking to one site stays on one link.`);
    lines.push('A link that stops answering is left out, and its connections move to the links that are up.');
  } else {
    lines.push(`Everything uses link 1. If it stops answering, link 2 takes over${links.length > 2 ? ', then the next' : ''}, and traffic returns to link 1 when it is back.`);
  }
  lines.push("The router's own traffic, including the tunnel to billing, uses link 1 and fails over in the same order.");
  const parked = st.mainDefaults.filter((r) => !isMine(r) && !isDynamic(r) && !yes(r.disabled) && Number(r.distance ?? 1) < PARKED).length;
  if (parked) lines.push(`The ${parked === 1 ? 'default route' : `${parked} default routes`} already on the router ${parked === 1 ? 'is' : 'are'} kept as a last resort (distance ${PARKED}), and put back when you remove this.`);
  const needNat = links.filter((l) => !hasMasquerade(st, l.iface)).map((l) => l.iface);
  if (needNat.length) lines.push(`NAT (masquerade) is added on ${needNat.join(', ')}.`);
  if (st.dnsOpen) lines.push('DNS queries arriving from the internet on each link are dropped, so the router is not an open resolver on the new links.');
  lines.push('If billing cannot reach the router after applying, the router undoes all of it by itself within 5 minutes.');
  return lines;
}

/** Is traffic leaving through this interface already masqueraded by a rule that covers every source? */
function hasMasquerade(st, iface) {
  return st.nat.some((r) => !isMine(r) && String(r.chain) === 'srcnat' && String(r.action) === 'masquerade' && !yes(r.disabled)
    && !r['src-address'] && !r['src-address-list']
    && (String(r['out-interface'] ?? '') === iface || (!r['out-interface'] && !r['out-interface-list'])));
}

/**
 * What must be put back when this is removed: the distance each existing default route had, and the fasttrack rules that were on.
 * A route that is already parked from an earlier setup keeps the original distance recorded then.
 */
function planUndo(st, cfg, previous) {
  const prev = previous ?? {};
  const original = (now, was) => (now >= PARKED && was != null ? Number(was) : now >= PARKED ? 1 : now);
  const routes = []; const dhcp = []; const pppoe = [];
  for (const r of st.mainDefaults) {
    if (isMine(r) || isDynamic(r) || yes(r.disabled)) continue;
    const gateway = String(r.gateway ?? '');
    if (!gateway || routes.some((x) => x.gateway === gateway)) continue;
    routes.push({ gateway, distance: original(Number(r.distance ?? 1), (prev.routes ?? []).find((x) => x.gateway === gateway)?.distance) });
  }
  for (const d of st.dhcp) {
    const adds = String(d['add-default-route'] ?? 'yes').toLowerCase();
    if (adds === 'no' || adds === 'false' || !plainName(d.interface)) continue;
    dhcp.push({ iface: d.interface, distance: original(Number(d['default-route-distance'] ?? 1), (prev.dhcp ?? []).find((x) => x.iface === d.interface)?.distance) });
  }
  for (const p of st.pppoe) {
    if (!yes(p['add-default-route']) || !plainName(p.name)) continue;
    pppoe.push({ name: p.name, distance: original(Number(p['default-route-distance'] ?? 1), (prev.pppoe ?? []).find((x) => x.name === p.name)?.distance) });
  }
  const stillThere = new Set(st.filter.map(idOf));
  const wasOn = (prev.fasttrack ?? []).filter((id) => stillThere.has(id));
  const onNow = st.filter.filter((r) => String(r.action) === 'fasttrack-connection' && !yes(r.disabled)).map(idOf);
  const fasttrack = cfg.mode === 'balance' ? [...new Set([...wasOn, ...onNow])] : [];
  return { routes, dhcp, pppoe, fasttrack, fasttrackBack: cfg.mode === 'balance' ? [] : wasOn };
}

const MENUS = [
  ['/ip/firewall/mangle', []], ['/ip/route', []], ['/routing/table', []], ['/ip/firewall/nat', []], ['/ip/firewall/filter', []],
  ['/ip/firewall/address-list', [`?list=${LOCAL_LIST}`]], ['/interface/list/member', [`?list=${WAN_LIST}`]], ['/interface/list', [`?name=${WAN_LIST}`]],
];

/** Remove everything this module wrote. Never touches a row that does not carry its comment. */
async function clear(conn) {
  let removed = 0;
  for (const [path, query] of MENUS) {
    let rows;
    try { rows = await conn.write(`${path}/print`, query); } catch { continue; }   // /routing/table does not exist on RouterOS 6
    for (const r of rows.filter((x) => isMine(x) && !isDynamic(x))) {
      await conn.write(`${path}/remove`, [`=.id=${idOf(r)}`]);
      removed += 1;
    }
  }
  return removed;
}

/** Put the operator's own default routes and fasttrack rules back the way they were. A dial-up uplink goes last: changing it can drop the connection this runs over. */
async function restore(conn, undo) {
  const u = undo ?? {};
  const notes = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (e) { notes.push(`${what}: ${e.message}`); } };
  const routes = await conn.write('/ip/route/print', ['?dst-address=0.0.0.0/0']);
  for (const r of routes) {
    if (isMine(r) || isDynamic(r) || Number(r.distance ?? 1) < PARKED) continue;
    const was = (u.routes ?? []).find((x) => x.gateway === String(r.gateway ?? ''))?.distance ?? 1;
    await attempt(`default route through ${r.gateway}`, () => conn.write('/ip/route/set', [`=.id=${idOf(r)}`, `=distance=${was}`]));
  }
  for (const d of await conn.write('/ip/dhcp-client/print', []).catch(() => [])) {
    if (Number(d['default-route-distance'] ?? 1) < PARKED) continue;
    const was = (u.dhcp ?? []).find((x) => x.iface === d.interface)?.distance ?? 1;
    await attempt(`DHCP client on ${d.interface}`, () => conn.write('/ip/dhcp-client/set', [`=.id=${idOf(d)}`, `=default-route-distance=${was}`]));
  }
  for (const id of [...(u.fasttrack ?? []), ...(u.fasttrackBack ?? [])]) {
    await attempt('fasttrack rule', () => conn.write('/ip/firewall/filter/set', [`=.id=${id}`, '=disabled=no']));
  }
  for (const p of await conn.write('/interface/pppoe-client/print', []).catch(() => [])) {
    if (Number(p['default-route-distance'] ?? 1) < PARKED) continue;
    const was = (u.pppoe ?? []).find((x) => x.name === p.name)?.distance ?? 1;
    await attempt(`PPPoE uplink ${p.name}`, () => conn.write('/interface/pppoe-client/set', [`=.id=${idOf(p)}`, `=default-route-distance=${was}`]));
  }
  return notes;
}

/** The same undo, as a script the router runs by itself if billing never comes back to cancel it. */
function revertScript(undo) {
  const safely = (c) => `:do { ${c} } on-error={}`;
  const mine = `[find comment~"^${LB} "]`;
  const lines = [
    `/ip firewall mangle remove ${mine}`, `/ip route remove ${mine}`, `/routing table remove ${mine}`, `/ip firewall nat remove ${mine}`,
    `/ip firewall filter remove ${mine}`, `/ip firewall address-list remove ${mine}`, `/interface list member remove ${mine}`, `/interface list remove ${mine}`,
  ];
  for (const r of undo.routes) {
    if (!/^[A-Za-z0-9_.\-+% ]{1,80}$/.test(r.gateway)) continue;
    lines.push(`/ip route set [find where dst-address="0.0.0.0/0" and gateway="${r.gateway}" and dynamic=no] distance=${Number(r.distance) || 1}`);
  }
  for (const d of undo.dhcp) lines.push(`/ip dhcp-client set [find interface="${d.iface}"] default-route-distance=${Number(d.distance) || 1}`);
  for (const id of [...undo.fasttrack, ...(undo.fasttrackBack ?? [])]) if (/^\*[0-9A-Fa-f]+$/.test(String(id))) lines.push(`/ip firewall filter enable ${id}`);
  for (const p of undo.pppoe) lines.push(`/interface pppoe-client set [find name="${p.name}"] default-route-distance=${Number(p.distance) || 1}`);
  return `${lines.map(safely).join('; ')}; /system scheduler remove [find name=${REVERT}]`;
}

async function disarm(conn) {
  for (const old of await conn.write('/system/scheduler/print', [`?name=${REVERT}`])) {
    await conn.write('/system/scheduler/remove', [`=.id=${idOf(old)}`]);
  }
}

/** Arm the undo on the router's own clock. Returns the router time it will run at. */
async function arm(conn, undo, minutes) {
  const clock = (await conn.write('/system/clock/print', []))[0] ?? {};
  const [hh, mm, ss] = String(clock.time ?? '00:00:00').split(':').map((x) => Number(x) || 0);
  const at = ((hh * 3600) + (mm * 60) + ss + (minutes * 60)) % 86400;
  const when = [Math.floor(at / 3600), Math.floor((at % 3600) / 60), at % 60].map((x) => String(x).padStart(2, '0')).join(':');
  await disarm(conn);
  await conn.write('/system/scheduler/add', [
    `=name=${REVERT}`, `=start-time=${when}`, '=interval=1d', '=policy=read,write,policy,test',
    `=on-event=${revertScript(undo)}`, `=comment=${tag('undoes the link setup unless billing confirms it')}`,
  ]);
  return when;
}

/** Billing got back in through the new setup: the undo is no longer wanted. */
export async function confirm(conn) { await disarm(conn); }

/**
 * Write the setup. The order keeps a working way out at every moment: the new routes are added beside the old ones, the old ones are
 * moved out of the way only after that, and the rules that steer traffic go in last, when every route they point at exists.
 */
export async function apply(conn, cfg, { previousUndo = null, revertMinutes = 5 } = {}) {
  const st = await read(conn);
  const review = check(st, cfg);
  if (review.blockers.length) throw Object.assign(new Error(review.blockers[0]), { refused: true });
  const { links, mode } = cfg;
  const undo = planUndo(st, cfg, previousUndo);
  const notes = [];
  const revertAt = await arm(conn, undo, revertMinutes);
  const add = async (label, path, fields) => {
    try { return await conn.write(`${path}/add`, fields); } catch (e) { e.message = `${label}: ${e.message}`; throw e; }
  };

  try {
    await clear(conn);   // an earlier setup on this router; its parked routes carry traffic meanwhile

    if (mode === 'balance') {
      await add('interface list', '/interface/list', [`=name=${WAN_LIST}`, `=comment=${tag('internet links and tunnels')}`]);
      const members = [...links.map((l) => l.iface), ...TUNNELS.filter((t) => st.ifaces.some((i) => i.name === t))];
      for (const m of members) await add(`list member ${m}`, '/interface/list/member', [`=list=${WAN_LIST}`, `=interface=${m}`, `=comment=${tag('link or tunnel')}`]);
      const local = [...PRIVATE];
      for (const a of st.addrs) {
        const [ip, bits] = String(a.address ?? '').split('/');
        if (!isIpv4(ip) || !isIpv4(a.network) || isPrivate(ip)) continue;
        const cidr = `${a.network}/${bits ?? 32}`;
        if (!local.includes(cidr)) local.push(cidr);
      }
      for (const c of local) await add(`local network ${c}`, '/ip/firewall/address-list', [`=list=${LOCAL_LIST}`, `=address=${c}`, `=comment=${tag('not sent out through a chosen link')}`]);
      if (st.major >= 7) {
        for (let i = 0; i < links.length; i++) {
          const fields = [`=name=${table(i)}`, `=comment=${tag(`table link ${i + 1}`)}`];
          try { await conn.write('/routing/table/add', [...fields, '=fib=']); }
          catch { await add(`routing table link ${i + 1}`, '/routing/table', [...fields, '=fib=yes']); }
        }
      }
    }

    // The test address of each link, reachable only through that link.
    for (let i = 0; i < links.length; i++) {
      await add(`test route link ${i + 1}`, '/ip/route', [`=dst-address=${links[i].probe}/32`, `=gateway=${links[i].gateway}`, '=scope=10', `=comment=${tag(`test address link ${i + 1}`)}`]);
    }
    if (mode === 'balance') {
      for (let i = 0; i < links.length; i++) {
        await add(`route for link ${i + 1}`, '/ip/route', [
          '=dst-address=0.0.0.0/0', `=gateway=${links[i].probe}`, '=check-gateway=ping', '=target-scope=11', '=distance=1',
          st.major >= 7 ? `=routing-table=${table(i)}` : `=routing-mark=${table(i)}`, `=comment=${tag(`only link ${i + 1}`)}`,
        ]);
      }
    }
    for (let i = 0; i < links.length; i++) {
      if (!hasMasquerade(st, links[i].iface)) {
        await add(`NAT on ${links[i].iface}`, '/ip/firewall/nat', ['=chain=srcnat', `=out-interface=${links[i].iface}`, '=action=masquerade', `=comment=${tag(`NAT link ${i + 1}`)}`]);
      }
    }
    if (st.dnsOpen) {
      // The router answers DNS for its customers; it must not answer the whole internet on a link nobody wrote a firewall for.
      try {
        for (let i = 0; i < links.length; i++) {
          for (const proto of ['udp', 'tcp']) {
            await conn.write('/ip/firewall/filter/add', ['=chain=input', `=in-interface=${links[i].iface}`, `=protocol=${proto}`, '=dst-port=53', '=action=drop', `=comment=${tag(`DNS from the internet link ${i + 1} ${proto}`)}`]);
          }
        }
        const rows = await conn.write('/ip/firewall/filter/print', []);
        const top = rows.find((r) => !isDynamic(r));
        for (const r of rows.filter(isMine)) {
          if (top && idOf(r) !== idOf(top)) await conn.write('/ip/firewall/filter/move', [`=numbers=${idOf(r)}`, `=destination=${idOf(top)}`]);
        }
      } catch (e) {
        notes.push(`The rules that keep DNS closed to the internet on the new links could not be placed (${e.message}). Check the router's input firewall.`);
      }
    }

    // The way out for everything that is not steered: link 1, then the next, in order.
    for (let i = 0; i < links.length; i++) {
      await add(`default route link ${i + 1}`, '/ip/route', [
        '=dst-address=0.0.0.0/0', `=gateway=${links[i].probe}`, '=check-gateway=ping', '=target-scope=11', `=distance=${i + 1}`,
        `=comment=${tag(`default via link ${i + 1}`)}`,
      ]);
    }

    // Only now are the routes that were there before moved out of the way.
    let park = PARKED;
    for (const r of st.mainDefaults) {
      if (isMine(r) || isDynamic(r) || yes(r.disabled) || Number(r.distance ?? 1) >= PARKED) continue;
      await conn.write('/ip/route/set', [`=.id=${idOf(r)}`, `=distance=${Math.min(park++, 254)}`]);
    }
    for (const d of st.dhcp) {
      if (!undo.dhcp.some((x) => x.iface === d.interface) || Number(d['default-route-distance'] ?? 1) >= PARKED) continue;
      await conn.write('/ip/dhcp-client/set', [`=.id=${idOf(d)}`, `=default-route-distance=${Math.min(park++, 254)}`]);
    }

    for (const id of undo.fasttrackBack) await conn.write('/ip/firewall/filter/set', [`=.id=${id}`, '=disabled=no']).catch(() => {});
    if (mode === 'balance') {
      for (const id of undo.fasttrack) await conn.write('/ip/firewall/filter/set', [`=.id=${id}`, '=disabled=yes']);
      const m = (label, fields) => add(`mangle ${label}`, '/ip/firewall/mangle', [...fields, `=comment=${tag(label)}`]);
      // A connection that arrives from the internet on a link is answered on the same link.
      for (let i = 0; i < links.length; i++) {
        await m(`arrived on link ${i + 1}`, ['=chain=prerouting', `=in-interface=${links[i].iface}`, '=connection-state=new', '=connection-mark=no-mark',
          '=action=mark-connection', `=new-connection-mark=${connMark(i)}`, '=passthrough=yes']);
      }
      // A new connection from a customer to the internet is given a link, by share.
      const order = slots(links);
      for (let s = 0; s < order.length; s++) {
        await m(`share ${s + 1} of ${order.length} to link ${order[s] + 1}`, ['=chain=prerouting', `=in-interface-list=!${WAN_LIST}`, '=connection-mark=no-mark',
          '=dst-address-type=!local', `=dst-address-list=!${LOCAL_LIST}`, `=per-connection-classifier=both-addresses:${order.length}/${s}`,
          '=action=mark-connection', `=new-connection-mark=${connMark(order[s])}`, '=passthrough=yes']);
      }
      // Every packet of the connection then leaves through its link.
      for (let i = 0; i < links.length; i++) {
        await m(`customers out link ${i + 1}`, ['=chain=prerouting', `=in-interface-list=!${WAN_LIST}`, `=connection-mark=${connMark(i)}`,
          `=dst-address-list=!${LOCAL_LIST}`, '=action=mark-routing', `=new-routing-mark=${table(i)}`, '=passthrough=yes']);
      }
      // The router's own answers to the internet. Never an answer to a customer: that must go back to the customer, not out of a link.
      for (let i = 0; i < links.length; i++) {
        await m(`router answers link ${i + 1}`, ['=chain=output', `=connection-mark=${connMark(i)}`, `=dst-address-list=!${LOCAL_LIST}`,
          '=action=mark-routing', `=new-routing-mark=${table(i)}`, '=passthrough=yes']);
      }
    }
  } catch (e) {
    await clear(conn).catch(() => {});
    await restore(conn, undo).catch(() => {});
    await disarm(conn).catch(() => {});
    throw e;
  }

  // Last, because it can make a dial-up uplink reconnect and drop the connection this runs over. Everything else is already in place.
  for (const p of st.pppoe) {
    if (!undo.pppoe.some((x) => x.name === p.name) || Number(p['default-route-distance'] ?? 1) >= PARKED) continue;
    try { await conn.write('/interface/pppoe-client/set', [`=.id=${idOf(p)}`, `=default-route-distance=${PARKED + 10}`]); }
    catch (e) { notes.push(`The default route of the PPPoE uplink ${p.name} may not have been moved out of the way (${e.message}).`); }
  }
  return { undo, revertAt, notes, warnings: review.warnings };
}

/** Take the setup off the router and put the operator's own routes back. */
export async function remove(conn, undo) {
  // The setup goes first: the parked routes carry traffic the moment it is gone. Putting distances back comes after, and the dial-up
  // uplink last of all, because that one can drop the connection this runs over.
  await disarm(conn).catch(() => {});
  const removed = await clear(conn);
  const notes = await restore(conn, undo);
  return { removed, notes };
}

/**
 * One light reading for the watcher: which links are carrying traffic, and the byte counters of their interfaces. Null when the setup is
 * no longer on the router. Reads two tables only, because it runs every couple of minutes on every such router.
 */
export async function sample(conn, cfg) {
  const [routes, stats] = await Promise.all([
    conn.write('/ip/route/print', ['?dst-address=0.0.0.0/0']),
    conn.write('/interface/print', ['=stats=']).catch(() => []),
  ]);
  const mine = routes.filter((r) => isMine(r) && /default via link \d+/.test(r.comment));
  if (!mine.length) return null;
  const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  return (cfg?.links ?? []).map((l, i) => {
    const route = mine.find((r) => Number(/link (\d+)/.exec(r.comment)?.[1]) === i + 1);
    const s = stats.find((x) => x.name === l.iface);
    return { n: i + 1, iface: l.iface, up: !!route && yes(route.active) && !yes(route.inactive), rx: num(s?.['rx-byte']), tx: num(s?.['tx-byte']) };
  });
}
