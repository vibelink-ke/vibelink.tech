import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, font, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Textarea } from '../ui/primitives';
import Bills from './expenses/Bills';
import Suppliers from './expenses/Suppliers';
import ProfitLoss from './expenses/ProfitLoss';

const CATEGORIES = ['Fuel', 'Equipment', 'Rent', 'Utilities', 'Salaries', 'Marketing', 'Repairs', 'Other'];

const blank = () => ({
  category: 'Fuel', description: '', amount: '', paidTo: '', staffId: '', receiptFile: null,
  supplierId: '', dueDate: '', reference: '',
});

/** Small label on an expense that was not typed in by hand. */
const Tag = ({ children }) => (
  <span style={{
    marginLeft: 8, padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
    background: color.tileBg, color: color.muted, letterSpacing: '.03em',
  }}>{children}</span>
);

/** Due date, in red once it has passed and the expense is still unpaid. */
function DueDate({ e }) {
  const day = String(e.due_date).slice(0, 10);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const overdue = day < today && !['paid', 'rejected'].includes(e.status);
  const label = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <span style={{ color: overdue ? color.rust : color.ink, fontWeight: overdue ? 700 : 400 }}>
      {label}{overdue && <span style={{ fontSize: 11, marginLeft: 6 }}>overdue</span>}
    </span>
  );
}


const STATUS_TONE = { pending: 'pending', approved: 'default', paid: 'active', rejected: 'suspended' };

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/**
 * A running log of money spent, separate from payroll's own salary/
 * commission/bonus lines — but the two meet at "expense reimbursement":
 * once approved here, a reimbursement can be pulled into a payroll run
 * (Hr.jsx's Payroll tab) as one more line on the staff member it belongs
 * to, rather than paid out through a second, separate channel.
 */
