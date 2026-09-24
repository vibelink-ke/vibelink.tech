import { pool } from './db.js';
import * as ros from './routeros.js';
import * as secrets from './secrets.js';

/**
 * Bring the system in line with who is actually connected on each router, without waiting for anyone to drop and
 * redial.
 *
 * Everything the app knows about a live PPPoE customer (that they are online, their address, which router they are on,
 * the queues and pool tied to that router) starts from a RADIUS Accounting-Start, which is only sent when a session
 * begins. A customer who was already connected when accounting was switched on, or when the tunnel was down, or when
 * the router was moved, stays unknown until they reconnect. This reads each router's own active-connection list and:
 *
 *   - records a session for anyone connected that the system has no open session for (with the address and MAC the
 *     router reports and the real start time from its uptime), so they read as online with the right address;
 *   - refreshes the session it already has (address, last seen);
 *   - closes sessions of PPPoE customers the router no longer lists;
 *   - optionally moves a customer to the router they are really on (the same rule autoRelocateSubscribers applies).
 *
 * A router that cannot be read is left completely alone: nothing is closed on the strength of an answer that was
 * never given. Hotspot sessions are only noted as live; their accounting rows are not touched.
 */
export async function syncOnlineCustomers(tenantId, { relocate = false } = {}) {
  const startedAt = Date.now();
  const { rows: routers } = await pool.query(
    `select id, name, host, api_port, service_user, service_password_enc
       from routers where tenant_id=$1 and status = 'up' and service_user is not null and service_password_enc is not null`,
    [tenantId]);

  const { rows: subs } = await pool.query(
    "select id, pppoe_user, router_id from subscribers where tenant_id=$1 and service='pppoe' and pppoe_user is not null",
    [tenantId]);
  const known = new Set(subs.map((s) => s.pppoe_user));
  const before = new Map(subs.map((s) => [s.id, s.router_id]));

  const summary = { routers: [], online: 0, added: 0, closed: 0, moved: 0, unknown: 0 };

  await Promise.all(routers.map(async (r) => {
    const entry = { name: r.name, ok: false, online: 0, added: 0, closed: 0 };
    summary.routers.push(entry);
    const nas = String(r.host).split('/')[0];
    let sessions;
    try {
      const password = secrets.decrypt(r.service_password_enc);
      if (!password) throw new Error('no stored password');
      const conn = await ros.connect({ host: nas, port: r.api_port ?? 8728, user: r.service_user, password, timeoutSec: 8 });
      try {
        sessions = await ros.activeSessions(conn, { strict: true });
      } finally {
        ros.close(conn);
      }
    } catch (e) {
      entry.error = e.message;
      return;
    }
    entry.ok = true;
    entry.online = sessions.length;

    for (const s of sessions) {
      await pool.query(
        `insert into live_sessions (tenant_id, router_id, username, address, service, seen_at)
              values ($1,$2,$3,$4::inet,$5, now())
         on conflict (tenant_id, username) do update
            set router_id = excluded.router_id, address = excluded.address, service = excluded.service, seen_at = now()`,
        [tenantId, r.id, s.username, s.address, s.service]);
    }

    const pppoe = sessions.filter((s) => s.service === 'pppoe');
    for (const s of pppoe) {
      if (!known.has(s.username)) { summary.unknown += 1; continue; }
      const { rowCount } = await pool.query(
        `update radacct set acctupdatetime = now(), framedipaddress = coalesce($3::inet, framedipaddress),
                callingstationid = coalesce($4, callingstationid)
          where acctstoptime is null and username = $1 and nasipaddress = $2::inet`,
        [s.username, nas, s.address, s.mac]);
      if (rowCount) continue;
      const seconds = ros.durationSeconds(s.uptime) ?? 0;
      await pool.query(
        `insert into radacct (acctsessionid, acctuniqueid, username, nasipaddress, acctstarttime, acctupdatetime,
                              acctsessiontime, acctauthentic, callingstationid, framedipaddress, framedprotocol,
                              nasporttype, acctinputoctets, acctoutputoctets)
         values ($1,$2,$3,$4::inet, now() - ($5::int || ' seconds')::interval, now(), $5::int, 'RADIUS', $6, $7::inet, 'PPP', 'Ethernet', 0, 0)
         on conflict (acctuniqueid) do update set acctstoptime = null, acctupdatetime = now()`,
        [s.sessionId || `sync-${Math.floor(Date.now() / 1000)}`, `sync-${r.id}-${s.username}-${s.sessionId || Math.floor((Date.now() - seconds * 1000) / 1000)}`,
          s.username, nas, String(seconds), s.mac, s.address]);
      entry.added += 1;
    }

    // PPPoE customers this router no longer lists. Only rows quiet for a minute or more, so a customer who dialled in
    // after the list was read is not closed.
    const { rowCount: closed } = await pool.query(
      `update radacct set acctstoptime = coalesce(acctupdatetime, acctstarttime), acctterminatecause = 'Lost-Carrier'
        where acctstoptime is null and nasipaddress = $1::inet
          and username = any($2::text[]) and not (username = any($3::text[]))
          and coalesce(acctupdatetime, acctstarttime) < now() - interval '1 minute'`,
      [nas, [...known], pppoe.map((s) => s.username)]);
    entry.closed = closed;
    // and the live list follows: nobody is "online from the router" after it stopped saying so
    await pool.query(
      'delete from live_sessions where tenant_id=$1 and router_id=$2 and seen_at < $3', [tenantId, r.id, new Date(startedAt)]);
  }));

  for (const e of summary.routers) { summary.online += e.online; summary.added += e.added; summary.closed += e.closed; }

  if (relocate && summary.added) {
    const { autoRelocateSubscribers } = await import('./jobs.js');
    await autoRelocateSubscribers();
    const { rows: after } = await pool.query(
      "select id, router_id from subscribers where tenant_id=$1 and service='pppoe'", [tenantId]);
    summary.moved = after.filter((s) => before.has(s.id) && before.get(s.id) !== s.router_id).length;
  }
  return summary;
}
