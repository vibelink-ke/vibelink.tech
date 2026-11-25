import crypto from 'node:crypto';

/**
 * The installation agreement, signed on the technician's phone.
 *
 * At an installation the technician opens the job, the customer reads a short agreement (package, equipment left with
 * them, notice period) and signs with a finger. The signed copy is kept on the customer and a link to it is texted to
 * them. The office writes the wording once (Installations > Agreement wording).
 *
 * Tamper evidence: when it is signed, a SHA-256 fingerprint is taken of the exact wording, the name, the signature and
 * the moment. The agreement page recomputes it every time it is opened and says whether anything has changed since. It
 * can be saved as a PDF from that page.
 *
 * Prices: the field app keeps money away from technicians, so the default wording names the package but not its price.
 * An owner who adds {price} to the wording chooses to let the technician see it on the customer's agreement.
 */
export const DEFAULT_WORDING = `SERVICE AGREEMENT

This agreement is between {company} and {customer}, account {account}, for internet at {address}.

Package: {package}. The monthly price is the one on your invoices and in your customer portal. Service is paid in advance; it pauses when a payment is missed and resumes when paid.

Equipment left with you:
{equipment}

The equipment remains the property of {company}. Keep it powered, dry and where the technician placed it, and return it when the service ends. Lost or damaged equipment may be charged.

To end the service, give one month's notice by calling {support}.

Signed at installation on {date}, with {technician}.`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fingerprint = (a) => crypto.createHash('sha256')
  .update([a.body, a.signed_name, new Date(a.signed_at).toISOString(), a.signature].join('\n')).digest('hex');

async function wordingFor(pool, tenantId) {
  const { rows: [s] } = await pool.query('select body from agreement_settings where tenant_id=$1', [tenantId]).catch(() => ({ rows: [] }));
  return s?.body?.trim() ? s.body : DEFAULT_WORDING;
}

/** The wording with this job's customer, package and equipment filled in. */
async function render(pool, tenantId, ticketId, staffName) {
  const { rows: [j] } = await pool.query(
    `select s.id as subscriber_id, s.name, s.account_code, s.phone, s.location, coalesce(s.custom_price, p.price) as price, p.title as package,
            t.name as company, t.support_phone
       from tickets k join subscribers s on s.id = k.subscriber_id left join plans p on p.id = s.plan_id join tenants t on t.id = k.tenant_id
      where k.tenant_id=$1 and k.id=$2`, [tenantId, ticketId]);
  if (!j) return null;
  const { rows: eq } = await pool.query(
    `select coalesce(name, category, 'Device') as what, serial_number, mac_address, quantity from job_equipment
      where tenant_id=$1 and ticket_id=$2 order by created_at`, [tenantId, ticketId]);
  const equipment = eq.length
    ? eq.map((e) => `- ${e.what}${e.quantity > 1 ? ` x ${e.quantity}` : ''}${e.serial_number ? `, serial ${e.serial_number}` : ''}${e.mac_address ? `, MAC ${e.mac_address}` : ''}`).join('\n')
    : '- None recorded';
  const date = new Date().toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'long', year: 'numeric' });
  const vars = {
    company: j.company ?? '', customer: j.name ?? '', account: j.account_code ?? '', address: j.location || 'the customer\'s premises',
    package: j.package ?? 'as agreed', price: j.price != null ? `KES ${Number(j.price).toLocaleString('en-KE')}` : '',
    equipment, support: j.support_phone || 'our office', date, technician: staffName || 'our technician', phone: j.phone ?? '',
  };
  const body = (await wordingFor(pool, tenantId)).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return { body, subscriberId: j.subscriber_id, customer: j.name, phone: j.phone };
}

