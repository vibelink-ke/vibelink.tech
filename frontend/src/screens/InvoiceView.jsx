import React, { useEffect, useState } from 'react';
import { font } from '../theme/tokens';
import { downloadInvoice } from '../lib/export';

/**
 * A public, unguessable link to one invoice, at /invoice/<id> — same reasoning
 * as VerifyStaff: a different audience on the same hostname, no session, no
 * store, a plain fetch against /api/public/invoices/:id. Reachable by anyone
 * holding the link (shared over SMS/WhatsApp), so it can both be viewed and
 * paid with an M-Pesa prompt without ever signing into the portal.
 */
const id = window.location.pathname.split('/invoice/')[1]?.split(/[/?#]/)[0] ?? '';

const kes = (n) => Number(n ?? 0).toLocaleString('en-KE');

export default function InvoiceView() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [pay, setPay] = useState({ kind: 'idle' });   // idle | sending | waiting | done | failed

  useEffect(() => {
    let live = true;
    if (!id) { setState({ loading: false, data: null, error: 'No invoice in this link.' }); return; }
    fetch(`/api/public/invoices/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error ?? 'Could not load this invoice.');
        return data;
      })
      .then((data) => {
        if (!live) return;
        setState({ loading: false, data, error: null });
        setAmount(String(Math.max(0, Number(data.amount) - Number(data.paid))));
      })
      .catch((e) => { if (live) setState({ loading: false, data: null, error: e.message }); });
    return () => { live = false; };
  }, []);

  const send = async () => {
    setPay({ kind: 'sending' });
    try {
      const r = await fetch(`/api/public/invoices/${encodeURIComponent(id)}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, amount: amount === '' ? undefined : Number(amount) }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? 'Could not send the prompt.');
      setPay({ kind: 'waiting' });
      for (let i = 0; i < 24; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const sr = await fetch(`/api/public/invoices/pay-status/${encodeURIComponent(body.checkoutId)}`)
          .then((x) => x.json()).catch(() => null);
        if (sr?.status === 'success') {
          setPay({ kind: 'done' });
          return;
        }
        if (sr?.status === 'failed' || sr?.status === 'timeout') {
          setPay({ kind: 'failed', message: sr.result_desc || 'The prompt was cancelled or timed out.' });
          return;
        }
      }
      setPay({ kind: 'failed', message: 'No answer yet. If you approved it on your phone, check back shortly.' });
    } catch (e) {
      setPay({ kind: 'failed', message: e.message });
    }
  };

  const { loading, data, error } = state;
  const card = { width: '100%', maxWidth: 420, background: '#fff', borderRadius: 16, border: '1px solid #e2e6e1', padding: 28 };
  const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: '#f4f6f4', padding: '40px 16px', fontFamily: font.body ?? 'system-ui, sans-serif' };
  const input = { width: '100%', height: 42, borderRadius: 8, border: '1px solid #d8ddd7', padding: '0 12px', fontSize: 14, boxSizing: 'border-box' };
  const busy = pay.kind === 'sending' || pay.kind === 'waiting';
  const owed = data ? Number(data.amount) - Number(data.paid) : 0;
  const payable = data && ['open', 'partial'].includes(data.status) && owed > 0;

  return (
    <div style={wrap}>
      <div style={card}>
        {loading && <p style={{ color: '#6b756a', textAlign: 'center' }}>Loading…</p>}

        {!loading && error && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>⚠️</div>
            <h1 style={{ fontSize: 17, margin: '0 0 6px' }}>Could not load this invoice</h1>
            <p style={{ fontSize: 13.5, color: '#6b756a', margin: 0 }}>{error}</p>
          </div>
        )}

        {!loading && data && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <p style={{ fontSize: 12, color: '#9aa298', margin: '0 0 2px', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '.05em' }}>{data.company}</p>
                <h1 style={{ fontSize: 19, margin: 0 }}>Invoice {data.number}</h1>
              </div>
              <span style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, textTransform: 'capitalize',
                background: data.status === 'paid' ? '#e7f5ef' : '#fdf1ec',
                color: data.status === 'paid' ? '#1c7a4d' : '#a13d1f',
              }}>
                {data.status}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, color: '#3a423a', marginBottom: 18 }}>
              {data.subscriberName && <span>Billed to {data.subscriberName} · Account {data.accountCode}</span>}
              {data.planTitle && <span>{data.planTitle}</span>}
              <span>Due {data.dueDate ? new Date(data.dueDate).toLocaleDateString('en-KE') : '—'}</span>
            </div>

            <div style={{ borderTop: '1px solid #eef1ee', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <span>Amount</span><span>KES {kes(data.amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <span>Paid</span><span>KES {kes(data.paid)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
                <span>Balance due</span><span>KES {kes(owed)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => downloadInvoice(`Invoice ${data.number}.pdf`, {
                company: data.company, number: data.number, subscriberName: data.subscriberName,
                accountCode: data.accountCode, planTitle: data.planTitle, amount: data.amount,
                paid: data.paid, dueDate: data.dueDate ? new Date(data.dueDate).toLocaleDateString('en-KE') : '—',
                status: data.status, link: window.location.href,
              })}
              style={{ width: '100%', height: 40, borderRadius: 8, border: '1px solid #d8ddd7', background: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: payable ? 18 : 0 }}
            >
              Download PDF
            </button>

            {payable && (
              <div style={{ borderTop: '1px solid #eef1ee', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Pay with M-Pesa</p>
                <input style={input} placeholder="07xx xxx xxx" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
                <input style={input} type="number" min="10" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
                <button
                  type="button" onClick={send} disabled={busy || !phone}
                  style={{ height: 42, borderRadius: 8, border: 0, background: '#1c7a4d', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy || !phone ? 'default' : 'pointer', opacity: busy || !phone ? 0.6 : 1 }}
                >
                  {pay.kind === 'sending' ? 'Sending…' : pay.kind === 'waiting' ? 'Check your phone…' : 'Send M-Pesa prompt'}
                </button>
                {pay.kind === 'waiting' && <span style={{ fontSize: 12.5, color: '#6b756a' }}>Waiting for you to approve it on your phone…</span>}
                {pay.kind === 'done' && <span style={{ fontSize: 12.5, color: '#1c7a4d', fontWeight: 600 }}>Payment received — thank you. Refresh this page to see it applied.</span>}
                {pay.kind === 'failed' && <span style={{ fontSize: 12.5, color: '#a13d1f' }}>{pay.message}</span>}
              </div>
            )}

            {data.supportPhone && (
              <p style={{ fontSize: 11.5, color: '#9aa298', marginTop: 18, textAlign: 'center' }}>
                Questions about this invoice? Call {data.supportPhone}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
