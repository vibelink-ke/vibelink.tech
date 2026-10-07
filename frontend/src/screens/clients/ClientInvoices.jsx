import React, { useMemo } from 'react';
import { color, font, kes, cur } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Modal } from '../../ui/primitives';
import { useInvoiceEditor } from './invoiceEditor';

const today = () => new Date().toISOString().slice(0, 10);

/** Delete (with a confirm) shared by every place that lists a client's invoices. */
export function useInvoiceActions() {
  const store = useStore();
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
  const view = (inv) => window.open(`${window.location.origin}/invoice/${inv.id}`, '_blank', 'noopener');
  return { remove, view };
}

/**
 * A client's unpaid invoices, opened from the clients table: create, view, edit, delete. Only invoices still owing
 * are listed here; a client's full history is on their own Invoices page. `lines` is every service line on the
 * account, since an invoice belongs to one line.
 */
export default function ClientInvoices({ open, name, lines, onClose }) {
  const store = useStore();
  const canEdit = !!store.session?.perms?.['clients.invoices'];
  const [openEditor, editor] = useInvoiceEditor();
  const { remove, view } = useInvoiceActions();

  const lineIds = useMemo(() => new Set(lines.map((l) => l.id)), [lines]);
  const unpaid = useMemo(
    () => (store.invoices ?? [])
      .filter((i) => lineIds.has(i.subscriber_id) && (i.status === 'open' || i.status === 'partial'))
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))),
    [store.invoices, lineIds]);

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
            {canEdit && <Button variant="primary" onClick={() => openEditor(lines)}>+ Create invoice</Button>}
          </>
        }
      >
        {unpaid.length === 0 ? (
          <div style={{ color: color.muted, fontSize: 13.5, padding: '8px 0' }}>No unpaid invoices for this client.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {unpaid.map((i) => {
              const owing = Number(i.amount) - Number(i.paid ?? 0);
              const overdue = i.due_date && String(i.due_date).slice(0, 10) <= today();
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
                    <div style={{ fontWeight: 700, fontFamily: font.mono, fontSize: 13.5 }}>-{cur()} {kes(owing)}</div>
                    {i.status === 'partial' && <Badge tone="default">partly paid</Badge>}
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ ...link, color: color.green }} onClick={() => view(i)}>View</span>
                    {canEdit && <span style={{ ...link, color: color.green }} onClick={() => openEditor(lines, i)}>Edit</span>}
                    {canEdit && <span style={{ ...link, color: color.rust }} onClick={() => remove(i)}>Delete</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
      {editor}
    </>
  );
}