export function registerAgreements(app, { pool, requirePermission, wrap }) {
  const use = requirePermission('field.use');
  // Only the technician the job is assigned to signs it, or the owner helping from the office (same rule as the rest of the field app).
  const mayAct = async (req, res) => {
    if (req.session?.is_super_admin || req.session?.role === 'owner') return true;
    const { rowCount } = await pool.query('select 1 from tickets where tenant_id=$1 and id=$2 and assigned_to=$3', [req.tenant.id, req.params.id, req.session?.staff_id ?? null]);
    if (!rowCount) res.status(403).json({ error: 'This job is not assigned to you.' });
    return rowCount > 0;
  };

  // What the technician shows the customer, and whether this job's agreement is already signed.
  app.get('/api/field/jobs/:id/agreement', use, wrap(async (req, res) => {
    if (!(await mayAct(req, res))) return;
    const r = await render(pool, req.tenant.id, req.params.id, req.session?.name);
    if (!r) return res.status(404).json({ error: 'This job has no customer to sign an agreement.' });
    const { rows: [done] } = await pool.query(
      'select token, signed_name, signed_at from agreements where tenant_id=$1 and ticket_id=$2 order by signed_at desc limit 1', [req.tenant.id, req.params.id]).catch(() => ({ rows: [] }));
    res.json({ text: r.body, customer: r.customer, signed: done ? { name: done.signed_name, at: done.signed_at, link: `/agreement/${done.token}` } : null });
  }));

  app.post('/api/field/jobs/:id/agreement', use, wrap(async (req, res) => {
    if (!(await mayAct(req, res))) return;
    const sig = String(req.body?.signature ?? '');
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > 400000) return res.status(400).json({ error: 'The signature did not come through. Ask the customer to sign again.' });
    if (name.length < 2) return res.status(400).json({ error: 'Type the name of the person signing.' });
    const r = await render(pool, req.tenant.id, req.params.id, req.session?.name);
    if (!r) return res.status(404).json({ error: 'This job has no customer to sign an agreement.' });
    const token = crypto.randomBytes(18).toString('base64url');
    const signedAt = new Date();
    const row = { body: r.body, signed_name: name, signed_at: signedAt, signature: sig };
    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
    await pool.query(
      `insert into agreements (tenant_id, subscriber_id, ticket_id, token, body, signed_name, signature, signed_at, staff_id, lat, lng, hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [req.tenant.id, r.subscriberId, req.params.id, token, r.body, name, sig, signedAt, req.session?.staff_id ?? null,
        Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null, fingerprint(row)]);
    await pool.query(
      `insert into activity_log (tenant_id, subscriber_id, account_code, actor, action, detail)
       select $1, s.id, s.account_code, $3, 'Agreement signed', $4 from subscribers s where s.id=$2`,
      [req.tenant.id, r.subscriberId, req.session?.name ?? 'technician', `Signed by ${name} at installation.`]).catch(() => {});
    // The customer's copy, by SMS.
    let texted = false;
    try {
      const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
      const link = req.tenant.subdomain ? `https://${req.tenant.subdomain}.${root}/agreement/${token}` : null;
      if (link && r.phone) {
        const sms = await import('./sms.js');
        const org = await sms.orgVars(req.tenant.id);
        const out = await sms.send(req.tenant.id, r.phone, 'custom', { ...org, body: `${org.company || ''}: thank you for signing your service agreement. Your copy: ${link}` });
        texted = out?.ok !== false;
      }
    } catch { /* the agreement is kept either way */ }
    res.json({ ok: true, link: `/agreement/${token}`, texted });
  }));

  // The office: the wording, and a customer's signed agreements.
  app.get('/api/agreements/wording', requirePermission('clients.view'), wrap(async (req, res) => {
    const { rows: [s] } = await pool.query('select body from agreement_settings where tenant_id=$1', [req.tenant.id]).catch(() => ({ rows: [] }));
    res.json({ body: s?.body ?? '', default: DEFAULT_WORDING });
  }));
  app.put('/api/agreements/wording', requirePermission('agreements.manage'), wrap(async (req, res) => {
    const body = String(req.body?.body ?? '').slice(0, 8000);
    await pool.query(
      `insert into agreement_settings (tenant_id, body) values ($1,$2) on conflict (tenant_id) do update set body = excluded.body`,
      [req.tenant.id, body.trim() ? body : null]);
    res.json({ ok: true });
  }));
  app.get('/api/subscribers/:id/agreements', requirePermission('clients.view'), wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select a.token, a.signed_name, a.signed_at, st.name as technician from agreements a left join staff st on st.id = a.staff_id
        where a.tenant_id=$1 and a.subscriber_id=$2 order by a.signed_at desc`, [req.tenant.id, req.params.id]).catch(() => ({ rows: [] }));
    res.json(rows.map((r) => ({ ...r, link: `/agreement/${r.token}` })));
  }));

}

/** The signed copy: for the customer (from the SMS) and the office. The token is the key; it is long and random. Public. */
export function registerAgreementPage(app, { pool, wrap, tenantByHost }) {
  app.get('/agreement/:token', wrap(async (req, res) => {
    const t = await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
    const { rows: [a] } = await pool.query(
      `select a.*, st.name as technician, tn.name as company from agreements a left join staff st on st.id = a.staff_id join tenants tn on tn.id = a.tenant_id
        where a.token=$1 ${t ? 'and a.tenant_id=$2' : ''}`, t ? [req.params.token, t.id] : [req.params.token]).catch(() => ({ rows: [] }));
    if (!a) return res.status(404).type('text').send('Agreement not found');
    const intact = fingerprint(a) === a.hash;
    res.set('Cache-Control', 'no-store').type('html').send(agreementPage(a, intact));
  }));
}

function agreementPage(a, intact) {
  const when = new Date(a.signed_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'long', timeStyle: 'short' });
  const data = JSON.stringify({ body: a.body, name: a.signed_name, when, sig: a.signature, company: a.company, hash: a.hash, tech: a.technician ?? '' }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Service agreement · ${esc(a.company)}</title>
<style>
  body { margin:0; background:#f5f6f3; color:#161a17; font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:16px; }
  .paper { max-width:640px; margin:0 auto; background:#fff; border:1px solid rgba(128,128,128,.25); border-radius:10px; padding:24px; }
  pre { white-space:pre-wrap; font:inherit; margin:0 0 18px; }
  .sig { border-bottom:1px solid #161a17; padding-bottom:4px; max-width:320px; }
  .sig img { max-width:100%; height:auto; display:block; }
  .m { color:#6f766b; font-size:13px; }
  .check { margin:16px 0 0; padding:10px 12px; border-radius:8px; font-size:14px; }
  .ok { background:#e8f3ee; color:#0b5a46; border:1px solid #bfe0d2; } .bad { background:#fdece5; color:#8a2d16; border:1px solid #f3c7b6; }
  code { font-size:11px; word-break:break-all; color:#6f766b; }
  button { margin-top:14px; padding:10px 16px; font-size:14px; font-weight:600; color:#fff; background:#0f7a5f; border:0; border-radius:9px; cursor:pointer; }
</style></head><body><div class="paper">
<pre>${esc(a.body)}</pre>
<div class="sig"><img src="${esc(a.signature)}" alt="Signature of ${esc(a.signed_name)}"></div>
<p class="m">Signed by <b>${esc(a.signed_name)}</b> on ${esc(when)}${a.technician ? `, with ${esc(a.technician)}` : ''}.</p>
<div class="check ${intact ? 'ok' : 'bad'}">${intact ? 'Unchanged since it was signed.' : 'This agreement has been changed since it was signed. Contact the office.'}</div>
<p class="m">Fingerprint (SHA-256): <code>${esc(a.hash)}</code></p>
<button type="button" id="pdf">Save as PDF</button>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script>
(function () {
  var A = ${data};
  document.getElementById('pdf').onclick = function () {
    var J = window.jspdf && window.jspdf.jsPDF; if (!J) return alert('The PDF maker did not load. Check your connection and try again.');
    var doc = new J({ unit: 'mm', format: 'a4' }); var y = 18;
    doc.setFontSize(10.5);
    doc.splitTextToSize(A.body, 180).forEach(function (line) { if (y > 270) { doc.addPage(); y = 18; } doc.text(line, 15, y); y += 5; });
    y += 4; if (y > 240) { doc.addPage(); y = 18; }
    try { doc.addImage(A.sig, 'PNG', 15, y, 70, 26); } catch (e) {}
    y += 30; doc.line(15, y, 95, y); y += 6;
    doc.text('Signed by ' + A.name + ' on ' + A.when + (A.tech ? ', with ' + A.tech : '') + '.', 15, y); y += 6;
    doc.setFontSize(7.5); doc.text('Fingerprint (SHA-256): ' + A.hash, 15, y);
    doc.save('Service agreement - ' + A.name + '.pdf');
  };
})();
</script></body></html>`;
}
