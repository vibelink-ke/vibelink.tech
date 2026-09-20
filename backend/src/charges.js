import { pool, config, platformCollectConfig } from './db.js';

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

/**
 * What a tenant pays to switch on their licence once the free trial has ended,
 * and how long that buys. A one-off, separate from the monthly statements (which
 * start with the first full month after activation). Set TENANT_ACTIVATION_FEE
 * in the environment to change the amount; 500 by default.
 */
export const ACTIVATION_FEE = Number(process.env.TENANT_ACTIVATION_FEE ?? 500);
export const ACTIVATION_DAYS = 30;

/**
 * What a paying tenant pays to switch a lapsed licence back on when they have no
 * statement to pay: their own flat monthly fee if they have one, else the
 * activation fee.
 */
export const reinstateFee = (flat) => (Number(flat) > 0 ? Number(flat) : ACTIVATION_FEE);

/**
 * The date an activation runs to: the end of the month after next, in Nairobi.
 * (See activateIfPaid — the first statement is due on the 1st of that month.)
 */
export function activationUntil(now = Date.now()) {
  const d = new Date(now + 3 * 3600 * 1000);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 0));
  return last.toISOString().slice(0, 10);
}

// Tenants that pay: activated ones (converted_at), not the platform owner's own
// tenant and not the public demo. A trial is never invoiced, and a tenant's first
// statement is the first full month after it was activated — nothing for the
// month it converted in, which was partly free.
const BILLABLE = `
  t.status in ('active', 'readonly')
  and t.converted_at is not null and t.converted_at < $1::timestamptz
  and t.subdomain <> 'demo'
  and t.id is distinct from (select tenant_id from staff where is_super_admin and tenant_id is not null limit 1)`;

const FIGURES = `
  select t.id as tenant_id, t.name, t.subdomain, t.billing_ref,
         h.revenue as hotspot_revenue, t.hotspot_commission_pct as hotspot_pct,
         -- A flat-rate tenant is charged the flat amount only; the usage is still
         -- recorded (revenue, active clients) so the statement shows what it covered.
         case when t.flat_monthly_fee is null then round(h.revenue * t.hotspot_commission_pct / 100, 2) else 0 end as hotspot_fee,
         p.active as pppoe_active, t.pppoe_client_rate as pppoe_rate,
         case when t.flat_monthly_fee is null then p.active * t.pppoe_client_rate else 0 end as pppoe_fee,
         coalesce(t.flat_monthly_fee, 0) as flat_fee,
         coalesce(t.flat_monthly_fee, round(h.revenue * t.hotspot_commission_pct / 100, 2) + p.active * t.pppoe_client_rate) as total
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
                                 pppoe_active, pppoe_rate, pppoe_fee, flat_fee, total)
     select f.tenant_id, $3::date, f.hotspot_revenue, f.hotspot_pct, f.hotspot_fee,
            f.pppoe_active, f.pppoe_rate, f.pppoe_fee, f.flat_fee, f.total
       from (${FIGURES}) f
     on conflict (tenant_id, month) do nothing
     returning id`,
    [w.start, w.end, w.month]);
  return rows.length;
}

// ── tenants paying the platform ─────────────────────────────────────────────

/** The platform owner's own tenant: the one whose Daraja credentials take the money. */
export async function ownerTenantId() {
  const { rows: [owner] } = await pool.query(
    'select tenant_id from staff where is_super_admin and tenant_id is not null limit 1');
  return owner?.tenant_id ?? null;
}

/** The platform's collection paybill, or null when none is set up. */
export async function platformPaybill() {
  const owner = await ownerTenantId();
  if (!owner) return null;
  const cfg = (await platformCollectConfig(owner, 'daraja')) ?? (await config(owner, 'daraja'));
  return cfg?.shortcode ?? null;
}

/**
 * Pay the oldest unpaid statements out of the tenant's credit, oldest first,
 * stopping at the first one the credit cannot cover. Each statement paid buys
 * one month of licence, counted from whichever is later — today or the date the
 * licence currently runs to — so paying on time never wastes days and paying
 * late never gets a month for less. A tenant whose licence has lapsed is
 * switched back on the moment it is paid up to a future date.
 *
 * A statement of nothing (no hotspot sales, no active PPPoE clients) is paid
 * automatically: there is nothing to owe, and it should not cost them access.
 * Must run inside a transaction; the tenant row is locked.
 */
