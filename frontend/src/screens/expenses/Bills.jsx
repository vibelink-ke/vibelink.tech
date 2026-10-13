import React, { useEffect, useMemo, useState } from 'react';
import { color, font, cur } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Select, Stat, Table, Textarea } from '../../ui/primitives';

const blank = () => ({ name: '', category: 'Rent', amount: '', dayOfMonth: '1', supplierId: '', notes: '', payee: '', paidIn: 'money' });

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
export default function Bills({ categories, suppliers, canEdit, canPay }) {
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
        payee: form.payee || null, paidIn: form.paidIn,
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

  // Month by month: which months of each bill are paid. A click on a month marks it paid (or undoes it).
  const [months, setMonths] = useState(null);
  const [mark, setMark] = useState(null);   // { bill, month, entry, paidOn }
  const loadMonths = async () => {
    try { setMonths(await api.billMonths()); } catch { setMonths([]); }
  };
  useEffect(() => { loadMonths(); }, []);
  const entryOf = useMemo(() => {
    const m = new Map();
    for (const e of months ?? []) m.set(`${e.bill_id}|${e.month}`, e);
    return m;
  }, [months]);
  const gridMonths = useMemo(() => {
    const out = [];
    const now = new Date();
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-KE', { month: 'short' }), year: d.getFullYear() });
    }
    return out;
  }, []);
  const submitMark = async (paid) => {
    setBusy(true);
    try {
      await api.markBillMonth(mark.bill.id, { month: mark.month, paid, paidOn: paid && mark.paidOn ? mark.paidOn : undefined });
      await loadMonths();
      store.setCollection('expenses', await api.expenses());
      store.toast(paid ? 'Marked paid' : 'Marked not paid');
      setMark(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const rows = bills ?? [];
  const monthly = rows.filter((b) => b.active).reduce((n, b) => n + Number(b.amount), 0);

  return (
    <>
      <Grid min={200} gap={14}>
        <Stat label="Monthly bills" value={`${cur()} ${monthly.toLocaleString('en-KE')}`} />
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
                  <span style={{ fontSize: 11.5, color: color.muted }}>{b.category}{(b.supplier_name || b.payee) ? ` · ${b.supplier_name || b.payee}` : ''}{b.paid_in === 'vouchers' ? ' · paid in hotspot vouchers' : ''}</span>
                </div>
              ),
            },
            {
              key: 'amount', label: 'Amount', align: 'right',
              render: (b) => <span style={{ fontFamily: font.mono }}>{cur()} {Number(b.amount).toLocaleString('en-KE')}</span>,
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
                    payee: b.payee ?? '', paidIn: b.paid_in ?? 'money',
                  })} style={{ ...link, color: color.green }}>Edit</span>
                  <span onClick={() => toggle(b)} style={{ ...link, color: color.ink }}>{b.active ? 'Pause' : 'Resume'}</span>
                  <span onClick={() => remove(b)} style={{ ...link, color: color.rust, marginRight: 0 }}>Delete</span>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Card title="Paid month by month">
        <p style={{ margin: '0 0 12px', fontSize: 13, color: color.muted }}>
          The last 12 months of every bill. A green tick means that month is paid. Click any month to mark it paid, including an earlier month
          that was paid before it was entered here, or to undo a mark.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 760, fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', position: 'sticky', left: 0, background: color.card ?? '#fff' }}>Bill</th>
                {gridMonths.map((m) => <th key={m.key} style={{ padding: '6px 4px', color: color.muted, fontWeight: 600 }}>{m.label}<br /><span style={{ fontSize: 10.5, fontWeight: 400 }}>{m.year}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={13} style={{ padding: 12, color: color.muted }}>{bills === null ? 'Loading…' : 'No monthly bills yet'}</td></tr>}
              {rows.map((b) => (
                <tr key={b.id}>
                  <td style={{ padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: color.card ?? '#fff', opacity: b.active ? 1 : 0.55 }}>
                    {b.name}<span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: color.muted }}>{cur()} {Number(b.amount).toLocaleString('en-KE')}</span>
                  </td>
                  {gridMonths.map((m) => {
                    const e = entryOf.get(`${b.id}|${m.key}`);
                    const paid = e?.status === 'paid';
                    const open = e && !paid && e.status !== 'rejected';
                    const text = paid ? '✓' : open ? 'due' : '·';
                    const bg = paid ? color.green : open ? (color.amber ?? '#e0a100') : 'transparent';
                    return (
                      <td key={m.key} style={{ padding: 3, textAlign: 'center' }}>
                        <button
                          type="button"
                          disabled={!canPay}
                          onClick={() => setMark({ bill: b, month: m.key, entry: e, paidOn: '' })}
                          title={paid ? `Paid${e.paid_on ? ' on ' + e.paid_on : ''}` : open ? 'Due, not paid yet' : 'No entry for this month'}
                          style={{
                            width: '100%', minWidth: 44, padding: '7px 0', borderRadius: 7, font: 'inherit', fontWeight: 700,
                            cursor: canPay ? 'pointer' : 'default',
                            border: `1px solid ${paid || open ? bg : (color.line ?? '#ddd')}`,
                            background: paid || open ? bg : 'transparent', color: paid || open ? '#fff' : color.muted,
                          }}
                        >{text}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!mark}
        title={mark ? `${mark.bill.name} · ${new Date(`${mark.month}-01T12:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}` : ''}
        onClose={() => setMark(null)}
        footer={
          <>
            <Button onClick={() => setMark(null)}>Cancel</Button>
            {mark?.entry?.status === 'paid'
              ? <Button onClick={() => submitMark(false)} disabled={busy || mark.entry.paid_by_mpesa}>{busy ? 'Saving…' : 'Mark not paid'}</Button>
              : <Button variant="primary" onClick={() => submitMark(true)} disabled={busy}>{busy ? 'Saving…' : 'Mark paid'}</Button>}
          </>
        }
      >
        {mark && (
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0 }}>
              {mark.entry?.status === 'paid'
                ? `Marked paid${mark.entry.paid_on ? ' on ' + mark.entry.paid_on : ''}. ${mark.entry.paid_by_mpesa ? 'It was paid through M-Pesa, so it cannot be undone here.' : ''}`
                : `${cur()} ${Number(mark.entry?.amount ?? mark.bill.amount).toLocaleString('en-KE')} for this month is not marked paid.`}
            </p>
            {mark.entry?.status !== 'paid' && (
              <Field label="Paid on" hint="Leave empty for today.">
                <Input type="date" value={mark.paidOn} max={new Date().toLocaleDateString('en-CA')} onChange={(e) => setMark((s) => ({ ...s, paidOn: e.target.value }))} />
              </Field>
            )}
          </div>
        )}
      </Modal>

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
            <Field label={`Amount (${cur()})`}>
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
            <Field label="Paid to" hint="A shop or person who is not a supplier. Used when no supplier is chosen.">
              <Input value={form.payee} onChange={set('payee')} placeholder="e.g. Mama Njeri shop" />
            </Field>
            <Field label="Paid in" hint="Vouchers: they are given hotspot vouchers worth this amount instead of money.">
              <Select value={form.paidIn} onChange={set('paidIn')} options={[{ value: 'money', label: 'Money' }, { value: 'vouchers', label: 'Hotspot vouchers' }]} />
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
