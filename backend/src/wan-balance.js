/**
 * More than one internet link on a router: failover, or weighted load sharing with failover.
 *
 * Two modes.
 *   balance   connections are shared across the links by weight (a link with share 2 gets twice the connections of a link with share 1),
 *             and a link that stops answering is left out until it returns.
 *   failover  the first link carries everything; when it stops answering, the next one takes over, and traffic goes back when it returns.
 *
 * Three kinds of link, and each can be one the router already has or one this sets up.
 *   static  an address on a port and the provider's gateway. The address is added if the port does not have it.
 *   dhcp    a DHCP client on a port. Made if the port has none. The gateway is whatever the provider hands out, and a small script on the
 *           client keeps this link's test route pointed at it when the provider changes it.
 *   pppoe   a PPPoE client on a port, with the provider's username and password. Made if the port has none. The password goes to the
 *           router only; it is never stored by billing.
 *
 * How a link is judged. Asking only "does the next hop answer" misses the usual failure, where the provider's own equipment is up and the
 * internet behind it is not. So each link has a test address on the internet that is reached only through that link (a /32 route), and the
 * default route through the link is hung on that address (a recursive route with check-gateway=ping). The link counts as up while its test
 * address answers.
 *
 * Keeping connections alive.
 *   - Replies to connections that are already open are accepted on every link, and packets that belong to no connection are dropped, so
 *     a firewall written for one link does not strangle the others.
 *   - A connection keeps the address of the link it started on. When that link dies, or comes back, such a connection would be sent out
 *     of another link with the wrong address and hang for minutes. A watcher on the router clears those connections so they start again
 *     on a working link.
 *   - A PPPoE uplink carries smaller packets; TCP is told so (MSS clamp), or large pages stall.
 *   - Optionally, the router itself is closed to new connections from the internet on these links (ping stays open).
 *
 * What is written to the router carries a comment starting "ispLb" and nothing else is removed. Things the operator owns that are changed
 * are recorded, so removing the setup puts them back: the default routes that were there (moved to distance 240 and up, where they stay as
 * a last resort), the default route of an existing DHCP or PPPoE client, the script of an existing DHCP client, and fasttrack rules
 * (switched off in balance mode, because a fasttracked packet skips the rules that choose its link).
 *
 * A mistake here cuts the router off from billing, so applying arms a scheduler on the router first that undoes all of it after a few
 * minutes. It is cancelled only when billing has got back in through the new setup.
 */

const TAG = '(managed)';
const LB = 'ispLb';
const tag = (label) => `${LB} ${label} ${TAG}`;
const isMine = (row) => typeof row?.comment === 'string' && row.comment.startsWith(`${LB} `);
/** An uplink this made (an address, a DHCP client, a PPPoE client). It outlives a change of settings and goes only when the setup is removed. */
const isUplink = (row) => isMine(row) && row.comment.startsWith(`${LB} uplink `);
const isDynamic = (row) => row?.dynamic !== 'false' && row?.dynamic !== undefined;
const idOf = (row) => row?.['.id'];
const yes = (v) => ['true', 'yes'].includes(String(v ?? '').toLowerCase());

const TUNNELS = ['billing-wg', 'billing-ovpn'];
const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '224.0.0.0/4'];
const PARKED = 240;                    // distance given to the default routes that were there before
const WAN_LIST = 'ispLbWan';
const LOCAL_LIST = 'ispLbLocal';
const REVERT = 'ispLbRevert';
const TYPES = ['static', 'dhcp', 'pppoe'];
const connMark = (i) => `ispLbC${i + 1}`;
const table = (i) => `ispLbT${i + 1}`;

/** Test addresses offered by default. Chosen because they answer pings and are rarely anyone's main DNS server. */
export const DEFAULT_PROBES = ['1.1.1.2', '149.112.112.112', '1.0.0.2', '208.67.220.220'];
export const MAX_LINKS = 4;
/** A second test address per link. A link counts as down only when both stop answering, so one of them having a bad day changes nothing. */
export const DEFAULT_PROBES2 = ['9.9.9.10', '149.112.112.10', '208.67.222.123', '76.76.2.0'];
const pinSrc = (i) => `ispLbPinSrc${i + 1}`;
const pinDst = (i) => `ispLbPinDst${i + 1}`;
const watchName = (n) => `ispLbWatch${n}`;

/**
 * The script the router runs every 15 seconds for one link. It does three things the routes cannot do by themselves.
 *   - Hold-down. A link that stopped answering is taken out (its default routes are disabled), and it is put back only after it has
 *     answered on every round for the hold time. A link that flaps is therefore not used until it is steady, instead of dragging
 *     customers back and forth each time it blinks.
 *   - It asks both test addresses, and only calls the link dead when neither answers, twice in a row.
 *   - It clears the connections tied to the link when it is taken out or put back, so they start again on a working link.
 * The counters are global variables. If a router did not keep them between runs, the counts would never reach their thresholds and the
 * script would simply never act; the routes' own ping check would still fail the link over. It cannot get a link stuck out by miscounting.
 */
function watchScript(i, link, cfg) {
  const n = i + 1;
  const routes = `[find where comment~"^${LB} (default via|only) link ${n} "]`;
  const need = Math.max(1, cfg.hold * 4);
  let wipe;
  if (cfg.mode === 'balance') wipe = `:do { /ip firewall connection remove [find connection-mark=${connMark(i)}] } on-error={}`;
  else if (n === 1) wipe = ':do { /ip firewall connection remove [find where srcnat] } on-error={}';
  else {
    // Failover: connections only need restarting when this link is, or becomes, the one in use: when no link ahead of it is working.
    const ahead = Array.from({ length: n - 1 }, (_, k) => k + 1).join('|');
    wipe = `:do { :if ([:len [/ip route find where comment~"^${LB} default via link (${ahead}) " and active=yes]] = 0) do={ /ip firewall connection remove [find where srcnat] } } on-error={}`;
  }
  const second = link.probe2 ? ` :if (!$alive) do={ :if ([/ping ${link.probe2} count=2] > 0) do={ :set alive true } };` : '';
  return [
    `:global ispLbOk${n}; :global ispLbBad${n};`,
    `:if ([:typeof $ispLbOk${n}] != "num") do={ :set ispLbOk${n} 0 };`,
    `:if ([:typeof $ispLbBad${n}] != "num") do={ :set ispLbBad${n} 0 };`,
    `:local alive false; :if ([/ping ${link.probe} count=2] > 0) do={ :set alive true };${second}`,
    `:local held ([:len [/ip route find where comment~"^${LB} (default via|only) link ${n} " and disabled=yes]] > 0);`,
    `:if ($alive) do={ :set ispLbBad${n} 0; :if ($held) do={ :set ispLbOk${n} ($ispLbOk${n} + 1); :if ($ispLbOk${n} >= ${need}) do={ :set ispLbOk${n} 0; /ip route enable ${routes}; :delay 12s; ${wipe}; :log warning "ispLb: internet link ${n} is steady again and back in use" } } }`,
    `else={ :set ispLbOk${n} 0; :if (!$held) do={ :set ispLbBad${n} ($ispLbBad${n} + 1); :if ($ispLbBad${n} >= 2) do={ :set ispLbBad${n} 0; /ip route disable ${routes}; ${wipe}; :log warning "ispLb: internet link ${n} stopped answering and is held out" } } }`,
  ].join(' ');
}

