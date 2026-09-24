/**
 * A router's queues, brought in line with the database.
 *
 * What belongs in a router's Simple Queue list is decided here and nowhere else,
 * so a manual Refresh, the two-minute automatic pass and a payment all agree:
 *
 *   - one queue per customer entitled to service: SiPLMT_US_<username>, target
 *     their address, the plan's rate, their name as the comment;
 *   - a shared pool queue per contended plan, with each of its customers as a
 *     member (comment "ispContention member — <name>");
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

/**
 * Returns the sentences a Configure result shows. Never throws for a queue-level
 * problem: those are reported, so the customers-stay-online work around it is not
 * marked failed for the sake of a list.
 */
export async function syncRouterQueues(conn, { tenantId, routerId, role, wipe = false, lines = null }) {
  const out = [];

  if (role === 'both' || role === 'pppoe') {
    const all = lines ?? await customerLines(tenantId, routerId);
    let cleared = 0;
    if (wipe) cleared = await ros.wipeSimpleQueues(conn);

    const q = await ros.syncSubscriberQueues(conn, {
      wanted: all.filter((l) => l.entitled).map((l) => ({
        pppoeUser: l.pppoe_user, address: l.address, rateDown: l.rate_down, rateUp: l.rate_up, customerName: l.name,
      })),
      drop: wipe ? [] : all.filter((l) => !l.entitled).map((l) => l.pppoe_user),
    });
    out.push((wipe ? `queues cleared (${cleared}) and rewritten: ` : 'customer queues: ')
      + `${q.added} added, ${q.updated} updated, ${q.same} already correct, ${q.removed} removed`
      + (q.leftover ? `; ${q.leftover} ${ros.SUB_QUEUE_PREFIX} queue(s) match no customer here and were left alone` : '')
      + (q.failed ? `; ${q.failed} failed (first: ${q.firstError})` : ''));

    // Contention pools and members. Only on a full rewrite: on the routine pass
    // each would cost two lookups per customer, every two minutes, for lines that
    // almost never change. A payment or plan change keeps a single member current.
    if (wipe) {
      const contended = all.filter((l) => l.entitled && l.plan_id && l.contention_ratio > 1);
      const pools = new Map(contended.map((l) => [l.plan_id, l]));
      for (const [planId, l] of pools) {
        await ros.ensureContentionPool(conn, { name: `contention-${planId}`, rateDown: l.rate_down, rateUp: l.rate_up });
      }
      let members = 0;
      for (const l of contended) {
        try {
          await ros.ensureContentionMember(conn, {
            poolName: `contention-${l.plan_id}`, pppoeUser: l.pppoe_user,
            rateDown: l.rate_down, rateUp: l.rate_up, customerName: l.name,
          });
          members += 1;
        } catch { /* reported by the count below */ }
      }
      if (contended.length) out.push(`contention: ${pools.size} shared pool(s), ${members} of ${contended.length} member queue(s)`);
    }
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
