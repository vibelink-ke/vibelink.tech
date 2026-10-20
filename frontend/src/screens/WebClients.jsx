import React, { useCallback, useEffect, useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Drawer, Empty, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table } from '../ui/primitives';

const kes = (n) => `KES ${Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const KINDS = [['hosting', 'Hosting'], ['domain', 'Domain'], ['maintenance', 'Maintenance'], ['other', 'Other']];
const CYCLES = [['annual', 'Yearly'], ['monthly', 'Monthly']];
/** The few lines a client's PHP site includes at the very top: it asks the platform whether the client is suspended (cached 5 minutes; if the platform cannot be reached the site stays up). */
const phpSnippet = (origin, key) => `<?php
// Service check: shows a notice instead of the site while the account is suspended for non-payment.
$cache = sys_get_temp_dir() . '/svc_${key}';
if (!is_file($cache) || time() - filemtime($cache) > 300) {
  $r = @file_get_contents('${origin}/api/public/web-status/${key}', false, stream_context_create(['http' => ['timeout' => 3]]));
  if ($r !== false) @file_put_contents($cache, $r);
}
$s = @json_decode(@file_get_contents($cache), true);
if (($s['status'] ?? 'active') === 'suspended') {
  http_response_code(503);
  echo '<!doctype html><meta charset="utf-8"><title>Service suspended</title><body style="font-family:sans-serif;text-align:center;padding:15vh 1rem"><h1>This website is temporarily unavailable</h1><p>Please contact the site owner.</p></body>';
  exit;
}
?>`;

const BLANK_CLIENT = { name: '', contactName: '', phone: '', email: '', notes: '' };
const BLANK_SERVICE = { kind: 'hosting', label: '', cost: '', price: '', cycle: 'annual', nextDue: '', invoiceNow: false, notes: '' };

/**
 * Website clients: businesses that are not ISP tenants but pay the platform owner for a domain, hosting or maintenance. Each has a payment
 * reference (WS-101) to use as the account number on the platform paybill; services renew yearly or monthly, an invoice is raised ahead of each
 * renewal, and a payment on the paybill pays the oldest invoice first. Platform owner only.
 */
export default function WebClients() {
  const store = useStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [clientForm, setClientForm] = useState(null);     // { id?, ...fields }
  const [serviceForm, setServiceForm] = useState(null);   // { id?, clientId, ...fields }
  const [payForm, setPayForm] = useState(null);           // { clientId, amount, method, reference, note }

  const load = useCallback(async () => {
    try { setData(await api.webOverview()); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, done) => {
    setBusy(true);
    try { await fn(); await load(); if (done) store.toast(done); return true; } catch (e) { store.toast(e.message); return false; } finally { setBusy(false); }
  };

  const client = data?.clients?.find((c) => c.id === openId) ?? null;
  const s = data?.stats;

  const saveClient = async () => {
    const f = clientForm;
    const ok = await run(() => (f.id ? api.webUpdateClient(f.id, f) : api.webAddClient(f)), f.id ? 'Saved' : 'Client added');
    if (ok) setClientForm(null);
  };
  const saveService = async () => {
    const f = serviceForm;
    const body = { kind: f.kind, label: f.label, cost: Number(f.cost || 0), price: Number(f.price || 0), cycle: f.cycle, nextDue: f.nextDue, notes: f.notes, status: f.status, invoiceNow: !!f.invoiceNow };
    const ok = await run(() => (f.id ? api.webUpdateService(f.id, body) : api.webAddService(f.clientId, body)), f.id ? 'Saved' : 'Service added');
    if (ok) setServiceForm(null);
  };
  const savePayment = async () => {
    const f = payForm;
    const ok = await run(() => api.webRecordPayment(f.clientId, { amount: Number(f.amount), method: f.method, reference: f.reference || undefined, note: f.note || undefined }), 'Payment recorded');
    if (ok) setPayForm(null);
  };

  return (
    <Screen
      title="Website clients"
      subtitle="Domains, hosting and maintenance you bill to clients who are not ISPs. They pay on the platform paybill with their own reference."
      actions={<Button variant="primary" onClick={() => setClientForm({ ...BLANK_CLIENT })}>+ Add client</Button>}
    >
      {error && <Empty>{error}</Empty>}
      {!data && !error && <Empty>Loading…</Empty>}
      {data && (
        <>
          <Grid min={170}>
            <Stat label="Active clients" value={s.clients} hint={`${s.services} services`} />
            <Stat label="Owed now" value={kes(s.owed)} tone={s.owed > 0 ? color.amberInk : undefined} hint="open invoices" />
            <Stat label="Overdue" value={kes(s.overdue)} tone={s.overdue > 0 ? color.rust : undefined} hint="past the due date" />
            <Stat label="Renewing in 30 days" value={s.renewingSoon} hint="services" />
            <Stat label="Yearly revenue" value={kes(s.yearlyRevenue)} hint={`margin ${kes(s.yearlyRevenue - s.yearlyCost)}`} tone={color.green} />
          </Grid>

          <Table
            rowKey={(c) => c.id}
            empty="No website clients yet. Press + Add client."
            rows={data.clients}
            columns={[
              { key: 'name', label: 'Client', render: (c) => (<span><b>{c.name}</b>{c.contact_name ? <span style={{ color: color.muted }}> · {c.contact_name}</span> : null}</span>) },
              { key: 'ref', label: 'Account no.', render: (c) => <span style={{ fontFamily: font.mono }}>{c.billing_ref}</span> },
              { key: 'services', label: 'Services', render: (c) => c.services.filter((x) => x.status === 'active').length },
              { key: 'next', label: 'Next renewal', render: (c) => {
                const d = c.services.filter((x) => x.status === 'active').map((x) => x.next_due).sort()[0];
                return d ?? '—';
              } },
              { key: 'owed', label: 'Owed', align: 'right', render: (c) => (c.overdue > 0 ? <b style={{ color: color.rust }}>{kes(c.owed)}</b> : c.owed > 0 ? kes(c.owed) : '—') },
              { key: 'credit', label: 'Credit', align: 'right', render: (c) => (Number(c.credit) > 0 ? kes(c.credit) : '—') },
              { key: 'status', label: 'Status', render: (c) => (c.suspended ? <Badge tone="expired">suspended</Badge> : <Badge tone={c.status === 'active' ? 'active' : 'default'}>{c.status}</Badge>) },
              { key: 'act', label: '', align: 'right', render: (c) => (
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  {c.suspended
                    ? <Button size="sm" disabled={busy} onClick={() => run(() => api.webSuspend(c.id, false), 'Restored')}>Restore</Button>
                    : <Button size="sm" disabled={busy || c.status !== 'active'} onClick={() => window.confirm(`Suspend ${c.name}? Their website shows a "suspended" notice if it has the service check installed.`) && run(() => api.webSuspend(c.id, true), 'Suspended')}>Suspend</Button>}
                  <Button size="sm" onClick={() => setOpenId(c.id)}>Open</Button>
                </span>
              ) },
            ]}
          />
        </>
      )}

      <Drawer open={!!client} title={client?.name} onClose={() => setOpenId(null)}>
        {client && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ background: color.tileBg, borderRadius: radius.md, padding: 12, fontSize: 13, lineHeight: 1.6 }}>
              <div>Pay on <b>M-Pesa Paybill {data.paybill ?? '(platform paybill not set)'}</b></div>
              <div>Account number: <b style={{ fontFamily: font.mono }}>{client.billing_ref}</b></div>
              <div style={{ color: color.muted }}>{client.phone ?? 'No phone'}{client.email ? ` · ${client.email}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={() => setClientForm({ id: client.id, name: client.name, contactName: client.contact_name ?? '', phone: client.phone ?? '', email: client.email ?? '', notes: client.notes ?? '', status: client.status, graceDays: client.grace_days })}>Edit client</Button>
              <Button size="sm" variant="primary" onClick={() => setPayForm({ clientId: client.id, amount: '', method: 'cash', reference: '', note: '' })}>Record a payment</Button>
              {client.suspended
                ? <Button size="sm" disabled={busy} onClick={() => run(() => api.webSuspend(client.id, false), 'Restored')}>Restore services</Button>
                : <Button size="sm" disabled={busy} onClick={() => window.confirm(`Suspend ${client.name}? Their website shows a "suspended" notice if it has the service check installed.`) && run(() => api.webSuspend(client.id, true), 'Suspended')}>Suspend now</Button>}
            </div>
            {client.suspended && (
              <div style={{ background: color.rustBg, color: color.rust, borderRadius: radius.md, padding: 10, fontSize: 13 }}>
                Suspended{client.suspend_reason === 'auto' ? ' automatically (an invoice is overdue). They are restored as soon as it is paid.' : ' by hand. Use Restore services to switch them back on.'}
              </div>
            )}
            <KV k="Lock-out" v={`Suspended ${client.grace_days} days after an invoice's due date`} />
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Service check for their website</summary>
              <div style={{ fontSize: 12.5, color: color.muted, margin: '8px 0' }}>
                Paste this at the very top of the site's main PHP file (index.php). While the client is suspended the site shows a notice instead; the moment they pay it is back.
                The link it reads is <span style={{ fontFamily: font.mono }}>{window.location.origin}/api/public/web-status/{client.site_key}</span>
              </div>
              <textarea readOnly rows={9} value={phpSnippet(window.location.origin, client.site_key)} style={{ width: '100%', fontFamily: font.mono, fontSize: 11.5, padding: 8, borderRadius: radius.md, border: `1px solid ${color.line}` }} onFocus={(e) => e.target.select()} />
              <Button size="sm" onClick={() => { navigator.clipboard?.writeText(phpSnippet(window.location.origin, client.site_key)); store.toast('Copied'); }}>Copy</Button>
            </details>
            <div style={{ fontSize: 12.5, color: color.muted }}>
              Their own page (sent in every message):{' '}
              <span style={{ fontFamily: font.mono }}>{window.location.origin}/web/{client.portal_key}</span>{' '}
              <Button size="sm" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/web/${client.portal_key}`); store.toast('Link copied'); }}>Copy link</Button>
            </div>
            <KV k="Credit held" v={kes(client.credit)} />
            <KV k="Owed" v={kes(client.owed)} />

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 8px' }}>
                <b>Services</b>
                <Button size="sm" onClick={() => setServiceForm({ ...BLANK_SERVICE, clientId: client.id })}>+ Add service</Button>
              </div>
              <Table
                rowKey={(x) => x.id}
                empty="No services yet"
                rows={client.services}
                columns={[
                  { key: 'label', label: 'Service', render: (x) => (<span><b>{x.label}</b><span style={{ color: color.muted }}> · {x.kind}</span></span>) },
                  { key: 'price', label: 'Price', align: 'right', render: (x) => `${kes(x.price)} / ${x.cycle === 'annual' ? 'yr' : 'mo'}` },
                  { key: 'cost', label: 'Cost', align: 'right', render: (x) => kes(x.cost) },
                  { key: 'next', label: 'Next period', render: (x) => x.next_due },
                  { key: 'status', label: '', render: (x) => <Badge tone={x.status === 'active' ? 'active' : 'default'}>{x.status}</Badge> },
                  { key: 'act', label: '', align: 'right', render: (x) => (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <Button size="sm" onClick={() => setServiceForm({ id: x.id, clientId: client.id, kind: x.kind, label: x.label, cost: x.cost, price: x.price, cycle: x.cycle, nextDue: x.next_due, status: x.status, notes: x.notes ?? '' })}>Edit</Button>
                      <Button size="sm" disabled={busy || x.status !== 'active'} onClick={() => run(() => api.webRaiseInvoice(x.id), 'Invoice raised')}>Invoice now</Button>
                    </span>
                  ) },
                ]}
              />
            </div>

            <div>
              <b style={{ display: 'block', margin: '4px 0 8px' }}>Invoices</b>
              <Table
                rowKey={(i) => i.id}
                empty="No invoices yet. One is raised ahead of each renewal."
                rows={client.invoices}
                columns={[
                  { key: 'number', label: 'No.', render: (i) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{i.number}</span> },
                  { key: 'description', label: 'For' },
                  { key: 'due', label: 'Due', render: (i) => i.due_date },
                  { key: 'amount', label: 'Amount', align: 'right', render: (i) => kes(i.amount) },
                  { key: 'paid', label: 'Paid', align: 'right', render: (i) => kes(i.paid) },
                  { key: 'status', label: '', render: (i) => <Badge tone={i.status === 'paid' ? 'active' : i.status === 'void' ? 'default' : (i.due_date < data.today ? 'expired' : 'pending')}>{i.status === 'open' || i.status === 'partial' ? (i.due_date < data.today ? 'overdue' : i.status) : i.status}</Badge> },
                  { key: 'act', label: '', align: 'right', render: (i) => (['open', 'partial'].includes(i.status) ? (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <Button size="sm" disabled={busy} onClick={() => run(() => api.webRemindInvoice(i.id), 'Reminder sent')}>Remind</Button>
                      {Number(i.paid) === 0 && <Button size="sm" disabled={busy} onClick={() => window.confirm(`Cancel invoice ${i.number}?`) && run(() => api.webVoidInvoice(i.id), 'Invoice cancelled')}>Cancel</Button>}
                    </span>
                  ) : null) },
                ]}
              />
            </div>

            <div>
              <b style={{ display: 'block', margin: '4px 0 8px' }}>Payments received</b>
              <Table
                rowKey={(p) => p.id}
                empty="Nothing received yet"
                rows={client.payments}
                columns={[
                  { key: 'at', label: 'When', render: (p) => new Date(p.created_at).toLocaleString('en-KE') },
                  { key: 'method', label: 'How' },
                  { key: 'reference', label: 'Reference', render: (p) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{p.reference ?? '—'}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: (p) => kes(p.amount) },
                ]}
              />
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={!!clientForm}
        title={clientForm?.id ? 'Edit client' : 'Add a website client'}
        onClose={() => setClientForm(null)}
        footer={<><Button onClick={() => setClientForm(null)}>Cancel</Button><Button variant="primary" disabled={busy || !clientForm?.name?.trim()} onClick={saveClient}>{busy ? 'Saving…' : 'Save'}</Button></>}
      >
        {clientForm && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Business name"><Input value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} placeholder="Vegas Electronics" autoFocus /></Field>
            <Field label="Contact person"><Input value={clientForm.contactName} onChange={(e) => setClientForm({ ...clientForm, contactName: e.target.value })} /></Field>
            <Field label="Phone" hint="Invoices, reminders and receipts are sent here by SMS."><Input value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} placeholder="0712345678" /></Field>
            <Field label="Email"><Input value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} /></Field>
            <Field label="Notes"><Input value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} /></Field>
            {clientForm.id && (
              <Field label="Grace days before suspension" hint="How many days after an invoice's due date before their services are suspended. Paying restores them at once."><Input type="number" min="0" max="90" value={clientForm.graceDays} onChange={(e) => setClientForm({ ...clientForm, graceDays: e.target.value })} /></Field>
            )}
            {clientForm.id && (
              <Field label="Status"><Select value={clientForm.status} onChange={(e) => setClientForm({ ...clientForm, status: e.target.value })} options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused (no new invoices)' }, { value: 'closed', label: 'Closed' }]} /></Field>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!serviceForm}
        title={serviceForm?.id ? 'Edit service' : 'Add a service'}
        onClose={() => setServiceForm(null)}
        footer={<><Button onClick={() => setServiceForm(null)}>Cancel</Button><Button variant="primary" disabled={busy || !serviceForm?.label?.trim() || !serviceForm?.nextDue || serviceForm?.price === ''} onClick={saveService}>{busy ? 'Saving…' : 'Save'}</Button></>}
      >
        {serviceForm && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Type"><Select value={serviceForm.kind} onChange={(e) => setServiceForm({ ...serviceForm, kind: e.target.value })} options={KINDS.map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="What it is" hint="The domain name, or a short description."><Input value={serviceForm.label} onChange={(e) => setServiceForm({ ...serviceForm, label: e.target.value })} placeholder="vegaselectronics.co.ke" /></Field>
            <Field label="Billed"><Select value={serviceForm.cycle} onChange={(e) => setServiceForm({ ...serviceForm, cycle: e.target.value })} options={CYCLES.map(([value, label]) => ({ value, label }))} /></Field>
            <Field label={`Price to the client, per ${serviceForm.cycle === 'annual' ? 'year' : 'month'}`}><Input type="number" min="0" value={serviceForm.price} onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })} /></Field>
            <Field label={`Your cost, per ${serviceForm.cycle === 'annual' ? 'year' : 'month'}`} hint="What you pay for it. Only used to show your margin."><Input type="number" min="0" value={serviceForm.cost} onChange={(e) => setServiceForm({ ...serviceForm, cost: e.target.value })} /></Field>
            <Field label="Next period starts" hint="The renewal date. An invoice is raised 30 days before a yearly renewal and 5 days before a monthly one."><Input type="date" value={serviceForm.nextDue} onChange={(e) => setServiceForm({ ...serviceForm, nextDue: e.target.value })} /></Field>
            {serviceForm.id ? (
              <Field label="Status"><Select value={serviceForm.status} onChange={(e) => setServiceForm({ ...serviceForm, status: e.target.value })} options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused (no invoices)' }, { value: 'cancelled', label: 'Cancelled' }]} /></Field>
            ) : (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={!!serviceForm.invoiceNow} onChange={(e) => setServiceForm({ ...serviceForm, invoiceNow: e.target.checked })} />
                Raise the first invoice now (for the period starting on that date)
              </label>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!payForm}
        title="Record a payment"
        onClose={() => setPayForm(null)}
        footer={<><Button onClick={() => setPayForm(null)}>Cancel</Button><Button variant="primary" disabled={busy || !(Number(payForm?.amount) > 0)} onClick={savePayment}>{busy ? 'Saving…' : 'Record'}</Button></>}
      >
        {payForm && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 13, color: color.muted }}>For money received outside the paybill (cash, bank). It goes on the client's credit and pays the oldest invoice first. Paybill payments are recorded by themselves.</div>
            <Field label="Amount (KES)"><Input type="number" min="0" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} autoFocus /></Field>
            <Field label="How"><Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank transfer' }, { value: 'mpesa', label: 'M-Pesa (other)' }, { value: 'manual', label: 'Other' }]} /></Field>
            <Field label="Reference" hint="The bank or M-Pesa code, if there is one. The same code cannot be recorded twice."><Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></Field>
            <Field label="Note"><Input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
