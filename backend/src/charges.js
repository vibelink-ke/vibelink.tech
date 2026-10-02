import { pool, config, platformCollectConfig } from './db.js';

/**
 * What tenants are charged each month for using the platform — one of two
 * models, chosen per tenant (tenants.billing_mode, see FIGURES below):
 *   - 'revenue': a percentage of the tenant's own hotspot revenue plus a
 *     fixed amount per active PPPoE client, at that tenant's own rates.
 *   - 'tiered': a flat fee tiered on total revenue that month (hotspot +
 *     PPPoE payments combined) — under KES 10,000 pays 1,000, 10,001–20,000
 *     pays 2,000, over 20,000 pays 3,000.
 * A new tenant starts on 'revenue'; an existing one keeps whatever it was
 * on before this choice existed ('tiered', the only model there used to be)
 * until an admin deliberately switches it.
 *
 * A tenant's own flat_monthly_fee, when the platform owner has set one,
 * overrides either mode entirely — a number here always wins, regardless
 * of billing_mode.
 *
 * A self-hosted tenant's revenue never reaches this platform's `payments`
 * table at all (it happens on their own server), so neither mode can work
 * for them — the signup route already requires a flat fee for them for
 * that reason.
 *
 * A closed month is written once to tenant_charges and never rewritten, so a
 * later rate, tier or mode change cannot alter a statement already sent. The
 * current month, and any month without a stored statement, is worked out
 * live.
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

/**
 * When a month's statement is due: by default the 5th of the following month at 10:00 Nairobi. The same for every
 * tenant — there is no per-tenant override yet.
 */