/** Policy-routing rules live in a different menu on RouterOS 6 and 7. Returns the one this router has, with its rows. */
async function ruleMenu(conn) {
  try { return { path: '/routing/rule', rows: await conn.write('/routing/rule/print', []) }; }
  catch { return { path: '/ip/route/rule', rows: await conn.write('/ip/route/rule/print', []) }; }
}

/** The address each link has right now on the interface its traffic leaves through. */
async function ownAddresses(conn, links) {
  const addrs = await conn.write('/ip/address/print', []);
  return links.map((l) => {
    const iface = l.out ?? l.iface;
    const row = addrs.find((a) => a.interface === iface && !yes(a.disabled) && !yes(a.invalid));
    const ip = String(row?.address ?? '').split('/')[0];
    return isIpv4(ip) ? ip : null;
  });
}

/**
 * Traffic the router itself sends from a link's own address leaves by that link (a service answering on that address, a tunnel bound to
 * it). Without this such traffic follows the main route and can leave by the other provider, who drops it as not theirs. Traffic to the
 * customers' side is told to stay on the main table first, so an answer to a customer is never pushed out of a link.
 */
async function ownAddressRules(conn, links) {
  const { path } = await ruleMenu(conn);
  for (const c of PRIVATE.filter((x) => x !== '224.0.0.0/4')) {
    await conn.write(`${path}/add`, [`=dst-address=${c}`, '=action=lookup', '=table=main', `=comment=${tag('local stays local')}`]);
  }
  const ips = await ownAddresses(conn, links);
  for (let i = 0; i < links.length; i++) {
    if (!ips[i]) continue;   // a dial-up link that is not connected yet: the watcher in billing adds it once it has an address
    await conn.write(`${path}/add`, [`=src-address=${ips[i]}/32`, '=action=lookup', `=table=${table(i)}`, `=comment=${tag(`own address link ${i + 1}`)}`]);
  }
}

/**
 * A DHCP or PPPoE link's address changes when the provider says so. Billing's watcher calls this on every pass and brings the
 * "own address" rules up to date. Changes nothing when they already match.
 */
export async function refreshOwnAddress(conn, cfg) {
  if (cfg?.mode !== 'balance') return 0;
  const { path, rows } = await ruleMenu(conn);
  if (!rows.some((r) => isMine(r) && /local stays local/.test(r.comment))) return 0;   // set up before these rules existed: left alone
  const ips = await ownAddresses(conn, cfg.links);
  let changed = 0;
  for (let i = 0; i < cfg.links.length; i++) {
    const rule = rows.find((r) => isMine(r) && new RegExp(`own address link ${i + 1} `).test(r.comment));
    const have = String(rule?.['src-address'] ?? '').split('/')[0];
    if (!ips[i] || have === ips[i]) continue;
    if (rule) await conn.write(`${path}/set`, [`=.id=${idOf(rule)}`, `=src-address=${ips[i]}/32`]);
    else await conn.write(`${path}/add`, [`=src-address=${ips[i]}/32`, '=action=lookup', `=table=${table(i)}`, `=comment=${tag(`own address link ${i + 1}`)}`]);
    changed += 1;
  }
  return changed;
}

const isIpv4 = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(String(s)) && String(s).split('.').every((x) => Number(x) <= 255);
const isCidr = (s) => { const [ip, bits] = String(s).split('/'); return isIpv4(ip) && /^\d{1,2}$/.test(bits ?? '') && Number(bits) >= 8 && Number(bits) <= 32; };
const ipToInt = (ip) => String(ip).split('.').reduce((n, x) => (n * 256) + Number(x), 0);
function inCidr(ip, cidr) {
  const [net, bitsRaw] = String(cidr).split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!isIpv4(ip) || !isIpv4(net) || !(bits >= 0 && bits <= 32)) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(ipToInt(ip) / size) === Math.floor(ipToInt(net) / size);
}
const isPrivate = (ip) => PRIVATE.some((c) => inCidr(ip, c)) || inCidr(ip, '127.0.0.0/8') || inCidr(ip, '0.0.0.0/8');
/** A name that is safe inside the quoted strings of the scripts the router runs by itself. */
const plainName = (s) => /^[A-Za-z0-9_.\-+ ]{1,60}$/.test(String(s));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const row = st.addrs.find((a) => !yes(a.disabled) && (inCidr(gateway, a.address) || a.network === gateway));
  return row?.interface ?? null;
}

/** Which interface a default route leaves through, from whichever field this RouterOS fills in. */
function routeInterface(st, r) {
  const names = new Set(st.ifaces.map((i) => i.name));
  const raw = String(r.gateway ?? '').split(',')[0].trim();
  const [gw, pinned] = raw.split('%');
  const tries = [
    pinned,
    String(r['immediate-gw'] ?? '').split('%')[1],                       // RouterOS 7: "41.90.1.1%ether1"
    /via\s+(\S+)\s*$/.exec(String(r['gateway-status'] ?? ''))?.[1],      // RouterOS 6: "41.90.1.1 reachable via ether1"
    names.has(gw) ? gw : null,                                           // a dial-up route names the interface itself
    isIpv4(gw) ? ifaceForGateway(st, gw) : null,
  ];
  return { gw, iface: tries.find((x) => x && names.has(x)) ?? null };
}

/**
 * The links this router already has a way out through, offered as a starting point. Every default route is traced to its interface, so
 * the link that is carrying traffic now is always among them, whatever kind it is; then any PPPoE or DHCP client that has no route yet.
 */
