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

export const OFFLINE_MINUTES = 3;
const FRESH_SECONDS = 180;            // a MAC seen on the bridge this recently is alive (RouterOS ages entries out after ~5 minutes)
const PINGS_PER_ROUTER = 20;
const MAX_NEW_PER_PASS = 200;
const MAX_PER_ROUTER = 500;

/** Names an extender gives itself when it asks for an address. */
const EXTENDER_NAME = /tenda|tp-?link|^tl-|mercusys|^mw\d|repeater|extender|\bap\b|access.?point|router|mesh|ruijie|totolink|d-?link|netis|wavlink|cudy|\bwifi\b|wlan/i;

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

/** What one router can tell us: the MACs on its bridge, who holds a lease, and which interfaces are wired. */
export async function chainSnapshot(conn) {
  const [hostRows, leaseRows, ifaceRows] = await Promise.all([
    conn.write('/interface/bridge/host/print', []),
    conn.write('/ip/dhcp-server/lease/print', []).catch(() => []),
    conn.write('/interface/print', []),
  ]);
  const hosts = hostRows.map((r) => ({
    mac: normMac(r['mac-address']), port: String(r['on-interface'] ?? ''), local: String(r.local) === 'true',
    ageSec: parseRosAge(r.age),
  })).filter((h) => h.mac && h.port);
  const leases = leaseRows.map((r) => ({
    mac: normMac(r['active-mac-address'] || r['mac-address']), address: String(r['active-address'] || r.address || ''),
    hostname: String(r['host-name'] ?? ''), seenSec: parseRosAge(r['last-seen']),
  })).filter((l) => l.mac);
  const wired = new Set(ifaceRows.filter((i) => String(i.type) === 'ether').map((i) => String(i.name)));
  return { hosts, leases, wired };
}

/**
 * Pick the chained routers out of a snapshot. On each wired bridge port, a router (or several chained one behind the other) is the device that
 * names itself like one, or failing that the most router-looking MAC among a group of devices on the port: a universal (not private) MAC that
 * holds a lease. A lone device only counts when it names itself like a router, so a laptop on a cable is not taken for one.
 * Returns [{ mac, port, behind, ip, hostname, confidence: 'high' | 'likely' }].
 */
export function detectChained({ hosts, leases, wired }) {
  const lease = new Map(leases.map((l) => [l.mac, l]));
  const byPort = new Map();
  for (const h of hosts) {
    if (h.local || !wired.has(h.port) || !MAC.test(h.mac) || multicast(h.mac)) continue;
    if (!byPort.has(h.port)) byPort.set(h.port, new Set());
    byPort.get(h.port).add(h.mac);
  }
  const out = [];
  for (const [port, macs] of byPort) {
    const scored = [...macs].map((mac) => {
      const l = lease.get(mac);
      const hostname = l?.hostname ?? '';
      const hint = EXTENDER_NAME.test(hostname);
      const score = (hint ? 4 : 0) + (universal(mac) ? 1 : -3) + (l?.address ? 1 : 0);
      return { mac, hostname, ip: l?.address || null, hint, score };
    }).sort((a, b) => b.score - a.score || (a.mac < b.mac ? -1 : 1));
    const need = macs.size >= 3 ? 2 : macs.size === 2 ? 3 : Infinity;
    const top = scored[0];
    if (!(top.hint || top.score >= need)) continue;
    const hinted = scored.filter((s) => s.hint);
    for (const c of hinted.length ? hinted : [top]) {
      out.push({ mac: c.mac, port, behind: macs.size - 1, ip: c.ip, hostname: c.hostname, confidence: c.hint ? 'high' : 'likely' });
    }
  }
  return out;
}

