import React, { useEffect, useState } from 'react';
import { color, font, radius, cur } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Field, Input, Toggle } from '../ui/primitives';

/**
 * Online sign-up (backend signup.js): the public /join page where a new customer checks coverage, picks a package and
 * pays the installation fee. Here: switch it on, set the fee and how far sites reach, and see who signed up.
 */
const when = (iso) => new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const phoneShown = (p) => (String(p).startsWith('254') ? `0${String(p).slice(3)}` : p);

export default function OnlineSignup() {
  const store = useStore();
  const canManage = !!(store.session?.perms?.['signup.manage'] || store.session?.is_super_admin);
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.signup().then((x) => { setD(x); setForm({ enabled: x.enabled, installFee: String(x.installFee), wirelessM: String(x.wirelessM), fibreM: String(x.fibreM), note: x.note ?? '' }); }).catch((e) => store.toast(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      await api.saveSignup({ ...form, installFee: Number(form.installFee) || 0, wirelessM: Number(form.wirelessM), fibreM: Number(form.fibreM) });
      store.toast(form.enabled ? 'Online sign-up is open' : 'Online sign-up is closed');
      await load();
    } catch (e) { store.toast(e.message); } finally { setBusy(false); }
  };

  if (!d || !form) return <Card><span style={{ color: color.muted }}>Loading…</span></Card>;
  const noPoints = !d.sites && !d.nodes;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card title="Online sign-up" subtitle="A public page where new customers check coverage, pick a package and pay the installation fee">
        <div style={{ display: 'grid', gap: 12, maxWidth: 560, pointerEvents: canManage ? 'auto' : 'none', opacity: canManage ? 1 : 0.7 }}>
          <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label="Open the sign-up page"
            detail={form.enabled ? 'Open. Share the link below on Facebook, WhatsApp and your website.' : 'Closed. The link says sign-up is not open.'} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label={`Installation fee (${cur()})`} hint="0 for none. Paid by M-Pesa to your PPPoE paybill">
              <Input type="number" min="0" value={form.installFee} onChange={(e) => setForm((f) => ({ ...f, installFee: e.target.value }))} style={{ width: 150 }} />
            </Field>
            <Field label="Wireless reach (metres)" hint="From a site or access point">
              <Input type="number" min="50" value={form.wirelessM} onChange={(e) => setForm((f) => ({ ...f, wirelessM: e.target.value }))} style={{ width: 150 }} />
            </Field>
            <Field label="Fibre reach (metres)" hint="From a splitter, closure or OLT">
              <Input type="number" min="20" value={form.fibreM} onChange={(e) => setForm((f) => ({ ...f, fibreM: e.target.value }))} style={{ width: 150 }} />
            </Field>
          </div>
          <Field label="A line under the form (optional)" hint="For example, how long installation takes">
            <Input value={form.note} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </Field>
          {canManage && <Button variant="primary" onClick={save} disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Saving…' : 'Save'}</Button>}
        </div>
        {noPoints && (
          <div style={{ marginTop: 12, fontSize: 13, color: color.rust }}>
            No sites have a location yet, so every address will show as "not covered". Set your routers' locations (Routers) or draw your network (Networks) first.
          </div>
        )}
        {!noPoints && <div style={{ marginTop: 12, fontSize: 12.5, color: color.muted }}>Coverage comes from {d.sites} site{d.sites === 1 ? '' : 's'} with a location and {d.nodes} drawn network point{d.nodes === 1 ? '' : 's'}.</div>}
        {d.link && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            The page: <a href={d.link} target="_blank" rel="noreferrer" style={{ color: color.green, fontFamily: font.mono }}>{d.link}</a>
          </div>
        )}
      </Card>

      <Card title="Recent online sign-ups" subtitle="They are also in Leads, with the pin on the map">
        {d.recent.length === 0 ? <div style={{ color: color.muted, fontSize: 13 }}>Nobody yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
              <thead>
                <tr style={{ color: color.muted, fontSize: 11.5, textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>When</th><th style={{ padding: '6px 8px' }}>Who</th><th style={{ padding: '6px 8px' }}>Package</th>
                  <th style={{ padding: '6px 8px' }}>Coverage</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Installation</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((l) => {
                  const due = Number(l.fee_due ?? 0), paid = Number(l.fee_paid ?? 0);
                  return (
                    <tr key={l.id} style={{ borderTop: `1px solid ${color.line}` }}>
                      <td style={{ padding: '8px' }}>{when(l.created_at)}</td>
                      <td style={{ padding: '8px' }}><b>{l.name}</b><div style={{ fontFamily: font.mono, fontSize: 11.5, color: color.muted }}>{phoneShown(l.phone)} · {l.signup_ref}</div></td>
                      <td style={{ padding: '8px' }}>{l.plan ?? '—'}</td>
                      <td style={{ padding: '8px', color: l.coverage === 'serviceable' ? color.green : color.rust }}>
                        {l.coverage === 'serviceable' ? 'Covered' : 'Not covered'}
                        {l.coverage_detail?.distance_m != null && <span style={{ color: color.muted }}> · {l.coverage_detail.distance_m} m</span>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {!due ? '—' : paid >= due
                          ? <span style={{ color: color.green, fontWeight: 600 }}>Paid {cur()} {paid.toLocaleString('en-KE')}</span>
                          : <span style={{ color: '#a86a00' }}>{paid ? `${cur()} ${paid} of ${due}` : `Owes ${cur()} ${due.toLocaleString('en-KE')}`}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div style={{ fontSize: 12, color: color.muted, borderRadius: radius.md }}>
        Paying by hand: the customer can pay your PPPoE paybill with their reference (for example JOIN48213) as the account number, and it is credited to their sign-up.
      </div>
    </div>
  );
}