export function candidates(st) {
  const out = [];
  const seen = new Set();
  const push = (c) => { if (c.iface && !seen.has(c.iface) && !TUNNELS.includes(c.iface)) { seen.add(c.iface); out.push(c); } };
  const defaults = st.mainDefaults.filter((r) => !isMine(r) && !yes(r.disabled))
    .sort((a, b) => (Number(yes(b.active)) - Number(yes(a.active))) || (Number(a.distance ?? 1) - Number(b.distance ?? 1)));
  for (const r of defaults) {
    const { gw, iface } = routeInterface(st, r);
    if (!iface) continue;
    const dial = st.pppoe.find((p) => p.name === iface);
    if (dial) { push({ type: 'pppoe', iface: String(dial.interface ?? dial.name), user: String(dial.user ?? '') }); continue; }
    if (st.dhcp.some((d) => d.interface === iface && !yes(d.disabled)) && isDynamic(r)) { push({ type: 'dhcp', iface }); continue; }
    const addr = st.addrs.find((a) => a.interface === iface && isIpv4(gw) && (inCidr(gw, a.address) || a.network === gw))
      ?? st.addrs.find((a) => a.interface === iface);
    push({ type: 'static', iface, gateway: isIpv4(gw) ? gw : iface, address: addr?.address ?? '' });
  }
  for (const p of st.pppoe) if (!yes(p.disabled)) push({ type: 'pppoe', iface: String(p.interface ?? p.name), user: String(p.user ?? '') });
  for (const d of st.dhcp) if (!yes(d.disabled)) push({ type: 'dhcp', iface: d.interface });
  return out;
}

/** The interfaces a link could be on, for the picker. */
export function interfaces(st) {
  // A bridge is offered only when the router already uses it as an uplink; otherwise it is the customers' side.
  const inUse = new Set(candidates(st).map((c) => c.iface));
  return st.ifaces
    .filter((i) => !TUNNELS.includes(i.name) && !yes(i.dynamic) && !yes(i.slave)
      && (inUse.has(i.name) || !['bridge', 'loopback', 'wg', 'pppoe-in', 'pppoe-out', 'ovpn-out', 'ovpn-in'].includes(String(i.type))))
    .map((i) => ({
      name: i.name, type: i.type, running: yes(i.running), disabled: yes(i.disabled),
      addresses: st.addrs.filter((a) => a.interface === i.name).map((a) => a.address),
    }));
}

/** What is on the router now from an earlier setup, and whether each link is carrying traffic. */
export function live(st) {
  const mine = st.mainDefaults.filter((r) => isMine(r) && /default via link \d+/.test(r.comment));
  const byLink = new Map();
  for (const r of mine) {
    const n = Number(/link (\d+)/.exec(r.comment)?.[1] ?? 0);
    if (!n) continue;
    const l = byLink.get(n) ?? { n, probes: [], up: false, held: false };
    l.probes.push(String(r.gateway ?? ''));
    if (yes(r.disabled)) l.held = true;
    else if (yes(r.active) && !yes(r.inactive)) l.up = true;
    byLink.set(n, l);
  }
  const links = [...byLink.values()].sort((a, b) => a.n - b.n);
  const mode = st.mangle.some((r) => isMine(r) && r['per-connection-classifier']) ? 'balance' : 'failover';
  return { active: links.length > 0, mode: links.length ? mode : null, links };
}

/** The request, tidied: at most four links, whole-number shares from 1 to 10, a test address for every link. */
export function normalise(input) {
  const links = (Array.isArray(input?.links) ? input.links : []).slice(0, MAX_LINKS + 1).map((l, i) => {
    const gateway = String(l?.gateway ?? '').trim();
    const iface = String(l?.iface ?? '').trim();
    // A setup saved before links had a kind: an address for a gateway meant static, the interface itself meant a dial-up link.
    const type = TYPES.includes(l?.type) ? l.type : (gateway && gateway === iface ? 'pppoe' : 'static');
    return {
      type, iface,
      address: type === 'static' ? String(l?.address ?? '').trim() : '',
      gateway: type === 'static' ? gateway : '',
      user: type === 'pppoe' ? String(l?.user ?? '').trim() : '',
      password: type === 'pppoe' ? String(l?.password ?? '') : '',
      weight: Math.min(10, Math.max(1, Math.round(Number(l?.weight) || 1))),
      mbps: Number(l?.mbps) > 0 ? Math.min(100000, Number(l.mbps)) : null,
      probe: String(l?.probe ?? '').trim() || DEFAULT_PROBES[i] || '',
      // Left out means "the usual second one"; given as an empty box means "just one test address".
      probe2: l?.probe2 === '' ? '' : (String(l?.probe2 ?? '').trim() || DEFAULT_PROBES2[i] || ''),
    };
  });
  // When every link's size is given, the shares follow from the sizes: 200 and 100 Mbps become 2 and 1. Nobody has to work out a ratio.
  if (links.length && links.every((l) => l.mbps)) {
    const biggest = Math.max(...links.map((l) => l.mbps));
    for (const l of links) l.weight = Math.max(1, Math.round((l.mbps / biggest) * 10));
  }
  // Minutes a link must answer steadily before it is used again. 0 means at once.
  const hold = input?.hold === undefined || input?.hold === null || input?.hold === '' ? 3 : Math.min(30, Math.max(0, Math.round(Number(input.hold) || 0)));
  // Traffic that always uses one link: a customer's address (or network), or a site's.
  const seenPin = new Set();
  const pins = (Array.isArray(input?.pins) ? input.pins : []).slice(0, 40)
    .map((p) => ({ match: p?.match === 'site' ? 'site' : 'customer', address: String(p?.address ?? '').trim(), link: Math.round(Number(p?.link) || 0) }))
    .filter((p) => p.address && !seenPin.has(`${p.match} ${p.address}`) && seenPin.add(`${p.match} ${p.address}`));
  return { mode: input?.mode === 'failover' ? 'failover' : 'balance', protect: input?.protect !== false, sticky: input?.sticky === 'pair' ? 'pair' : 'customer', hold, pins, links };
}

/** What billing keeps of a setup: everything but the PPPoE password, plus the interface each link's traffic leaves through. */
export function publicConfig(cfg, shaped) {
  return {
    mode: cfg.mode, protect: cfg.protect, sticky: cfg.sticky, hold: cfg.hold, pins: cfg.pins,
    links: cfg.links.map(({ password, ...l }, i) => ({ ...l, out: shaped?.[i]?.out ?? l.iface })),   // eslint-disable-line no-unused-vars
  };
}

/**
 * Each link worked out against what the router has: the interface its traffic leaves through, its gateway, and what must be made first.
 * A gateway of null means "whatever the DHCP server hands out", known once the client is bound.
 */
function shape(st, cfg) {
  const taken = new Set(st.ifaces.map((i) => i.name));
  return cfg.links.map((l, i) => {
    const n = i + 1;
    if (l.type === 'pppoe') {
      const client = st.pppoe.find((p) => p.interface === l.iface || p.name === l.iface) ?? null;
      let name = client?.name ?? `pppoe-wan${n}`;
      while (!client && taken.has(name)) name += 'b';
      return { n, type: l.type, port: client?.interface ?? l.iface, out: name, gateway: name, client, makeClient: !client };
    }
    if (l.type === 'dhcp') {
      const client = st.dhcp.find((d) => d.interface === l.iface) ?? null;
      const bound = client && String(client.status ?? '') === 'bound' && isIpv4(client.gateway);
      return { n, type: l.type, port: l.iface, out: l.iface, gateway: bound ? String(client.gateway) : null, client, makeClient: !client };
    }
    const has = l.address && st.addrs.some((a) => a.interface === l.iface && a.address === l.address);
    return { n, type: 'static', port: l.iface, out: l.iface, gateway: l.gateway, makeAddress: !!l.address && !has };
  });
}

