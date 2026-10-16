/**
 * Shared links: the radio, switch or ONU that several customers get their service through.
 *
 * One customer's line cannot tell you whether the fault is theirs or the thing they share. So customers are grouped by what they share, the
 * group is read as a whole, and the verdict names the shared device first. A link can be "unmanaged" (a plain switch, a radio nobody can log
 * into): nothing can be read from the device itself, so it is judged only from the customers behind it, and the verdict says so.
 */
export const KINDS = ['ap', 'station', 'radio', 'switch', 'onu', 'other'];
/** Customers are added to these. An access point (or the older "radio") is not shared: its customers each have their own dish. */
export const canHoldCustomers = (k) => k !== 'ap' && k !== 'radio';
const isRadio = (k) => k === 'ap' || k === 'station' || k === 'radio';
const KIND_LABEL = { radio: 'radio', ap: 'access point', station: 'station', switch: 'switch', onu: 'ONU', other: 'link' };

/** A customer whose signal is this weak or worse is a poor radio client. */
export const WEAK_DBM = -75;
const SAME_TIME_MINUTES = 10;

const live = (m) => m.status === 'active' || m.status === 'grace';

/**
 * Read a link from its customers, no database needed.
 *   members      [{ id, name, status, online, drops, signal, line_state }]
 *   worstWindow  { n, at } the most customers that lost their line within the same few minutes in the last day
 * Returns { level: ok | watch | down | unknown, headline, detail[], outliers[], steps[] }.
 * A fault is called shared only when most of the group shows it (at least 2 customers and 60%), so one bad customer is never blamed on the link.
 */
