/**
 * A router's queues, brought in line with the database.
 *
 * What belongs in a router's Simple Queue list is decided here and nowhere else,
 * so a manual Refresh, the two-minute automatic pass and a payment all agree:
 *
 *   - customers on a contended plan are grouped by (speed, contention ratio):
 *     one parent queue per group, MAIN_TARIFF_<speed>, targeting every member's
 *     address, its limit the combined rate of the members, and each member's own
 *     queue (SiPLMT_US_<username>) listed beneath it;
 *   - every other customer entitled to service has one queue of their own,
 *     SiPLMT_US_<username>: their address, the plan's rate, their name as comment;
 *   - the speed cap of every hotspot device bound to a code that is still running.
 *
 * Refresh wipes the list and writes it fresh (`wipe: true`). The automatic pass
 * only changes what differs and never removes a queue it does not recognise.
 */
import { pool } from './db.js';
import * as ros from './routeros.js';

const ENTITLED = ['active', 'grace'];

/** First host address of a CIDR — the gateway the PPP profile hands out as its own end. */
export function gatewayOf(cidr) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(cidr ?? '').trim());
  if (!m) return null;
  const bits = Number(m[5]);
  if (bits < 8 || bits > 30) return null;
  const ip = ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
  const net = (ip & (0xffffffff << (32 - bits))) >>> 0;
  const gw = (net + 1) >>> 0;
  return [gw >>> 24, (gw >>> 16) & 255, (gw >>> 8) & 255, gw & 255].join('.');
}

const ipNumber = (a) => String(a).split('/')[0].split('.').reduce((n, o) => n * 256 + Number(o), 0);

/** Every PPPoE customer on a router, with the address RADIUS gives them and their plan. */
export async function customerLines(tenantId, routerId) {
  const { rows } = await pool.query(
    `select s.pppoe_user, s.name, s.status, s.plan_id, p.rate_down, p.rate_up, p.contention_ratio,
            rr.value as address
       from subscribers s
       left join plans p on p.id = s.plan_id
       left join radreply rr on rr.tenant_id = s.tenant_id and rr.username = s.pppoe_user
                            and rr.attribute = 'Framed-IP-Address'
      where s.tenant_id=$1 and s.router_id=$2 and s.service='pppoe' and s.pppoe_user is not null`,
    [tenantId, routerId]);
  return rows.map((l) => ({
    ...l,
    entitled: ENTITLED.includes(l.status) && !!l.address && l.rate_down != null && l.rate_up != null,
  }));
}

/** A short fingerprint of what the router should hold, so an unchanged router is not queried again. */
export function signature(lines) {
  return lines
    .filter((l) => l.entitled)
    .map((l) => `${l.pppoe_user}|${l.address}|${l.rate_down}|${l.rate_up}|${l.name ?? ''}|${l.contention_ratio ?? ''}`)
    .sort()
    .join('\n');
}

// 5000 -> "5", 1500 -> "1.5"
const mbps = (k) => String(Math.round((Number(k) / 1000) * 100) / 100);

/**
 * Splits customers into shared-tariff groups and single queues.
 *
 * The group's name is MAIN_TARIFF_<speed>Mbps (download, plus _<up>Mbps when the
 * upload differs). Two ratios at one speed on the same router would share a name,
 * so those alone also get _1to<ratio>.
 */
