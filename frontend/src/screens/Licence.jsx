import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VIEW_ONLY_KEY } from '../app/LicenceBanner';
import { color, font, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Empty, Field, Grid, Input, Screen, Stat, Table } from '../ui/primitives';

const SALES_EMAIL = 'sales@vibelink.co.ke';
const STATUS_TONE = { open: 'pending', invoiced: 'default', paid: 'active', waived: 'default' };
const GAIN = '#0f7a5f';

const monthLabel = (key) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateLabel = (v) => (v
  ? new Date(String(v).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : '—');

function CopyBox({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* shown on screen to copy by hand */ }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', color: color.muted, textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <code style={{ fontFamily: font.mono, fontSize: 18, letterSpacing: '.04em', userSelect: 'all' }}>{value}</code>
        <span onClick={copy} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</span>
      </div>
    </div>
  );
}

/**
 * The tenant's own licence: whether it is running, what is owed for the
 * platform, and how to pay — an M-Pesa prompt sent to their own phone, or the
 * platform paybill with their reference. Stays reachable when the licence has
 * expired, which is when it matters most.
 *
 * Only this dashboard is affected by an expired licence. Customers, hotspot
 * visitors, payments and the network keep working, and this page says so.
 */
export default function Licence() {
  const store = useStore();
  const navigate = useNavigate();
  const canPay = !!store.session?.perms?.['billing.pay'];
  const canView = !!store.session?.perms?.['billing.view'];
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState({ kind: 'idle' });   // idle | sending | waiting | done | failed
  const cancelled = useRef(false);

  const load = async () => {
    try {
      const d = canView ? await api.billing() : await api.licence();
      setData(d);
      setAmount((a) => (a === '' && d.amountDue > 0 ? String(Math.round(d.amountDue)) : a));
      setError(null);
      window.dispatchEvent(new Event('vibelink:licence-changed'));
      return d;
    } catch (e) {
      setError(e.message);
      return null;
    }
  };
  useEffect(() => {
    cancelled.current = false;
    load();
    return () => { cancelled.current = true; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setState({ kind: 'sending' });
    try {
      const { checkoutId } = await api.billingPay({ phone, amount: amount === '' ? undefined : Number(amount) });
      setState({ kind: 'waiting' });
      for (let i = 0; i < 24 && !cancelled.current; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await api.billingPayStatus(checkoutId).catch(() => null);
        if (r?.status === 'success') {
          await new Promise((res) => setTimeout(res, 1500));   // the credit lands a moment after the result
          await load();
          setState({ kind: 'done' });
          store.toast('Payment received — thank you');
          return;
        }
        if (r?.status === 'failed' || r?.status === 'timeout') {
          setState({ kind: 'failed', message: r.message || 'The prompt was cancelled or timed out.' });
          return;
        }
      }
      if (!cancelled.current) setState({ kind: 'failed', message: 'No answer yet. If you approved it on your phone, it will appear here shortly.' });
    } catch (e) {
      setState({ kind: 'failed', message: e.message });
    }
  };

  if (error && !data) {
    return (
      <Screen title="Licence & billing">
        <Card><Empty>{error}</Empty></Card>
      </Screen>
    );
  }
  if (!data) return <Screen title="Licence & billing"><p style={{ color: color.muted }}>Loading…</p></Screen>;

  const expired = data.readOnly;
  if (!canView) {
    return (
      <Screen title="Licence">
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: expired ? color.rust : GAIN }}>
              {expired ? (data.trialEnded ? 'The free trial has ended' : 'The licence has expired') : 'The licence is active'}
            </span>
            <span style={{ fontSize: 13.5, color: color.inkSoft }}>
              {expired
                ? 'Changes in this dashboard are paused until it is renewed. Customers and hotspot visitors are not affected. Please ask the account owner to renew it.'
                : 'Nothing to do here.'}
            </span>
            {expired && (
              <div>
                <Button
                  onClick={() => {
                    try { sessionStorage.setItem(VIEW_ONLY_KEY, '1'); } catch { /* the banner still appears */ }
                    navigate('/');
                  }}
                >
                  View the dashboard (read-only)
                </Button>
              </div>
            )}
          </div>
        </Card>
      </Screen>
    );
  }
  const busy = state.kind === 'sending' || state.kind === 'waiting';

  return (
    <Screen
      title="Licence & billing"
      subtitle="Your licence, what is owed for the platform, and how to pay it."
    >
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: expired ? color.rust : GAIN }}>
            {data.trialEnded
              ? 'Your free trial has ended'
              : expired
                ? `Licence expired${data.licenceEnds ? ` on ${dateLabel(data.licenceEnds)}` : ''}`
                : data.trial
                  ? `Free trial${data.daysLeft != null ? ` · ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'} left` : ''}`
                  : data.licenceEnds
                    ? `Active until ${dateLabel(data.licenceEnds)}${data.daysLeft != null ? ` · ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'} left` : ''}`
                    : 'Active'}
          </span>
          {expired ? (
            <span style={{ fontSize: 13.5, color: color.inkSoft }}>
              {data.trialEnded
                ? 'You were not charged for the trial. '
                : ''}
              Only changes made in this dashboard are paused — you can still view everything.
              <b> Your customers and hotspot visitors are not affected:</b> they keep connecting, paying and getting
              their service as normal.
              {data.trialEnded ? ' To carry on, contact us and we will activate your account.' : ' Pay below to switch the dashboard back on straight away.'}
            </span>
          ) : data.trial ? (
            <span style={{ fontSize: 13.5, color: color.muted }}>
              Nothing is charged during the trial. When it ends the dashboard becomes view-only until your account is activated — your customers are never affected.
            </span>
          ) : (
            <span style={{ fontSize: 13.5, color: color.muted }}>
              Each monthly statement you pay extends your licence by a month.
            </span>
          )}
          {expired && data.payoutsPaused && (
            <span style={{ fontSize: 13.5, color: color.amberInk, background: color.amberBg, borderRadius: 6, padding: '8px 10px' }}>
              <b>Payouts are paused.</b> Money collected for you is safe and keeps building up — it is released as soon as you renew.
            </span>
          )}
          {expired && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {data.trialEnded && (
                <a href={`mailto:${SALES_EMAIL}?subject=Activate my account`} style={{ textDecoration: 'none' }}>
                  <Button variant="primary">Contact us to activate</Button>
                </a>
              )}
              <Button
                onClick={() => {
                  try { sessionStorage.setItem(VIEW_ONLY_KEY, '1'); } catch { /* the banner still appears */ }
                  navigate('/');
                }}
              >
                View the dashboard (read-only)
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Grid min={200} gap={14}>
        <Stat label="Due now" value={`KES ${kes(data.amountDue)}`} tone={data.amountDue > 0 ? color.rust : undefined} />
        <Stat label="Credit on account" value={`KES ${kes(data.credit)}`} hint={data.credit > 0 ? 'settles your next statement' : undefined} />
        <Stat label="Your reference" value={data.billingRef ?? '—'} />
      </Grid>

      {canPay && !data.trial && !data.trialEnded && (
        <Grid min={320} gap={14}>
          <Card title="Pay with an M-Pesa prompt" subtitle="We send a prompt to your phone — approve it with your PIN. Your licence updates as soon as it is paid.">
            {data.canPrompt ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="M-Pesa number">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" autoComplete="tel" disabled={busy} />
                </Field>
                <Field label="Amount (KES)" hint={data.amountDue > 0 ? 'What is due now — change it to pay part, or ahead' : 'Nothing is due — enter an amount to pay ahead'}>
                  <Input type="number" min="10" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
                </Field>
                <div>
                  <Button variant="primary" onClick={send} disabled={busy || !phone}>
                    {state.kind === 'sending' ? 'Sending…' : state.kind === 'waiting' ? 'Check your phone…' : 'Send M-Pesa prompt'}
                  </Button>
                </div>
                {state.kind === 'waiting' && <span style={{ fontSize: 13, color: color.muted }}>Waiting for you to approve it on your phone…</span>}
                {state.kind === 'done' && <span style={{ fontSize: 13, color: GAIN, fontWeight: 600 }}>Payment received.</span>}
                {state.kind === 'failed' && <span style={{ fontSize: 13, color: color.rust }}>{state.message}</span>}
              </div>
            ) : (
              <Empty>M-Pesa prompts are not switched on yet. Pay to the paybill instead, or contact support.</Empty>
            )}
          </Card>

          <Card title="Pay to our paybill" subtitle="From any phone, at any time. Use your reference as the account number so it credits you automatically.">
            {data.paybill ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <CopyBox label="Paybill number" value={String(data.paybill)} />
                <CopyBox label="Account number" value={data.billingRef ?? ''} />
                <span style={{ fontSize: 12.5, color: color.muted }}>
                  M-Pesa → Lipa na M-Pesa → Pay Bill. A different account number will not reach your licence.
                </span>
              </div>
            ) : (
              <Empty>Our paybill is not set up yet — contact support to renew.</Empty>
            )}
          </Card>
        </Grid>
      )}

      {expired && !data.trialEnded && data.amountDue === 0 && (
        <Card>
          <span style={{ fontSize: 13.5, color: color.inkSoft }}>
            Nothing is outstanding yet. Your monthly statement is drawn on the 1st, and paying it renews your licence.
            If you have already paid and this still shows expired, contact support.
          </span>
        </Card>
      )}

      <Card title="Monthly statements">
        <Table
          rowKey={(s) => s.id}
          empty="No statements yet — the first is drawn on the 1st of next month"
          rows={data.statements}
          columns={[
            { key: 'month', label: 'Month', render: (s) => <span style={{ fontWeight: 600 }}>{monthLabel(s.month)}</span> },
            { key: 'hs', label: 'Hotspot sales', align: 'right', render: (s) => <span style={{ fontFamily: font.mono, fontSize: 13 }}>KES {kes(s.hotspot_revenue)}</span> },
            { key: 'hf', label: `Hotspot fee`, align: 'right', render: (s) => <span style={{ fontFamily: font.mono, fontSize: 13 }}>KES {kes(s.hotspot_fee)} <span style={{ color: color.muted }}>({Number(s.hotspot_pct)}%)</span></span> },
            { key: 'act', label: 'Active PPPoE', align: 'right', render: (s) => <span style={{ fontFamily: font.mono, fontSize: 13 }}>{s.pppoe_active}</span> },
            { key: 'pf', label: 'PPPoE fee', align: 'right', render: (s) => <span style={{ fontFamily: font.mono, fontSize: 13 }}>KES {kes(s.pppoe_fee)} <span style={{ color: color.muted }}>(@{Number(s.pppoe_rate)})</span></span> },
            { key: 'total', label: 'Total', align: 'right', render: (s) => <span style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 700 }}>KES {kes(s.total)}</span> },
            {
              key: 'status', label: 'Status',
              render: (s) => (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  {s.paid_at && <span style={{ fontSize: 11, color: color.muted }}>{dateLabel(s.paid_at)}</span>}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </Screen>
  );
}