function judgeMembers({ kind = 'radio', managed = true, members = [], worstWindow = null }) {
  const label = KIND_LABEL[kind] ?? 'link';
  const active = members.filter(live);
  const n = active.length;
  const steps = checkSteps(kind, managed);
  const note = managed ? null : `This ${label} is unmanaged, so nothing can be read from it. This is judged only from the customers behind it.`;
  if (n === 0) {
    return { level: 'unknown', headline: members.length ? 'No active customers on this link right now.' : 'No customers added to this link yet.', detail: note ? [note] : [], outliers: [], steps: [] };
  }
  const need = Math.max(2, Math.ceil(n * 0.6));
  const offline = active.filter((m) => !m.online);
  const stuck = active.filter((m) => m.online && m.line_state === 'unreachable');
  const together = worstWindow?.n ?? 0;
  const withSignal = active.filter((m) => Number.isFinite(m.signal));
  const weak = withSignal.filter((m) => m.signal <= WEAK_DBM);
  const detail = [];
  if (note) detail.push(note);

  let level = 'ok';
  let headline = `The ${label} looks healthy: ${n - offline.length} of ${n} active customers are online and no shared fault shows.`;
  if (n >= 2 && offline.length >= need) {
    level = 'down';
    headline = `${offline.length} of ${n} active customers behind this ${label} are offline right now. Suspect the ${label}, not the customers.`;
  } else if (n >= 2 && together >= need) {
    level = 'watch';
    const when = worstWindow?.at ? ` around ${new Date(worstWindow.at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : '';
    headline = `${together} of ${n} customers lost their line within ${SAME_TIME_MINUTES} minutes of each other${when}. That points at the ${label} (power or the link), not at the customers.`;
  } else if (n >= 2 && stuck.length >= need) {
    level = 'watch';
    headline = `${stuck.length} of ${n} customers are connected but passing no traffic. Suspect the ${label}.`;
  } else if (isRadio(kind) && withSignal.length >= 2 && weak.length >= Math.max(2, Math.ceil(withSignal.length * 0.6))) {
    level = 'watch';
    headline = `${weak.length} of ${withSignal.length} customers with a reading are at ${WEAK_DBM} dBm or weaker. The sector is weak for most of them.`;
  }
  if (level === 'ok' && offline.length) detail.push(`${offline.length} of ${n} offline, but not enough of them to blame the ${label}.`);
  if (managed === false && level !== 'ok') detail.push('Because it is unmanaged, confirm on site (power, cable, port) before replacing anything.');
  if (isRadio(kind) && withSignal.length) {
    const avg = withSignal.reduce((a, m) => a + m.signal, 0) / withSignal.length;
    detail.push(`Signal readings: ${withSignal.length} customers, average ${avg.toFixed(0)} dBm, weakest ${Math.min(...withSignal.map((m) => m.signal))} dBm.`);
  }

  const outliers = active
    .filter((m) => !m.online || m.line_state === 'unreachable' || m.drops >= 3 || (Number.isFinite(m.signal) && m.signal <= WEAK_DBM - 5))
    .map((m) => ({
      id: m.id, name: m.name,
      why: [
        !m.online ? 'offline' : null,
        m.online && m.line_state === 'unreachable' ? 'online, no traffic' : null,
        m.drops >= 3 ? `${m.drops} drops in a day` : null,
        Number.isFinite(m.signal) && m.signal <= WEAK_DBM - 5 ? `signal ${m.signal} dBm` : null,
      ].filter(Boolean).join(', '),
    }));
  return { level, headline, detail, outliers: level === 'ok' ? outliers : outliers.slice(0, 50), steps: level === 'ok' ? [] : steps };
}

/** A ping older than this is not trusted: the device is then read from its customers alone. */
export const PING_FRESH_MINUTES = 10;

/** The router a device is pinged from: the one it is locked to, or the organisation's only router when there is just one. */
export function pingRouterFor(link, routers) {
  if (link.ping_router_id) return routers.find((r) => r.id === link.ping_router_id) ?? null;
  const usable = routers.filter((r) => r.has_creds);
  return usable.length === 1 ? usable[0] : null;
}

/**
 * Read a link from its customers AND from whether the device itself answers a ping (from the router it is locked to). A device that does not
 * answer is down whatever its customers say, and the customers behind it are not blamed. A device that answers is powered and reachable, so when
 * its customers are still bad the fault is behind it (its ports or the radios under it) or at the customers.
 *   device  { ip, ok, ms, at, router, since } where `at` is when it was last pinged; null when it has no address
 */
export function judgeLink({ kind = 'radio', managed = true, members = [], worstWindow = null, device = null }) {
  const base = judgeMembers({ kind, managed, members, worstWindow });
  if (!device?.ip) return base;
  const label = KIND_LABEL[kind] ?? 'link';
  const fresh = device.at && Date.now() - new Date(device.at).getTime() < PING_FRESH_MINUTES * 60000 && device.ok !== null && device.ok !== undefined;
  if (!fresh) {
    const why = !device.router ? 'No router is chosen to ping it from, so it is judged only from its customers.' : 'Not pinged recently (the router may be down), so it is judged only from its customers.';
    return { ...base, detail: [...base.detail, why] };
  }
  if (device.ok === false) {
    const since = device.since ? ` since ${new Date(device.since).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : '';
    return {
      level: 'down',
      headline: `The ${label} (${device.ip}) does not answer a ping from ${device.router}${since}. Suspect its power or its link, not the customers behind it.`,
      detail: base.level === 'ok' || base.level === 'unknown' ? [] : [`Its customers agree: ${base.headline}`],
      outliers: [], steps: checkSteps(kind, managed),
    };
  }
  const answers = `The ${label} answers a ping from ${device.router}${device.ms != null ? ` (${Number(device.ms).toFixed(0)} ms)` : ''}, so it is powered and reachable.`;
  if (base.level === 'unknown') return { ...base, level: 'ok', headline: `${answers} No customers are behind it yet.`, detail: [] };
  if (base.level === 'down' || base.level === 'watch') {
    // The device answers, so it is not the one to blame: say so instead of pointing at it.
    const headline = base.headline.replace(/(Suspect|That points at) the [^.]*?(, not (at )?the customers\.|\.)/, `The ${label} itself answers a ping, so look behind it (its ports or the radios under it) or at the customers.`);
    return { ...base, headline, detail: [answers, ...base.detail] };
  }
  return { ...base, detail: [answers, ...base.detail] };
}

/** What to do on site, by what kind of device it is and whether it can be logged into. */
export function checkSteps(kind, managed) {
  if (kind === 'switch') {
    return managed
      ? ['Look at the uplink port: errors, flaps, speed and duplex.', 'Check the switch has power and has not restarted (uptime).', 'Check the cable and the port the customers hang off.']
      : ['Check the switch has power: the lights, the power adapter, the socket.', 'Reseat the uplink cable and try another uplink port.', 'Unplug customer cables one at a time: one bad cable or device can drag the whole switch down.', 'Swap the switch for a known good one if the lights are fine.'];
  }
  if (kind === 'onu') {
    return managed
      ? ['Read the optical power: about -8 to -27 dBm is healthy, and LOS means the fibre is cut.', 'Check how many customers are on that PON port and its load.', 'Check the ONU is online and not in a restart loop.']
      : ['Look at the PON and LOS lights: a red LOS means no light from the fibre.', 'Check the ONU power adapter and socket.', 'Clean and reseat the fibre connector.', 'Ask the upstream provider whether the splitter or the PON port has a fault.'];
  }
  if (kind === 'station') {
    return managed
      ? ['Check the station is associated to the access point above it, and its signal and link rate.', 'Look for a new obstruction or a shifted alignment toward that access point.', 'Check its power and the cable to the switch.']
      : ['Check the station has power and its link light, and reset its PoE injector.', 'Check it is still aimed at the access point above it, and for a new obstruction.', 'Check the cable from the station to the switch for water or damage.'];
  }
  if (kind === 'radio' || kind === 'ap') {
    return managed
      ? ['Check the radio is up and see each client\'s signal, CCQ and airtime.', 'Look for interference or a new obstruction; check alignment.', 'One poor client can drag a sector down: test with the weakest one disconnected.']
      : ['Check the radio has power and its link light; reset its PoE injector.', 'Check the alignment and look for a new obstruction or interference.', 'Check the cable from the radio to the injector for water or damage.'];
  }
  return ['Check power at the shared device.', 'Check the cable and port the customers share.', 'Compare against a customer not on this link.'];
}

const DROPS = `('Lost-Carrier', 'Lost-Service')`;

/**
 * A radio link made from a SkyPlan site also carries every customer assigned (on their account) to an access point at that site, so the
 * customers do not have to be put on it one by one. A customer put on a link by hand stays on that link.
 */
const AP_LINKS = `with ap_link as (
  select distinct on (n.id) n.id as node_id, l.id as link_id
    from shared_links l
    join network_nodes h on h.tenant_id = l.tenant_id and (h.id::text = l.site_ref or h.details->>'skyplan' = l.site_ref)
    join network_nodes n on n.tenant_id = h.tenant_id and n.kind in ('ap', 'ptp', 'station') and (n.id = h.id or n.details->>'tower' = h.id::text)
   where l.tenant_id = $1 and l.site_ref is not null and l.kind in ('ap', 'radio')
   order by n.id, l.created_at)`;

/** Customers on links with what is needed to judge them: online now, drops in the last day, last signal reading, line health. */
async function memberRows(pool, tenantId) {
  const { rows } = await pool.query(
    `${AP_LINKS}
     select s.id, s.name, s.account_code, s.phone, s.status, s.pppoe_user, coalesce(s.shared_link_id, al.link_id) as shared_link_id, (s.shared_link_id is null) as via_ap,
            s.cpe_signal_dbm::float8 as signal,
            exists (select 1 from radacct a where a.username = s.pppoe_user and a.acctstoptime is null) as online,
            (select count(*)::int from radacct a where a.username = s.pppoe_user and a.acctstoptime > now() - interval '24 hours'
                and a.acctterminatecause in ${DROPS}) as drops,
            lh.state as line_state
       from subscribers s
       left join line_health lh on lh.tenant_id = s.tenant_id and lh.pppoe_user = s.pppoe_user
       left join ap_link al on al.node_id = s.ap_node_id
      where s.tenant_id = $1 and (s.shared_link_id is not null or al.link_id is not null)
      order by s.name`, [tenantId]);
  return rows;
}

/** Every customer line lost in the last day, with the few-minute window it fell in (a window is a number of seconds since 1970 divided by its length). */
async function dropEvents(pool, tenantId) {
  const secs = SAME_TIME_MINUTES * 60;
  const { rows } = await pool.query(
    `${AP_LINKS}
     select s.id, coalesce(s.shared_link_id, al.link_id) as link, floor(extract(epoch from a.acctstoptime) / ${secs})::bigint as bucket
       from radacct a join subscribers s on s.tenant_id = $1 and s.pppoe_user = a.username
       left join ap_link al on al.node_id = s.ap_node_id
      where coalesce(s.shared_link_id, al.link_id) is not null and a.acctstoptime > now() - interval '24 hours' and a.acctterminatecause in ${DROPS}
      group by 1, 2, 3`, [tenantId]);
  return rows.map((r) => ({ id: r.id, link: r.link, bucket: Number(r.bucket) }));
}

/**
 * For each link, the links at and below it (a switch carries the radios hung off it and their customers). Links are fed from one other link
 * at most, so this is a forest; a loop (which saving refuses) cannot make it run forever.
 */
export function subtreeOf(links) {
  const kids = new Map();
  for (const l of links) if (l.parent_id) { if (!kids.has(l.parent_id)) kids.set(l.parent_id, []); kids.get(l.parent_id).push(l.id); }
  const out = new Map();
  for (const l of links) {
    const seen = new Set([l.id]);
    const stack = [l.id];
    while (stack.length) for (const k of kids.get(stack.pop()) ?? []) if (!seen.has(k)) { seen.add(k); stack.push(k); }
    out.set(l.id, seen);
  }
  return out;
}

const BAD = new Set(['down', 'watch']);

/**
 * Read every link from the customers at and below it, then say where a shared fault really is. A fault that shows on a switch AND on the
 * radios under it is the switch's (or the uplink above it): the highest link that shows it is blamed, the ones below it are marked "upstream".
 * A radio that is bad while the switch above it is fine is that radio's own fault.
 *   links    [{ id, name, kind, managed, parent_id }]
 *   members  customers, each with shared_link_id (the device they plug into)
 *   events   [{ id, link, bucket }] line drops, bucket = which few-minute window
 */
export function judgeTree({ links, members, events = [], devices = new Map() }) {
  const sub = subtreeOf(links);
  const byId = new Map(links.map((l) => [l.id, l]));
  const verdicts = new Map(); const counts = new Map();
  for (const l of links) {
    const ids = sub.get(l.id);
    const mine = members.filter((m) => ids.has(m.shared_link_id));
    const buckets = new Map();
    for (const e of events) if (ids.has(e.link)) { if (!buckets.has(e.bucket)) buckets.set(e.bucket, new Set()); buckets.get(e.bucket).add(e.id); }
    let worst = null;
    for (const [b, set] of buckets) if (!worst || set.size > worst.n || (set.size === worst.n && b > worst.b)) worst = { n: set.size, b };
    verdicts.set(l.id, judgeLink({ kind: l.kind, managed: l.managed, members: mine, worstWindow: worst ? { n: worst.n, at: new Date(worst.b * SAME_TIME_MINUTES * 60000) } : null, device: devices.get(l.id) ?? null }));
    counts.set(l.id, mine);
  }
  const upstream = new Map();
  for (const l of links) {
    if (!BAD.has(verdicts.get(l.id).level)) continue;
    let top = null; let cur = byId.get(l.parent_id); let guard = 0;
    while (cur && guard++ < 10) { if (BAD.has(verdicts.get(cur.id).level)) top = cur; cur = byId.get(cur.parent_id); }
    if (top) {
      const mine = counts.get(l.id).filter(live).length; const theirs = counts.get(top.id).filter(live).length;
      upstream.set(l.id, { id: top.id, name: top.name, sameCustomers: mine === theirs });
    }
  }
  return { verdicts, upstream, members: counts };
}

/** Everything about every link, worked out once. */
async function compute(pool, tenantId) {
  const [{ rows: links }, members, events, { rows: routers }] = await Promise.all([
    pool.query('select * from shared_links where tenant_id=$1 order by name', [tenantId]),
    memberRows(pool, tenantId),
    dropEvents(pool, tenantId),
    pool.query('select id, name, (service_user is not null and service_password_enc is not null) as has_creds from routers where tenant_id=$1', [tenantId]),
  ]);
  const devices = new Map();
  const viaOf = new Map();
  for (const l of links) {
    const r = pingRouterFor(l, routers);
    viaOf.set(l.id, r?.name ?? null);
    if (l.ip) devices.set(l.id, { ip: l.ip, ok: l.ping_ok, ms: l.ping_ms, at: l.ping_at, since: l.down_since, router: r?.name ?? null });
  }
  const t = judgeTree({ links, members, events, devices });
  const list = links.map((l) => {
    const v = t.verdicts.get(l.id); const up = t.upstream.get(l.id);
    const all = t.members.get(l.id); const act = all.filter(live);
    return {
      ...l, ping_router: viaOf.get(l.id) ?? null, level: v.level,
      headline: up ? `${v.headline} ${up.sameCustomers ? `The same customers are behind ${up.name}, so check both.` : `${up.name}, above it, shows the same fault: likely the cause.`}` : v.headline,
      upstream: up ?? null,
      customers: all.length, active: act.length, online: act.filter((m) => m.online).length,
      drops: all.reduce((x, m) => x + m.drops, 0),
      memberIds: members.filter((m) => m.shared_link_id === l.id).map((m) => m.id),
    };
  });
  return { links, list, ...t };
}

/** Every link with its verdict, for the list. */
export async function listLinks(pool, tenantId) { return (await compute(pool, tenantId)).list; }

/** One link: its customers (including those on the links below it), the links below it, and its full verdict. */
export async function linkDetail(pool, tenantId, id) {
  const c = await compute(pool, tenantId);
  const me = c.list.find((x) => x.id === id);
  if (!me) return null;
  const names = new Map(c.links.map((x) => [x.id, x.name]));
  const { memberIds, ...link } = me;
  return {
    ...link, parent_name: me.parent_id ? names.get(me.parent_id) ?? null : null,
    members: c.members.get(id).map((m) => ({ ...m, via: names.get(m.shared_link_id) ?? null, direct: m.shared_link_id === id })),
    children: c.list.filter((x) => x.parent_id === id).map((x) => ({ id: x.id, name: x.name, kind: x.kind, managed: x.managed, level: x.level, active: x.active, online: x.online })),
    verdict: { ...c.verdicts.get(id), headline: me.headline },
  };
}

const text = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const coord = (v, max) => { const n = Number(v); return v !== null && v !== '' && v !== undefined && Number.isFinite(n) && Math.abs(n) <= max ? n : null; };

/** The link this one is fed from (a switch is fed from a receiving radio, a radio from a switch): checked to be this organisation's, and never a loop. */
async function checkParent(pool, tenantId, selfId, parentId) {
  if (!parentId) return null;
  if (!UUID.test(String(parentId))) throw bad('That is not a link.');
  if (parentId === selfId) throw bad('A link cannot be fed from itself.');
  const { rows } = await pool.query('select id, parent_id from shared_links where tenant_id=$1', [tenantId]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(parentId)) throw bad('No such link to be fed from.');
  let cur = parentId; let depth = 0;
  while (cur) {
    if (selfId && cur === selfId) throw bad('That would make a loop: the link above is already fed from this one.');
    cur = byId.get(cur)?.parent_id;
    if (++depth > 8) throw bad('Links are nested too deeply.');
  }
  return parentId;
}

/** A place on the map for the device (the building or mast it is on), or none. Both numbers or neither. */
function place(b, curLat = null, curLng = null) {
  if (!('lat' in (b ?? {})) && !('lng' in (b ?? {}))) return { lat: curLat, lng: curLng };
  const la = coord(b.lat, 90); const ln = coord(b.lng, 180);
  if (la === null || ln === null) return { lat: null, lng: null };
  if (la === 0 && ln === 0) throw bad('That is not a place on the map.');
  return { lat: la, lng: ln };
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

/**
 * What a device is: its address, MAC, model, frequency and network name, and the router it is pinged from. Each is kept only when sent (so a
 * change of name never wipes them), checked, and the router must be this organisation's own.
 */
async function deviceFields(pool, tenantId, b, cur = {}) {
  const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k);
  const ip = has('ip') ? text(b.ip, 45) : cur.ip ?? null;
  if (ip && (!IPV4.test(ip) || ip === '0.0.0.0' || ip.startsWith('127.'))) throw bad('The address must look like 10.20.30.40.');
  const macRaw = has('mac') ? text(b.mac, 17) : cur.mac ?? null;
  if (macRaw && !MAC.test(macRaw)) throw bad('The MAC address must look like aa:bb:cc:dd:ee:ff.');
  const f = has('freqMhz') ? (b.freqMhz === null || b.freqMhz === '' ? null : Math.round(Number(b.freqMhz))) : cur.freq_mhz ?? null;
  if (f !== null && !(Number.isFinite(f) && f >= 100 && f <= 100000)) throw bad('The frequency is in MHz, for example 5180.');
  let router = has('pingRouterId') ? (b.pingRouterId || null) : cur.ping_router_id ?? null;
  if (router) {
    if (!UUID.test(String(router))) throw bad('That is not a router.');
    const { rowCount } = await pool.query('select 1 from routers where tenant_id=$1 and id=$2', [tenantId, router]);
    if (!rowCount) throw bad('No such router to ping from.');
  }
  return {
    ip, mac: macRaw ? macRaw.toLowerCase().replace(/-/g, ':') : null, freq_mhz: f, router,
    model: has('model') ? text(b.model, 60) : cur.model ?? null, ssid: has('ssid') ? text(b.ssid, 40) : cur.ssid ?? null,
    // a changed address is not the one last pinged
    reset: ip !== (cur.ip ?? null) || router !== (cur.ping_router_id ?? null),
  };
}

export async function createLink(pool, tenantId, b) {
  const name = text(b?.name, 80);
  if (!name) throw bad('Give the link a name, for example "Mlima mast sector 1".');
  const kind = KINDS.includes(b?.kind) ? b.kind : 'radio';
  const parent = await checkParent(pool, tenantId, null, b?.parentId);
  const at = place(b);
  const d = await deviceFields(pool, tenantId, b);
  try {
    const { rows: [r] } = await pool.query(
      `insert into shared_links (tenant_id, name, kind, managed, location, notes, parent_id, lat, lng, site_ref, ip, mac, model, freq_mhz, ssid, ping_router_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
      [tenantId, name, kind, b?.managed !== false, text(b?.location, 120), text(b?.notes, 1000), parent, at.lat, at.lng, text(b?.siteRef, 80), d.ip, d.mac, d.model, d.freq_mhz, d.ssid, d.router]);
    return r;
  } catch (e) {
    if (e.code === '23505') throw bad(`There is already a link called "${name}".`);
    throw e;
  }
}

export async function updateLink(pool, tenantId, id, b) {
  const { rows: [cur] } = await pool.query('select * from shared_links where id=$1 and tenant_id=$2', [id, tenantId]);
  if (!cur) return null;
  const name = b?.name === undefined ? cur.name : text(b.name, 80);
  if (!name) throw bad('Give the link a name.');
  const kind = b?.kind === undefined ? cur.kind : (KINDS.includes(b.kind) ? b.kind : cur.kind);
  const parent = b && 'parentId' in b ? await checkParent(pool, tenantId, id, b.parentId) : cur.parent_id;
  const at = place(b, cur.lat, cur.lng);
  const d = await deviceFields(pool, tenantId, b, cur);
  try {
    const { rows: [r] } = await pool.query(
      `update shared_links set name=$3, kind=$4, managed=$5, location=$6, notes=$7, parent_id=$8, lat=$9, lng=$10, site_ref=$11,
              ip=$12, mac=$13, model=$14, freq_mhz=$15, ssid=$16, ping_router_id=$17,
              ping_ok = case when $18 then null else ping_ok end, ping_fails = case when $18 then 0 else ping_fails end,
              ping_at = case when $18 then null else ping_at end, down_since = case when $18 then null else down_since end
        where id=$1 and tenant_id=$2 returning *`,
      [id, tenantId, name, kind, b?.managed === undefined ? cur.managed : b.managed !== false,
        b?.location === undefined ? cur.location : text(b.location, 120), b?.notes === undefined ? cur.notes : text(b.notes, 1000), parent, at.lat, at.lng, b?.siteRef === undefined ? cur.site_ref : text(b.siteRef, 80), d.ip, d.mac, d.model, d.freq_mhz, d.ssid, d.router, d.reset]);
    return r;
  } catch (e) {
    if (e.code === '23505') throw bad(`There is already a link called "${name}".`);
    throw e;
  }
}

export async function deleteLink(pool, tenantId, id) {
  const { rowCount } = await pool.query('delete from shared_links where id=$1 and tenant_id=$2', [id, tenantId]);
  return rowCount > 0;
}

/** Put customers on a link (a customer sits on one link; adding moves them) or take them off it. Only this organisation's customers. */
export async function setMembers(pool, tenantId, id, { add = [], remove = [] }) {
  const { rows: [l] } = await pool.query('select id, kind from shared_links where id=$1 and tenant_id=$2', [id, tenantId]);
  if (!l) return null;
  // A customer with their own dish connects to the access point by their own assignment, so an access point is not something customers are
  // added to: they go on the switch or station they share (or a fibre ONU).
  if ((Array.isArray(add) ? add : []).length && !canHoldCustomers(l.kind)) {
    throw bad('Customers are put on a switch, a station or a fibre ONU. A customer with their own dish connects to the access point by their account assignment, not here.');
  }
  const ids = (a) => (Array.isArray(a) ? a : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  let added = 0; let removed = 0;
  if (ids(add).length) added = (await pool.query('update subscribers set shared_link_id=$1 where tenant_id=$2 and id = any($3::uuid[])', [id, tenantId, ids(add)])).rowCount;
  if (ids(remove).length) removed = (await pool.query('update subscribers set shared_link_id=null where tenant_id=$1 and shared_link_id=$2 and id = any($3::uuid[])', [tenantId, id, ids(remove)])).rowCount;
  return { added, removed };
}
