import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { color, font, radius, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { useAction, ActionResult } from '../ui/action';
import { api } from '../api/client';
import { downloadCsv } from '../lib/csv';
import { Badge, Button, Empty, Field, Input, Modal, Screen, Select, Table, Textarea } from '../ui/primitives';

const TABS = [
  { id: 'unmatched', label: 'Unmatched' },
  { id: 'failed', label: 'Failed STK' },
  { id: 'all', label: 'All transactions' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'reports', label: 'M-Pesa report' },
];

const card = {
  background: color.cardBg,
  border: `1px solid ${color.line}`,
  borderRadius: radius.lg,
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
};

const Tile = ({ label, value, hint, dim }) => (
  <div style={card}>
    <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: color.muted }}>{label}</span>
    <span style={{ fontFamily: font.mono, fontSize: 24, color: dim ? color.neutralInk : color.ink }}>{value}</span>
    <span style={{ fontSize: 12.5, color: color.neutralInk }}>{hint}</span>
  </div>
);

const money = (n) => `KES ${kes(n)}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export default function Payments() {
  const store = useStore();
  const location = useLocation();
  const [tab, setTab] = useState(location.pathname === '/invoices' ? 'invoices' : 'unmatched');
  const [resolving, setResolving] = useState(null);
  const [assignTo, setAssignTo] = useState('');
  const [busy, setBusy] = useState(false);

  const unmatched = store.unmatched ?? [];
  const all = store.mpesaTx ?? [];
  const invoices = store.invoices ?? [];

  const collected = all.filter((p) => p.status === 'applied').reduce((a, p) => a + Number(p.amount ?? 0), 0);
  const openInvoices = invoices.filter((i) => i.status === 'open' || i.status === 'partial');
  const outstanding = openInvoices.reduce((a, i) => a + (Number(i.amount ?? 0) - Number(i.paid ?? 0)), 0);
  const matchRate = all.length ? Math.round(((all.length - unmatched.length) / all.length) * 100) : null;

  const months = useMemo(() => {
    const out = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleDateString('en-KE', { month: 'short' });
      const inMonth = all.filter((p) => {
        const t = new Date(p.received_at ?? 0);
        return t.getMonth() === d.getMonth() && t.getFullYear() === d.getFullYear() && p.status === 'applied';
      });
      out.push({ label, total: inMonth.reduce((a, p) => a + Number(p.amount ?? 0), 0) });
    }
    const peak = Math.max(1, ...out.map((m) => m.total));
    return out.map((m) => ({ ...m, pct: (m.total / peak) * 100 }));
  }, [all]);

  const [stkForm, setStkForm] = useState(null);
  const [stkResult, setStkResult] = useState(null);
  const stkPoll = useRef(null);

  useEffect(() => () => clearInterval(stkPoll.current), []);

  /**
   * Fire the prompt, then poll stk_requests until the callback lands. Without a
   * publicly reachable BASE_URL the callback never arrives, so the poll is capped
   * and says so rather than spinning forever.
   */
  const pushStk = async () => {
    if (!stkForm.amount) return store.toast('Enter an amount');
    if (!stkForm.subscriberId && !stkForm.phone.trim()) return store.toast('Pick a client or type a number');
    try {
      const r = await api.pushStk({
        provider: stkForm.provider,
        subscriberId: stkForm.subscriberId || null,
        phone: stkForm.phone || null,
        amount: Number(stkForm.amount),
        planId: stkForm.planId || null,
      });
      setStkResult({ ...r, status: 'pending', elapsed: 0 });
      store.toast(r.note);

      clearInterval(stkPoll.current);
      stkPoll.current = setInterval(async () => {
        try {
          const s = await api.stkStatus(r.checkoutId);
          setStkResult((prev) => {
            const elapsed = (prev?.elapsed ?? 0) + 3;
            if (s.status && s.status !== 'pending') {
              clearInterval(stkPoll.current);
              store.reload();
              return { ...prev, ...s, elapsed };
            }
            if (elapsed >= 90) clearInterval(stkPoll.current);
            return { ...prev, ...s, elapsed };
          });
        } catch {
          /* keep polling */
        }
      }, 3000);
    } catch (e) {
      store.toast(`STK failed: ${e.message}`);
    }
  };

  const [invoiceForm, setInvoiceForm] = useState(null);
  const [recordForm, setRecordForm] = useState(null);
  const [reconcileText, setReconcileText] = useState(null);

  const createInvoice = async () => {
    if (!invoiceForm.amount) return store.toast('Enter an amount');
    try {
      const made = await api.createInvoice({
        subscriberId: invoiceForm.subscriberId || null,
        amount: Number(invoiceForm.amount),
        dueDate: invoiceForm.dueDate || new Date().toISOString().slice(0, 10),
      });
      store.setCollection('invoices', (xs) => [made, ...xs]);
      store.toast(`${made.number} raised for KES ${kes(made.amount)}`);
      setInvoiceForm(null);
      setTab('invoices');
    } catch (e) {
      store.toast(`Could not create: ${e.message}`);
    }
  };

  const recordPayment = async () => {
    if (!recordForm.code || !recordForm.amount) return store.toast('M-Pesa code and amount are required');
    try {
      const out = await api.recordPayment(recordForm);
      await store.reload();
      store.toast(
        out.duplicate ? 'Already recorded — that code is in the ledger'
        : out.unmatched ? 'Recorded, but it needs matching — see Unmatched'
        : 'Payment recorded and applied'
      );
      setRecordForm(null);
    } catch (e) {
      store.toast(`Could not record: ${e.message}`);
    }
  };

  const action = useAction();

  const reconcile = async () => {
    if (!reconcileText?.trim()) return store.toast('Paste the statement first');
    try {
      // Five numbers in a toast that vanishes is a report nobody can read
      // twice, and this is the one action whose result decides what an operator
      // does next — chase the unmatched, or re-read the unreadable lines.
      await action.run('Reconciling the statement', async () => {
        const r = await api.reconcileStatement(reconcileText);
        await store.reload();
        return r;
      }, {
        working: 'Reading each line and matching it to an account…',
        describe: (r) => ({
          lines: [
            `${r.parsed} line(s) understood`,
            `${r.applied} applied to an account`,
            `${r.unmatched} could not be matched — these need a person`,
            `${r.duplicate} already recorded`,
            `${r.skipped} unreadable`,
          ],
        }),
      });
      setReconcileText(null);
    } catch {
      // Reported in the dialog.
    }
  };

  const exportReport = () => {
    const rows = [
      ['code', 'amount', 'payer_name', 'payer_phone', 'typed_account', 'channel', 'status', 'received_at'],
      ...all.map((p) => [p.provider_ref, p.amount, p.payer_name, p.payer_phone, p.raw_account, p.provider, p.status, p.received_at]),
    ];
    const n = downloadCsv(`mpesa-report-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    store.toast(n ? `Exported ${n} transaction(s)` : 'Nothing to export yet');
  };

  const resolve = async () => {
    if (!assignTo) return store.toast('Pick a client to apply this payment to');
    setBusy(true);
    try {
      await api.matchPayment(resolving.id, assignTo);
      store.setUnmatched((u) => u.filter((p) => p.id !== resolving.id));
      store.toast('Payment matched and applied');
      setResolving(null);
      setAssignTo('');
    } catch (e) {
      store.toast(`Could not match: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Payments"
      subtitle="Confirmed payments are matched and applied automatically. Anything ambiguous waits here."
      actions={
        <>
          <Button variant="primary" onClick={() => setInvoiceForm({ subscriberId: '', amount: '', dueDate: '' })}>
            + Create invoice
          </Button>
          <Button
            style={{ fontWeight: 600 }}
            onClick={() => { setStkResult(null); setStkForm({ provider: 'daraja', subscriberId: '', phone: '', amount: '', planId: '' }); }}
          >
            Charge via STK
          </Button>
          <Button style={{ fontWeight: 600 }} onClick={() => setRecordForm({ code: '', amount: '', phone: '', name: '', account: '' })}>
            Record payment
          </Button>
          <Button onClick={() => setReconcileText('')}>Reconcile statement</Button>
          <Button onClick={exportReport}>Export M-Pesa report</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <Tile label="COLLECTED THIS MONTH" value={money(collected)} hint={collected ? `${all.length} payments` : 'no collections yet'} />
        <Tile label="OUTSTANDING" value={money(outstanding)} dim hint={`${openInvoices.length} open invoices`} />
        <Tile label="ORG BALANCE (M-PESA)" value="KES 0" hint="utility acct · not synced" />
        <Tile label="AUTO-MATCH RATE" value={matchRate === null ? '—' : `${matchRate}%`} hint={`${unmatched.length} need a human`} />
      </div>

      <div style={{ ...card, padding: '18px 20px', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Collections tracking · last 4 months</span>
          <div style={{ display: 'flex', gap: 16 }}>
            {[['PPPoE', '#0f7a5f'], ['Hotspot', '#54c2a1'], ['Target', '#c9a227']].map(([l, c]) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4a524c' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />
                {l}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 26, height: 220, paddingTop: 6 }}>
          {months.map((m) => (
            <div key={m.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 6 }}>
              <span style={{ fontFamily: font.mono, fontSize: 11.5, color: '#4a524c', textAlign: 'center' }}>{kes(m.total)}</span>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: '100%' }}>
                <div style={{ flex: 1, height: `${m.pct}%`, background: '#0f7a5f', borderRadius: '4px 4px 0 0' }} />
                <div style={{ flex: 1, height: `${m.pct * 0.4}%`, background: '#54c2a1', borderRadius: '4px 4px 0 0' }} />
                <div style={{ flex: 1, height: `${Math.min(100, m.pct * 1.2)}%`, background: '#c9a227', borderRadius: '4px 4px 0 0', opacity: 0.55 }} />
              </div>
              <span style={{ fontSize: 11.5, color: color.muted, textAlign: 'center', borderTop: '1px solid #eef0ec', paddingTop: 6 }}>
                {m.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${color.line}`, borderRadius: radius.lg, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${color.line}`, overflowX: 'auto' }}>
          {TABS.map((t) => {
            const on = t.id === tab;
            const n = t.id === 'unmatched' ? unmatched.length : t.id === 'invoices' ? openInvoices.length : null;
            return (
              <div
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  position: 'relative',
                  padding: '13px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: on ? color.ink : color.neutralInk,
                  whiteSpace: 'nowrap',
                }}
              >
                {on && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: color.green }} />}
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t.label}
                  {n !== null && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 18,
                        height: 18,
                        padding: '0 5px',
                        borderRadius: radius.pill,
                        background: color.tileBg,
                        color: color.neutralInk,
                        fontSize: 11,
                      }}
                    >
                      {n}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '16px 20px' }}>
          {tab === 'unmatched' && (
            <Table
              rowKey={(r) => r.id}
              empty="Nothing waiting — every payment matched automatically"
              rows={unmatched}
              columns={[
                { key: 'provider_ref', label: 'M-Pesa code', render: (r) => <span style={{ fontFamily: font.mono }}>{r.provider_ref}</span> },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
                { key: 'payer', label: 'From', render: (r) => (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>{r.payer_name ?? '—'}</span>
                    <span style={{ fontFamily: font.mono, fontSize: 11.5, color: color.muted }}>{r.payer_phone}</span>
                  </div>
                ) },
                { key: 'raw_account', label: 'Typed account', render: (r) => <span style={{ fontFamily: font.mono }}>{r.raw_account ?? '—'}</span> },
                { key: 'provider', label: 'Channel' },
                { key: 'received_at', label: 'Received', render: (r) => when(r.received_at) },
                {
                  key: 'act',
                  label: '',
                  align: 'right',
                  render: (r) => (
                    <Button size="sm" variant="primary" onClick={() => { setResolving(r); setAssignTo(''); }}>
                      Resolve
                    </Button>
                  ),
                },
              ]}
            />
          )}

          {tab === 'failed' && (
            <Table
              rowKey={(r) => r.id}
              empty="No failed STK pushes"
              rows={all.filter((p) => p.status === 'failed')}
              columns={[
                { key: 'provider_ref', label: 'Ref' },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
                { key: 'payer_phone', label: 'Phone' },
                { key: 'received_at', label: 'When', render: (r) => when(r.received_at) },
              ]}
            />
          )}

          {tab === 'all' && (
            <Table
              rowKey={(r) => r.id}
              empty="No transactions recorded yet"
              rows={all}
              columns={[
                { key: 'provider_ref', label: 'M-Pesa ref', render: (r) => <span style={{ fontFamily: font.mono }}>{r.provider_ref}</span> },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
                {
                  key: 'customer',
                  label: 'Customer',
                  // The account this actually applied to, not who M-Pesa said
                  // paid — a shared or family phone means those can differ.
                  render: (r) => r.customer_name ? r.customer_name.trim().split(/\s+/)[0] : '—',
                },
                { key: 'payer_phone', label: 'Phone' },
                {
                  key: 'plan',
                  label: 'Bundle',
                  render: (r) => r.plan_title
                    ? <span>{r.plan_title}{r.rate_down ? <span style={{ color: color.neutralInk }}> · {Math.round(r.rate_down / 1000)}/{Math.round(r.rate_up / 1000)} Mbps</span> : null}</span>
                    : '—',
                },
                { key: 'provider', label: 'Channel' },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status}>{r.status}</Badge> },
                { key: 'received_at', label: 'Received', render: (r) => when(r.received_at) },
              ]}
            />
          )}

          {tab === 'invoices' && (
            <Table
              rowKey={(r) => r.id}
              empty="No invoices raised yet — they generate automatically 3 days before expiry"
              rows={invoices}
              columns={[
                { key: 'number', label: 'Invoice', render: (r) => <span style={{ fontFamily: font.mono }}>{r.number}</span> },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
                { key: 'paid', label: 'Paid', align: 'right', render: (r) => money(r.paid) },
                { key: 'due_date', label: 'Due', render: (r) => (r.due_date ? new Date(r.due_date).toLocaleDateString('en-KE') : '—') },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status}>{r.status}</Badge> },
              ]}
            />
          )}

          {tab === 'reports' && (
            <Empty
              action={
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button onClick={exportReport}>Export CSV</Button>
                  <Button variant="primary" onClick={() => setReconcileText('')}>Paste statement</Button>
                </div>
              }
            >
              {all.length
                ? `${all.length} transaction(s) on file — export or reconcile a statement against them`
                : 'M-Pesa reconciliation report — nothing to reconcile yet'}
            </Empty>
          )}
        </div>
      </div>

      <Modal
        open={!!resolving}
        title={`Resolve ${resolving?.provider_ref ?? ''}`}
        onClose={() => setResolving(null)}
        footer={
          <>
            <Button onClick={() => setResolving(null)}>Cancel</Button>
            <Button variant="primary" onClick={resolve} disabled={busy}>
              {busy ? 'Applying…' : 'Apply payment'}
            </Button>
          </>
        }
      >
        {resolving && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: color.tileBg, borderRadius: radius.md, padding: 12, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span><strong>{money(resolving.amount)}</strong> from {resolving.payer_name ?? 'unknown'}</span>
              <span style={{ fontFamily: font.mono, fontSize: 12, color: color.muted }}>
                {resolving.payer_phone} · typed "{resolving.raw_account ?? ''}"
              </span>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: color.inkSoft }}>Apply to client</span>
              <Select
                value={assignTo}
                onChange={(e) => setAssignTo(e.target.value)}
                options={[
                  { value: '', label: store.clients.length ? 'Select a client…' : 'No clients loaded' },
                  ...store.clients.map((c) => ({ value: c.id, label: `${c.name} · ${c.account_code}` })),
                ]}
              />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={!!stkForm}
        title="Charge via STK push"
        width={560}
        onClose={() => { clearInterval(stkPoll.current); setStkForm(null); }}
        footer={
          <>
            <Button onClick={() => { clearInterval(stkPoll.current); setStkForm(null); }}>Close</Button>
            <Button variant="primary" onClick={pushStk} disabled={stkResult?.status === 'pending'}>
              {stkResult?.status === 'pending' ? 'Waiting…' : 'Send prompt'}
            </Button>
          </>
        }
      >
        {stkForm && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Channel" hint={stkForm.provider === 'kopokopo' ? 'Hotspot bundles only' : 'Paybill STK'}>
              <Select
                value={stkForm.provider}
                onChange={(e) => setStkForm((s) => ({ ...s, provider: e.target.value }))}
                options={[
                  { value: 'daraja', label: 'M-Pesa Paybill (Daraja)' },
                  { value: 'kopokopo', label: 'KopoKopo (hotspot)' },
                ]}
              />
            </Field>
            <Field label="Amount (KES)">
              <Input type="number" value={stkForm.amount} onChange={(e) => setStkForm((s) => ({ ...s, amount: e.target.value }))} />
            </Field>

            <Field label="Client" span={2} hint="Or leave blank and type a number below">
              <Select
                value={stkForm.subscriberId}
                onChange={(e) => setStkForm((s) => ({ ...s, subscriberId: e.target.value }))}
                options={[
                  { value: '', label: 'Not a saved client' },
                  ...store.clients.map((c) => ({ value: c.id, label: `${c.name} · ${c.phone}` })),
                ]}
              />
            </Field>

            {!stkForm.subscriberId && (
              <Field label="Phone" span={2}>
                <Input
                  value={stkForm.phone}
                  onChange={(e) => setStkForm((s) => ({ ...s, phone: e.target.value }))}
                  placeholder="07xx xxx xxx"
                  style={{ fontFamily: font.mono }}
                />
              </Field>
            )}

            {stkForm.provider === 'kopokopo' && (
              <Field label="Hotspot bundle" span={2} hint="KopoKopo needs a plan; the voucher is issued on success">
                <Select
                  value={stkForm.planId}
                  onChange={(e) => setStkForm((s) => ({ ...s, planId: e.target.value }))}
                  options={[
                    { value: '', label: store.hsPlans?.length ? 'Select a bundle…' : 'No hotspot bundles yet' },
                    ...(store.hsPlans ?? []).map((p) => ({ value: p.id, label: `${p.title} · KES ${p.price}` })),
                  ]}
                />
              </Field>
            )}

            {stkResult && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  background: stkResult.status === 'success' ? '#eef7f2' : stkResult.status === 'failed' ? '#fdf1ec' : color.tileBg,
                  border: `1px solid ${stkResult.status === 'failed' ? '#f0d8ce' : color.line}`,
                  borderRadius: 9,
                  padding: '11px 13px',
                  fontSize: 12.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <span style={{ fontFamily: font.mono, fontSize: 11.5, color: color.muted }}>{stkResult.checkoutId}</span>
                <span>
                  <strong>{stkResult.status}</strong>
                  {stkResult.result_desc ? ` — ${stkResult.result_desc}` : ''}
                  {stkResult.status === 'pending' && ` · waited ${stkResult.elapsed ?? 0}s`}
                </span>
                {!stkResult.callbackReachable && (
                  <span style={{ color: color.amberInk }}>{stkResult.note}</span>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!invoiceForm}
        title="Create invoice"
        onClose={() => setInvoiceForm(null)}
        footer={
          <>
            <Button onClick={() => setInvoiceForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={createInvoice}>Raise invoice</Button>
          </>
        }
      >
        {invoiceForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Client">
              <Select
                value={invoiceForm.subscriberId}
                onChange={(e) => setInvoiceForm((s) => ({ ...s, subscriberId: e.target.value }))}
                options={[
                  { value: '', label: 'Not client-specific' },
                  ...store.clients.map((c) => ({ value: c.id, label: `${c.name} · ${c.account_code}` })),
                ]}
              />
            </Field>
            <Field label="Amount (KES)">
              <Input type="number" value={invoiceForm.amount} onChange={(e) => setInvoiceForm((s) => ({ ...s, amount: e.target.value }))} />
            </Field>
            <Field label="Due date" hint="Defaults to today">
              <Input type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm((s) => ({ ...s, dueDate: e.target.value }))} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!recordForm}
        title="Record payment"
        onClose={() => setRecordForm(null)}
        footer={
          <>
            <Button onClick={() => setRecordForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={recordPayment}>Record</Button>
          </>
        }
      >
        {recordForm && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1', fontSize: 12.5, color: color.neutralInk }}>
              Goes through the same matching funnel as the webhooks, so it will auto-apply
              if the account or phone is recognised.
            </div>
            <Field label="M-Pesa code">
              <Input
                value={recordForm.code}
                onChange={(e) => setRecordForm((s) => ({ ...s, code: e.target.value.toUpperCase() }))}
                placeholder="SJ71M4PL8Q"
                style={{ fontFamily: font.mono }}
              />
            </Field>
            <Field label="Amount (KES)">
              <Input type="number" value={recordForm.amount} onChange={(e) => setRecordForm((s) => ({ ...s, amount: e.target.value }))} />
            </Field>
            <Field label="Payer phone">
              <Input value={recordForm.phone} onChange={(e) => setRecordForm((s) => ({ ...s, phone: e.target.value }))} placeholder="07xx xxx xxx" />
            </Field>
            <Field label="Payer name">
              <Input value={recordForm.name} onChange={(e) => setRecordForm((s) => ({ ...s, name: e.target.value }))} />
            </Field>
            <Field label="Account typed by the customer" span={2}>
              <Input value={recordForm.account} onChange={(e) => setRecordForm((s) => ({ ...s, account: e.target.value }))} placeholder="ZN-1042" />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={reconcileText !== null}
        title="Reconcile statement"
        width={620}
        onClose={() => setReconcileText(null)}
        footer={
          <>
            <Button onClick={() => setReconcileText(null)}>Cancel</Button>
            <Button variant="primary" onClick={reconcile}>Reconcile</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 12.5, color: color.neutralInk }}>
            Paste forwarded M-Pesa messages, one per line. Each is parsed and applied;
            codes already in the ledger are skipped as duplicates.
          </span>
          <Textarea
            value={reconcileText ?? ''}
            onChange={(e) => setReconcileText(e.target.value)}
            rows={10}
            style={{ fontFamily: font.mono, fontSize: 12 }}
            placeholder={'SJ71M4PL8Q Confirmed. You have received Ksh2,500.00 from JOHN M NJUGUNA 0722118340 on 1/8/26 for account ZN-1042'}
          />
        </div>
      </Modal>

      <ActionResult state={action.state} onClose={action.dismiss} />
    </Screen>
  );
}
