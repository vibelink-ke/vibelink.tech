/**
 * Website clients: businesses that are not ISP tenants but pay the platform owner for a domain, hosting or maintenance (a marketing site built
 * for them, say). Each client has a payment reference (WS-101) used as the ACCOUNT NUMBER on the platform paybill; each of their services has what
 * it costs the owner, what it is charged, a cycle (monthly or annual) and the date the next period starts.
 *
 * A daily job raises an invoice ahead of each renewal (30 days ahead for annual services, 5 for monthly) and reminds the client by SMS. A payment
 * on the paybill (see daraja.js) or recorded by hand goes onto the client's credit and then pays the oldest open invoice first. All of it is
 * platform-owner only; nothing here touches an ISP tenant's data.
 */
import { pool } from './db.js';
import { ownerTenantId, platformPaybill } from './charges.js';

export const LEAD_DAYS = { annual: 30, monthly: 5 };
const KINDS = ['domain', 'hosting', 'maintenance', 'other'];
const CYCLES = ['monthly', 'annual'];

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Nairobi as YYYY-MM-DD. */
export const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

/** A date plus n months (end of month respected: 31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const cycleMonths = (cycle) => (cycle === 'annual' ? 12 : 1);
const kes = (n) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dateOnly = (d) => (d instanceof Date ? new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));

async function tell(client, body) {
  if (!client?.phone) return;
  try {
    const owner = await ownerTenantId();
    if (!owner) return;
    const { send } = await import('./sms.js');
    await send(owner, client.phone, 'custom', { body });
  } catch (e) { console.warn('web-services: could not send a message to', client.name, '-', e.message); }
}

async function payLine(client) {
  const paybill = await platformPaybill().catch(() => null);
  return paybill ? `Pay by M-Pesa Paybill ${paybill}, account ${client.billing_ref}.` : `Your payment reference is ${client.billing_ref}.`;
}

// ── reading ──

export async function overview() {
  const [{ rows: clients }, { rows: services }, { rows: invoices }, { rows: payments }] = await Promise.all([
    pool.query('select * from web_clients order by (status = \'closed\'), name'),
    pool.query('select * from web_services order by client_id, kind, label'),
    pool.query(`select * from web_invoices where status in ('open','partial') or created_at > now() - interval '120 days' order by due_date desc, created_at desc`),
    pool.query('select * from web_payments order by created_at desc limit 100'),
  ]);
  const paybill = await platformPaybill().catch(() => null);
  const t = today();
  const out = clients.map((c) => {
    const svc = services.filter((s) => s.client_id === c.id);
    const inv = invoices.filter((i) => i.client_id === c.id);
    const open = inv.filter((i) => i.status === 'open' || i.status === 'partial');
    const owed = open.reduce((a, i) => a + Number(i.amount) - Number(i.paid), 0);
    const overdue = open.filter((i) => dateOnly(i.due_date) < t).reduce((a, i) => a + Number(i.amount) - Number(i.paid), 0);
    const D = (r, ...keys) => { const o = { ...r }; for (const k of keys) o[k] = dateOnly(r[k]); return o; };
    return { ...c, services: svc.map((x) => D(x, 'next_due')), invoices: inv.map((x) => D(x, 'due_date', 'period_start', 'period_end')),
      payments: payments.filter((p) => p.client_id === c.id), owed, overdue };
  });
  const active = services.filter((s) => s.status === 'active' && clients.find((c) => c.id === s.client_id && c.status === 'active'));
  const yearly = (s, f) => Number(s[f]) * (12 / cycleMonths(s.cycle));
  const soon = addDays(t, 30);
  return {
    paybill, today: t,
    stats: {
      clients: clients.filter((c) => c.status === 'active').length,
      services: active.length,
      yearlyRevenue: active.reduce((a, s) => a + yearly(s, 'price'), 0),
      yearlyCost: active.reduce((a, s) => a + yearly(s, 'cost'), 0),
      owed: out.reduce((a, c) => a + c.owed, 0),
      overdue: out.reduce((a, c) => a + c.overdue, 0),
      renewingSoon: active.filter((s) => dateOnly(s.next_due) <= soon).length,
    },
    clients: out,
  };
}

// ── clients and services ──

export async function createClient(b = {}) {
  const name = text(b.name, 120);
  if (!name) throw bad('The client needs a name.');
  const { rows: [{ n }] } = await pool.query("select nextval('web_client_seq') as n");
  const { rows: [c] } = await pool.query(
    `insert into web_clients (name, contact_name, phone, email, notes, billing_ref) values ($1,$2,$3,$4,$5,$6) returning *`,
    [name, text(b.contactName, 120), text(b.phone, 30), text(b.email, 160), text(b.notes, 1000), `WS-${n}`]);
  return c;
}

export async function updateClient(id, b = {}) {
  const { rows: [cur] } = await pool.query('select * from web_clients where id=$1', [id]);
  if (!cur) throw bad('No such client.', 404);
  const status = b.status && ['active', 'paused', 'closed'].includes(b.status) ? b.status : cur.status;
  const { rows: [c] } = await pool.query(
    `update web_clients set name=$2, contact_name=$3, phone=$4, email=$5, notes=$6, status=$7 where id=$1 returning *`,
    [id, text(b.name, 120) ?? cur.name, 'contactName' in b ? text(b.contactName, 120) : cur.contact_name, 'phone' in b ? text(b.phone, 30) : cur.phone,
      'email' in b ? text(b.email, 160) : cur.email, 'notes' in b ? text(b.notes, 1000) : cur.notes, status]);
  return c;
}

function serviceFields(b, cur = {}) {
  const kind = b.kind ?? cur.kind ?? 'hosting';
  if (!KINDS.includes(kind)) throw bad(`The kind must be one of ${KINDS.join(', ')}.`);
  const cycle = b.cycle ?? cur.cycle ?? 'annual';
  if (!CYCLES.includes(cycle)) throw bad('The cycle must be monthly or annual.');
  const label = text(b.label ?? cur.label, 160);
  if (!label) throw bad('Say what it is, for example the domain name.');
  const price = num(b.price ?? cur.price);
  const cost = num(b.cost ?? cur.cost ?? 0);
  if (!(price >= 0) || !(cost >= 0)) throw bad('The price and the cost must be amounts of 0 or more.');
  const nextDue = String(b.nextDue ?? b.next_due ?? dateOnly(cur.next_due) ?? '');
  if (!ISO.test(nextDue)) throw bad('Give the date the next period starts (YYYY-MM-DD).');
  const status = b.status ?? cur.status ?? 'active';
  if (!['active', 'paused', 'cancelled'].includes(status)) throw bad('The status must be active, paused or cancelled.');
  return { kind, cycle, label, price, cost, nextDue, status, notes: 'notes' in b ? text(b.notes, 500) : (cur.notes ?? null) };
}

export async function addService(clientId, b = {}) {
  const { rows: [client] } = await pool.query('select id from web_clients where id=$1', [clientId]);
  if (!client) throw bad('No such client.', 404);
  const f = serviceFields(b);
  const { rows: [s] } = await pool.query(
    `insert into web_services (client_id, kind, label, cost, price, cycle, next_due, status, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [clientId, f.kind, f.label, f.cost, f.price, f.cycle, f.nextDue, f.status, f.notes]);
  if (b.invoiceNow) await raiseInvoice(s.id);
  return s;
}

export async function updateService(id, b = {}) {
  const { rows: [cur] } = await pool.query('select * from web_services where id=$1', [id]);
  if (!cur) throw bad('No such service.', 404);
  const f = serviceFields(b, cur);
  const { rows: [s] } = await pool.query(
    `update web_services set kind=$2, label=$3, cost=$4, price=$5, cycle=$6, next_due=$7, status=$8, notes=$9 where id=$1 returning *`,
    [id, f.kind, f.label, f.cost, f.price, f.cycle, f.nextDue, f.status, f.notes]);
  return s;
}

// ── invoices ──

/**
 * Raise the invoice for the period that starts on the service's next_due, then move next_due on by one cycle so the same period is never billed twice.
 * Credit the client already holds is applied straight away.
 */