export const STATEMENT_DUE_DAY = 5;
export const STATEMENT_DUE_HOUR = 10;
export function statementDueAt(key) {
  const [y, m] = key.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(STATEMENT_DUE_DAY).padStart(2, '0')}T${String(STATEMENT_DUE_HOUR).padStart(2, '0')}:00:00+03:00`;
}

/** The Nairobi month after `key`. */
export function nextMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Where a new tenant's licence runs to. There is no trial: the sign-up month is free (a statement of nothing is raised
 * for it at month end), and the licence runs to that statement's due date, the 5th of the next month at 10:00. Signing
 * up on the 1st gives about five weeks, on the 21st about two. That statement settles by itself and the licence moves
 * on to the next one's due date (see allocateCredit).
 */
export function signupLicenceEnds(now = Date.now()) {
  return statementDueAt(currentMonthKey(now)).slice(0, 10);
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
// tenant and not the public demo. The month a tenant signed up in gets a statement too, but a free one (see FIGURES).
const BILLABLE = `
  t.status in ('active', 'readonly')
  and t.converted_at is not null and t.converted_at < $2::timestamptz
  and t.subdomain <> 'demo'
  and t.id is distinct from (select tenant_id from staff where is_super_admin and tenant_id is not null limit 1)`;

/**
 * Two billing modes live side by side, chosen per tenant (tenants.billing_mode):
 *   - 'revenue': a percentage of the tenant's own HOTSPOT revenue (hotspot_commission_pct)
 *     plus a fixed amount per ACTIVE PPPoE client (pppoe_client_rate) — the original model,
 *     both rates editable per tenant, defaulting to 3% and KES 16.
 *   - 'tiered': a flat fee tiered on total revenue (hotspot + PPPoE payments combined) —
 *     under KES 10,000 pays 1,000, 10,001-20,000 pays 2,000, over 20,000 pays 3,000.
 * flat_monthly_fee, when set, overrides either mode with a fixed amount — nothing to do
 * with which mode is chosen, same escape hatch either way.
 */
const FIGURES_RAW = `
  select t.converted_at >= $1::timestamptz as free_month,
         t.id as tenant_id, t.name, t.subdomain, t.billing_ref, t.billing_mode,
         case when t.billing_mode = 'revenue' then hs.total else rev.total end as hotspot_revenue,
         case when t.billing_mode = 'revenue' then t.hotspot_commission_pct else 0 end as hotspot_pct,
         case when t.flat_monthly_fee is not null then 0
              when t.billing_mode = 'revenue' then round(hs.total * t.hotspot_commission_pct / 100, 2)
              else 0 end as hotspot_fee,
         p.active as pppoe_active,
         case when t.billing_mode = 'revenue' then t.pppoe_client_rate else 0 end as pppoe_rate,
         case when t.flat_monthly_fee is not null then 0
              when t.billing_mode = 'revenue' then p.active * t.pppoe_client_rate
              else 0 end as pppoe_fee,
         case when t.billing_mode = 'revenue' then coalesce(t.flat_monthly_fee, 0) else coalesce(t.flat_monthly_fee, tier.fee) end as flat_fee,
         case
           when t.flat_monthly_fee is not null then t.flat_monthly_fee
           when t.billing_mode = 'revenue' then round(hs.total * t.hotspot_commission_pct / 100, 2) + p.active * t.pppoe_client_rate
           else tier.fee
         end as total
    from tenants t
   cross join lateral (
     -- Hotspot-only revenue (voucher sales), for 'revenue' mode's commission — not the same
     -- figure as rev.total below, which combines hotspot and PPPoE for the tier.
     select coalesce(sum(pay.amount), 0) as total from payments pay
      where pay.tenant_id = t.id and pay.status = 'applied' and pay.voucher_id is not null
        and pay.received_at >= $1 and pay.received_at < $2) hs
   cross join lateral (
     select coalesce(sum(pay.amount), 0) as total from payments pay
      where pay.tenant_id = t.id and pay.status = 'applied'
        and pay.received_at >= $1 and pay.received_at < $2) rev
   cross join lateral (
     select count(*)::int as active from subscribers s
      where s.tenant_id = t.id and s.service = 'pppoe' and s.status = 'active') p
   cross join lateral (
     select case when rev.total < 10000 then 1000 when rev.total <= 20000 then 2000 else 3000 end as fee) tier
   where ${BILLABLE}`;

// The month a tenant signed up in is free: it still gets a statement, but of nothing, which settles by itself and rolls
// the licence on to the next due date.
const FIGURES = `
  select r.tenant_id, r.name, r.subdomain, r.billing_ref, r.billing_mode, r.hotspot_revenue, r.hotspot_pct,
         case when r.free_month then 0 else r.hotspot_fee end as hotspot_fee,
         r.pppoe_active, r.pppoe_rate,
         case when r.free_month then 0 else r.pppoe_fee end as pppoe_fee,
         case when r.free_month then 0 else r.flat_fee end as flat_fee,
         case when r.free_month then 0 else r.total end as total
    from (${FIGURES_RAW}) r`;

/** Every billable tenant's figures for a month, worked out now. */
export async function liveCharges(key) {
  const w = monthWindow(key);
  const { rows } = await pool.query(`${FIGURES} order by r.name`, [w.start, w.end]);
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
 * What one month costs this tenant, for turning spare credit into months of licence: their fixed
 * monthly fee when they have one, else the total of their latest statement, else the activation fee.
 */
async function monthlyFee(c, tenantId, flat) {
  if (Number(flat) > 0) return Number(flat);
  const { rows: [last] } = await c.query(
    'select total from tenant_charges where tenant_id = $1 and total > 0 order by month desc limit 1', [tenantId]);
  return Number(last?.total) > 0 ? Number(last.total) : ACTIVATION_FEE;
}

/**
 * Pay the oldest unpaid statements out of the tenant's credit, oldest first,
 * stopping at the first one the credit cannot cover. Each statement paid buys
 * one month of licence, counted from whichever is later — today or the date the
 * licence currently runs to — so paying on time never wastes days and paying
 * late never gets a month for less. A tenant whose licence has lapsed is
 * switched back on the moment it is paid up to a future date.
 *
 * Credit left over once every statement is paid is turned into whole months of licence straight
 * away (at monthlyFee above), added on top of the days already left — otherwise a tenant who pays
 * ahead sits on credit while their licence runs out before the next statement is even drawn. Those
 * months are remembered in prepaid_months, and a statement drawn later for a month already paid
 * this way is settled without charging or extending again.
 *
 * A statement of nothing (no hotspot sales, no active PPPoE clients) is paid
 * automatically: there is nothing to owe, and it should not cost them access.
 * Must run inside a transaction; the tenant row is locked.
 */
async function allocateCredit(c, tenantId) {
  const { rows: [t] } = await c.query(
    'select billing_credit, prepaid_months, converted_at, status, flat_monthly_fee from tenants where id = $1 for update', [tenantId]);
  let credit = Number(t?.billing_credit ?? 0);
  let prepaid = Number(t?.prepaid_months ?? 0);
  const { rows: due } = await c.query(
    `select id, total, to_char(month, 'YYYY-MM') as month_key from tenant_charges
      where tenant_id = $1 and status in ('open', 'invoiced')
      order by month for update`, [tenantId]);

  let paid = 0;
  let blocked = false;
  for (const s of due) {
    if (prepaid > 0) {
      // A month already bought with spare credit: nothing to charge, and the licence was extended then.
      prepaid -= 1;
      paid += 1;
      await c.query("update tenant_charges set status = 'paid', paid_at = now() where id = $1", [s.id]);
      continue;
    }
    const total = Number(s.total);
    if (credit + 0.005 < total) { blocked = true; break; }
    credit -= total;
    paid += 1;
    await c.query("update tenant_charges set status = 'paid', paid_at = now() where id = $1", [s.id]);
    // Paid for a month: covered until the next month's statement falls due (the 5th, 10:00), never shortened.
    await c.query(
      `update tenants set licence_ends = greatest(coalesce(licence_ends, date '1970-01-01'), $2::date) where id = $1`,
      [tenantId, statementDueAt(nextMonthKey(s.month_key)).slice(0, 10)]);
  }

  if (!blocked && t?.converted_at && t.status !== 'suspended') {
    const fee = await monthlyFee(c, tenantId, t.flat_monthly_fee);
    const months = Math.floor((credit + 0.005) / fee);
    if (months > 0) {
      credit -= months * fee;
      prepaid += months;
      await c.query(
        `update tenants
            set licence_ends = (greatest(coalesce(licence_ends, current_date), current_date) + ($2 || ' months')::interval)::date
          where id = $1`, [tenantId, String(months)]);
    }
  }

  await c.query(
    `update tenants
        set billing_credit = $2,
            prepaid_months = $3,
            status = case when status = 'readonly' and licence_ends >= current_date then 'active' else status end
      where id = $1`, [tenantId, Math.max(0, credit), prepaid]);

  // A paying tenant whose licence ran out with nothing left to pay (their activation
  // ended before the first statement was drawn) has no statement for a payment to
  // settle, so paying would renew nothing. They reinstate for one month with their
  // flat monthly fee (or the activation fee if they have none).
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
              -- One month on top of whatever is left (from today if nothing is): their monthly
              -- statements are already being drawn and each one they pay adds a month. Only a
              -- first activation needs the longer cover.
              licence_ends = (greatest(coalesce(licence_ends, current_date), current_date) + interval '1 month')::date
        where id = $1`, [tenantId, reinstateFee(s.flat_monthly_fee)]);
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
            -- Added ON TOP of whatever is left of the trial (or licence). The cover bought is at
            -- least ACTIVATION_DAYS and never short of the end of the month after next, counted
            -- from today: the first statement is for the first full month after activation and is
            -- drawn on the 1st of the month after that, so the licence must reach it. Taking the
            -- later of "remaining + days" and that date used to swallow the remaining days.
            licence_ends = (greatest(coalesce(licence_ends, current_date), current_date)
              + greatest($3::int, (date_trunc('month', current_date) + interval '3 months' - interval '1 day')::date - current_date)
                * interval '1 day')::date
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
      where billing_credit > 0 or prepaid_months > 0
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
    `select name, status, licence_ends, billing_ref, billing_credit, prepaid_months, converted_at, flat_monthly_fee,
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
  // Nothing invoiced yet but the licence is running down: what this month's statement stands at so far (the figure the
  // next statement will be built from), so the pay box can offer it instead of an empty field.
  let suggested = null;
  if (!trialEnded && !reinstate && owed - credit <= 0) {
    const mine = (await liveCharges(currentMonthKey())).find((r) => r.tenant_id === tenantId);
    const est = mine ? Math.round(Number(mine.total) - credit) : 0;
    if (est >= 10) suggested = est;
  }
  // The moment access stops if nothing is paid: the earliest unpaid statement's due time; with none outstanding, the
  // next statement's due time (what the licence date is set to).
  const unpaid = statements.filter((s) => s.status === 'open' || s.status === 'invoiced').map((s) => statementDueAt(s.month)).sort()[0];
  const endsDay = t?.licence_ends ? (t.licence_ends instanceof Date ? t.licence_ends.toISOString() : String(t.licence_ends)).slice(0, 10) : null;
  const lockAt = readOnly ? null : (unpaid ?? (endsDay ? `${endsDay}T${String(STATEMENT_DUE_HOUR).padStart(2, '0')}:00:00+03:00` : null));
  return {
    tenant: t?.name ?? null,
    lockAt,
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
    prepaidMonths: Number(t?.prepaid_months ?? 0),
    amountSuggested: suggested,
    amountDue: trialEnded || reinstate ? Math.max(0, (reinstate ? reinstateFee(t.flat_monthly_fee) : ACTIVATION_FEE) - credit) : Math.max(0, owed - credit),
    statements: statements.slice(0, 12).map((s) => ({ ...s, due_at: statementDueAt(s.month) })),
    dueDay: STATEMENT_DUE_DAY, dueHour: STATEMENT_DUE_HOUR,
    paybill,
    canPrompt: !!paybill,
  };
}