async function allocateCredit(c, tenantId) {
  const { rows: [t] } = await c.query('select billing_credit from tenants where id = $1 for update', [tenantId]);
  let credit = Number(t?.billing_credit ?? 0);
  const { rows: due } = await c.query(
    `select id, total from tenant_charges
      where tenant_id = $1 and status in ('open', 'invoiced')
      order by month for update`, [tenantId]);

  let paid = 0;
  for (const s of due) {
    const total = Number(s.total);
    if (credit + 0.005 < total) break;
    credit -= total;
    paid += 1;
    await c.query("update tenant_charges set status = 'paid', paid_at = now() where id = $1", [s.id]);
    await c.query(
      `update tenants
          set licence_ends = (greatest(coalesce(licence_ends, current_date), current_date) + interval '1 month')::date
        where id = $1`, [tenantId]);
  }
  await c.query(
    `update tenants
        set billing_credit = $2,
            status = case when status = 'readonly' and licence_ends >= current_date then 'active' else status end
      where id = $1`, [tenantId, Math.max(0, credit)]);

  // A paying tenant whose licence ran out with nothing left to pay (their activation
  // ended before the first statement was drawn) has no statement for a payment to
  // settle, so paying would renew nothing. They reinstate with the activation fee.
  const { rows: [s] } = await c.query(
    `select status, converted_at, billing_credit, flat_monthly_fee,
            (licence_ends is not null and licence_ends < current_date) as lapsed,
            (select count(*) from tenant_charges where tenant_id = $1 and status in ('open', 'invoiced')) as open_count
       from tenants where id = $1`, [tenantId]);
  if (s?.converted_at && s.status !== 'suspended' && Number(s.open_count) === 0
      && (s.lapsed || s.status === 'readonly') && Number(s.billing_credit) + 0.005 >= reinstateFee(s.flat_monthly_fee)) {
    await c.query(
      `update tenants
          set billing_credit = billing_credit - $2,
              status = 'active',
              licence_ends = greatest(
                (greatest(coalesce(licence_ends, current_date), current_date) + ($3 || ' days')::interval)::date,
                (date_trunc('month', current_date) + interval '3 months' - interval '1 day')::date)
        where id = $1`, [tenantId, reinstateFee(s.flat_monthly_fee), ACTIVATION_DAYS]);
    credit = Number(s.billing_credit) - reinstateFee(s.flat_monthly_fee);
  }
  return { paid, credit: Math.max(0, credit) };
}

/**
 * A tenant that has never been activated (still on, or past, the free trial) is
 * activated once their credit covers the activation fee: it is taken from the
 * credit, they become a paying customer, and the licence runs for
 * ACTIVATION_DAYS from today or the end of the trial, whichever is later.
 * Anything beyond the fee stays as credit. A suspended tenant is not switched
 * back on by paying — that is the platform owner's decision.
 * Must run inside the payment's transaction.
 */
async function activateIfPaid(c, tenantId) {
  const { rows: [t] } = await c.query('select billing_credit, converted_at from tenants where id = $1 for update', [tenantId]);
  if (!t || t.converted_at) return false;
  if (Number(t.billing_credit) + 0.005 < ACTIVATION_FEE) return false;
  await c.query(
    `update tenants
        set billing_credit = billing_credit - $2,
            converted_at = now(),
            status = case when status = 'suspended' then status else 'active' end,
            -- At least ACTIVATION_DAYS, and never short of the end of the month after next:
            -- the first statement is for the first full month after activation and is drawn
            -- on the 1st of the month after that, so the licence must reach it.
            licence_ends = greatest(
              (greatest(coalesce(licence_ends, current_date), current_date) + ($3 || ' days')::interval)::date,
              (date_trunc('month', current_date) + interval '3 months' - interval '1 day')::date)
      where id = $1`, [tenantId, ACTIVATION_FEE, ACTIVATION_DAYS]);
  return true;
}

