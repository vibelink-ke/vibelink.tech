import React, { useCallback, useEffect, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Empty, Field, Input, Modal, Screen, Table, Toggle } from '../ui/primitives';

/**
 * TR-069: customer routers and ONUs that call our own ACS directly (see backend/src/tr069.js and the
 * `genieacs`/`mongo` services in docker-compose), rather than through SmartOLT.
 *
 * A device is matched to a client by serial number — set under a client's page, or confirmed here once the
 * device has actually called in. Once matched, its WiFi name/password, PPPoE login, reboot and factory reset
 * can all be set from here, and it appears with its own status: last seen, WAN address, WiFi clients.
 */
const ago = (iso) => {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} d ago`;
};

function ClientPicker({ onPick }) {
  const store = useStore();
  const [q, setQ] = useState('');
  const matches = (store.clients ?? [])
    .filter((c) => !q.trim() || `${c.name} ${c.account_code} ${c.phone}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 12);
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name, account number or phone…" autoFocus />
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto', border: `1px solid ${color.line}`, borderRadius: 8 }}>
        {matches.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c)} style={{ textAlign: 'left', padding: '8px 10px', background: 'none', border: 0, borderTop: `1px solid ${color.line}`, cursor: 'pointer', color: color.ink, fontFamily: 'inherit', fontSize: 13 }}>
            <b>{c.name}</b> <span style={{ color: color.muted }}>· {c.account_code} · {c.phone}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Tr069() {
  const store = useStore();
  const canManage = !!store.session?.perms?.['tr069.manage'];
  const [devices, setDevices] = useState(null);
  const [unmatched, setUnmatched] = useState(null);
  const [err, setErr] = useState('');
  const [matching, setMatching] = useState(false);
  const [detail, setDetail] = useState(null);   // the device the drawer is open for
  const [busy, setBusy] = useState('');
  const [wifi, setWifiForm] = useState({ ssid: '', password: '', band5: false });
  const [ppp, setPpp] = useState({ username: '', password: '' });
  const [claiming, setClaiming] = useState(null);   // an unmatched device, while picking its client

  const load = useCallback(() => {
    setErr('');
    api.tr069Devices().then(setDevices).catch((e) => { setErr(e.message); setDevices([]); });
    if (canManage) api.tr069Unmatched().then(setUnmatched).catch(() => setUnmatched([]));
  }, [canManage]);
  useEffect(() => { load(); }, [load]);

  const matchNow = async () => {
    setMatching(true);
    try {
      const r = await api.tr069MatchNow();
      store.toast(r.linked ? `${r.linked} device(s) linked` : 'Nothing new to link');
      load();
    } catch (e) {
      store.toast(e.message);
    } finally {
      setMatching(false);
    }
  };

  const openDetail = (d) => {
    setDetail(d);
    setWifiForm({ ssid: d.ssid ?? '', password: '', band5: false });
    setPpp({ username: '', password: '' });
  };

  const doAction = async (fn, okMsg) => {
    setBusy('go');
    try {
      await fn();
      store.toast(okMsg);
      load();
    } catch (e) {
      store.toast(e.message);
    } finally {
      setBusy('');
    }
  };

  const saveWifi = () => {
    if (!wifi.ssid.trim() || wifi.password.length < 8) return store.toast('Give a WiFi name and a password of 8+ characters');
    doAction(() => api.tr069SetWifi(detail.id, wifi), 'WiFi sent to the device');
  };
  const savePppoe = () => {
    if (!ppp.username.trim()) return store.toast('Give the PPPoE username');
    doAction(() => api.tr069SetPppoe(detail.id, ppp), 'PPPoE login sent to the device');
  };
  const reboot = () => { if (window.confirm('Reboot this device now? It will drop offline for a minute or two.')) doAction(() => api.tr069Reboot(detail.id), 'Reboot sent'); };
  const factoryReset = () => { if (window.confirm('Factory reset this device? Everything on it — WiFi, PPPoE, everything — is wiped, and it may need re-linking afterwards.')) doAction(() => api.tr069FactoryReset(detail.id), 'Factory reset sent'); };
  const refresh = () => doAction(() => api.tr069Refresh(detail.id), 'Asked the device for its current status');

  const claim = async (subscriberId) => {
    try {
      await api.tr069Claim(claiming.genieacs_id, subscriberId);
      store.toast('Linked');
      setClaiming(null);
      load();
    } catch (e) {
      store.toast(e.message);
    }
  };

  return (
    <Screen
      title="TR-069 devices"
      subtitle="Customer routers and ONUs that call our own ACS directly — set their WiFi and PPPoE, reboot or factory-reset them, without anyone touching the device."
      actions={canManage ? <Button onClick={matchNow} disabled={matching}>{matching ? 'Matching…' : 'Match by serial'}</Button> : null}
    >
      {err && <div style={{ fontSize: 13, color: color.rust }}>{err}</div>}

      <Card title="Devices" subtitle="Linked to a client, by serial number">
        <Table
          rowKey={(d) => d.id}
          empty={devices === null ? 'Loading…' : 'No devices yet — set a client’s TR-069 serial, or link one waiting below'}
          rows={devices ?? []}
          columns={[
            { key: 'client', label: 'Client', render: (d) => d.subscriber_name ? <><b>{d.subscriber_name}</b> <span style={{ color: color.muted }}>· {d.account_code}</span></> : <span style={{ color: color.muted }}>Not linked</span> },
            { key: 'model', label: 'Device', render: (d) => `${d.manufacturer ?? ''} ${d.model_name ?? d.product_class ?? ''}`.trim() || '—' },
            { key: 'serial', label: 'Serial', render: (d) => <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>{d.serial_number ?? '—'}</span> },
            { key: 'wan', label: 'WAN IP', render: (d) => d.wan_ip ?? '—' },
            { key: 'ssid', label: 'WiFi name', render: (d) => d.ssid ?? '—' },
            { key: 'seen', label: 'Last seen', render: (d) => ago(d.last_inform) },
            { key: 'a', label: '', align: 'right', render: (d) => canManage && <span onClick={() => openDetail(d)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Manage</span> },
          ]}
        />
      </Card>

      {canManage && (
        <Card title="Waiting to be linked" subtitle="Devices the ACS has heard from that match no client's saved serial yet">
          {!unmatched ? <Empty>Loading…</Empty> : !unmatched.length ? <Empty>Nothing waiting</Empty> : (
            <Table
              rowKey={(d) => d.genieacs_id}
              rows={unmatched}
              columns={[
                { key: 'model', label: 'Device', render: (d) => `${d.manufacturer ?? ''} ${d.model_name ?? ''}`.trim() || '—' },
                { key: 'serial', label: 'Serial', render: (d) => <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>{d.serial_number ?? '—'}</span> },
                { key: 'seen', label: 'Last seen', render: (d) => ago(d.last_inform) },
                { key: 'a', label: '', align: 'right', render: (d) => <span onClick={() => setClaiming(d)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Link to a client</span> },
              ]}
            />
          )}
        </Card>
      )}

      <Modal open={!!claiming} title={claiming ? `Link ${claiming.serial_number ?? claiming.genieacs_id}` : ''} onClose={() => setClaiming(null)} width={480}>
        {claiming && <ClientPicker onPick={(c) => claim(c.id)} />}
      </Modal>

      <p style={{ fontSize: 12.5, color: color.muted }}>
        To have a device watched for automatically, save its serial number on the client's own page (Edit → TR-069 serial).
      </p>

      <Modal open={!!detail} title={detail ? `Manage ${detail.subscriber_name ?? detail.serial_number ?? 'device'}` : ''} onClose={() => !busy && setDetail(null)} width={620}>
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 12.5, color: color.muted, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>WAN {detail.wan_ip ?? '—'}</span>
              <span>{detail.connected_clients ?? '—'} WiFi client(s)</span>
              <span>Last seen {ago(detail.last_inform)}</span>
              <span>{detail.data_model ?? 'shape unknown'}</span>
              <span onClick={refresh} style={{ color: color.green, cursor: 'pointer', fontWeight: 600 }}>Refresh status</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>WiFi</span>
              <Field label="WiFi name"><Input value={wifi.ssid} onChange={(e) => setWifiForm((f) => ({ ...f, ssid: e.target.value }))} maxLength={32} /></Field>
              <Field label="WiFi password" hint="8 or more characters"><Input value={wifi.password} onChange={(e) => setWifiForm((f) => ({ ...f, password: e.target.value }))} /></Field>
              <Toggle checked={wifi.band5} onChange={(v) => setWifiForm((f) => ({ ...f, band5: v }))} label="Also set the 5 GHz WiFi" detail="Same password, name ends _5G — only if the device has one" />
              <div><Button variant="primary" onClick={saveWifi} disabled={!!busy}>Send WiFi to device</Button></div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${color.line}`, paddingTop: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>PPPoE</span>
              <Field label="Username"><Input value={ppp.username} onChange={(e) => setPpp((f) => ({ ...f, username: e.target.value }))} /></Field>
              <Field label="Password"><Input value={ppp.password} onChange={(e) => setPpp((f) => ({ ...f, password: e.target.value }))} /></Field>
              <div><Button onClick={savePppoe} disabled={!!busy}>Send PPPoE login to device</Button></div>
            </div>

            <div style={{ display: 'flex', gap: 10, borderTop: `1px solid ${color.line}`, paddingTop: 14 }}>
              <Button onClick={reboot} disabled={!!busy}>Reboot</Button>
              <Button onClick={factoryReset} disabled={!!busy} style={{ color: color.rust }}>Factory reset</Button>
            </div>
          </div>
        )}
      </Modal>

    </Screen>
  );
}
