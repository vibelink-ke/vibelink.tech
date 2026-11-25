/**
 * Customer experience score: 0 to 10 for every home customer and every site, from what the system already records.
 *
 * Over the last 7 days:
 *   - reconnects: sessions started per day beyond the first (a line that keeps dropping starts a new session each time);
 *   - very short sessions (under 5 minutes): a link that cannot hold;
 *   - the customer's own latest speed test (last 14 days), against their package;
 *   - tickets they opened in the last 14 days.
 * 10 is a customer with none of these. A customer with no sessions at all in the week has no score: being offline by
 * choice (travelling, switched off) is not something the records can tell apart.
 *
 * "Likely to leave": a low score together with money trouble (an overdue invoice, or already expired), or a very low
 * score with repeated tickets. It is a list to call, not a prediction.
 */
const DAYS = 7;

export function scoreOf(r) {
  const sessions = Number(r.sessions ?? 0);
  if (!sessions) return { score: null, reasons: ['No sessions this week'] };
  const reasons = [];
  let pen = 0;
  const extraPerDay = Math.max(0, sessions / DAYS - 1);
  if (extraPerDay > 0.3) {
    const p = Math.min(5, extraPerDay * 0.8);
    pen += p;
    reasons.push(`${Math.round(sessions / DAYS * 10) / 10} connections a day`);
  }
  const short = Number(r.short ?? 0);
  if (sessions >= 3 && short / sessions > 0.2) {
    pen += Math.min(2, (short / sessions) * 3);
    reasons.push(`${short} of ${sessions} sessions under 5 minutes`);
  }
  if (r.down_mbps != null && Number(r.plan_down_kbps) > 0) {
    const share = (Number(r.down_mbps) * 1000) / Number(r.plan_down_kbps);
    if (share < 0.4) { pen += 2; reasons.push(`speed test ${Number(r.down_mbps)} of ${Number(r.plan_down_kbps) / 1000} Mbps`); }
    else if (share < 0.7) { pen += 1; reasons.push(`speed test ${Math.round(share * 100)}% of package`); }
  }
  const tickets = Number(r.tickets ?? 0);
  if (tickets) { pen += Math.min(1.5, tickets * 0.75); reasons.push(`${tickets} ticket${tickets === 1 ? '' : 's'} in 2 weeks`); }
  const score = Math.round(Math.max(0, Math.min(10, 10 - pen)) * 10) / 10;
  return { score, reasons };
}

export function atRisk(r, score) {
  if (score == null) return false;
  const owes = Number(r.owed ?? 0) > 0 || r.status === 'expired';
  return (score < 6 && owes) || (score < 4 && Number(r.tickets ?? 0) >= 2);
}

async function rowsFor(pool, tenantId, subscriberId = null) {
  const { rows: [has] } = await pool.query("select to_regclass('speed_tests') is not null as yes");
  const speed = has?.yes
    ? `st as (select distinct on (subscriber_id) subscriber_id, down_mbps, plan_down_kbps from speed_tests
               where tenant_id=$1 and subscriber_id is not null and created_at > now() - interval '14 days'
               order by subscriber_id, created_at desc),`
    : 'st as (select null::uuid as subscriber_id, null::numeric as down_mbps, null::int as plan_down_kbps where false),';
  const { rows } = await pool.query(
    `with s as (
       select subscriber_id, count(*)::int as sessions,
              count(*) filter (where stopped_at is not null and stopped_at - started_at < interval '5 minutes')::int as short
         from sessions where tenant_id=$1 and subscriber_id is not null and started_at > now() - interval '${DAYS} days'
        group by subscriber_id),
     ${speed}
     tk as (select subscriber_id, count(*)::int as n from tickets where tenant_id=$1 and subscriber_id is not null
             and created_at > now() - interval '14 days' group by subscriber_id),
     ow as (select subscriber_id, sum(amount - paid) as owed from invoices where tenant_id=$1 and status in ('open','partial')
             and due_date < now() group by subscriber_id)
     select sub.id, sub.name, sub.account_code, sub.phone, sub.status, sub.expires_at, sub.router_id, r.name as site,
            coalesce(s.sessions, 0) as sessions, coalesce(s.short, 0) as short, st.down_mbps, st.plan_down_kbps,
            coalesce(tk.n, 0) as tickets, coalesce(ow.owed, 0) as owed
       from subscribers sub
       left join routers r on r.id = sub.router_id
       left join s on s.subscriber_id = sub.id
       left join st on st.subscriber_id = sub.id
       left join tk on tk.subscriber_id = sub.id
       left join ow on ow.subscriber_id = sub.id
      where sub.tenant_id=$1 and sub.service <> 'hotspot' and sub.status in ('active','grace','expired')
        ${subscriberId ? 'and sub.id = $2' : ''}`,
    subscriberId ? [tenantId, subscriberId] : [tenantId]);
  return rows.map((r) => { const s = scoreOf(r); return { ...r, ...s, risk: atRisk(r, s.score), owed: Number(r.owed) }; });
}

export function registerExperience(app, { pool, requirePermission, wrap }) {
  app.get('/api/experience', requirePermission('clients.view'), wrap(async (req, res) => {
    const all = await rowsFor(pool, req.tenant.id);
    const scored = all.filter((r) => r.score != null);
    const bySite = new Map();
    for (const r of scored) {
      const k = r.router_id ?? 'none';
      const x = bySite.get(k) ?? { router_id: r.router_id, site: r.site ?? 'No site', n: 0, sum: 0, below5: 0 };
      x.n += 1; x.sum += r.score; if (r.score < 5) x.below5 += 1;
      bySite.set(k, x);
    }
    const sites = [...bySite.values()].map((x) => ({ ...x, avg: Math.round((x.sum / x.n) * 10) / 10 })).sort((a, b) => a.avg - b.avg);
    const pick = (r) => ({ id: r.id, name: r.name, account_code: r.account_code, phone: r.phone, status: r.status, site: r.site, score: r.score, reasons: r.reasons, risk: r.risk, owed: r.owed });
    res.json({
      days: DAYS,
      counted: scored.length,
      noData: all.length - scored.length,
      average: scored.length ? Math.round((scored.reduce((a, r) => a + r.score, 0) / scored.length) * 10) / 10 : null,
      sites,
      worst: scored.filter((r) => r.score < 7).sort((a, b) => a.score - b.score).slice(0, 200).map(pick),
      risk: scored.filter((r) => r.risk).sort((a, b) => a.score - b.score).slice(0, 200).map(pick),
    });
  }));

  app.get('/api/subscribers/:id/experience', requirePermission('clients.view'), wrap(async (req, res) => {
    const [r] = await rowsFor(pool, req.tenant.id, req.params.id);
    res.json(r ? { score: r.score, reasons: r.reasons, risk: r.risk, sessions: r.sessions, days: DAYS } : { score: null, reasons: [] });
  }));
}
