import React, { useMemo, useState } from 'react';
import { color, font, cur } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Select, Stat } from '../../ui/primitives';

const TZ = 'Africa/Nairobi';
const STATUS_TONE = { pending: 'pending', approved: 'default', paid: 'active', rejected: 'suspended' };
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The calendar day (Nairobi) an expense belongs to: when it was logged, or the date picked for it. */
const dayOf = (e) => new Date(e.created_at).toLocaleDateString('en-CA', { timeZone: TZ });
const money = (n) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });

/**
 * Every day of a month as a grid, with what was spent on each day. Click a day to see its entries or to record one for that date.
 * Entries are the same ones as the expense log (a cashier's entry still waits for approval there); this is only another way in.
 */
export default function ExpenseCalendar({ items, categories, canEdit, onChanged }) {
  const store = useStore();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const [ym, setYm] = useState(today.slice(0, 7));
  const [openDay, setOpenDay] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const [year, month] = ym.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;          // Monday first

  // Rejected entries were never spent, so they do not count.
  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of items) {
      if (e.status === 'rejected') continue;
      const d = dayOf(e);
      if (!d.startsWith(ym)) continue;
      const cur0 = m.get(d) ?? { total: 0, list: [] };
      cur0.total += Number(e.amount);
      cur0.list.push(e);
      m.set(d, cur0);
    }
    return m;
  }, [items, ym]);

  const monthTotal = [...byDay.values()].reduce((n, d) => n + d.total, 0);
  const byCategory = useMemo(() => {
    const m = new Map();
    for (const d of byDay.values()) for (const e of d.list) m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [byDay]);
  const daysWithSpend = byDay.size;

  const shift = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setOpenDay(null);
  };

  const dayKey = (n) => `${ym}-${String(n).padStart(2, '0')}`;
  const blank = () => ({ category: categories[0] ?? 'Other', amount: '', description: '', paidTo: '' });
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const open = (n) => { setOpenDay(dayKey(n)); setForm(blank()); };

  const save = async () => {
    const amount = Number(form.amount);
    if (!(amount > 0)) return store.toast('Enter an amount');
    setBusy(true);
    try {
      await api.createExpense({
        category: form.category, amount, description: form.description || null,
        paidTo: form.paidTo || null, spentOn: openDay,
      });
      await onChanged();
      setForm(blank());
      store.toast('Recorded');
    } catch (e) {
      store.toast(`Could not record: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const dayData = openDay ? byDay.get(openDay) : null;
  const label = new Date(year, month - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let n = 1; n <= daysInMonth; n += 1) cells.push(n);

  return (
    <>
      <Grid min={200} gap={14}>
        <Stat label={`Spent in ${label}`} value={`${cur()} ${money(monthTotal)}`} hint={`${daysWithSpend} day${daysWithSpend === 1 ? '' : 's'} with spending`} />
        {byCategory.slice(0, 3).map(([c, v]) => <Stat key={c} label={c} value={`${cur()} ${money(v)}`} />)}
      </Grid>

      <Card
        title={label}
        actions={
          <>
            <Button onClick={() => shift(-1)}>‹ Previous</Button>
            <Button onClick={() => setYm(today.slice(0, 7))} disabled={ym === today.slice(0, 7)}>This month</Button>
            <Button onClick={() => shift(1)}>Next ›</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
          {WEEK.map((w) => <div key={w} style={{ fontSize: 11.5, fontWeight: 700, color: color.muted, textAlign: 'center' }}>{w}</div>)}
          {cells.map((n, i) => {
            if (n === null) return <div key={`b${i}`} />;
            const key = dayKey(n);
            const d = byDay.get(key);
            const future = key > today;
            return (
              <button
                key={key}
                type="button"
                disabled={future && !d}
                onClick={() => open(n)}
                style={{
                  minHeight: 64, padding: '6px 6px', borderRadius: 8, textAlign: 'left', cursor: future && !d ? 'default' : 'pointer',
                  border: `1px solid ${key === today ? color.green : (color.line ?? '#ddd')}`,
                  background: d ? color.tileBg : 'transparent', opacity: future && !d ? 0.4 : 1,
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: color.ink, font: 'inherit',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: key === today ? color.green : color.muted }}>{n}</span>
                {d && (
                  <span style={{ fontFamily: font.mono, fontSize: 12, fontWeight: 700 }}>
                    {money(d.total)}
                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, color: color.muted }}>{d.list.length} item{d.list.length === 1 ? '' : 's'}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: color.muted }}>
          Click a day to see what was spent or to record an expense for that date. Entries still follow the same approval and payment steps
          as the expense log.
        </p>
      </Card>

      <Modal
        open={!!openDay}
        title={openDay ? new Date(`${openDay}T12:00:00`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''}
        onClose={() => setOpenDay(null)}
        footer={
          <>
            <Button onClick={() => setOpenDay(null)}>Close</Button>
            {canEdit && openDay <= today && <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Record expense'}</Button>}
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          {dayData ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {dayData.list.map((e) => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: `1px solid ${color.line ?? '#ddd'}`, paddingBottom: 6 }}>
                  <span>
                    <b>{e.category}</b>{e.description ? ` · ${e.description}` : ''}
                    <span style={{ display: 'block', fontSize: 12, color: color.muted }}>{e.paid_to ?? ''}</span>
                  </span>
                  <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: font.mono }}>{cur()} {money(e.amount)}</span><br />
                    <Badge tone={STATUS_TONE[e.status] ?? 'default'}>{e.status}</Badge>
                  </span>
                </div>
              ))}
              <div style={{ textAlign: 'right', fontWeight: 700 }}>Total {cur()} {money(dayData.total)}</div>
            </div>
          ) : <p style={{ margin: 0, color: color.muted }}>Nothing recorded for this day.</p>}

          {canEdit && openDay <= today && form && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderTop: `1px solid ${color.line ?? '#ddd'}`, paddingTop: 12 }}>
              <Field label="Category">
                <Select value={form.category} onChange={set('category')} options={categories} />
              </Field>
              <Field label={`Amount (${cur()})`}>
                <Input type="number" min="0" value={form.amount} onChange={set('amount')} placeholder="0" />
              </Field>
              <Field label="What for" span={2}>
                <Input value={form.description} onChange={set('description')} placeholder="e.g. Fuel for the generator" />
              </Field>
              <Field label="Paid to" span={2}>
                <Input value={form.paidTo} onChange={set('paidTo')} placeholder="Optional" />
              </Field>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
