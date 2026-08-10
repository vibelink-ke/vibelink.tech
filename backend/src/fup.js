import { pool, withTenant } from './db.js';
import { applyFupThrottle, clearFupThrottle } from './radius.js';
import { send } from './sms.js';

/**
 * Fair-use enforcement.
 *
 * Policies say *what* the cap is (see fup_policies); this measures usage against
 * it and acts. Usage comes from RADIUS accounting in `sessions`, summed over the
 * policy's window. `fup_state` records what has already been done to each
 * subscriber this window so a job on a short interval is idempotent.
 */

const MB = 1024 * 1024;

/** numeric(10,2) arrives as a string: "10.00" reads badly in an SMS, "10" does not. */
const tidyGb = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
};

/** Postgres expression for the start of the current window. */
const WINDOW_START = {
  daily: "date_trunc('day', now())",
  weekly: "date_trunc('week', now())",
  monthly: "date_trunc('month', now())",
};

/**
 * Usage per subscriber for one window, joined to the policy that governs them.
 * A plan-specific policy beats an all-plans one — `order by ... applies_to='plan' desc`
 * inside the lateral picks the more specific row.
 */
async function measure(tenantId, windowPeriod) {
  const start = WINDOW_START[windowPeriod];
  const { rows } = await pool.query(
    `select s.id  as subscriber_id,
            s.name, s.phone, s.pppoe_user,
            f.id   as policy_id,
            f.name as policy_name,
            f.data_cap_gb, f.throttle_down, f.throttle_up, f.notify_at_pct,
            ${start}::date as window_start,
            coalesce(u.bytes, 0) as bytes,
            st.warned, st.throttled
     from subscribers s
     join lateral (
       select f.* from fup_policies f
       where f.tenant_id = s.tenant_id
         and f.enabled
         and f.window_period = $2
         and (f.applies_to = 'all' or f.plan_id = s.plan_id)
       order by (f.applies_to = 'plan') desc, f.data_cap_gb asc
       limit 1
     ) f on true
     left join lateral (
       select sum(coalesce(sess.bytes_in,0) + coalesce(sess.bytes_out,0)) bytes
       from sessions sess
       where sess.subscriber_id = s.id and sess.started_at >= ${start}
     ) u on true
     left join fup_state st
       on st.subscriber_id = s.id and st.window_start = ${start}::date
     where s.tenant_id = $1 and s.status in ('active','grace')`,
    [tenantId, windowPeriod]
  );
  return rows;
}

/**
 * Run one tenant through every window type.
 * Returns a summary; callers log it rather than throwing on individual failures,
 * so one unreachable router cannot stall the rest.
 */
export async function enforceForTenant(tenantId) {
  const summary = { checked: 0, warned: 0, throttled: 0, restored: 0 };

  for (const windowPeriod of Object.keys(WINDOW_START)) {
    const rows = await measure(tenantId, windowPeriod);
    summary.checked += rows.length;

    for (const r of rows) {
      const usedMb = Math.floor(Number(r.bytes) / MB);
      const capMb = Math.round(Number(r.data_cap_gb) * 1024);
      const pct = capMb > 0 ? (usedMb / capMb) * 100 : 0;
      const shouldThrottle = usedMb >= capMb;
      const shouldWarn = !shouldThrottle && pct >= Number(r.notify_at_pct);

      // Upsert first so the row exists even when nothing needs doing — that is
      // what makes the next pass able to tell "already handled" from "new".
      await pool.query(
        `insert into fup_state (tenant_id, subscriber_id, policy_id, window_start, used_mb)
         values ($1,$2,$3,$4,$5)
         on conflict (subscriber_id, window_start) do update
           set used_mb = excluded.used_mb, policy_id = excluded.policy_id, updated_at = now()`,
        [tenantId, r.subscriber_id, r.policy_id, r.window_start, usedMb]
      );

      if (shouldThrottle && !r.throttled) {
        const applied = await withTenant(tenantId, (c) =>
          applyFupThrottle(c, tenantId, r.subscriber_id, r.throttle_down, r.throttle_up)
        ).catch(() => false);
        if (applied) {
          await pool.query(
            'update fup_state set throttled=true where subscriber_id=$1 and window_start=$2',
            [r.subscriber_id, r.window_start]);
          summary.throttled++;
          await send(tenantId, r.phone, 'custom', {
            body: `You have used your ${tidyGb(r.data_cap_gb)} GB fair-use allowance. Speeds are reduced to ${Math.round(r.throttle_down / 1000)} Mbps until the next period.`,
          }).catch(() => {});
        }
      } else if (shouldWarn && !r.warned) {
        await pool.query(
          'update fup_state set warned=true where subscriber_id=$1 and window_start=$2',
          [r.subscriber_id, r.window_start]);
        summary.warned++;
        await send(tenantId, r.phone, 'custom', {
          body: `You have used ${Math.round(pct)}% of your ${tidyGb(r.data_cap_gb)} GB allowance. Speeds drop once it is finished.`,
        }).catch(() => {});
      }
    }
  }

  // New window: anyone throttled under an older window goes back to full speed.
  const { rows: stale } = await pool.query(
    `select distinct st.subscriber_id from fup_state st
     where st.tenant_id = $1 and st.throttled
       and st.window_start < date_trunc('month', now())::date
       and not exists (
         select 1 from fup_state cur
         where cur.subscriber_id = st.subscriber_id
           and cur.window_start >= date_trunc('month', now())::date
           and cur.throttled)`,
    [tenantId]
  );
  for (const s of stale) {
    const ok = await withTenant(tenantId, (c) => clearFupThrottle(c, tenantId, s.subscriber_id)).catch(() => false);
    if (ok) summary.restored++;
  }

  return summary;
}

/** Every tenant that has not switched the job off. */
export async function enforceFup() {
  const { rows } = await pool.query(`
    select t.id from tenants t
    left join automation_jobs a on a.tenant_id = t.id and a.job = 'enforceFup'
    where coalesce(a.enabled, true)
      and exists (select 1 from fup_policies f where f.tenant_id = t.id and f.enabled)`);
  for (const t of rows) {
    try {
      const s = await enforceForTenant(t.id);
      if (s.warned || s.throttled || s.restored)
        console.log(`fup ${t.id}: warned ${s.warned}, throttled ${s.throttled}, restored ${s.restored}`);
    } catch (e) {
      console.error('fup failed for tenant', t.id, e.message);
    }
  }
}

/** Current-window usage for the UI, richest window first. */
export async function usageReport(tenantId) {
  const out = [];
  for (const windowPeriod of Object.keys(WINDOW_START)) {
    for (const r of await measure(tenantId, windowPeriod)) {
      const usedMb = Math.floor(Number(r.bytes) / MB);
      const capMb = Math.round(Number(r.data_cap_gb) * 1024);
      out.push({
        subscriberId: r.subscriber_id,
        name: r.name,
        phone: r.phone,
        policy: r.policy_name,
        windowPeriod,
        windowStart: r.window_start,
        usedMb,
        capMb,
        pct: capMb > 0 ? Math.round((usedMb / capMb) * 1000) / 10 : 0,
        warned: !!r.warned,
        throttled: !!r.throttled,
        throttleDown: r.throttle_down,
      });
    }
  }
  return out.sort((a, b) => b.pct - a.pct);
}