export async function raiseInvoice(serviceId) {
  const c = await pool.connect();
  let made;
  try {
    await c.query('begin');
    const { rows: [s] } = await c.query(
      `select s.*, w.name as client_name, w.phone, w.billing_ref from web_services s join web_clients w on w.id = s.client_id where s.id=$1 for update of s`, [serviceId]);
    if (!s) throw bad('No such service.', 404);
    const start = dateOnly(s.next_due);
    const end = addMonths(start, cycleMonths(s.cycle));
    const due = start < today() ? today() : start;
    const { rows: [{ n }] } = await c.query("select nextval('web_invoice_seq') as n");
    const number = `WSI-${start.slice(0, 4)}-${String(n).padStart(4, '0')}`;
    const description = `${s.label} (${s.kind}), ${day(start)} to ${day(addDays(end, -1))}`;
    const { rows: [inv] } = await c.query(
      `insert into web_invoices (client_id, service_id, number, description, amount, cost, period_start, period_end, due_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [s.client_id, s.id, number, description, s.price, s.cost, start, end, due]);
    await c.query('update web_services set next_due=$2 where id=$1', [s.id, end]);
    await allocate(c, s.client_id);
    await c.query('commit');
    made = { inv, s };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  const { rows: [client] } = await pool.query('select * from web_clients where id=$1', [made.s.client_id]);
  const { rows: [now] } = await pool.query('select * from web_invoices where id=$1', [made.inv.id]);
  if (now.status !== 'paid') {
    await tell(client, `${client.name}: invoice ${now.number}, KES ${kes(Number(now.amount) - Number(now.paid))} for ${made.s.label}, is due ${day(dateOnly(now.due_date))}. ${await payLine(client)}`);
    await pool.query('update web_invoices set reminders = reminders + 1, last_reminder_at = now() where id=$1', [now.id]);
  }
  return now;
}

/** Pay the client's open invoices, oldest due first, from the credit they hold. Runs inside the caller's transaction. */
async function allocate(c, clientId) {
  const { rows: [w] } = await c.query('select credit from web_clients where id=$1 for update', [clientId]);
  let credit = Number(w?.credit ?? 0);
  if (!(credit > 0)) return;
  const { rows: open } = await c.query(
    `select id, amount, paid from web_invoices where client_id=$1 and status in ('open','partial') order by due_date, created_at`, [clientId]);
  for (const i of open) {
    if (!(credit > 0)) break;
    const owing = Number(i.amount) - Number(i.paid);
    const take = Math.min(credit, owing);
    if (!(take > 0)) continue;
    await c.query(
      `update web_invoices set paid = paid + $2, status = case when paid + $2 >= amount then 'paid' else 'partial' end,
              paid_at = case when paid + $2 >= amount then now() else paid_at end where id=$1`, [i.id, take]);
    credit -= take;
  }
  await c.query('update web_clients set credit=$2 where id=$1', [clientId, credit]);
}

/** Money received for a client: kept as credit, then used on the oldest open invoice. A reference seen before is ignored (a replayed callback). */
export async function recordPayment(clientId, amount, { method = 'manual', reference = null, phone = null, note = null } = {}) {
  const value = num(amount);
  if (!(value > 0)) throw bad('The amount must be more than 0.');
  const c = await pool.connect();
  let client;
  try {
    await c.query('begin');
    const { rows: [w] } = await c.query('select * from web_clients where id=$1 for update', [clientId]);
    if (!w) throw bad('No such client.', 404);
    const { rows: [pay] } = await c.query(
      `insert into web_payments (client_id, amount, method, reference, phone, note) values ($1,$2,$3,$4,$5,$6)
       on conflict (reference) where reference is not null do nothing returning id`, [clientId, value, text(method, 20) ?? 'manual', text(reference, 40), text(phone, 30), text(note, 300)]);
    if (!pay) { await c.query('rollback'); return { duplicate: true }; }
    await c.query('update web_clients set credit = credit + $2 where id=$1', [clientId, value]);
    await allocate(c, clientId);
    await c.query('commit');
    client = w;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  const { rows: [after] } = await pool.query(
    `select w.credit, (select coalesce(sum(amount - paid), 0) from web_invoices i where i.client_id = w.id and i.status in ('open','partial')) as owed from web_clients w where w.id=$1`, [clientId]);
  await tell(client, `${client.name}: we received KES ${kes(value)}. ${Number(after.owed) > 0 ? `Still due: KES ${kes(after.owed)}.` : 'Nothing is due. Thank you.'}${Number(after.credit) > 0 ? ` Credit on your account: KES ${kes(after.credit)}.` : ''}`);
  return { duplicate: false, owed: Number(after.owed), credit: Number(after.credit) };
}

/** A payment that arrived on the platform paybill with a WS- account number. Returns { matched: false } for a reference that is not a client's. */
export async function applyPaybillPayment(ref, amount, { reference, phone } = {}) {
  const { rows: [c] } = await pool.query('select id from web_clients where upper(billing_ref) = $1', [String(ref ?? '').trim().toUpperCase()]);
  if (!c) return { matched: false };
  return { matched: true, ...(await recordPayment(c.id, amount, { method: 'paybill', reference, phone })) };
}

export async function voidInvoice(id) {
  const { rows: [i] } = await pool.query('select * from web_invoices where id=$1', [id]);
  if (!i) throw bad('No such invoice.', 404);
  if (Number(i.paid) > 0) throw bad('Part of this invoice is already paid, so it cannot be cancelled.');
  const { rows: [out] } = await pool.query("update web_invoices set status='void' where id=$1 returning *", [id]);
  return out;
}

export async function remindInvoice(id) {
  const { rows: [i] } = await pool.query(
    `select i.*, w.name as client_name, w.phone, w.billing_ref from web_invoices i join web_clients w on w.id = i.client_id where i.id=$1`, [id]);
  if (!i) throw bad('No such invoice.', 404);
  if (!['open', 'partial'].includes(i.status)) throw bad('That invoice is not waiting for payment.');
  if (!i.phone) throw bad('This client has no phone number to send the reminder to.');
  const late = dateOnly(i.due_date) < today();
  await tell({ name: i.client_name, phone: i.phone },
    `${i.client_name}: invoice ${i.number}, KES ${kes(Number(i.amount) - Number(i.paid))} for ${i.description.split(' (')[0]}, ${late ? 'was due' : 'is due'} ${day(dateOnly(i.due_date))}. ${await payLine({ billing_ref: i.billing_ref })}`);
  await pool.query('update web_invoices set reminders = reminders + 1, last_reminder_at = now() where id=$1', [id]);
  return { sent: true };
}

// ── the daily job ──

/** Raise the invoices that are coming up, then remind about the ones that are due soon or late. */
export async function runBilling() {
  const t = today();
  const { rows: services } = await pool.query(
    `select s.id, s.cycle, s.next_due from web_services s join web_clients w on w.id = s.client_id
      where s.status = 'active' and w.status = 'active'`);
  let raised = 0;
  for (const s of services) {
    for (let guard = 0; guard < 3; guard += 1) {      // a service left unbilled for a while catches up, but never floods
      const { rows: [cur] } = await pool.query('select next_due, cycle from web_services where id=$1', [s.id]);
      if (dateOnly(cur.next_due) > addDays(t, LEAD_DAYS[cur.cycle] ?? 14)) break;
      try { await raiseInvoice(s.id); raised += 1; } catch (e) { console.warn('web-services: invoice not raised for', s.id, '-', e.message); break; }
    }
  }
  // Reminders: three days before it is due, on the day, then every 7 days while it stays unpaid.
  const { rows: open } = await pool.query(
    `select i.id, i.due_date, i.last_reminder_at from web_invoices i join web_clients w on w.id = i.client_id
      where i.status in ('open','partial') and w.status = 'active' and w.phone is not null`);
  let reminded = 0;
  for (const i of open) {
    const due = dateOnly(i.due_date);
    const last = i.last_reminder_at ? dateOnly(i.last_reminder_at) : null;
    const dueSoon = due <= addDays(t, 3) && due >= t && (!last || last < addDays(due, -3));
    const dueToday = due === t && last !== t;
    const late = due < t && (!last || last <= addDays(t, -7));
    if (dueSoon || dueToday || late) {
      try { await remindInvoice(i.id); reminded += 1; } catch (e) { console.warn('web-services: reminder not sent -', e.message); }
    }
  }
  return { raised, reminded };
}