/** What stops this setup (blockers) and what the operator should know before pressing Apply (warnings). Changes nothing. */
export function check(st, cfg) {
  const blockers = []; const warnings = [];
  const { links, mode } = cfg;
  if (links.length < 2) blockers.push('Add at least two links.');
  if (links.length > MAX_LINKS) blockers.push(`At most ${MAX_LINKS} links.`);
  const shaped = shape(st, cfg);
  const usedPort = new Set(); const usedProbe = new Set();
  links.forEach((l, i) => {
    const n = i + 1; const s = shaped[i];
    const row = st.ifaces.find((x) => x.name === s.port);
    if (!l.iface || !row) return blockers.push(`Link ${n}: choose the port it is plugged into.`);
    if (TUNNELS.includes(s.port) || TUNNELS.includes(s.out)) return blockers.push(`Link ${n}: ${l.iface} is the tunnel to billing, not an internet link.`);
    if (!plainName(s.port) || !plainName(s.out)) return blockers.push(`Link ${n}: the interface name "${l.iface}" has characters this cannot work with. Rename the interface on the router first.`);
    if (usedPort.has(s.port)) blockers.push(`Link ${n}: ${s.port} is already used by another link.`);
    usedPort.add(s.port);
    if (yes(row.slave)) blockers.push(`Link ${n}: ${s.port} is a port inside a bridge. An internet link needs a port of its own; take it out of the bridge first.`);

    if (l.type === 'static') {
      if (l.address && !isCidr(l.address)) blockers.push(`Link ${n}: write the address with its size, for example 41.90.1.2/30.`);
      const selfGateway = l.gateway === s.port && /ppp|lte|l2tp|sstp/.test(String(row.type ?? ''));
      if (selfGateway) { /* nothing to check: the interface is the way out */ }
      else if (!isIpv4(l.gateway)) blockers.push(`Link ${n}: enter the gateway address the provider gave for ${s.port}.`);
      else {
        // A gateway the router already routes through on this port is taken as it is, however the operator made it reachable.
        const inUse = st.mainDefaults.some((r) => { const x = routeInterface(st, r); return !isMine(r) && x.gw === l.gateway && x.iface === s.port; });
        const reachable = inUse || (l.address && isCidr(l.address) && inCidr(l.gateway, l.address)) || ifaceForGateway(st, l.gateway) === s.port;
        if (!reachable) blockers.push(`Link ${n}: the gateway ${l.gateway} is not in the network of ${l.address ? `the address ${l.address}` : `any address on ${s.port}. Enter this link's own address as well`}.`);
        if (l.address && isCidr(l.address) && l.address.split('/')[0] === l.gateway) blockers.push(`Link ${n}: the address and the gateway are the same. The address is the router's own, the gateway is the provider's.`);
      }
    } else if (l.type === 'pppoe') {
      if (s.makeClient && (!l.user || !l.password)) blockers.push(`Link ${n}: enter the PPPoE username and password the provider gave. There is no PPPoE client on ${s.port} yet.`);
      if (/[\r\n]/.test(l.user + l.password)) blockers.push(`Link ${n}: the PPPoE username or password has a line break in it.`);
      if (!s.makeClient && l.password) warnings.push(`Link ${n}: the PPPoE client ${s.out} will be given the new username and password, and will reconnect.`);
    } else if (l.type === 'dhcp') {
      if (s.client && !s.gateway) warnings.push(`Link ${n}: the DHCP client on ${s.port} has no address right now. Applying waits a short while for one, and stops if none comes.`);
      if (s.client && String(s.client.script ?? '').trim() && !/ispLb/.test(String(s.client.script)))
        warnings.push(`Link ${n}: the DHCP client on ${s.port} already runs a script of its own, so it is left alone. If the provider changes the gateway, this link is treated as down until you apply again.`);
    }

    if (!isIpv4(l.probe) || isPrivate(l.probe)) blockers.push(`Link ${n}: the test address must be a public internet address, for example ${DEFAULT_PROBES[i] ?? '1.1.1.2'}.`);
    else {
      if (usedProbe.has(l.probe)) blockers.push(`Link ${n}: every link needs its own test address; ${l.probe} is used twice.`);
      usedProbe.add(l.probe);
      if (st.dnsServers.includes(l.probe))
        blockers.push(`Link ${n}: ${l.probe} is one of this router's own DNS servers. A test address is reached through one link only, so the router would lose that DNS server whenever link ${n} is down. Choose another.`);
      if (links.some((o) => o.gateway === l.probe)) blockers.push(`Link ${n}: the test address cannot be a gateway.`);
    }
    if (l.probe2) {
      if (!isIpv4(l.probe2) || isPrivate(l.probe2)) blockers.push(`Link ${n}: the second test address must be a public internet address, for example ${DEFAULT_PROBES2[i] ?? '9.9.9.10'}, or leave it empty.`);
      else {
        if (usedProbe.has(l.probe2)) blockers.push(`Link ${n}: every test address must be used once only; ${l.probe2} is used twice.`);
        usedProbe.add(l.probe2);
        if (st.dnsServers.includes(l.probe2)) blockers.push(`Link ${n}: ${l.probe2} is one of this router's own DNS servers, so it cannot be a test address. Choose another.`);
        if (links.some((o) => o.gateway === l.probe2)) blockers.push(`Link ${n}: the second test address cannot be a gateway.`);
      }
    }
    if (!yes(row.running)) warnings.push(`Link ${n}: nothing is plugged into ${s.port} right now, so it will start out as down.`);
  });
  cfg.pins.forEach((p, i) => {
    if (!isIpv4(p.address) && !isCidr(p.address)) blockers.push(`Fixed traffic ${i + 1}: "${p.address}" is not an address or a network. Write it like 10.5.0.20 or 41.90.64.0/24.`);
    if (!(p.link >= 1 && p.link <= links.length)) blockers.push(`Fixed traffic ${i + 1}: choose which link ${p.address} uses.`);
  });
  if (cfg.pins.length && mode !== 'balance') warnings.push('Fixed traffic is only used when the links work together. In failover everything uses one link anyway, so it is ignored.');
  if (mode === 'balance') {
    const foreign = st.mangle.filter((r) => !isMine(r) && !yes(r.disabled) && !isDynamic(r)
      && ['mark-connection', 'mark-routing'].includes(String(r.action))
      && String(r['new-connection-mark'] ?? '') !== 'ispSniOk');
    if (foreign.length)
      blockers.push(`This router already marks connections or routes for something else (${foreign.length} mangle rule${foreign.length === 1 ? '' : 's'} not made by billing). Sharing the load would fight with them. Use failover only, or remove those rules first.`);
    const fast = st.filter.filter((r) => String(r.action) === 'fasttrack-connection' && !yes(r.disabled));
    if (fast.length) warnings.push(`Fasttrack will be switched off (${fast.length} rule${fast.length === 1 ? '' : 's'}): it skips the rules that choose a link. The router's processor will work somewhat harder.`);
  }
  if (st.pppoe.some((p) => !isMine(p) && yes(p['add-default-route']) && Number(p['default-route-distance'] ?? 1) < PARKED))
    warnings.push('A PPPoE uplink already on the router has its own default route. Changing it may make that uplink reconnect once, for a few seconds.');
  if (!st.dnsServers.length)
    warnings.push('This router has no DNS server set. A new PPPoE or DHCP link will bring its provider\'s; with static links only, set one under IP > DNS on the router (for example 8.8.8.8 and 1.1.1.1).');
  if (cfg.protect)
    warnings.push('The router will refuse new connections from the internet on these links (ping stays open). If you open Winbox on the router\'s public address, or run a VPN server on the router, add your own rule for it first or untick the protection. Billing and Winbox (VPN) are not affected: they come through the tunnel.');
  else
    warnings.push('The router is not closed to the internet on these links by this setup. Make sure your own firewall covers every link.');
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
  const shaped = shape(st, cfg);
  links.forEach((l, i) => {
    const s = shaped[i];
    const how = l.type === 'pppoe'
      ? (s.makeClient ? `a new PPPoE client (${s.out}) on ${s.port}, user ${l.user}` : `the PPPoE client ${s.out} already on ${s.port}`)
      : l.type === 'dhcp'
        ? (s.makeClient ? `a new DHCP client on ${s.port}` : `the DHCP client already on ${s.port}${s.gateway ? `, gateway ${s.gateway} for now` : ''}`)
        : `${s.port} through ${l.gateway}${s.makeAddress ? `, with the address ${l.address} added to it` : ''}`;
    lines.push(`Link ${i + 1} is ${how}. It counts as up while ${l.probe}${l.probe2 ? ` or ${l.probe2}` : ''} answers through it.`);
  });
  if (mode === 'balance') {
    const total = slots(links).length;
    const share = links.map((l, i) => `link ${i + 1} about ${Math.round((slots(links).filter((x) => x === i).length / total) * 100)}%`).join(', ');
    lines.push(`${links.length === 2 ? 'Both links are' : 'All the links are'} used at the same time. New connections are shared${links.every((l) => l.mbps) ? ' by the size of each link' : ''}: ${share}. ${cfg.sticky === 'pair' ? 'One customer talking to one site stays on one link; different sites may use different links.' : 'Everything one customer does leaves by the same link, so sites that check the visitor\'s address (banks, games, streaming) keep working.'}`);
    lines.push('A link that stops answering is left out, and its connections move to the links that are up.');
  } else {
    lines.push(`Everything uses link 1. If it stops answering, link 2 takes over${links.length > 2 ? ', then the next' : ''}, and traffic returns to link 1 when it is back.`);
  }
  lines.push("The router's own traffic, including the tunnel to billing, uses link 1 and fails over in the same order.");
  if (st.dnsServers.length) lines.push(`DNS is left as it is (${st.dnsServers.join(', ')}); the new links do not add servers of their own.`);
  const parked = st.mainDefaults.filter((r) => !isMine(r) && !isDynamic(r) && !yes(r.disabled) && Number(r.distance ?? 1) < PARKED).length;
  if (parked) lines.push(`The ${parked === 1 ? 'default route' : `${parked} default routes`} already on the router ${parked === 1 ? 'is' : 'are'} kept as a last resort (distance ${PARKED}), and put back when you remove this.`);
  const needNat = shaped.filter((s) => !hasMasquerade(st, s.out)).map((s) => s.out);
  if (needNat.length) lines.push(`NAT (masquerade) is added on ${needNat.join(', ')}.`);
  lines.push('Firewall: replies to open connections are accepted on every link, and packets that belong to no connection are dropped.');
  if (cfg.protect) lines.push('Firewall: new connections from the internet to the router itself are refused on these links, except ping.');
  else if (st.dnsOpen) lines.push('Firewall: DNS queries arriving from the internet on each link are dropped, so the router is not an open resolver.');
  lines.push('When a link goes down or comes back, the connections that were tied to it are cleared on the router, so they start again on a working link instead of hanging.');
  lines.push(cfg.hold ? `A link that comes back is used again only after it has answered steadily for ${cfg.hold} minute${cfg.hold === 1 ? '' : 's'}, so a link that keeps blinking does not drag customers back and forth.` : 'A link that comes back is used again at once.');
  if (mode === 'balance') {
    for (const p of cfg.pins) lines.push(`${p.match === 'site' ? 'Traffic to' : 'The customer at'} ${p.address} always uses link ${p.link} while that link is up.`);
    lines.push("Traffic the router itself sends from a link's own address leaves by that link.");
  }
  if (shaped.some((s) => s.type === 'pppoe')) lines.push('TCP packet size is adjusted on the PPPoE link (MSS clamp), so large pages do not stall.');
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
 * What must be put back when this is removed: the distance each existing default route had, the DHCP clients given a script, and the
 * fasttrack rules that were on. A route that is already parked from an earlier setup keeps the original distance recorded then.
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
    if (isMine(d) || adds === 'no' || adds === 'false' || !plainName(d.interface)) continue;
    dhcp.push({ iface: d.interface, distance: original(Number(d['default-route-distance'] ?? 1), (prev.dhcp ?? []).find((x) => x.iface === d.interface)?.distance) });
  }
  for (const p of st.pppoe) {
    if (isMine(p) || !yes(p['add-default-route']) || !plainName(p.name)) continue;
    pppoe.push({ name: p.name, distance: original(Number(p['default-route-distance'] ?? 1), (prev.pppoe ?? []).find((x) => x.name === p.name)?.distance) });
  }
  // Existing DHCP clients whose script slot is free (or already ours) get the script that follows the gateway.
  const scripts = shape(st, cfg).filter((s) => s.type === 'dhcp' && s.client && !isMine(s.client) && plainName(s.port)
    && (!String(s.client.script ?? '').trim() || /ispLb/.test(String(s.client.script)))).map((s) => s.port);
  const stillThere = new Set(st.filter.map(idOf));
  const wasOn = (prev.fasttrack ?? []).filter((id) => stillThere.has(id));
  const onNow = st.filter.filter((r) => String(r.action) === 'fasttrack-connection' && !yes(r.disabled)).map(idOf);
  const fasttrack = cfg.mode === 'balance' ? [...new Set([...wasOn, ...onNow])] : [];
  return { routes, dhcp, pppoe, scripts: [...new Set([...(prev.scripts ?? []), ...scripts])], fasttrack, fasttrackBack: cfg.mode === 'balance' ? [] : wasOn };
}

