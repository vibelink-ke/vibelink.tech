/**
 * "Employee of the month", combined across every role rather than technicians alone.
 *
 * A technician's contribution is a count of tickets resolved; a salesperson's is
 * revenue their clients have actually paid in; office/support staff who resolve
 * tickets score exactly like a technician does — there is deliberately no third
 * metric invented for them (see the conversation this shipped from). Those two
 * units cannot be compared directly (10 tickets vs KES 40,000 means nothing set
 * against each other), so each person is scored as a fraction of their own lane's
 * best performer for the period, and the two lanes are then compared on that
 * normalized score — whoever is relatively furthest ahead of their own peers wins,
 * regardless of which lane they were in.
 *
 * Both jobs.js's monthly cron (the actual award: SMS, push, reward expense) and
 * server.js's live leaderboard routes (Team jobs / Dashboard, still in progress
 * for the current month) share this so the two never disagree about who's ahead.
 */
import { pool } from './db.js';

async function jobsLane(tenantId, start, end) {
  const { rows } = await pool.query(
    `select assigned_to as staff_id, count(*)::int as n
       from tickets
      where tenant_id=$1 and assigned_to is not null and status='resolved'
        and resolved_at >= $2 and resolved_at < $3
      group by assigned_to`,
    [tenantId, start, end]);
  return rows;
}

async function salesLane(tenantId, start, end) {
  const { rows } = await pool.query(
    `select l.assigned_to as staff_id,
            coalesce(sum(p.amount) filter (where p.status='applied' and p.received_at >= $2 and p.received_at < $3), 0) as n
       from leads l
       join payments p on p.subscriber_id = l.subscriber_id and p.tenant_id = l.tenant_id
      where l.tenant_id=$1 and l.assigned_to is not null
      group by l.assigned_to
     having coalesce(sum(p.amount) filter (where p.status='applied' and p.received_at >= $2 and p.received_at < $3), 0) > 0`,
    [tenantId, start, end]);
  return rows;
}

/** Every staff member's best lane for the period, ranked by that normalized score. */
export async function leaderboard(tenantId, start, end) {
  const [jobs, sales, { rows: staff }] = await Promise.all([
    jobsLane(tenantId, start, end),
    salesLane(tenantId, start, end),
    pool.query('select id, name from staff where tenant_id=$1', [tenantId]),
  ]);
  const nameById = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const maxJobs = Math.max(0, ...jobs.map((r) => r.n));
  const maxSales = Math.max(0, ...sales.map((r) => Number(r.n)));

  const entries = [
    ...jobs.map((r) => ({ staffId: r.staff_id, metric: 'jobs', value: r.n, score: maxJobs ? r.n / maxJobs : 0 })),
    ...sales.map((r) => ({ staffId: r.staff_id, metric: 'sales', value: Number(r.n), score: maxSales ? Number(r.n) / maxSales : 0 })),
  ].filter((e) => nameById[e.staffId]);

  // A staff member can appear in both lanes (a salesperson who also closes tickets) —
  // keep only their best-scoring one, so the board shows one row per person.
  const best = new Map();
  for (const e of entries) {
    const cur = best.get(e.staffId);
    if (!cur || e.score > cur.score) best.set(e.staffId, e);
  }
  return [...best.values()]
    .map((e) => ({ ...e, name: nameById[e.staffId] }))
    .sort((a, b) => b.score - a.score);
}

/** The single winner for the period, or null if nobody had any qualifying activity. */
export async function winner(tenantId, start, end) {
  const board = await leaderboard(tenantId, start, end);
  return board[0] ?? null;
}