export function queuePlan(lines) {
  const entitled = lines.filter((l) => l.entitled);
  const drop = lines.filter((l) => !l.entitled).map((l) => l.pppoe_user);

  const contended = new Map();
  const singles = [];
  for (const l of entitled) {
    const member = { pppoeUser: l.pppoe_user, address: l.address, rateDown: l.rate_down, rateUp: l.rate_up, customerName: l.name };
    if (l.plan_id && Number(l.contention_ratio) > 1) {
      const key = `${l.rate_down}|${l.rate_up}|${l.contention_ratio}`;
      if (!contended.has(key)) contended.set(key, { rateDown: Number(l.rate_down), rateUp: Number(l.rate_up), ratio: Number(l.contention_ratio), members: [] });
      contended.get(key).members.push(member);
    } else {
      singles.push(member);
    }
  }

  const base = (g) => `${ros.MAIN_TARIFF_PREFIX}${mbps(g.rateDown)}Mbps${g.rateUp === g.rateDown ? '' : `_${mbps(g.rateUp)}Mbps`}`;
  const perBase = new Map();
  for (const g of contended.values()) perBase.set(base(g), (perBase.get(base(g)) ?? 0) + 1);

  const groups = [...contended.values()].map((g) => {
    g.members.sort((a, b) => ipNumber(a.address) - ipNumber(b.address));
    return {
      name: perBase.get(base(g)) > 1 ? `${base(g)}_1to${g.ratio}` : base(g),
      rateDown: g.members.reduce((n, m) => n + Number(m.rateDown), 0),
      rateUp: g.members.reduce((n, m) => n + Number(m.rateUp), 0),
      addresses: g.members.map((m) => m.address),
      members: g.members,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return { groups, singles, drop };
}

/**
 * Returns the sentences a Configure result shows. Never throws for a queue-level
 * problem: those are reported, so the customers-stay-online work around it is not
 * marked failed for the sake of a list.
 */
export async function syncRouterQueues(conn, { tenantId, routerId, role, wipe = false, lines = null }) {
  const out = [];

  if (role === 'both' || role === 'pppoe') {
    const all = lines ?? await customerLines(tenantId, routerId);
    const cleared = wipe ? await ros.wipeSimpleQueues(conn) : 0;
    const plan = queuePlan(all);
    // A full rewrite has nothing left to drop; the routine pass removes the queue
    // of a customer who is no longer entitled to service.
    const q = await ros.syncQueuePlan(conn, { ...plan, drop: wipe ? [] : plan.drop });
    const inGroups = plan.groups.reduce((n, g) => n + g.members.length, 0);
    out.push((wipe ? `queues cleared (${cleared}) and rewritten: ` : 'queues: ')
      + `${q.added} added, ${q.updated} updated, ${q.same} already correct, ${q.removed} removed`
      + (plan.groups.length ? `; ${plan.groups.length} shared tariff(s) holding ${inGroups} customer(s): ${plan.groups.map((g) => g.name).join(', ')}` : '')
      + (q.leftover ? `; ${q.leftover} ${ros.SUB_QUEUE_PREFIX} queue(s) match no customer here and were left alone` : '')
      + (q.failed ? `; ${q.failed} failed (first: ${q.firstError})` : ''));
  } else if (wipe) {
    const cleared = await ros.wipeSimpleQueues(conn);
    out.push(`queues cleared (${cleared})`);
  }

  // Devices locked to a paid code get their cap from a queue of their own, since
  // a bypassed device never goes through RADIUS. A wipe removes those, so they are
  // written back here; on the routine pass they are not touched at all.
  if (wipe && (role === 'both' || role === 'hotspot')) {
    const { rows: devices } = await pool.query(
      `select d.mac, v.code, d.label, p.rate_down, p.rate_up
         from voucher_devices d
         join vouchers v on v.id = d.voucher_id
         left join plans p on p.id = v.plan_id
        where d.router_id=$1 and d.unbound_at is null and v.tenant_id=$2
          and v.status = 'in_use' and (v.expires_at is null or v.expires_at > now())`,
      [routerId, tenantId]);
    let ok = 0; let skipped = 0;
    for (const d of devices) {
      try {
        await ros.bindDeviceByMac(conn, {
          mac: d.mac, downKbps: d.rate_down ?? 2000, upKbps: d.rate_up ?? 1000,
          comment: d.label ? `${d.code} — ${d.label}` : d.code,
        });
        ok += 1;
      } catch { skipped += 1; }
    }
    if (devices.length) out.push(`device speed caps: ${ok} re-applied${skipped ? `, ${skipped} skipped (not on the network right now)` : ''}`);
  }
  return out;
}

/**
 * The PPP profile's own end of the link. Without it every login authenticates and
 * is dropped a second later ("could not determine remote IP address"), so it is
 * checked on every pass and put back if it has gone. Only ever fills a missing
 * value in: one an operator set on purpose is left as it is.
 */
export async function repairPppProfile(conn, pppoePool, profileName = 'vibelink-pppoe') {
  const gateway = gatewayOf(pppoePool);
  if (!gateway) return null;
  const profile = (await conn.write('/ppp/profile/print', [`?name=${profileName}`]))[0];
  if (!profile || profile['local-address']) return null;
  await conn.write('/ppp/profile/set', [`=.id=${profile['.id']}`, `=local-address=${gateway}`]);
  return `PPP profile ${profileName} had no local-address; set it to ${gateway}`;
}