const MENUS = [
  ['/system/scheduler', []], ['/ip/firewall/mangle', []], ['/tool/netwatch', []], ['/routing/rule', []], ['/ip/route/rule', []],
  ['/ip/route', []], ['/routing/table', []], ['/ip/firewall/nat', []], ['/ip/firewall/filter', []],
  ['/ip/firewall/address-list', [`?list=${LOCAL_LIST}`]],
  ...Array.from({ length: MAX_LINKS }, (_, i) => [['/ip/firewall/address-list', [`?list=${pinSrc(i)}`]], ['/ip/firewall/address-list', [`?list=${pinDst(i)}`]]]).flat(), ['/interface/list/member', [`?list=${WAN_LIST}`]], ['/interface/list', [`?name=${WAN_LIST}`]],
];
const UPLINK_MENUS = ['/ip/dhcp-client', '/ip/address', '/interface/pppoe-client'];

/** Remove the rules and routes this module wrote. Never touches a row that does not carry its comment, and leaves the uplinks it made. */
async function clear(conn) {
  let removed = 0;
  for (const [path, query] of MENUS) {
    let rows;
    try { rows = await conn.write(`${path}/print`, query); } catch { continue; }   // /routing/table does not exist on RouterOS 6
    for (const r of rows.filter((x) => isMine(x) && !isUplink(x) && !isDynamic(x) && x.name !== REVERT)) {
      await conn.write(`${path}/remove`, [`=.id=${idOf(r)}`]);
      removed += 1;
    }
  }
  return removed;
}

