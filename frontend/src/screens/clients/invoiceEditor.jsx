import React, { useState } from 'react';
import { color, font, kes } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Field, Input, Modal, Select } from '../../ui/primitives';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const TERMS = [
  { value: '0', label: 'Due now' },
  { value: '3', label: 'In 3 days' },
  { value: '7', label: 'In 7 days' },
  { value: '14', label: 'In 14 days' },
  { value: '30', label: 'In 30 days' },
  { value: 'custom', label: 'Pick a date' },
];

const blankItem = (desc = '', price = '') => ({ desc, qty: '1', price: String(price) });

/**
 * Creating and editing an invoice, shared by the clients table and the client's own Invoices page.
 *
 * Built to what good invoices carry: itemised lines (what, how many, how much) rather than one lump, a clear due date
 * with common payment terms to pick from, a running total with the tax inside it, and quick-add lines for what this
 * business actually bills (installation, router, reconnection, the package itself).
 *
 * Usage: const [openInvoice, invoiceModal] = useInvoiceEditor();  openInvoice(lines)  to create for a client's lines,
 * openInvoice(lines, invoice) to edit one. Render {invoiceModal} once in the screen.
 */
export function useInvoiceEditor() {
  const store = useStore();
  const [f, setF] = useState(null);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  const prefs = store.settings?.prefs ?? {};
  const taxRate = Number(prefs.taxRate) || 0;
  const inclusive = (prefs.taxInclusive ?? 'Yes') !== 'No';
  const standardFee = Number(prefs.installationFee) || 0;

  const open = (accountLines, inv = null) => {
    setLines(accountLines);
    setF(inv
      ? {
          id: inv.id, subscriberId: inv.subscriber_id, items: [blankItem(inv.reason ?? '', Number(inv.amount))],
          term: 'custom', dueDate: String(inv.due_date ?? today()).slice(0, 10), number: inv.number, paid: Number(inv.paid ?? 0),
        }
      : { id: null, subscriberId: accountLines[0]?.id ?? '', items: [blankItem()], term: '0', dueDate: today() });
  };

  const close = () => setF(null);
  const setField = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setItem = (i, k) => (e) => setF((s) => ({ ...s, items: s.items.map((it, n) => (n === i ? { ...it, [k]: e.target.value } : it)) }));
  const addItem = (desc = '', price = '') => setF((s) => ({
    ...s,
    // Replace the empty starter row instead of leaving a blank line above the first real one.
    items: s.items.length === 1 && !s.items[0].desc && !s.items[0].price ? [blankItem(desc, price)] : [...s.items, blankItem(desc, price)],
  }));
  const dropItem = (i) => setF((s) => ({ ...s, items: s.items.length > 1 ? s.items.filter((_, n) => n !== i) : [blankItem()] }));
  const setTerm = (e) => {
    const term = e.target.value;
    setF((s) => ({ ...s, term, dueDate: term === 'custom' ? s.dueDate : plusDays(Number(term)) }));
  };

  const total = (f?.items ?? []).reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const tax = taxRate <= 0 ? 0 : inclusive ? total - total / (1 + taxRate / 100) : total * (taxRate / 100);
  const grand = inclusive ? total : total + tax;

  const planPrice = (line) => {
    const plan = (store.plans ?? []).find((p) => p.id === line?.plan_id);
    return Number(line?.custom_price ?? plan?.price ?? 0) || 0;
  };
  const line = (lines ?? []).find((l) => l.id === f?.subscriberId) ?? lines?.[0];

  const reasonOf = (items) => items
    .filter((it) => it.desc.trim())
    .map((it) => (Number(it.qty) > 1 ? `${it.desc.trim()} ×${Number(it.qty)}` : it.desc.trim()))
    .join(', ');

  const save = async () => {
    const items = f.items.filter((it) => it.desc.trim() || Number(it.price));
    if (!items.length || items.some((it) => !it.desc.trim())) return store.toast('Give every line a description');
    if (items.some((it) => !(Number(it.price) > 0) || !(Number(it.qty) > 0))) return store.toast('Every line needs a quantity and a price');
    if (!f.dueDate) return store.toast('Pick a due date');
    if (f.id && grand + 0.005 < f.paid) return store.toast(`Part of this invoice (KES ${kes(f.paid)}) is already paid — it cannot go below that.`);
    setBusy(true);
    try {
      if (f.id) {
        const saved = await api.updateInvoice(f.id, { amount: grand, dueDate: f.dueDate, reason: reasonOf(items) });
        store.setCollection('invoices', (xs) => xs.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)));
        store.toast(`${saved.number} updated`);
      } else {
        const made = await api.createInvoice({ subscriberId: f.subscriberId, amount: grand, dueDate: f.dueDate, reason: reasonOf(items) });
        store.setCollection('invoices', (xs) => [made, ...xs]);
        store.toast(`${made.number} raised for KES ${kes(made.amount)}`);
      }
      store.reload?.({ quiet: true });   // balances elsewhere move with it
      close();
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const chip = {
    fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${color.line}`, background: color.subtleBg ?? 'transparent', color: color.ink,
  };

  const node = (
    <Modal
      open={!!f}
      title={f?.id ? `Edit ${f.number ?? 'invoice'}` : 'Create invoice'}
      onClose={close}
      width={620}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : f?.id ? 'Save changes' : `Raise invoice · KES ${kes(grand)}`}</Button>
        </>
      }
    >
      {f && (
        <div style={{ display: 'grid', gap: 14 }}>
          {!f.id && lines.length > 1 && (
            <Field label="Service line">
              <Select value={f.subscriberId} onChange={setField('subscriberId')}
                options={lines.map((l) => ({ value: l.id, label: l.pppoe_user || l.account_code || l.name }))} />
            </Field>
          )}

          {!f.id && (
            <div>
              <div style={{ fontSize: 12, color: color.muted, marginBottom: 6 }}>Quick add</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={chip} onClick={() => addItem('Installation fee', standardFee || '')}>Installation fee{standardFee ? ` · ${kes(standardFee)}` : ''}</span>
                {planPrice(line) > 0 && <span style={chip} onClick={() => addItem('Package', planPrice(line))}>Package · {kes(planPrice(line))}</span>}
                <span style={chip} onClick={() => addItem('Router')}>Router</span>
                <span style={chip} onClick={() => addItem('Reconnection fee')}>Reconnection</span>
                <span style={chip} onClick={() => addItem('')}>+ Other line</span>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 110px 24px', gap: 8, fontSize: 11.5, color: color.muted }}>
              <span>Description</span><span>Qty</span><span>Unit price</span><span />
            </div>
            {f.items.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 110px 24px', gap: 8, alignItems: 'center' }}>
                <Input value={it.desc} onChange={setItem(i, 'desc')} placeholder="What is this for" />
                <Input type="number" min="1" value={it.qty} onChange={setItem(i, 'qty')} />
                <Input type="number" min="0" value={it.price} onChange={setItem(i, 'price')} />
                <span onClick={() => dropItem(i)} title="Remove line" style={{ cursor: 'pointer', color: color.rust, textAlign: 'center' }}>×</span>
              </div>
            ))}
            {f.id && <div style={{ fontSize: 12, color: color.muted }}>Editing changes the description and the total; the invoice number stays.</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Payment terms">
              <Select value={f.term} onChange={setTerm} options={TERMS} />
            </Field>
            <Field label="Due date">
              <Input type="date" value={f.dueDate} onChange={(e) => setF((s) => ({ ...s, dueDate: e.target.value, term: 'custom' }))} />
            </Field>
          </div>

          <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: 10, display: 'grid', gap: 4, fontSize: 13.5, justifyItems: 'end' }}>
            {taxRate > 0 && (
              <span style={{ color: color.muted, fontSize: 12.5 }}>
                {inclusive ? `Includes ${taxRate}% tax of` : `Plus ${taxRate}% tax of`} KES {kes(tax)}
              </span>
            )}
            <span style={{ fontWeight: 700, fontFamily: font.mono }}>Total KES {kes(grand)}</span>
          </div>

          {!f.id && (
            <div style={{ fontSize: 12, color: color.muted }}>
              Once it is due, this shows as a negative balance for the client, and their next payment clears it before their package renews.
            </div>
          )}
        </div>
      )}
    </Modal>
  );

  return [open, node];
}
