import { pool, enabledTenants } from './db.js';

/**
 * Turn each active monthly bill into this month's pending expense.
 *
 * An entry is created three days before the bill's due day (clamped to the
 * month's last day, so a bill due on the 31st still lands in February), so
 * there is time to approve and pay it. One per bill per month: the unique
 * index on (recurring_bill_id, bill_month) makes running this again — the
 * daily job, then the button that creates a bill — a no-op for anything
 * already generated.
 *
 * A bill created after this month's due day has already passed starts next
 * month rather than appearing instantly overdue.
 *
 * Returns the entries it just created, so the caller can tell the owner.
 * tenantId limits it to one tenant (used right after a bill is added).
 */
export async function generateDueBills({ tenantId = null } = {}) {
  const { rows } = await pool.query(
    `insert into expenses (tenant_id, category, description, amount, paid_to, supplier_id,
                           recurring_bill_id, bill_month, due_date)
     select b.tenant_id, b.category, b.name, b.amount, sp.name, b.supplier_id,
            b.id, m.month, d.due
       from recurring_bills b
       left join suppliers sp on sp.id = b.supplier_id
       cross join lateral (
         select date_trunc('month', now() at time zone 'Africa/Nairobi')::date as month) m
       cross join lateral (
         select least(m.month + (b.day_of_month - 1),
                      (m.month + interval '1 month' - interval '1 day')::date) as due) d
      where b.active
        and b.tenant_id in (${enabledTenants})
        ${tenantId ? 'and b.tenant_id = $2' : ''}
        and (now() at time zone 'Africa/Nairobi')::date >= d.due - 3
        and (b.created_at at time zone 'Africa/Nairobi')::date <= d.due
     on conflict (recurring_bill_id, bill_month) where recurring_bill_id is not null do nothing
     returning tenant_id, description, amount, due_date::text as due_date`,
    tenantId ? ['generateMonthlyBills', tenantId] : ['generateMonthlyBills']);
  return rows;
}
