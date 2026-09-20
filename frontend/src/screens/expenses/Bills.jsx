import React, { useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Select, Stat, Table, Textarea } from '../../ui/primitives';

const blank = () => ({ name: '', category: 'Rent', amount: '', dayOfMonth: '1', supplierId: '', notes: '' });

/** The next date this bill falls due, today included. A day past a short month's end lands on its last day. */
function nextDue(day) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const pick = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  const d = pick(now.getFullYear(), now.getMonth());
  return d < today ? pick(now.getFullYear(), now.getMonth() + 1) : d;
}

const link = { fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 };

/**
 * Bills that come round every month. Each becomes a pending entry in the
 * expense log a few days before it is due (see backend bills.js), where it is
 * approved and paid like any other expense — this screen only defines them.
 */
export default function Bills({ categories, suppliers, canEdit }) {
  const store = useStore();
  const [bills, setBills] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setBills(await api.bills()); } catch { setBills([]); }
  };
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const save = async () => {
    const amount = Number(form.amount);
    const day = Number(form.dayOfMonth);
    if (!form.name.trim()) return store.toast('Give the bill a name');
    if (!(amount > 0)) return store.toast('Enter a positive amount');
    if (!Number.isInteger(day) || day < 1 || day > 31) return store.toast('Day of month must be 1 to 31');
    setBusy(true);
    try {
      const body = {
        name: form.name, category: form.category, amount, dayOfMonth: day,
        supplierId: form.supplierId || null, notes: form.notes || null,
      };
      const out = form.id ? await api.updateBill(form.id, body) : await api.createBill(body);
      await load();
      // A new bill close to its due day has already produced this month's entry.
      if (out.generated) store.setCollection('expenses', await api.expenses());
      store.toast(form.id ? 'Bill updated' : out.generated ? 'Bill added — this month\'s entry is in the expense log' : 'Bill added');
      setForm(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (b) => {
    try {
      await api.updateBill(b.id, { active: !b.active });
      await load();
    } catch (e) { store.toast(`Could not update: ${e.message}`); }
  };

  const remove = async (b) => {
    if (!window.confirm(`Delete the monthly bill "${b.name}"? Entries it already created stay in the expense log.`)) return;
    try {
      await api.deleteBill(b.id);
      await load();
    } catch (e) { store.toast(`Could not delete: ${e.message}`); }
  };

  const rows = bills ?? [];
  const monthly = rows.filter((b) => b.active).reduce((n, b) => n + Number(b.amount), 0);

  return (
    <>
      <Grid min={200} gap={14}>
        <Stat label="Monthly bills" value={`KES ${monthly.toLocaleString('en-KE')}`} />
        <Stat label="Active bills" value={String(rows.filter((b) => b.active).length)} />
      </Grid>

      <Card
        title="Monthly bills"
        actions={canEdit && <Button variant="primary" onClick={() => setForm(blank())}>+ Add monthly bill</Button>}
      >
        <p style={{ margin: '0 0 12px', fontSize: 13, color: color.muted }}>
          Rent, upstream bandwidth, tower leases — anything that comes round every month. An entry is added to the
          expense log three days before it is due, ready to approve and pay.
        </p>
        <Table
          rowKey={(b) => b.id}
          empty={bills === null ? 'Loading…' : 'No monthly bills yet'}
          rows={rows}
          columns={[
            {
              key: 'name', label: 'Bill',
              render: (b) => (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, opacity: b.active ? 1 : 0.55 }}>{b.name}</span>
                  <span style={{ fontSize: 11.5, color: color.muted }}>{b.category}{b.supplier_name ? ` · ${b.supplier_name}` : ''}</span>
                </div>
              ),
            },
            {
              key: 'amount', label: 'Amount', align: 'right',
              render: (b) => <span style={{ fontFamily: font.mono }}>KES {Number(b.amount).toLocaleString('en-KE')}</span>,
            },
            {
              key: 'day', label: 'Due',
              render: (b) => b.active
                ? <span>{nextDue(b.day_of_month).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                    <span style={{ color: color.muted, fontSize: 11.5 }}> · day {b.day_of_month} monthly</span></span>
                : <span style={{ color: color.muted }}>day {b.day_of_month} monthly</span>,
            },
            { key: 'active', label: 'Status', render: (b) => <Badge tone={b.active ? 'active' : 'default'}>{b.active ? 'active' : 'paused'}</Badge> },
            {
              key: 'act', label: '', align: 'right',
              render: (b) => canEdit && (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <span onClick={() => setForm({
                    id: b.id, name: b.name, category: b.category, amount: String(b.amount),
                    dayOfMonth: String(b.day_of_month), supplierId: b.supplier_id ?? '', notes: b.notes ?? '',
                  })} style={{ ...link, color: color.green }}>Edit</span>
                  <span onClick={() => toggle(b)} style={{ ...link, color: color.ink }}>{b.active ? 'Pause' : 'Resume'}</span>
                  <span onClick={() => remove(b)} style={{ ...link, color: color.rust, marginRight: 0 }}>Delete</span>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!form}
        title={form?.id ? 'Edit monthly bill' : 'Add a monthly bill'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save bill'}</Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Bill name" span={2}>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Office rent" />
            </Field>
            <Field label="Category">
              <Select value={form.category} onChange={set('category')} options={categories} />
            </Field>
            <Field label="Amount (KES)">
              <Input type="number" min="0" value={form.amount} onChange={set('amount')} placeholder="0" />
            </Field>
            <Field label="Due day of month" hint="1 to 31. A 31st in a shorter month falls on its last day.">
              <Input type="number" min="1" max="31" value={form.dayOfMonth} onChange={set('dayOfMonth')} />
            </Field>
            <Field label="Supplier">
              <Select
                value={form.supplierId}
                onChange={set('supplierId')}
                options={[{ value: '', label: 'None' }, ...suppliers.filter((s) => s.active || s.id === form.supplierId).map((s) => ({ value: s.id, label: s.name }))]}
              />
            </Field>
            <Field label="Notes" span={2}>
              <Textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Account number, contract reference…" />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
