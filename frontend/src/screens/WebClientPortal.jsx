import React, { useEffect, useState } from 'react';
import { font } from '../theme/tokens';

/**
 * A website client's own page, at /web/<key> (the link in their messages): what they pay for, their invoices and payments, and Pay now, which
 * sends an M-Pesa prompt to their phone. No sign-in: the long random key in the link is the access, like the public invoice page.
 */
const key = window.location.pathname.split('/web/')[1]?.split(/[/?#]/)[0] ?? '';
const kes = (n) => `KES ${Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

export default function WebClientPortal() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [pay, setPay] = useState({ kind: 'idle' });

  const load = () => fetch(`/api/public/web-client/${encodeURIComponent(key)}`)
    .then(async (r) => {
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error ?? 'Could not load this page.');
      setState({ loading: false, data, error: null });
    })
    .catch((e) => setState({ loading: false, data: null, error: e.message }));
  useEffect(() => { if (!key) setState({ loading: false, data: null, error: 'No account in this link.' }); else load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setPay({ kind: 'sending' });
    try {
      const r = await fetch(`/api/public/web-client/${encodeURIComponent(key)}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, amount: amount === '' ? undefined : Number(amount) }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? 'Could not send the prompt.');
      setPay({ kind: 'waiting' });
      for (let i = 0; i < 24; i += 1) {
        await new Promise((res) => setTimeout(res, 3000));
        const sr = await fetch(`/api/public/web-client/pay-status/${encodeURIComponent(body.checkoutId)}`).then((x) => x.json()).catch(() => null);
        if (sr?.status === 'success') { setPay({ kind: 'done' }); setTimeout(load, 2500); return; }
        if (sr?.status === 'failed' || sr?.status === 'timeout') { setPay({ kind: 'failed', message: sr.result_desc || 'The prompt was cancelled or timed out.' }); return; }
      }
      setPay({ kind: 'failed', message: 'No answer yet. If you approved it on your phone, refresh this page in a minute.' });
    } catch (e) {
      setPay({ kind: 'failed', message: e.message });
    }
  };

  const { loading, data, error } = state;
  const wrap = { minHeight: '100vh', background: '#f4f6f4', padding: '32px 16px', fontFamily: font.body ?? 'system-ui, sans-serif', color: '#161a17', display: 'flex', justifyContent: 'center' };
  const card = { width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 14 };
  const box = { background: '#fff', border: '1px solid #e2e6e1', borderRadius: 14, padding: 18 };
  const th = { textAlign: 'left', fontSize: 11.5, color: '#8a9186', fontWeight: 600, padding: '4px 6px' };
  const td = { padding: '7px 6px', fontSize: 13.5, borderTop: '1px solid #eef0ec', verticalAlign: 'top' };
  const input = { width: '100%', height: 42, borderRadius: 8, border: '1px solid #d8ddd7', padding: '0 12px', fontSize: 14, boxSizing: 'border-box' };
  const btn = { height: 44, borderRadius: 10, border: 'none', background: '#1652d9', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%' };

  if (loading) return <div style={wrap}><div style={card}>Loading…</div></div>;
  if (error) return <div style={wrap}><div style={{ ...card, ...box }}>{error}</div></div>;

  return (
    <div style={wrap}>
      <div style={card}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{data.name}</h1>
          <div style={{ color: '#8a9186', fontSize: 13 }}>Your website services · account {data.billing_ref}</div>
        </div>

        {data.suspended && (
          <div style={{ ...box, background: '#f7e2dc', borderColor: '#e8c4b8', color: '#a5451f', fontSize: 14 }}>
            Your website services are suspended. Pay below and they are restored as soon as the payment is received.
          </div>
        )}

        <div style={box}>
          <div style={{ fontSize: 13, color: '#8a9186' }}>Amount due</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{kes(data.owed)}</div>
          {data.credit > 0 && <div style={{ fontSize: 13, color: '#8a9186' }}>Credit on your account: {kes(data.credit)}</div>}

          {pay.kind === 'done' ? (
            <div style={{ marginTop: 12, color: '#157347', fontWeight: 600 }}>Payment received. Thank you.</div>
          ) : pay.kind === 'waiting' ? (
            <div style={{ marginTop: 12 }}>Check your phone and enter your M-Pesa PIN…</div>
          ) : (
            <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
              <input style={input} inputMode="tel" placeholder="M-Pesa phone, e.g. 0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input style={input} inputMode="numeric" placeholder={data.owed > 0 ? `Amount (default ${data.owed})` : 'Amount (KES 10 or more)'} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
              <button type="button" style={{ ...btn, opacity: phone.trim() && pay.kind !== 'sending' ? 1 : 0.5 }} disabled={!phone.trim() || pay.kind === 'sending'} onClick={send}>
                {pay.kind === 'sending' ? 'Sending…' : 'Pay now with M-Pesa'}
              </button>
              {pay.kind === 'failed' && <div style={{ color: '#a5451f', fontSize: 13.5 }}>{pay.message}</div>}
            </div>
          )}
          {data.paybill && (
            <div style={{ marginTop: 14, fontSize: 13, color: '#8a9186' }}>
              Or pay on M-Pesa: Paybill <b style={{ color: '#161a17' }}>{data.paybill}</b>, account <b style={{ color: '#161a17' }}>{data.billing_ref}</b>.
            </div>
          )}
        </div>

        <div style={box}>
          <b>Your services</b>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead><tr><th style={th}>Service</th><th style={th}>Price</th><th style={th}>Renews</th></tr></thead>
            <tbody>
              {data.services.length === 0 && <tr><td style={td} colSpan={3}>Nothing yet.</td></tr>}
              {data.services.map((s, i) => (
                <tr key={i}><td style={td}><b>{s.label}</b><div style={{ color: '#8a9186', fontSize: 12 }}>{s.kind}{s.status === 'paused' ? ' · paused' : ''}</div></td>
                  <td style={td}>{kes(s.price)} / {s.cycle === 'annual' ? 'year' : 'month'}</td><td style={td}>{s.next_due}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={box}>
          <b>Invoices</b>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead><tr><th style={th}>For</th><th style={th}>Due</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {data.invoices.length === 0 && <tr><td style={td} colSpan={4}>No invoices yet.</td></tr>}
              {data.invoices.map((i) => (
                <tr key={i.number}>
                  <td style={td}>{i.description}<div style={{ color: '#8a9186', fontSize: 12 }}>{i.number}</div></td>
                  <td style={td}>{i.due_date}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{kes(i.amount)}{Number(i.paid) > 0 && i.status !== 'paid' ? <div style={{ color: '#8a9186', fontSize: 12 }}>paid {kes(i.paid)}</div> : null}</td>
                  <td style={td}>{i.status === 'paid' ? 'Paid' : i.due_date < data.today ? <b style={{ color: '#a5451f' }}>Overdue</b> : 'Due'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={box}>
          <b>Payments received</b>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <tbody>
              {data.payments.length === 0 && <tr><td style={td}>Nothing yet.</td></tr>}
              {data.payments.map((p, i) => (
                <tr key={i}><td style={td}>{new Date(p.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}<div style={{ color: '#8a9186', fontSize: 12 }}>{p.method}{p.reference ? ` · ${p.reference}` : ''}</div></td>
                  <td style={{ ...td, textAlign: 'right' }}>{kes(p.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