export default function Expenses() {
  const store = useStore();
  const navigate = useNavigate();
  const items = store.expenses ?? [];
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  // Expenses, Monthly bills and Suppliers share this screen; a tab only shows for someone who may see it.
  const [tab, setTab] = useState('log');
  const perms = store.session?.perms ?? {};
  const [suppliers, setSuppliers] = useState([]);
  const loadSuppliers = async () => {
    if (!perms['suppliers.view']) return;
    try { setSuppliers(await api.suppliers()); } catch { setSuppliers([]); }
  };
  useEffect(() => { loadSuppliers(); }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const reload = async () => store.setCollection('expenses', await api.expenses());

  const save = async () => {
    if (!form.category.trim()) return store.toast('Pick a category');
    const amount = Number(form.amount);
    if (!(amount > 0)) return store.toast('Enter a positive amount');
    setBusy(true);
    try {
      const created = await api.createExpense({
        category: form.category, description: form.description || undefined,
        amount, paidTo: form.paidTo || undefined, staffId: form.staffId || undefined,
        supplierId: form.supplierId || undefined, dueDate: form.dueDate || undefined, reference: form.reference || undefined,
      });
      if (form.receiptFile) {
        try {
          await api.uploadExpenseReceipt(created.id, await fileToDataUrl(form.receiptFile));
        } catch (e) {
          store.toast(`Expense logged, but the receipt didn't upload: ${e.message}`);
        }
      }
      // Recorded and paid in one go: approve it, then send it. Each step is its own permission,
      // and a failure leaves the expense logged (and approved) with the reason on it, to retry.
      if (form.payNow) {
        try {
          await api.approveExpense(created.id);
          await api.payExpense(created.id, form.payPhone ? { method: 'phone', phone: form.payPhone } : {});
          store.toast('Expense logged and sent to M-Pesa — it shows as paid once M-Pesa confirms');
        } catch (e) {
          store.toast(`Expense logged, but not paid: ${e.message}`);
        }
      } else {
        store.toast('Expense logged');
      }
      await reload();
      setForm(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Where an approved expense would be sent, in words, for the confirmation.
  const payTarget = (e) => {
    if (e.staff_id) return `${e.staff_name ?? 'the staff member'}'s phone`;
    if (e.supplier_paybill) return `${e.supplier_name ?? 'the supplier'} (paybill ${e.supplier_paybill})`;
    if (e.supplier_till) return `${e.supplier_name ?? 'the supplier'} (till ${e.supplier_till})`;
    if (e.supplier_phone) return `${e.supplier_name ?? 'the supplier'} (${e.supplier_phone})`;
    return null;
  };

  // Send it from the M-Pesa paybill. Marked paid only when M-Pesa confirms, so this reports
  // "on its way", not "paid".
  const payNow = async (e) => {
    let body = {};
    let target = payTarget(e);
    if (!target) {
      const phone = window.prompt('Nowhere on file to send this. Phone number to pay (M-Pesa):', '');
      if (!phone) return;
      body = { method: 'phone', phone: phone.trim() };
      target = phone.trim();
    }
    if (!window.confirm(`Send KES ${kes(e.amount)} from your M-Pesa paybill to ${target}?\n\nThis moves real money and cannot be undone here.`)) return;
    try {
      await api.payExpense(e.id, body);
      await reload();
      store.toast('Payment sent to M-Pesa — it shows as paid once M-Pesa confirms');
    } catch (err) {
      await reload().catch(() => {});
      store.toast(`Could not pay: ${err.message}`);
    }
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete this ${e.category} expense?`)) return;
    try {
      await api.deleteExpense(e.id);
      store.setCollection('expenses', (xs) => xs.filter((x) => x.id !== e.id));
    } catch (err) {
      store.toast(`Could not delete: ${err.message}`);
    }
  };

  const approve = async (e) => {
    try {
      await api.approveExpense(e.id);
      await reload();
      store.toast('Approved');
    } catch (err) {
      store.toast(`Could not approve: ${err.message}`);
    }
  };

  const markPaid = async (e) => {
    try {
      await api.markExpensePaid(e.id);
      await reload();
      store.toast('Marked paid');
    } catch (err) {
      store.toast(`Could not update: ${err.message}`);
    }
  };

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((e) => e.status === filter)),
    [items, filter]);

  const totalPending = items.filter((e) => e.status === 'pending').reduce((n, e) => n + Number(e.amount), 0);
  const totalApproved = items.filter((e) => e.status === 'approved').reduce((n, e) => n + Number(e.amount), 0);
  const totalPaidThisMonth = items
    .filter((e) => e.status === 'paid' && e.paid_at && new Date(e.paid_at).getMonth() === new Date().getMonth())
    .reduce((n, e) => n + Number(e.amount), 0);

  return (
    <Screen
      title="Expenses"
      subtitle="Fuel, rent, equipment, staff reimbursements — every shilling spent, logged before it's paid."
      actions={<Button variant="primary" onClick={() => setForm(blank())}>+ Log expense</Button>}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['log', 'Expenses'], ...(perms['bills.view'] ? [['bills', 'Monthly bills']] : []),
          ...(perms['suppliers.view'] ? [['suppliers', 'Suppliers']] : []),
          ...(perms['profitloss.view'] ? [['pnl', 'Profit & loss']] : [])].map(([key, label]) => (
          <Button key={key} variant={tab === key ? 'primary' : undefined} onClick={() => setTab(key)}>{label}</Button>
        ))}
      </div>

      {tab === 'bills' && (
        <Bills categories={CATEGORIES} suppliers={suppliers} canEdit={!!perms['bills.edit']} />
      )}
      {tab === 'suppliers' && (
        <Suppliers suppliers={suppliers} reload={loadSuppliers} categories={CATEGORIES} canEdit={!!perms['suppliers.edit']} />
      )}

      {tab === 'pnl' && perms['profitloss.view'] && <ProfitLoss />}

      {tab === 'log' && (<>
      <Grid min={200} gap={14}>
        <Stat label="Awaiting approval" value={`KES ${totalPending.toLocaleString('en-KE')}`} />
        <Stat label="Approved, unpaid" value={`KES ${totalApproved.toLocaleString('en-KE')}`} />
        <Stat label="Paid this month" value={`KES ${totalPaidThisMonth.toLocaleString('en-KE')}`} />
      </Grid>

      <Card
        title="Expense log"
        actions={
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'paid', label: 'Paid' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
        }
      >
        <Table
          rowKey={(e) => e.id}
          empty="Nothing logged yet"
          rows={filtered}
          columns={[
            {
              key: 'category', label: 'Category',
              render: (e) => (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{e.category}{e.payout_id && <Tag>Payroll</Tag>}{e.recurring_bill_id && <Tag>Monthly bill</Tag>}</span>
                  {e.description && <span style={{ fontSize: 11.5, color: color.muted }}>{e.description}</span>}
                </div>
              ),
            },
            {
              key: 'paid_to', label: 'Paid to',
              render: (e) => e.staff_name
                ? <span onClick={() => navigate(`/staff?open=${e.staff_id}`)} style={{ color: color.ink, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline dotted' }}>{e.staff_name}</span>
                : e.paid_to || <span style={{ color: color.muted }}>—</span>,
            },
            {
              key: 'amount', label: 'Amount', align: 'right',
              render: (e) => <span style={{ fontFamily: font.mono }}>KES {Number(e.amount).toLocaleString('en-KE')}</span>,
            },
            {
              key: 'due', label: 'Due',
              render: (e) => (e.due_date ? <DueDate e={e} /> : <span style={{ color: color.muted }}>—</span>),
            },
            { key: 'status', label: 'Status', render: (e) => <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge> },
            {
              key: 'receipt', label: 'Receipt',
              render: (e) => e.has_receipt
                ? <a href={`/api/expenses/${e.id}/receipt`} target="_blank" rel="noreferrer" style={{ color: color.green, fontSize: 12.5, fontWeight: 600 }}>View</a>
                : <span style={{ color: color.muted }}>—</span>,
            },
            {
              key: 'act', label: '', align: 'right',
              render: (e) => (
                <span style={{ whiteSpace: 'nowrap' }}>
                  {e.status === 'pending' && (
                    <>
                      <span onClick={() => approve(e)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Approve</span>
                      <span onClick={() => remove(e)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                    </>
                  )}
                  {e.status === 'approved' && e.pay_state === 'processing' && (
                    <span style={{ color: color.muted, fontSize: 12.5, fontWeight: 600 }}>Paying…</span>
                  )}
                  {e.status === 'approved' && e.pay_state !== 'processing' && (
                    <>
                      {perms['expenses.pay'] && (
                        <span
                          onClick={() => payNow(e)}
                          title={e.pay_state === 'failed' ? `Last attempt failed: ${e.pay_error ?? ''}` : 'Send this from your M-Pesa paybill'}
                          style={{ color: e.pay_state === 'failed' ? color.rust : color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}
                        >
                          {e.pay_state === 'failed' ? 'Retry M-Pesa' : 'Pay via M-Pesa'}
                        </span>
                      )}
                      <span onClick={() => markPaid(e)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Mark paid</span>
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!form}
        title="Log an expense"
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Log expense'}</Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Category">
              <Select value={form.category} onChange={set('category')} options={CATEGORIES} />
            </Field>
            <Field label="Amount (KES)">
              <Input type="number" min="0" value={form.amount} onChange={set('amount')} placeholder="0" />
            </Field>
            <Field label="Paid to" span={2} hint="Vendor or person's name">
              <Input value={form.paidTo} onChange={set('paidTo')} placeholder="e.g. Total fuel station" />
            </Field>
            <Field label="Supplier" hint="Optional — fills in Paid to and adds to their totals">
              <Select
                value={form.supplierId}
                onChange={(e) => {
                  const id = e.target.value;
                  const sp = suppliers.find((x) => x.id === id);
                  setForm((s) => ({ ...s, supplierId: id, paidTo: s.paidTo || sp?.name || '' }));
                }}
                options={[{ value: '', label: 'None' }, ...suppliers.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))]}
              />
            </Field>
            <Field label="Due date" hint="Optional — for a bill still to be paid">
              <Input type="date" value={form.dueDate} onChange={set('dueDate')} />
            </Field>
            <Field label="Reference" span={2} hint="The supplier's invoice or receipt number">
              <Input value={form.reference} onChange={set('reference')} placeholder="e.g. INV-2041" />
            </Field>
            <Field label="Staff member" span={2} hint="Only if this is a reimbursement to one of your own staff">
              <Select
                value={form.staffId}
                onChange={set('staffId')}
                options={[{ value: '', label: 'None' }, ...(store.staff ?? []).map((s) => ({ value: s.id, label: s.name }))]}
              />
            </Field>
            <Field label="Notes" span={2}>
              <Textarea rows={3} value={form.description} onChange={set('description')} placeholder="Any other detail worth keeping" />
            </Field>
            {perms['expenses.pay'] && perms['expenses.approve'] && (
              <Field label="Pay now" span={2} hint="Approves it and sends the money from your M-Pesa paybill now, to the supplier's paybill, till or phone, or to the staff member's phone">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <input type="checkbox" checked={!!form.payNow} onChange={(e) => setForm((s) => ({ ...s, payNow: e.target.checked }))} />
                  Pay this straight away via M-Pesa
                </label>
                {form.payNow && !form.supplierId && !form.staffId && (
                  <Input style={{ marginTop: 8 }} value={form.payPhone ?? ''} onChange={set('payPhone')} placeholder="Phone to pay, e.g. 0712345678" />
                )}
              </Field>
            )}
            <Field label="Receipt" span={2} hint="Photo or PDF of the receipt, up to 5MB">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setForm((s) => ({ ...s, receiptFile: e.target.files?.[0] ?? null }))}
              />
            </Field>
          </div>
        )}
      </Modal>
      </>)}
    </Screen>
  );
}