/** Is a chained router alive right now: on the bridge recently, or leased recently. */
export function aliveFromSnapshot(mac, snap) {
  const h = snap.hosts.find((x) => x.mac === mac);
  if (h && h.ageSec <= FRESH_SECONDS) return true;
  const l = snap.leases.find((x) => x.mac === mac);
  return !!(l && l.seenSec <= FRESH_SECONDS);
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const label = (c) => c.name || c.hostname || c.mac;

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
    const found = detectChained(snap);
    const { rows: known } = await pool.query('select * from chained_routers where tenant_id=$1 and router_id=$2 limit $3', [r.tenant_id, r.id, MAX_PER_ROUTER]);
    const byMac = new Map(known.map((k) => [k.mac, k]));
    let added = 0;
    for (const f of found) {
      const have = byMac.get(f.mac);
      if (have) {
        await pool.query(
          `update chained_routers set port=$2, behind=$3, ip=coalesce($4, ip), hostname=coalesce(nullif($5,''), hostname) where id=$1`,
          [have.id, f.port, f.behind, f.ip, f.hostname]);
        continue;
      }
      if (added >= MAX_NEW_PER_PASS) break;
      const { rows: [made] } = await pool.query(
        `insert into chained_routers (tenant_id, router_id, mac, ip, hostname, port, behind, confidence, status, last_seen)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'up', now())
         on conflict (tenant_id, mac) do update set router_id = excluded.router_id, port = excluded.port, behind = excluded.behind
         returning *`,
        [r.tenant_id, r.id, f.mac, f.ip, f.hostname || null, f.port, f.behind, f.confidence]);
      added += 1;
      if (made) byMac.set(made.mac, made);
    }

    // ── watch: every chained router on this router that is not ignored ──
    const downNow = []; const recovered = [];
    let pings = 0;
    for (const c of byMac.values()) {
      if (c.ignored || c.router_id !== r.id) continue;
      let alive = aliveFromSnapshot(c.mac, snap);
      const ip = c.ip && IPV4.test(c.ip) ? c.ip : null;
      if (!alive && ip && pings < PINGS_PER_ROUTER) {
        pings += 1;
        const res = await ros.pingHost(conn, ip, 2).catch(() => null);
        if (res === null) continue;                          // the router could not ping: no answer either way
        alive = res.received > 0;
      }
      if (alive) {
        await pool.query(`update chained_routers set status='up', last_seen=now(), ping_fails=0, offline_since=null, offline_notified=false where id=$1`, [c.id]);
        if (c.offline_notified) recovered.push(c);
        continue;
      }
      const fails = Number(c.ping_fails) + 1;
      if (fails < 2) { await pool.query('update chained_routers set ping_fails=$2 where id=$1', [c.id, fails]); continue; }
      await pool.query(`update chained_routers set status='down', ping_fails=$2, offline_since=coalesce(offline_since, now()) where id=$1`, [c.id, fails]);
      const since = c.offline_since ? new Date(c.offline_since) : new Date();
      if (!c.offline_notified && (Date.now() - since) / 60000 >= OFFLINE_MINUTES) {
        await pool.query('update chained_routers set offline_notified=true where id=$1', [c.id]);
        downNow.push(c);
      }
    }

    // ── tell the owner: one message however many went down together ──
    const opts = { url: '/hotspot/chaining', title: 'Chained router' };
    if (downNow.length) {
      const names = downNow.slice(0, 6).map(label).join(', ');
      const ports = [...new Set(downNow.map((c) => c.port).filter(Boolean))];
      await notify(r.tenant_id, downNow.length === 1
        ? `${label(downNow[0])} (${downNow[0].mac}), a router chained to ${r.name}${downNow[0].port ? ` on ${downNow[0].port}` : ''}, has stopped answering. About ${downNow[0].behind} device${downNow[0].behind === 1 ? '' : 's'} were behind it.`
        : `${downNow.length} routers chained to ${r.name} have stopped answering${ports.length === 1 ? ` (all on ${ports[0]}: check that cable or switch first)` : ''}: ${names}${downNow.length > 6 ? ', …' : ''}.`, opts);
    }
    if (recovered.length) {
      await notify(r.tenant_id, recovered.length === 1 ? `${label(recovered[0])} (chained to ${r.name}) is back.` : `${recovered.length} chained routers on ${r.name} are back.`, opts);
    }
    return { added, watched: byMac.size, down: downNow.length };
  } finally {
    if (conn) ros.close(conn);
  }
}

/** The scheduled job: every hotspot router that is up. A router that is down says nothing about what is behind it, so those are "unknown". */
export async function watchChainedRouters({ notify }) {
  const { rows: routers } = await pool.query(
    `select id, tenant_id, name, host, api_port, service_user, service_password_enc
       from routers
      where role in ('hotspot','both') and status = 'up' and service_user is not null and service_password_enc is not null
        and tenant_id in (${enabledTenants})`, ['watchChainedRouters']);
  await pool.query(
    `update chained_routers c set status='unknown', ping_fails=0
       from routers r where r.id = c.router_id and r.status <> 'up' and c.status <> 'unknown'`);
  if (!routers.length) return;
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  for (const r of routers) {
    try { await pass(r, { ros, secrets, notify }); } catch (e) { console.warn('watchChainedRouters:', r.name, '-', e.message); }
  }
}

/** Look at one router now (the Scan button): learn and check it once, without telling anyone. */
export async function scanRouter(tenantId, routerId) {
  const { rows: [r] } = await pool.query(
    `select id, tenant_id, name, host, api_port, service_user, service_password_enc, status
       from routers where id=$1 and tenant_id=$2`, [routerId, tenantId]);
  if (!r) throw Object.assign(new Error('No such router'), { status: 404 });
  if (r.status !== 'up' || !r.service_user || !r.service_password_enc) {
    throw Object.assign(new Error('That router is not reachable right now, so it cannot be scanned.'), { status: 409 });
  }
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  return pass(r, { ros, secrets, notify: async () => {} });
}

// ── what the screen and the API use ──

export async function listChained(tenantId) {
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
export async function addChained(tenantId, { routerId, mac, name }) {
  if (!validMac(mac)) throw bad('The MAC address must look like AA:BB:CC:DD:EE:FF.');
  const { rows: [r] } = await pool.query('select id from routers where id=$1 and tenant_id=$2', [routerId, tenantId]);
  if (!r) throw bad('Choose the router it hangs off.');
  try {
    const { rows: [c] } = await pool.query(
      `insert into chained_routers (tenant_id, router_id, mac, name, confidence, status) values ($1,$2,$3,$4,'manual','unknown') returning *`,
      [tenantId, routerId, normMac(mac), text(name, 80)]);
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
