import { pool } from './db.js';

/**
 * What tenants are charged each month for using the platform:
 *   - a percentage of the tenant's HOTSPOT revenue (payments applied to a
 *     voucher sale), and
 *   - a fixed amount for each ACTIVE PPPoE client — a line whose status is
 *     'active' when the statement is drawn.
 *
 * Both rates live on the tenant (hotspot_commission_pct, pppoe_client_rate) so
 * the platform owner can charge a particular tenant their own rate. Nothing is
 * ever taken out of a tenant's payouts: these are billed separately.
 *
 * A closed month is written once to tenant_charges and never rewritten, so a
 * later rate change cannot alter a statement already sent. The current month,
 * and any month without a stored statement, is worked out live.
 */

/** 'YYYY-MM' -> { month: 'YYYY-MM-01', start, end } with Nairobi (+03:00) boundaries. */
export function monthWindow(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key ?? ''));
  if (!m) throw new Error('month must look like 2026-09');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error('month must look like 2026-09');
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { month: `${key}-01`, start: `${key}-01T00:00:00+03:00`, end: `${next}-01T00:00:00+03:00` };
}

/** The current Nairobi month as 'YYYY-MM'. */
export function currentMonthKey(now = Date.now()) {
  const d = new Date(now + 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The Nairobi month before `key`. */
export function previousMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Tenants that pay: live ones, not the platform owner's own tenant and not the
// public demo. Trials are free until they are switched to active.
const BILLABLE = `
  t.status in ('active', 'readonly')
  and t.subdomain <> 'demo'
  and t.id is distinct from (select tenant_id from staff where is_super_admin and tenant_id is not null limit 1)`;

const FIGURES = `
  select t.id as tenant_id, t.name, t.subdomain, t.billing_ref,
         h.revenue as hotspot_revenue, t.hotspot_commission_pct as hotspot_pct,
         round(h.revenue * t.hotspot_commission_pct / 100, 2) as hotspot_fee,
         p.active as pppoe_active, t.pppoe_client_rate as pppoe_rate,
         p.active * t.pppoe_client_rate as pppoe_fee,
         round(h.revenue * t.hotspot_commission_pct / 100, 2) + p.active * t.pppoe_client_rate as total
    from tenants t
   cross join lateral (
     select coalesce(sum(pay.amount), 0) as revenue from payments pay
      where pay.tenant_id = t.id and pay.status = 'applied' and pay.voucher_id is not null
        and pay.received_at >= $1 and pay.received_at < $2) h
   cross join lateral (
     select count(*)::int as active from subscribers s
      where s.tenant_id = t.id and s.service = 'pppoe' and s.status = 'active') p
   where ${BILLABLE}`;

/** Every billable tenant's figures for a month, worked out now. */
export async function liveCharges(key) {
  const w = monthWindow(key);
  const { rows } = await pool.query(`${FIGURES} order by t.name`, [w.start, w.end]);
  return rows;
}

/**
 * The statements for a month: the stored ones where they exist, live figures
 * (marked live: true) for anyone without one. The current month is always live.
 */
export async function chargesFor(key) {
  const w = monthWindow(key);
  const live = await liveCharges(key);
  if (key === currentMonthKey()) return live.map((r) => ({ ...r, live: true, status: 'open', id: null }));

  const { rows: stored } = await pool.query(
    `select c.*, t.name, t.subdomain, t.billing_ref
       from tenant_charges c join tenants t on t.id = c.tenant_id
      where c.month = $1 order by t.name`, [w.month]);
  const have = new Set(stored.map((r) => r.tenant_id));
  return [
    ...stored.map((r) => ({ ...r, live: false })),
    ...live.filter((r) => !have.has(r.tenant_id)).map((r) => ({ ...r, live: true, status: 'open', id: null })),
  ].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Write the statements for a closed month. Existing ones are left alone
 * (unique tenant + month), so running it twice is harmless. Returns how many
 * were created.
 */
export async function snapshotCharges(key) {
  const w = monthWindow(key);
  const { rows } = await pool.query(
    `insert into tenant_charges (tenant_id, month, hotspot_revenue, hotspot_pct, hotspot_fee,
                                 pppoe_active, pppoe_rate, pppoe_fee, total)
     select f.tenant_id, $3::date, f.hotspot_revenue, f.hotspot_pct, f.hotspot_fee,
            f.pppoe_active, f.pppoe_rate, f.pppoe_fee, f.total
       from (${FIGURES}) f
     on conflict (tenant_id, month) do nothing
     returning id`,
    [w.start, w.end, w.month]);
  return rows.length;
}