/** Remove the addresses and DHCP and PPPoE clients this module made. Only when the whole setup goes. */
async function clearUplinks(conn) {
  for (const path of UPLINK_MENUS) {
    const rows = await conn.write(`${path}/print`, []).catch(() => []);
    for (const r of rows.filter((x) => isUplink(x) && !isDynamic(x))) await conn.write(`${path}/remove`, [`=.id=${idOf(r)}`]).catch(() => {});
  }
}

/** Put the operator's own default routes, DHCP scripts and fasttrack rules back the way they were. A dial-up uplink goes last: changing it can drop the connection this runs over. */
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
    if (isMine(d)) continue;
    if ((u.scripts ?? []).includes(d.interface) || /ispLb/.test(String(d.script ?? '')))
      await attempt(`DHCP client script on ${d.interface}`, () => conn.write('/ip/dhcp-client/set', [`=.id=${idOf(d)}`, '=script=']));
    if (Number(d['default-route-distance'] ?? 1) < PARKED) continue;
    const was = (u.dhcp ?? []).find((x) => x.iface === d.interface)?.distance ?? 1;
    await attempt(`DHCP client on ${d.interface}`, () => conn.write('/ip/dhcp-client/set', [`=.id=${idOf(d)}`, `=default-route-distance=${was}`]));
  }
  for (const id of [...(u.fasttrack ?? []), ...(u.fasttrackBack ?? [])]) {
    await attempt('fasttrack rule', () => conn.write('/ip/firewall/filter/set', [`=.id=${id}`, '=disabled=no']));
  }
  for (const p of await conn.write('/interface/pppoe-client/print', []).catch(() => [])) {
    if (isMine(p) || Number(p['default-route-distance'] ?? 1) < PARKED) continue;
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
    '/system scheduler remove [find name~"^ispLbWatch"]', `/ip firewall mangle remove ${mine}`, `/tool netwatch remove ${mine}`,
    `/routing rule remove ${mine}`, `/ip route rule remove ${mine}`, `/ip route remove ${mine}`, `/routing table remove ${mine}`, `/ip firewall nat remove ${mine}`,
    `/ip firewall filter remove ${mine}`, `/ip firewall address-list remove ${mine}`, `/interface list member remove ${mine}`, `/interface list remove ${mine}`,
    `/ip dhcp-client remove ${mine}`, `/ip address remove ${mine}`, `/interface pppoe-client remove ${mine}`,
  ];
  for (const r of undo.routes) {
    if (!/^[A-Za-z0-9_.\-+% ]{1,80}$/.test(r.gateway)) continue;
    lines.push(`/ip route set [find where dst-address="0.0.0.0/0" and gateway="${r.gateway}" and dynamic=no] distance=${Number(r.distance) || 1}`);
  }
  for (const iface of undo.scripts ?? []) lines.push(`/ip dhcp-client set [find interface="${iface}"] script=""`);
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

/** The script a DHCP client runs when its lease changes: keep this link's test route on the gateway the provider gave. */
const dhcpScript = (n) => `:if ($bound=1) do={ :do { /ip route set [find comment~"^${LB} test address link ${n} "] gateway=$"gateway-address" } on-error={} }`;

/** Make the uplinks that are not there yet, and settle each link's gateway. Returns the links as the rest of the setup uses them. */
async function prepareUplinks(conn, cfg, shaped, undo, notes, st) {
  // The router keeps the DNS servers it has. Only a router with none takes them from a new link's provider.
  const peerDns = st.dnsServers.length ? 'no' : 'yes';
  const out = [];
  for (let i = 0; i < cfg.links.length; i++) {
    const l = cfg.links[i]; const s = shaped[i];
    let gateway = s.gateway;
    if (s.type === 'static' && s.makeAddress) {
      await conn.write('/ip/address/add', [`=address=${l.address}`, `=interface=${s.port}`, `=comment=${tag(`uplink address link ${s.n}`)}`]);
    }
    if (s.type === 'pppoe') {
      if (s.makeClient) {
        await conn.write('/interface/pppoe-client/add', [
          `=name=${s.out}`, `=interface=${s.port}`, `=user=${l.user}`, `=password=${l.password}`,
          '=add-default-route=no', `=use-peer-dns=${peerDns}`, '=disabled=no', `=comment=${tag(`uplink PPPoE link ${s.n}`)}`,
        ]);
      } else if (l.password) {
        await conn.write('/interface/pppoe-client/set', [`=.id=${idOf(s.client)}`, `=user=${l.user || s.client.user}`, `=password=${l.password}`]);
      }
    }
    if (s.type === 'dhcp') {
      if (s.makeClient) {
        await conn.write('/ip/dhcp-client/add', [
          `=interface=${s.port}`, '=add-default-route=no', `=use-peer-dns=${peerDns}`, '=use-peer-ntp=no', '=disabled=no',
          `=script=${dhcpScript(s.n)}`, `=comment=${tag(`uplink DHCP link ${s.n}`)}`,
        ]);
      } else if (undo.scripts.includes(s.port)) {
        await conn.write('/ip/dhcp-client/set', [`=.id=${idOf(s.client)}`, `=script=${dhcpScript(s.n)}`]);
      }
      // The gateway is whatever the provider's server hands out; give it a moment to answer.
      for (let tries = 0; !gateway && tries < 8; tries++) {
        await sleep(tries ? 2500 : 500);
        const row = (await conn.write('/ip/dhcp-client/print', [`?interface=${s.port}`]))[0];
        if (String(row?.status ?? '') === 'bound' && isIpv4(row.gateway)) gateway = String(row.gateway);
      }
      if (!gateway) throw new Error(`link ${s.n}: no DHCP answer on ${s.port}. Check the cable and that the provider's side hands out addresses`);
    }
    out.push({ n: s.n, type: s.type, iface: s.out, gateway, weight: l.weight, probe: l.probe, probe2: l.probe2 });
  }
  if (out.some((l, i) => isIpv4(l.gateway) && out.findIndex((o) => o.gateway === l.gateway) !== i))
    notes.push('Two links have the same gateway address. If they are not really the same provider network, one of them will not work.');
  return out;
}

