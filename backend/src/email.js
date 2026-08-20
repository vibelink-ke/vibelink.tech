/**
 * Outbound email, one SMTP account per tenant.
 *
 * Shaped deliberately like sms.js: same idea of a per-tenant gateway, the same
 * template variables, the same "store the credential encrypted and never return
 * it" rule. An operator who has set up SMS should recognise all of this.
 *
 * SMTP rather than a hosted API on purpose. Every tenant already has a mailbox
 * with their domain, and asking them to sign up for a sending service before
 * they can email an invoice is a step most will not take.
 */
import nodemailer from 'nodemailer';
import { pool } from './db.js';
import * as secrets from './secrets.js';
import { subscriberVars, orgVars, SUBSCRIBER_VARS_SQL } from './sms.js';

/** What the Settings screen renders, and what credentialsComplete() checks. */
export const FIELDS = [
  { key: 'host', label: 'SMTP host', placeholder: 'smtp.gmail.com', required: true },
  { key: 'port', label: 'Port', placeholder: '587', required: true },
  { key: 'username', label: 'Username', placeholder: 'billing@yourdomain.co.ke' },
  { key: 'password', label: 'Password', secret: true },
  { key: 'from_email', label: 'From address', placeholder: 'billing@yourdomain.co.ke', required: true },
  { key: 'from_name', label: 'From name', placeholder: 'Your Company' },
];

/** Read the tenant's config, decrypting the password for use — never for display. */
export async function config(tenantId) {
  const { rows: [c] } = await pool.query(
    'select * from tenant_email_config where tenant_id=$1', [tenantId]);
  if (!c) return null;

  let password = null;
  if (c.password_enc) {
    // A rotated key makes old ciphertext unreadable. Report that as "no
    // password" so the send fails with an SMTP auth error the operator can act
    // on, rather than a crash halfway through a billing run.
    try { password = secrets.decrypt(c.password_enc); } catch { password = null; }
  }
  return { ...c, password };
}

function transportFor(c) {
  return nodemailer.createTransport({
    host: c.host,
    port: Number(c.port) || 587,
    secure: Boolean(c.secure),
    auth: c.username ? { user: c.username, pass: c.password ?? '' } : undefined,
    // Kenyan links to overseas SMTP are slow enough that the default can fire
    // during an otherwise fine handshake.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
}

/**
 * Send one message. Returns { ok } rather than throwing: email is a side effect
 * of billing, and a bounced invoice must not roll back the invoice itself.
 */
export async function send(tenantId, to, subject, body, { html = false } = {}) {
  const c = await config(tenantId);
  if (!c || !c.enabled) return { ok: false, error: 'No email gateway configured' };

  try {
    const from = c.from_name ? `"${c.from_name}" <${c.from_email}>` : c.from_email;
    await transportFor(c).sendMail({ from, to, subject, [html ? 'html' : 'text']: body });
    await pool.query(
      'insert into email_log (tenant_id, to_email, subject, status) values ($1,$2,$3,$4)',
      [tenantId, to, subject, 'sent']);
    await pool.query(
      'update tenant_email_config set last_sent_at=now(), last_error=null where tenant_id=$1',
      [tenantId]);
    return { ok: true };
  } catch (e) {
    await pool.query(
      'insert into email_log (tenant_id, to_email, subject, status, error) values ($1,$2,$3,$4,$5)',
      [tenantId, to, subject, 'failed', e.message.slice(0, 300)]).catch(() => {});
    await pool.query('update tenant_email_config set last_error=$2 where tenant_id=$1',
      [tenantId, e.message.slice(0, 300)]).catch(() => {});
    return { ok: false, error: e.message };
  }
}

/**
 * Send to a subscriber, with the same {placeholders} the SMS templates use.
 *
 * Reuses sms.js's variable builder rather than growing a second dialect: an
 * operator should not have to learn that {plan} works in a text but not in an
 * email.
 */
export async function sendToSubscriber(tenantId, subscriberId, subject, body) {
  const { rows: [s] } = await pool.query(
    `select ${SUBSCRIBER_VARS_SQL}, s.email
       from subscribers s
       left join plans p on p.id = s.plan_id
       left join routers r on r.id = s.router_id
      where s.id = $1 and s.tenant_id = $2`, [subscriberId, tenantId]);
  if (!s?.email) return { ok: false, error: 'Customer has no email address' };

  const vars = subscriberVars(s, await orgVars(tenantId));
  const fill = (t) => String(t ?? '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  return send(tenantId, s.email, fill(subject), fill(body));
}

function platformTransport() {
  if (!process.env.PLATFORM_SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.PLATFORM_SMTP_HOST,
    port: Number(process.env.PLATFORM_SMTP_PORT) || 587,
    secure: process.env.PLATFORM_SMTP_SECURE === 'true',
    auth: process.env.PLATFORM_SMTP_USER
      ? { user: process.env.PLATFORM_SMTP_USER, pass: process.env.PLATFORM_SMTP_PASS ?? '' }
      : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
}

/**
 * Account-security mail — password resets, magic-link sign-in — as opposed to
 * the customer notices `send()` above handles.
 *
 * Tries the tenant's own gateway first so it arrives from a recognised
 * address, but a brand-new tenant (or one that's locked itself out precisely
 * because nobody remembers the SMTP password) has no working gateway to try.
 * PLATFORM_SMTP_* is the fallback so "I forgot my password" still works then.
 */
export async function sendSystem(tenantId, to, subject, body) {
  const c = await config(tenantId);
  if (c?.enabled) {
    const r = await send(tenantId, to, subject, body);
    if (r.ok) return r;
  }
  const transport = platformTransport();
  if (!transport) return { ok: false, error: 'No email gateway configured' };
  try {
    await transport.sendMail({
      from: process.env.PLATFORM_SMTP_FROM || 'Vibelink <no-reply@vibelink.tech>',
      to, subject, text: body,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function missingFields(c = {}) {
  return FIELDS.filter((f) => f.required && !String(c[f.key] ?? '').trim()).map((f) => f.label);
}
