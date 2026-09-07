import React, { useMemo, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Textarea } from '../ui/primitives';

const CATEGORIES = ['Fuel', 'Equipment', 'Rent', 'Utilities', 'Salaries', 'Marketing', 'Repairs', 'Other'];

const blank = () => ({ category: 'Fuel', description: '', amount: '', paidTo: '', staffId: '' });

const STATUS_TONE = { pending: 'pending', approved: 'default', paid: 'active', rejected: 'suspended' };

/**
 * A running log of money spent, separate from payroll's own salary/
 * commission/bonus lines — but the two meet at "expense reimbursement":
 * once approved here, a reimbursement can be pulled into a payroll run
 * (Hr.jsx's Payroll tab) as one more line on the staff member it belongs
 * to, rather than paid out through a second, separate channel.
 */
export default function Expenses() {
  const store = useStore();
  const items = store.expenses ?? [];
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const reload = async () => store.setCollection('expenses', await api.expenses());

  const save = async () => {
    if (!form.category.trim()) return store.toast('Pick a category');
    const amount = Number(form.amount);
    if (!(amount > 0)) return store.toast('Enter a positive amount');
    setBusy(true);
    try {
      await api.createExpense({
        category: form.category, description: form.description || undefined,
        amount, paidTo: form.paidTo || undefined, staffId: form.staffId || undefined,
      });
      await reload();
      store.toast('Expense logged');
      setForm(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
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
                  <span style={{ fontWeight: 600 }}>{e.category}</span>
                  {e.description && <span style={{ fontSize: 11.5, color: color.muted }}>{e.description}</span>}
                </div>
              ),
            },
            {
              key: 'paid_to', label: 'Paid to',
              render: (e) => e.staff_name || e.paid_to || <span style={{ color: color.muted }}>—</span>,
            },
            {
              key: 'amount', label: 'Amount', align: 'right',
              render: (e) => <span style={{ fontFamily: font.mono }}>KES {Number(e.amount).toLocaleString('en-KE')}</span>,
            },
            { key: 'status', label: 'Status', render: (e) => <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge> },
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
                  {e.status === 'approved' && (
                    <span onClick={() => markPaid(e)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Mark paid</span>
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
          </div>
        )}
      </Modal>
    </Screen>
  );
}
