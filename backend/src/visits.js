import { pool } from './db.js';

/**
 * Booked technician visits: the messages that go with them. A visit is a ticket with scheduled_at set (see
 * POST /api/tickets/:id/schedule). The customer is texted when it is booked and again a few hours before; the
 * technician is texted a reminder with where to go. All best-effort: a failed text never undoes a booking.
 */

function when(at, tz) {
  const d = new Date(at);
  const day = d.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
  const time = d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  return { day, time };
}

async function load(tenantId, ticketId) {
  const { rows: [r] } = await pool.query(
    `select t.id, t.number, t.subject, t.kind, t.scheduled_at, t.scheduled_minutes,
            sub.name as customer_name, sub.phone as customer_phone, sub.location as customer_location,
            st.name as tech_name, st.phone as tech_phone,
            tn.name as company, tn.support_phone, coalesce(tn.timezone, 'Africa/Nairobi') as tz
       from tickets t
       join tenants tn on tn.id = t.tenant_id
       left join subscribers sub on sub.id = t.subscriber_id and sub.tenant_id = t.tenant_id
       left join staff st on st.id = t.assigned_to
      where t.tenant_id = $1 and t.id = $2`, [tenantId, ticketId]);
  return r ?? null;
}

/** Text the customer their booking (reminder = false) or a "today" reminder. Returns whether a text went out. */
export async function textCustomer(tenantId, ticketId, { reminder = false } = {}) {
  const r = await load(tenantId, ticketId);
  if (!r?.customer_phone || !r.scheduled_at) return false;
  const { day, time } = when(r.scheduled_at, String(r.tz).split(' ')[0]);
  const first = String(r.customer_name ?? '').trim().split(/\s+/)[0] || 'there';
  const what = r.kind === 'install' ? 'installation' : 'visit';
  const who = r.tech_name ? `our technician ${r.tech_name}` : 'our technician';
  const body = reminder
    ? `${r.company}: Hi ${first}, a reminder that ${who} is coming for your ${what} today at ${time}. Please be available.`
    : `${r.company}: Hi ${first}, your ${what} is booked for ${day} at ${time} with ${who}.`
      + (r.support_phone ? ` To change it call ${r.support_phone}.` : '');
  const sms = await import('./sms.js');
  await sms.send(tenantId, r.customer_phone, 'custom', { body });
  return true;
}

/** Remind the technician: when, who and where. */
export async function textTechnician(tenantId, ticketId) {
  const r = await load(tenantId, ticketId);
  if (!r?.tech_phone || !r.scheduled_at) return false;
  const { time } = when(r.scheduled_at, String(r.tz).split(' ')[0]);
  const where = [r.customer_name, r.customer_phone, r.customer_location].filter(Boolean).join(', ');
  const body = `${r.company}: ${r.kind === 'install' ? 'Install' : 'Visit'} at ${time}: ${r.subject}${where ? ` — ${where}` : ''} (${r.number}).`;
  const sms = await import('./sms.js');
  await sms.send(tenantId, r.tech_phone, 'custom', { body });
  return true;
}
