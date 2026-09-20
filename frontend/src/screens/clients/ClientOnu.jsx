import React, { useCallback, useEffect, useState } from 'react';
import { color, font, radius } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Empty, Field, Input } from '../../ui/primitives';
import { Signal, StatusBadge, fmtDistance } from '../SmartOlt';

/**
 * A client's ONU, from SmartOLT: is it online, how good is the light, where on the OLT it sits, and
 * the things a technician does about it (reboot, disable, enable). Tied to the client by the serial
 * number typed here, or automatically when the ONU is named with the client's account number.
 */

const ago = (iso) => {
  if (!iso) return '—';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} d ago`;
};

export default function ClientOnu({ client }) {
  const store = useStore();
  const canManage = !!store.session?.perms?.['smartolt.manage'];
  const [d, setD] = useState(null);
  const [sn, setSn] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api.smartoltOnuFor(client.id).then((r) => { setD(r); setSn((s) => s || r.savedSerial || ''); }).catch(() => setD({ enabled: false })), [client.id]);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (action) => {
    const words = { reboot: 'Reboot', disable: 'Disable', enable: 'Enable' }[action];
    if (action !== 'enable' && !window.confirm(`${words} this client's ONU?`)) return;
    setBusy(action);
    try {
      await api.smartoltOnuAction(d.onu.external_id, action);
      store.toast(`${words} — sent`);
      await load();
    } catch (e) {
      store.toast(`SmartOLT: ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  const saveSerial = async () => {
    setBusy('link');
    try {
      const r = await api.smartoltLinkSerial(client.id, sn);
      store.toast(r.linked ? 'ONU linked' : sn ? 'Saved — it will link as soon as SmartOLT lists that serial' : 'Cleared');
      await load();
    } catch (e) {
      store.toast(e.message);
    } finally {
      setBusy('');
    }
  };

  const box = { background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '16px 20px 20px' };
  if (!d) return <div style={box}><Empty>Loading…</Empty></div>;
  if (!d.enabled) return <div style={box}><Empty>SmartOLT is not connected.</Empty></div>;
  const o = d.onu;

  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {o ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <StatusBadge status={o.status} />
            {o.status !== 'online' && o.offline_since && <span style={{ fontSize: 13, color: color.rust }}>{o.status === 'los' ? 'no light' : 'down'} since {ago(o.offline_since)}</span>}
            {o.admin_status === 'disabled' && <Badge tone={{ bg: color.amberBg, fg: color.amberInk }}>{o.disabled_by_us ? 'disabled — not paid' : 'disabled'}</Badge>}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: color.muted }}>updated {ago(o.updated_at)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, fontSize: 13 }}>
            <div><div style={{ color: color.muted, fontSize: 12 }}>Serial</div><span style={{ fontFamily: font.mono }}>{o.sn ?? '—'}</span></div>
            <div><div style={{ color: color.muted, fontSize: 12 }}>Signal</div><Signal dbm={o.signal_dbm} cls={o.signal_class} /></div>
            <div><div style={{ color: color.muted, fontSize: 12 }}>Distance</div>{fmtDistance(o.distance_m)}</div>
            <div><div style={{ color: color.muted, fontSize: 12 }}>OLT · port</div>{o.olt_name ?? '—'} · {o.board ?? '?'}/{o.port ?? '?'}{o.onu_no ? `/${o.onu_no}` : ''}</div>
            <div><div style={{ color: color.muted, fontSize: 12 }}>Model</div>{o.onu_type ?? '—'}</div>
            <div><div style={{ color: color.muted, fontSize: 12 }}>Zone</div>{o.zone ?? '—'}</div>
          </div>
          {canManage && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button onClick={() => act('reboot')} disabled={!!busy}>{busy === 'reboot' ? 'Sending…' : 'Reboot ONU'}</Button>
              <Button onClick={() => act(o.admin_status === 'disabled' ? 'enable' : 'disable')} disabled={!!busy}>{o.admin_status === 'disabled' ? 'Enable ONU' : 'Disable ONU'}</Button>
              <Button onClick={load} disabled={!!busy}>Refresh</Button>
            </div>
          )}
          {d.autoDisable && <div style={{ fontSize: 12.5, color: color.muted }}>Automatic disable is on: this ONU is switched off when the client expires and back on when they pay.</div>}
        </>
      ) : (
        <div style={{ fontSize: 13.5, color: color.inkSoft }}>
          This client has no ONU linked. Enter the serial number printed on the ONU (for example <span style={{ fontFamily: font.mono }}>ZTEGC1234567</span>); it links as soon as SmartOLT lists it.
        </div>
      )}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label={o ? 'ONU serial number' : 'Serial number'}>
            <Input value={sn} onChange={(e) => setSn(e.target.value)} placeholder="ONU serial" style={{ minWidth: 240 }} />
          </Field>
          <Button variant="primary" onClick={saveSerial} disabled={!!busy || (!sn && !d.savedSerial)}>{busy === 'link' ? 'Saving…' : o ? 'Change ONU' : 'Link ONU'}</Button>
        </div>
      )}
    </div>
  );
}