/** Last, because it can make a dial-up uplink reconnect and drop the connection this runs over. Everything else is already in place. */
async function parkDialUps(conn, st, undo, notes) {
  for (const p of st.pppoe) {
    if (!undo.pppoe.some((x) => x.name === p.name) || Number(p['default-route-distance'] ?? 1) >= PARKED) continue;
    try { await conn.write('/interface/pppoe-client/set', [`=.id=${idOf(p)}`, `=default-route-distance=${PARKED + 10}`]); }
    catch (e) { notes.push(`The default route of the PPPoE uplink ${p.name} may not have been moved out of the way (${e.message}).`); }
  }
}

/**
 * Write the setup. The order keeps a working way out at every moment: the new routes are added beside the old ones, the old ones are
 * moved out of the way only after that, and the rules that steer traffic go in last, when every route they point at exists.
 */
export async function apply(conn, cfg, { previousUndo = null, revertMinutes = 5 } = {}) {
  const st = await read(conn);
  const review = check(st, cfg);
  if (review.blockers.length) throw Object.assign(new Error(review.blockers[0]), { refused: true });
  const { mode } = cfg;
  const shaped = shape(st, cfg);
  const undo = planUndo(st, cfg, previousUndo);
  const notes = [];
  const revertAt = await arm(conn, undo, revertMinutes);
  const add = async (label, path, fields) => {
    try { return await conn.write(`${path}/add`, fields); } catch (e) { e.message = `${label}: ${e.message}`; throw e; }
  };

  try {
    await clear(conn);   // an earlier setup on this router; its parked routes carry traffic meanwhile
    const links = await prepareUplinks(conn, cfg, shaped, undo, notes, st);

    await add('interface list', '/interface/list', [`=name=${WAN_LIST}`, `=comment=${tag('the internet links')}`]);
    for (const l of links) await add(`list member ${l.iface}`, '/interface/list/member', [`=list=${WAN_LIST}`, `=interface=${l.iface}`, `=comment=${tag(`link ${l.n}`)}`]);

    if (mode === 'balance') {
      const local = [...PRIVATE];
      for (const a of await conn.write('/ip/address/print', [])) {
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
      if (links[i].probe2) await add(`second test route link ${i + 1}`, '/ip/route', [`=dst-address=${links[i].probe2}/32`, `=gateway=${links[i].gateway}`, '=scope=10', `=comment=${tag(`test address link ${i + 1} second`)}`]);
    }
    if (mode === 'balance') {
      for (let i = 0; i < links.length; i++) {
        const inTable = st.major >= 7 ? `=routing-table=${table(i)}` : `=routing-mark=${table(i)}`;
        await add(`route for link ${i + 1}`, '/ip/route', [
          '=dst-address=0.0.0.0/0', `=gateway=${links[i].probe}`, '=check-gateway=ping', '=target-scope=11', '=distance=1',
          inTable, `=comment=${tag(`only link ${i + 1}`)}`,
        ]);
        if (links[i].probe2) await add(`second route for link ${i + 1}`, '/ip/route', [
          '=dst-address=0.0.0.0/0', `=gateway=${links[i].probe2}`, '=check-gateway=ping', '=target-scope=11', '=distance=2',
          inTable, `=comment=${tag(`only link ${i + 1} second`)}`,
        ]);
      }
    }
    for (let i = 0; i < links.length; i++) {
      if (!hasMasquerade(st, links[i].iface)) {
        await add(`NAT on ${links[i].iface}`, '/ip/firewall/nat', ['=chain=srcnat', `=out-interface=${links[i].iface}`, '=action=masquerade', `=comment=${tag(`NAT link ${i + 1}`)}`]);
      }
    }

    // Firewall. The accept for open connections goes in before anything that drops, because a drop without it would cut the router off
    // from everything, billing included.
    const fw = (label, fields) => add(`firewall ${label}`, '/ip/firewall/filter', [...fields, `=comment=${tag(label)}`]);
    const wan = `=in-interface-list=${WAN_LIST}`;
    await fw('top replies to the router', ['=chain=input', wan, '=connection-state=established,related,untracked', '=action=accept']);
    await fw('top stray packets to the router', ['=chain=input', wan, '=connection-state=invalid', '=action=drop']);
    await fw('top replies to customers', ['=chain=forward', wan, '=connection-state=established,related,untracked', '=action=accept']);
    await fw('top stray packets to customers', ['=chain=forward', wan, '=connection-state=invalid', '=action=drop']);
    if (st.dnsOpen && !cfg.protect) {
      // The router answers DNS for its customers; it must not answer the whole internet on a link nobody wrote a firewall for.
      for (const proto of ['udp', 'tcp']) await fw(`top DNS from the internet ${proto}`, ['=chain=input', wan, `=protocol=${proto}`, '=dst-port=53', '=action=drop']);
    }
    try {
      const rows = await conn.write('/ip/firewall/filter/print', []);
      const first = rows.find((r) => !isDynamic(r));
      for (const r of rows.filter((x) => isMine(x) && x.comment.startsWith(`${LB} top `))) {
        if (first && idOf(r) !== idOf(first)) await conn.write('/ip/firewall/filter/move', [`=numbers=${idOf(r)}`, `=destination=${idOf(first)}`]);
      }
    } catch (e) {
      notes.push(`The firewall rules could not be moved to the top of their chains (${e.message}). They work from where they are unless an earlier rule of yours drops the same traffic.`);
    }
    if (cfg.protect) {
      // At the end of the chain on purpose: a rule of the operator's own that lets something in (a VPN server, Winbox from one address) stays ahead of it.
      await fw('ping from the internet', ['=chain=input', wan, '=protocol=icmp', '=action=accept']);
      await fw('nothing else from the internet to the router', ['=chain=input', wan, '=action=drop']);
    }

    // The way out for everything that is not steered: link 1, then the next, in order.
    for (let i = 0; i < links.length; i++) {
      // Link 1 has distances 1 and 2 (its two test addresses), link 2 has 3 and 4, and so on: a link is passed over only when both fail.
      await add(`default route link ${i + 1}`, '/ip/route', [
        '=dst-address=0.0.0.0/0', `=gateway=${links[i].probe}`, '=check-gateway=ping', '=target-scope=11', `=distance=${(i * 2) + 1}`,
        `=comment=${tag(`default via link ${i + 1}`)}`,
      ]);
      if (links[i].probe2) await add(`second default route link ${i + 1}`, '/ip/route', [
        '=dst-address=0.0.0.0/0', `=gateway=${links[i].probe2}`, '=check-gateway=ping', '=target-scope=11', `=distance=${(i * 2) + 2}`,
        `=comment=${tag(`default via link ${i + 1} second`)}`,
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
    const m = (label, fields) => add(`mangle ${label}`, '/ip/firewall/mangle', [...fields, `=comment=${tag(label)}`]);
    for (const l of links.filter((x) => x.type === 'pppoe')) {
      for (const dir of ['out', 'in']) {
        await m(`packet size ${dir} link ${l.n}`, ['=chain=forward', '=protocol=tcp', '=tcp-flags=syn', `=${dir}-interface=${l.iface}`, '=action=change-mss', '=new-mss=clamp-to-pmtu', '=passthrough=yes']);
      }
    }
    if (mode === 'balance') {
      for (const id of undo.fasttrack) await conn.write('/ip/firewall/filter/set', [`=.id=${id}`, '=disabled=yes']);
      // A connection that arrives from the internet on a link is answered on the same link.
      for (let i = 0; i < links.length; i++) {
        await m(`arrived on link ${i + 1}`, ['=chain=prerouting', `=in-interface=${links[i].iface}`, '=connection-state=new', '=connection-mark=no-mark',
          '=action=mark-connection', `=new-connection-mark=${connMark(i)}`, '=passthrough=yes']);
      }
      // Traffic that must always use one link is marked first; the sharing rules below only touch what is still unmarked.
      for (let i = 0; i < links.length; i++) {
        const fixed = cfg.pins.filter((p) => p.link === i + 1);
        for (const p of fixed) {
          await add(`fixed ${p.address}`, '/ip/firewall/address-list', [`=list=${p.match === 'site' ? pinDst(i) : pinSrc(i)}`, `=address=${p.address}`, `=comment=${tag(`always link ${i + 1}`)}`]);
        }
        if (fixed.some((p) => p.match === 'customer')) {
          await m(`fixed customers to link ${i + 1}`, ['=chain=prerouting', `=in-interface-list=!${WAN_LIST}`, '=connection-mark=no-mark', '=dst-address-type=!local',
            `=dst-address-list=!${LOCAL_LIST}`, `=src-address-list=${pinSrc(i)}`, '=action=mark-connection', `=new-connection-mark=${connMark(i)}`, '=passthrough=yes']);
        }
        if (fixed.some((p) => p.match === 'site')) {
          await m(`fixed sites to link ${i + 1}`, ['=chain=prerouting', `=in-interface-list=!${WAN_LIST}`, '=connection-mark=no-mark', '=dst-address-type=!local',
            `=dst-address-list=${pinDst(i)}`, '=action=mark-connection', `=new-connection-mark=${connMark(i)}`, '=passthrough=yes']);
        }
      }
      // A new connection from a customer to the internet is given a link, by share.
      const order = slots(links);
      for (let s = 0; s < order.length; s++) {
        await m(`share ${s + 1} of ${order.length} to link ${order[s] + 1}`, ['=chain=prerouting', `=in-interface-list=!${WAN_LIST}`, '=connection-mark=no-mark',
          '=dst-address-type=!local', `=dst-address-list=!${LOCAL_LIST}`, `=per-connection-classifier=${cfg.sticky === 'pair' ? 'both-addresses' : 'src-address'}:${order.length}/${s}`,
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

    if (mode === 'balance') {
      try { await ownAddressRules(conn, links); }
      catch (e) { notes.push(`The rules that send a link's own address out of that link could not be added (${e.message}). Everything else is in place.`); }
    }

    // The watcher: one small script per link, run by the router every 15 seconds (see watchScript). Not fatal if the router will not
    // take it: the routes still fail over by their own ping check, only without the hold-down and the clearing of old connections.
    try {
      for (let i = 0; i < links.length; i++) {
        await conn.write('/system/scheduler/add', [
          `=name=${watchName(i + 1)}`, '=interval=15s', '=policy=read,write,test,policy',
          `=on-event=${watchScript(i, links[i], cfg)}`, `=comment=${tag(`watch link ${i + 1}`)}`,
        ]);
      }
    } catch (e) {
      notes.push(`The watcher that holds back an unsteady link and clears stale connections could not be added (${e.message}). Failover still works without it.`);
    }
  } catch (e) {
    await clear(conn).catch(() => {});
    await clearUplinks(conn).catch(() => {});
    await restore(conn, undo).catch(() => {});
    await disarm(conn).catch(() => {});
    throw e;
  }

  await parkDialUps(conn, st, undo, notes);
  return { undo, revertAt, notes, warnings: review.warnings, config: publicConfig(cfg, shaped) };
}

/** Take the setup off the router and put the operator's own routes back. */
export async function remove(conn, undo) {
  // The rules and routes go first: the parked routes carry traffic the moment they are gone. Then the distances are put back, and the
  // uplinks this made are removed last of all, when nothing points at them any more.
  await disarm(conn).catch(() => {});
  const removed = await clear(conn);
  const notes = await restore(conn, undo);
  await clearUplinks(conn);
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
    const mineHere = mine.filter((r) => Number(/link (\d+)/.exec(r.comment)?.[1]) === i + 1);
    const iface = l.out ?? l.iface;
    const s = stats.find((x) => x.name === iface);
    return {
      n: i + 1, iface, up: mineHere.some((r) => yes(r.active) && !yes(r.inactive) && !yes(r.disabled)), held: mineHere.some((r) => yes(r.disabled)),
      rx: num(s?.['rx-byte']), tx: num(s?.['tx-byte']),
    };
  });
}
