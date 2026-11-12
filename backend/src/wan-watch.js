/**
 * Watching the internet links of routers that have more than one (wan-balance.js). Every pass asks each such router which of its links is
 * carrying traffic and how many bytes each link's interface has moved, and from that:
 *   - tells the owner when a link goes down and when it comes back (the same channel as the router-offline alert),
 *   - keeps the history of those changes (wan_link_events), for the outage count and downtime,
 *   - adds up each link's traffic per day (wan_link_usage) and its speed between the last two passes.
 *
 * A router that billing cannot reach is skipped: that is the router-offline alert's business, and nothing can be said about its links.
 */
import { pool, enabledTenants } from './db.js';

const QUIET_MINUTES = 15;   // a link that flaps is announced once per this long, not on every pass

let running = false;

export async function watchWanLinks({ notify }) {
  if (running) return;
  running = true;
  try {
    const ros = await import('./routeros.js');
    const wb = await import('./wan-balance.js');
    const secrets = await import('./secrets.js');
    const { rows } = await pool.query(
      `select id, tenant_id, name, host, api_port, service_user, service_password_enc, wan_balance
         from routers
        where wan_balance is not null and status = 'up'
          and service_user is not null and service_password_enc is not null
          and tenant_id in (${enabledTenants})`, ['watchWanLinks']);
    for (const r of rows) {
      let conn;
      try {
        const password = secrets.decrypt(r.service_password_enc);
        if (!password) continue;
        conn = await ros.connect({ host: String(r.host).split('/')[0], port: r.api_port ?? 8728, user: r.service_user, password, timeoutSec: 8 });
        const now = await wb.sample(conn, r.wan_balance.config);
        if (!now) {
          // The routes are gone: the router undid the setup by itself, or someone removed it by hand.
          await pool.query('update routers set wan_balance = null where id = $1', [r.id]);
          await notify(r.tenant_id, `${r.name}: the load sharing / failover setup is no longer on the router. It is using its own default route. Set it up again from Routers > Internet links if it is still wanted.`);
          continue;
        }
        await record(r, now, notify);
      } catch (e) {
        console.warn('watchWanLinks:', r.name, '-', e.message);
      } finally {
        if (conn) ros.close(conn);
      }
    }
  } finally {
    running = false;
  }
}

/** Compare this reading with the last one kept on the router's row, and store what follows from the difference. */
export async function record(r, now, notify) {
  const before = r.wan_balance.state ?? null;
  const at = Date.now();
  const seconds = before?.at ? (at - new Date(before.at).getTime()) / 1000 : null;
  const links = [];
  for (const l of now) {
    const p = (before?.links ?? []).find((x) => x.n === l.n && x.iface === l.iface) ?? null;
    const grown = (cur, old) => (cur == null || old == null ? 0 : cur >= old ? cur - old : cur);   // a smaller counter means the router restarted
    const rx = p ? grown(l.rx, p.rx) : 0;
    const tx = p ? grown(l.tx, p.tx) : 0;
    if (rx || tx) {
      await pool.query(
        `insert into wan_link_usage (tenant_id, router_id, iface, day, rx_bytes, tx_bytes)
         values ($1, $2, $3, (now() at time zone 'Africa/Nairobi')::date, $4, $5)
         on conflict (router_id, iface, day) do update
           set rx_bytes = wan_link_usage.rx_bytes + excluded.rx_bytes, tx_bytes = wan_link_usage.tx_bytes + excluded.tx_bytes`,
        [r.tenant_id, r.id, l.iface, rx, tx]);
    }
    const steady = seconds && seconds > 20 && seconds < 900;   // a speed over a gap of a quarter of an hour says nothing about now
    const next = {
      n: l.n, iface: l.iface, up: l.up, rx: l.rx, tx: l.tx,
      rxBps: steady && p ? Math.round((rx * 8) / seconds) : null,
      txBps: steady && p ? Math.round((tx * 8) / seconds) : null,
      since: p && p.up === l.up ? p.since : new Date(at).toISOString(),
      told: p?.told ?? false,            // was the owner told about the outage this link is in (or was last in)
      toldAt: p?.toldAt ?? null,
    };
    if (p && p.up !== l.up) {
      await pool.query('insert into wan_link_events (tenant_id, router_id, link, iface, up) values ($1,$2,$3,$4,$5)', [r.tenant_id, r.id, l.n, l.iface, l.up]);
      if (!l.up) {
        const quiet = p.toldAt && (at - new Date(p.toldAt).getTime()) / 60000 < QUIET_MINUTES;
        next.told = !quiet;
        if (!quiet) {
          next.toldAt = new Date(at).toISOString();
          const others = now.filter((o) => o.n !== l.n && o.up).length;
          await notify(r.tenant_id, `${r.name}: internet link ${l.n} (${l.iface}) is down. `
            + (others ? `Customers are using the other link${others === 1 ? '' : 's'}.` : 'No other link is up, so customers on this router have no internet.'));
        }
      } else if (p.told) {
        const mins = p.since ? Math.max(1, Math.round((at - new Date(p.since).getTime()) / 60000)) : null;
        next.told = false;
        await notify(r.tenant_id, `${r.name}: internet link ${l.n} (${l.iface}) is back${mins ? ` after ${mins} minute${mins === 1 ? '' : 's'}` : ''}.`);
      }
    }
    links.push(next);
  }
  await pool.query(
    `update routers set wan_balance = jsonb_set(wan_balance, '{state}', $2::jsonb) where id = $1 and wan_balance is not null`,
    [r.id, JSON.stringify({ at: new Date(at).toISOString(), links })]);
}

/** What the Internet links screen shows under the setup: each link's state and speed, its traffic, and its outages in the last 30 days. */
export async function wanStats(router) {
  const { rows: usage } = await pool.query(
    `with d as (select (now() at time zone 'Africa/Nairobi')::date as today)
     select iface,
            coalesce(sum(rx_bytes) filter (where day = d.today), 0)::float8 as rx_today,
            coalesce(sum(tx_bytes) filter (where day = d.today), 0)::float8 as tx_today,
            coalesce(sum(rx_bytes) filter (where day > d.today - 7), 0)::float8 as rx_7,
            coalesce(sum(tx_bytes) filter (where day > d.today - 7), 0)::float8 as tx_7,
            coalesce(sum(rx_bytes), 0)::float8 as rx_30,
            coalesce(sum(tx_bytes), 0)::float8 as tx_30
       from wan_link_usage, d
      where router_id = $1 and day > d.today - 30
      group by iface`, [router.id]);
  const { rows: events } = await pool.query(
    `select link, iface, up, at from wan_link_events
      where router_id = $1 and at > now() - interval '30 days' order by at asc`, [router.id]);
  // An outage runs from a "down" to the next "up" of the same link, or to now if it is still down.
  const outages = {};
  const open = {};
  for (const e of events) {
    const o = (outages[e.link] ??= { count: 0, minutes: 0 });
    if (!e.up) { o.count += 1; open[e.link] = new Date(e.at).getTime(); }
    else if (open[e.link]) { o.minutes += (new Date(e.at).getTime() - open[e.link]) / 60000; delete open[e.link]; }
  }
  for (const [link, since] of Object.entries(open)) outages[link].minutes += (Date.now() - since) / 60000;
  for (const o of Object.values(outages)) o.minutes = Math.round(o.minutes);
  return { state: router.wan_balance?.state ?? null, usage, outages, recent: events.slice(-12).reverse() };
}
