import React, { useCallback, useEffect, useState } from 'react';
import { color, font, cur } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Field, Input, Modal, Stat, Grid, Table, Toggle } from '../../ui/primitives';

/**
 * Wallets for hotspot visitors: money a visitor paid ahead by M-Pesa, kept under their phone number and spent on
 * bundles later from their own wallet page. This screen holds the rules, every wallet with its history, and
 * corrections made by hand (each needs a reason and is kept in the history).
 */
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const phoneShown = (p) => (String(p).startsWith('254') ? `0${String(p).slice(3)}` : p);
const amount = (n) => `${cur()} ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

export default function Wallets() {
  const store = useStore();
  const canManage = !!store.session?.perms?.['visitor_wallets.manage'];
  const [data, setData] = useState(null);
  const [rules, setRules] = useState({ enabled: false, minTopup: 10, maxTopup: 5000 });
  const [saving, setSaving] = useState(false);
  const [find, setFind] = useState('');
  const [history, setHistory] = useState(null);     // { phone, rows }
  const [adjusting, setAdjusting] = useState(null); // { phone, balance, delta, note }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.visitorWallets();
      setData(d);
      setRules({ enabled: d.enabled, minTopup: d.minTopup, maxTopup: d.maxTopup });
    } catch (e) {
      setData({ enabled: false, wallets: [], held: 0, count: 0, link: null });
      store.toast(e.message);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const saveRules = async () => {
    setSaving(true);
    try {
      await api.saveVisitorWalletSettings({ enabled: rules.enabled, minTopup: Number(rules.minTopup), maxTopup: Number(rules.maxTopup) });
      store.toast(rules.enabled ? 'The visitor wallet is on' : 'The visitor wallet is off');
      await load();
    } catch (e) {
      store.toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const showHistory = async (phone) => {
    try { setHistory({ phone, rows: await api.visitorWalletLedger(phone) }); } catch (e) { store.toast(e.message); }
  };

  const confirmAdjust = async () => {
    const delta = Number(adjusting.delta);
    if (!delta) return store.toast('Enter an amount: a minus takes money away');
    if (!adjusting.note.trim()) return store.toast('Say why, so the history explains it');
    setBusy(true);
    try {
      const out = await api.adjustVisitorWallet({ phone: adjusting.phone, delta, note: adjusting.note.trim() });
      store.toast(`Wallet is now ${amount(out.balance)}`);
      setAdjusting(null);
      await load();
    } catch (e) {
      store.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Card><div style={{ color: color.muted }}>Loading…</div></Card>;
  const digits = find.replace(/[^0-9]/g, '').replace(/^0/, '');
  const rows = digits ? data.wallets.filter((w) => String(w.phone).includes(digits)) : data.wallets;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Card title="Visitor wallet" subtitle="Visitors pay ahead by M-Pesa and buy bundles from their wallet later, with no prompt each time">
        <div style={{ display: 'grid', gap: 12, maxWidth: 520, pointerEvents: canManage ? 'auto' : 'none', opacity: canManage ? 1 : 0.7 }}>
          <Toggle
            checked={rules.enabled}
            onChange={(v) => setRules((r) => ({ ...r, enabled: v }))}
            label="Let visitors keep money in a wallet"
            detail={rules.enabled
              ? 'On. A My wallet link is on the WiFi sign-in page. Top-ups are paid to the same till or paybill your hotspot bundles use.'
              : 'Off. Nobody can top up. Money already in a wallet can still be spent.'}
          />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label={`Least a visitor can put in (${cur()})`}>
              <Input type="number" min="1" value={rules.minTopup} onChange={(e) => setRules((r) => ({ ...r, minTopup: e.target.value }))} style={{ width: 160 }} />
            </Field>
            <Field label={`Most at once (${cur()})`}>
              <Input type="number" min="1" value={rules.maxTopup} onChange={(e) => setRules((r) => ({ ...r, maxTopup: e.target.value }))} style={{ width: 160 }} />
            </Field>
          </div>
          {canManage && <Button variant="primary" onClick={saveRules} disabled={saving} style={{ alignSelf: 'flex-start' }}>{saving ? 'Saving…' : 'Save'}</Button>}
        </div>
        {data.link && (
          <div style={{ marginTop: 14, fontSize: 13, color: color.neutralInk }}>
            The visitor's page: <a href={data.link} target="_blank" rel="noreferrer" style={{ color: color.green, fontFamily: font.mono }}>{data.link}</a>
            <div style={{ color: color.muted, marginTop: 4 }}>
              It opens on your WiFi before a visitor has paid, and from anywhere else. A visitor can add it to their home screen and open it like an app.
              A sign-in costs one SMS, once per phone.
            </div>
          </div>
        )}
      </Card>

      <Grid min={200}>
        <Stat label="Held for visitors" value={amount(data.held)} hint="Paid to you already, not yet spent on bundles" />
        <Stat label="Wallets" value={data.count} />
      </Grid>

      <Card
        title="Wallets"
        subtitle="Newest activity first"
        actions={<Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a phone number" style={{ width: 200 }} />}
      >
        <Table
          rows={rows}
          rowKey={(w) => w.phone}
          empty={data.wallets.length ? 'No wallet with that number' : 'Nobody has put money in yet'}
          columns={[
            { key: 'phone', label: 'Phone', render: (w) => <span style={{ fontFamily: font.mono }}>{phoneShown(w.phone)}</span> },
            { key: 'balance', label: 'In the wallet', align: 'right', render: (w) => <b>{amount(w.balance)}</b> },
            { key: 'paid_in', label: 'Paid in', align: 'right', render: (w) => amount(w.paid_in) },
            { key: 'spent', label: 'Spent', align: 'right', render: (w) => amount(w.spent) },
            { key: 'updated_at', label: 'Last activity', render: (w) => when(w.updated_at) },
            {
              key: 'act', label: '', align: 'right',
              render: (w) => (
                <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
                  <Button size="sm" onClick={() => showHistory(w.phone)}>History</Button>
                  {canManage && <Button size="sm" onClick={() => setAdjusting({ phone: w.phone, balance: w.balance, delta: '', note: '' })}>Adjust</Button>}
                </span>
              ),
            },
          ]}
        />
        {canManage && (
          <div style={{ marginTop: 12 }}>
            <Button onClick={() => {
              const p = window.prompt('Phone number of the wallet to add money to (for a visitor who paid you in cash, or a payment you are correcting):', '');
              if (p && p.trim()) setAdjusting({ phone: p.trim(), balance: null, delta: '', note: '' });
            }}>Add money to a number</Button>
          </div>
        )}
      </Card>

      <Modal
        open={!!adjusting}
        title="Adjust a wallet"
        onClose={() => !busy && setAdjusting(null)}
        footer={<><Button onClick={() => setAdjusting(null)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={confirmAdjust} disabled={busy}>{busy ? 'Working…' : 'Save'}</Button></>}
      >
        {adjusting && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 13.5 }}>
              <b style={{ fontFamily: font.mono }}>{phoneShown(adjusting.phone)}</b>
              {adjusting.balance !== null && <> has <b>{amount(adjusting.balance)}</b> in the wallet.</>}
            </div>
            <Field label={`Amount (${cur()})`} hint="A minus takes money away, for example -50. A wallet never goes below zero.">
              <Input type="number" value={adjusting.delta} onChange={(e) => setAdjusting((a) => ({ ...a, delta: e.target.value }))} style={{ width: 180 }} />
            </Field>
            <Field label="Why" hint="Kept in the wallet's history with your name">
              <Input value={adjusting.note} onChange={(e) => setAdjusting((a) => ({ ...a, note: e.target.value }))} maxLength={200} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!history} title={history ? `History · ${phoneShown(history.phone)}` : ''} onClose={() => setHistory(null)} footer={<Button variant="primary" onClick={() => setHistory(null)}>Close</Button>}>
        {history && (
          history.rows.length ? (
            <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
              {history.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>
                    {r.reason === 'topup' ? `Top-up${r.mpesa_code ? ` · ${r.mpesa_code}` : ''}`
                      : r.reason === 'purchase' ? `Bought ${r.note ?? 'a bundle'}${r.voucher_code ? ` · code ${r.voucher_code}` : ''}`
                        : `Adjusted${r.staff_name ? ` by ${r.staff_name}` : ''}${r.note ? `: ${r.note}` : ''}`}
                    <div style={{ color: color.muted }}>{when(r.created_at)} · balance after {amount(r.balance_after)}</div>
                  </span>
                  <b style={{ color: Number(r.delta) < 0 ? color.rust : color.green, whiteSpace: 'nowrap' }}>{Number(r.delta) > 0 ? '+' : ''}{Number(r.delta).toLocaleString('en-KE')}</b>
                </div>
              ))}
            </div>
          ) : <div style={{ color: color.muted }}>Nothing recorded yet.</div>
        )}
      </Modal>
    </div>
  );
}
