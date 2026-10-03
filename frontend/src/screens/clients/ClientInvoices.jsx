import React, { useMemo, useState } from 'react';
import { color, font, kes } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Field, Input, Modal, Select } from '../../ui/primitives';

const today = () => new Date().toISOString().slice(0, 10);
const BLANK = { id: null, subscriberId: '', amount: '', reason: '', dueDate: today() };

/**
 * A client's unpaid invoices, raised and managed straight from the clients table: create one, edit it, delete it.
 * Only invoices still owing (open or partly paid) are listed here; the full history lives under Payments → Invoices.
 * `lines` is every service line on the account, since an invoice belongs to one line.
 */
export default function ClientInvoices({ open, name, lines, onClose }) {
  const store = useStore();
  const [f, setF] = useState(null);   // the invoice form, when it is open
  const [busy, setBusy] = useState(false);
  const canEdit = !!store.session?.perms?.['clients.invoices'];

  const lineIds = useMemo(() => new Set(lines.map((l) => l.id)), [lines]);
  const unpaid = useMemo(
    () => (store.invoices ?? [])
      .filter((i) => lineIds.has(i.subscriber_id) && (i.status === 'open' || i.status === 'partial'))
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))),
    [store.invoices, lineIds]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const lineLabel = (l) => l.pppoe_user || l.account_code || l.name;

  const save = async () => {
    if (!(Number(f.amount) > 0)) return store.toast('Enter an amount');
    if (!f.reason.trim()) return store.toast('Say what this invoice is for');
    setBusy(true);
    try {
      if (f.id) {
        const saved = await api.updateInvoice(f.id, { amount: Number(f.amount), dueDate: f.dueDate || undefined, reason: f.reason.trim() });
        store.setCollection('invoices', (xs) => xs.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)));
        store.toast(`${saved.number} updated`);
      } else {
        const made = await api.createInvoice({
          subscriberId: f.subscriberId || lines[0]?.id, amount: Number(f.amount), dueDate: f.dueDate || today(), reason: f.reason.trim(),
        });
        store.setCollection('invoices', (xs) => [made, ...xs]);
        store.toast(`${made.number} raised for KES ${kes(made.amount)}`);
      }
      store.reload?.({ quiet: true });   // the balance in the clients table moves with it
      setF(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (inv) => {
    if (!window.confirm(`Delete invoice ${inv.number}? This cannot be undone.`)) return;
    try {
      await api.deleteInvoice(inv.id);
      store.setCollection('invoices', (xs) => xs.filter((x) => x.id !== inv.id));
      store.reload?.({ quiet: true });
      store.toast(`${inv.number} deleted`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const link = { fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };

  return (
    <>
      <Modal
        open={open}
        title={`Invoices — ${name}`}
        onClose={onClose}
        width={640}
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            {canEdit && (
              <Button variant="primary" onClick={() => setF({ ...BLANK, subscriberId: lines[0]?.id ?? '' })}>+ Create invoice</Button>
            )}
          </>
        }
      >
        {unpaid.length === 0 ? (
          <div style={{ color: color.muted, fontSize: 13.5, padding: '8px 0' }}>No unpaid invoices for this client.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {unpaid.map((i) => {
              const owing = Number(i.amount) - Number(i.paid ?? 0);
              const overdue = i.due_date && new Date(String(i.due_date).slice(0, 10)) <= new Date(today());
              return (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${color.line}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: font.mono, fontSize: 12.5 }}>{i.number}</div>
                    <div style={{ fontSize: 13.5 }}>{i.reason || '—'}</div>
                    <div style={{ fontSize: 12, color: overdue ? color.rust : color.muted }}>
                      Due {String(i.due_date).slice(0, 10)}{overdue ? ' · due now' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontFamily: font.mono, fontSize: 13.5 }}>-KES {kes(owing)}</div>
                    {i.status === 'partial' && <Badge tone="default">partly paid</Badge>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ ...link, color: color.green }} onClick={() => setF({
                        id: i.id, subscriberId: i.subscriber_id, amount: String(Number(i.amount)), reason: i.reason ?? '', dueDate: String(i.due_date).slice(0, 10),
                      })}>Edit</span>
                      <span style={{ ...link, color: color.rust }} onClick={() => remove(i)}>Delete</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={!!f}
        title={f?.id ? 'Edit invoice' : 'Create invoice'}
        onClose={() => setF(null)}
        footer={
          <>
            <Button onClick={() => setF(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : f?.id ? 'Save changes' : 'Create invoice'}</Button>
          </>
        }
      >
        {f && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {!f.id && lines.length > 1 && (
              <Field label="Service line" span={2}>
                <Select value={f.subscriberId} onChange={set('subscriberId')}
                  options={lines.map((l) => ({ value: l.id, label: lineLabel(l) }))} />
              </Field>
            )}
            <Field label="Amount (KES)">
              <Input type="number" min="1" value={f.amount} onChange={set('amount')} />
            </Field>
            <Field label="Due date">
              <Input type="date" value={f.dueDate} onChange={set('dueDate')} />
            </Field>
            <Field label="What is it for" span={2}>
              <Input value={f.reason} onChange={set('reason')} placeholder="e.g. Router, installation, extra month" />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
