import { hasPermission } from './permissions.js';

/**
 * The "Today" home screen's figures, in one call. Each part is included only when the staff member's role may see it,
 * so a technician gets sites and tickets, a cashier gets money and payments, and the owner gets everything.
 * Days are Nairobi days.
 */
export function registerToday(app, { pool, wrap }) {
  app.get('/api/today', wrap(async (req, res) => {
    const t = req.tenant.id;
    const may = async (key) => !!(req.session?.is_super_admin || await hasPermission(t, req.session?.role, key));
    const [money, clients, routers, tickets, leads] = await Promise.all(
      ['payments.view', 'clients.view', 'routers.view', 'tickets.view', 'leads.view'].map(may));
    const out = { attention: [] };
    const safe = (p) => p.catch((e) => { console.warn('today:', e.message); return { rows: [] }; });
    const day = "(now() at time zone 'Africa/Nairobi')::date";

    const jobs = [];
    if (money) {
      jobs.push(safe(pool.query(
        `select d::date as day, coalesce(sum(p.amount), 0) as total, count(p.id)::int as n
           from generate_series(${day} - 13, ${day}, interval '1 day') d
           left join payments p on p.tenant_id=$1 and p.status='applied' and (p.received_at at time zone 'Africa/Nairobi')::date = d::date
          group by d order by d`, [t])).then(({ rows }) => {
        const days = rows.map((r) => ({ day: r.day, total: Number(r.total), n: r.n }));
        out.money = { days, today: days.at(-1)?.total ?? 0, todayCount: days.at(-1)?.n ?? 0 };
      }));
      // Yesterday up to this same time of day, so the morning's figure is not compared with a whole day.
      jobs.push(safe(pool.query(
        `select coalesce(sum(amount), 0) as total from payments where tenant_id=$1 and status='applied'
            and received_at >= ((${day} - 1)::timestamp at time zone 'Africa/Nairobi') and received_at < now() - interval '1 day'`, [t]))
        .then(({ rows: [r] }) => { out.moneyYesterdaySoFar = Number(r?.total ?? 0); }));
      jobs.push(safe(pool.query(`select count(*)::int as n from payments where tenant_id=$1 and status='unmatched'`, [t])).then(({ rows: [r] }) => {
        if (r?.n) out.attention.push({ level: 'high', text: `${r.n} payment${r.n === 1 ? '' : 's'} not matched to anyone`, to: '/payments?tab=unmatched' });
      }));
      jobs.push(safe(pool.query(
        `select count(*)::int as n from stk_requests where (tenant_id=$1 or purpose->>'tenant_id'=$1::text)
            and status='failed' and result_desc like 'paid, but could not be applied%' and created_at > now() - interval '7 days'`, [t])).then(({ rows: [r] }) => {
        if (r?.n) out.attention.push({ level: 'high', text: `${r.n} paid but not applied in the last week`, to: '/issues' });
      }));
    }
    if (clients) {
      jobs.push(safe(pool.query(
        `select id, name, account_code from subscribers where tenant_id=$1 and status in ('active','grace')
            and (expires_at at time zone 'Africa/Nairobi')::date = ${day} order by expires_at limit 200`, [t])).then(({ rows }) => {
        out.expiring = { count: rows.length, first: rows.slice(0, 5) };
      }));
      jobs.push(safe(pool.query(
        `select count(*)::int as n from subscribers where tenant_id=$1 and status in ('expired','suspended')
            and (expires_at at time zone 'Africa/Nairobi')::date = ${day} - 1`, [t])).then(({ rows: [r] }) => {
        out.expiredYesterday = r?.n ?? 0;
      }));
    }
    if (routers) {
      jobs.push(safe(pool.query(
        `select id, name, offline_since, last_seen from routers where tenant_id=$1 and status='down' order by coalesce(offline_since, last_seen) nulls last limit 20`, [t]))
        .then(({ rows }) => { out.sitesDown = rows; }));
      jobs.push(safe(pool.query(`select count(*)::int as n from routers where tenant_id=$1`, [t])).then(({ rows: [r] }) => { out.sitesTotal = r?.n ?? 0; }));
    }
    if (tickets) {
      jobs.push(safe(pool.query(
        `select count(*) filter (where created_at < now() - interval '24 hours')::int as old, count(*)::int as open
           from tickets where tenant_id=$1 and status in ('open','in_progress')`, [t])).then(({ rows: [r] }) => {
        out.tickets = { open: r?.open ?? 0, old: r?.old ?? 0 };
        if (r?.old) out.attention.push({ level: 'medium', text: `${r.old} ticket${r.old === 1 ? '' : 's'} waiting over 24 hours`, to: '/tickets' });
      }));
      jobs.push(safe(pool.query(`select count(*)::int as n from outages where tenant_id=$1 and status='active'`, [t])).then(({ rows: [r] }) => {
        if (r?.n) out.attention.push({ level: 'high', text: `${r.n} outage${r.n === 1 ? '' : 's'} still open`, to: '/outages' });
      }));
    }
    if (leads) {
      jobs.push(safe(pool.query(
        `select count(*)::int as n from leads where tenant_id=$1 and (created_at at time zone 'Africa/Nairobi')::date = ${day}`, [t]))
        .then(({ rows: [r] }) => { if (r?.n) out.attention.push({ level: 'low', text: `${r.n} new lead${r.n === 1 ? '' : 's'} today`, to: '/work' }); }));
    }
    await Promise.all(jobs);
    const rank = { high: 0, medium: 1, low: 2 };
    out.attention.sort((a, b) => rank[a.level] - rank[b.level]);
    res.json(out);
  }));
}
