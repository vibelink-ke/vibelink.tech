import React, { useState } from 'react';
import { color, cur } from '../theme/tokens';
import { Button, Field, Input, Modal } from './primitives';

/**
 * "Click to pay" for staff screens — the same public, unauthenticated
 * /api/public/invoices/:id/pay endpoint the shared /invoice/:id link uses,
 * triggered right from Payments/ClientDetail/Clients instead of making a
 * staff member copy a link, open it in another tab, and paste a phone
 * number there. One modal, reused wherever an invoice row needs it.
 */
export function useInvoicePay(store) {
  const [target, setTarget] = useState(null);   // the invoice row, or null when closed
  const [phone, setPhone] = useState('');
  const [state, setState] = useState({ kind: 'idle' });   // idle | sending | waiting | done | failed

  const open = (invoice) => { setTarget(invoice); setPhone(''); setState({ kind: 'idle' }); };
  const close = () => setTarget(null);
  const busy = state.kind === 'sending' || state.kind === 'waiting';

  const send = async () => {
    setState({ kind: 'sending' });
    try {
      const r = await fetch(`/api/public/invoices/${encodeURIComponent(target.id)}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? 'Could not send the prompt.');
      setState({ kind: 'waiting' });
      for (let i = 0; i < 24; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const sr = await fetch(`/api/public/invoices/pay-status/${encodeURIComponent(body.checkoutId)}`)
          .then((x) => x.json()).catch(() => null);
        if (sr?.status === 'success') {
          setState({ kind: 'done' });
          store.toast?.('Payment received');
          return;
        }
        if (sr?.status === 'failed' || sr?.status === 'timeout') {
          setState({ kind: 'failed', message: sr.result_desc || 'The prompt was cancelled or timed out.' });
          return;
        }
      }
      setState({ kind: 'failed', message: 'No answer yet. If they approved it on their phone, check back shortly.' });
    } catch (e) {
      setState({ kind: 'failed', message: e.message });
    }
  };

  const owed = target ? Number(target.amount) - Number(target.paid) : 0;

  const modal = (
    <Modal
      open={!!target}
      title={target ? `Pay invoice ${target.number}` : 'Pay invoice'}
      onClose={close}
      footer={<Button onClick={close}>{state.kind === 'done' ? 'Done' : 'Cancel'}</Button>}
    >
      {target && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13.5, color: color.neutralInk }}>
            We'll send an M-Pesa prompt for {cur()} {owed.toLocaleString('en-KE')} to the number below.
          </div>
          {state.kind !== 'done' && (
            <>
              <Field label="Phone number">
                <Input
                  value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx"
                  disabled={busy} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && phone && !busy) send(); }}
                />
              </Field>
              <Button variant="primary" onClick={send} disabled={busy || !phone}>
                {state.kind === 'sending' ? 'Sending…' : state.kind === 'waiting' ? 'Check their phone…' : 'Send prompt'}
              </Button>
            </>
          )}
          {state.kind === 'waiting' && <span style={{ fontSize: 12.5, color: color.neutralInk }}>Waiting for them to approve it…</span>}
          {state.kind === 'done' && <span style={{ fontSize: 13.5, color: color.green, fontWeight: 600 }}>Payment received.</span>}
          {state.kind === 'failed' && <span style={{ fontSize: 12.5, color: color.rust }}>{state.message}</span>}
        </div>
      )}
    </Modal>
  );

  return { open, modal };
}