/**
 * Record money received from a tenant and apply it. Safe to call twice with the
 * same reference (a retried callback): the second call does nothing.
 */
export async function applyTenantPayment(tenantId, amount, { method, reference = null, phone = null }) {
  const value = Number(amount);
  if (!(value > 0)) return { ignored: true };
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [receipt] } = await c.query(
      `insert into tenant_payments (tenant_id, amount, method, reference, phone)
       values ($1, $2, $3, $4, $5)
       on conflict (reference) where reference is not null do nothing
       returning id`, [tenantId, value, method, reference, phone]);
    if (!receipt) { await c.query('rollback'); return { duplicate: true }; }
    await c.query('update tenants set billing_credit = billing_credit + $2 where id = $1', [tenantId, value]);
    const activated = await activateIfPaid(c, tenantId);
    const result = await allocateCredit(c, tenantId);
    await c.query('commit');
    return { duplicate: false, activated, ...result };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * After statements are drawn: settle anything already covered by a tenant's
 * credit, and any statement of nothing. Run by the monthly job.
 */
export async function settleAllFromCredit() {
  const { rows } = await pool.query(
    `select id from tenants
      where billing_credit > 0
         or id in (select tenant_id from tenant_charges where status in ('open', 'invoiced') and total = 0)`);
  for (const { id } of rows) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await allocateCredit(c, id);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      console.error('settleAllFromCredit', id, e.message);
    } finally {
      c.release();
    }
  }
}

/** Everything the Licence & billing page shows for one tenant. */
export async function billingSummary(tenantId) {
  const { rows: [t] } = await pool.query(
    `select name, status, licence_ends, billing_ref, billing_credit, converted_at, flat_monthly_fee,
            (licence_ends - current_date) as days_left,
            (licence_ends is not null and licence_ends < current_date) as licence_lapsed
       from tenants where id = $1`, [tenantId]);
  const { rows: statements } = await pool.query(
    `select id, to_char(month, 'YYYY-MM') as month, hotspot_revenue, hotspot_pct, hotspot_fee,
            pppoe_active, pppoe_rate, pppoe_fee, flat_fee, total, status, paid_at
       from tenant_charges where tenant_id = $1 order by month desc`, [tenantId]);
  const owed = statements
    .filter((s) => s.status === 'open' || s.status === 'invoiced')
    .reduce((n, s) => n + Number(s.total), 0);
  const credit = Number(t?.billing_credit ?? 0);
  const paybill = await platformPaybill();
  const lapsed = ['active', 'trial'].includes(t?.status) && !!t?.licence_lapsed;
  const readOnly = t?.status === 'readonly' || lapsed;
  const trialEnded = readOnly && !t?.converted_at;
  // A paying tenant locked out with no statement to pay reinstates with the activation fee.
  const reinstate = readOnly && !!t?.converted_at && owed === 0;
  return {
    tenant: t?.name ?? null,
    status: t?.status ?? 'active',
    readOnly,
    trial: t?.status === 'trial' && !readOnly,
    // Expired without ever having been a paying customer: nothing has been
    // invoiced, so there is nothing to pay — they are activated by the platform.
    trialEnded,
    // After the trial, activating costs a set amount; nothing has been invoiced.
    activation: trialEnded || reinstate ? { fee: reinstate ? reinstateFee(t.flat_monthly_fee) : ACTIVATION_FEE, days: ACTIVATION_DAYS, until: activationUntil() } : null,
    // Money collected for them is held, not paid out, until the licence is renewed.
    payoutsPaused: ['readonly', 'suspended'].includes(t?.status) || !!t?.licence_lapsed,
    licenceEnds: t?.licence_ends ?? null,
    daysLeft: t?.days_left == null ? null : Number(t.days_left),
    billingRef: t?.billing_ref ?? null,
    credit,
    amountDue: trialEnded || reinstate ? Math.max(0, (reinstate ? reinstateFee(t.flat_monthly_fee) : ACTIVATION_FEE) - credit) : Math.max(0, owed - credit),
    statements: statements.slice(0, 12),
    paybill,
    canPrompt: !!paybill,
  };
}
