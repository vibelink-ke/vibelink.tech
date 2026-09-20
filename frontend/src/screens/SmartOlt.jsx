import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Empty, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Tabs, Toggle } from '../ui/primitives';

/**
 * SmartOLT: the tenant's OLTs and ONUs, as SmartOLT reports them.
 *
 * Overview (how many are up, which OLTs, what needs attention), the ONU list (act on one, tie it to a
 * client), authorising new ONUs, and the connection (address, API key, automatic disable).
 * Everything shown is our copy of SmartOLT's data, refreshed in the background — the status line
 * says when, and "Sync now" asks for a fresh list.
 */

const STATUS = {
  online: { label: 'Online', tone: { bg: '#e2ebe5', fg: color.green } },
  offline: { label: 'Offline', tone: { bg: color.rustBg, fg: color.rust } },
  los: { label: 'LOS', tone: { bg: color.rustBg, fg: color.rust } },
  power_fail: { label: 'Power fail', tone: { bg: color.amberBg, fg: color.amberInk } },
};
const statusOf = (s) => STATUS[s] ?? { label: s || 'Unknown', tone: { bg: color.tileBg, fg: color.muted } };

const ago = (iso) => {
  if (!iso) return '—';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} d ago`;
};

/** GPON receive power: better than -25 is comfortable, worse than -27 is a fault waiting to happen. */
const signalColor = (dbm) => (dbm == null ? color.muted : dbm < -27 ? color.rust : dbm < -25 ? color.amberInk : color.green);

export function StatusBadge({ status }) {
  const s = statusOf(status);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const Signal = ({ dbm, cls }) => (
  dbm == null && !cls ? <span style={{ color: color.muted }}>—</span> : (
    <span style={{ fontFamily: font.mono, fontSize: 12.5, color: signalColor(dbm) }} title={cls ?? undefined}>
      {dbm != null ? `${dbm} dBm` : cls}
    </span>
  )
);

export default function SmartOlt() {
  const store = useStore();
  const navigate = useNavigate();
  const canManage = !!store.session?.perms?.['smartolt.manage'];
  const [tab, setTab] = useState('overview');
  const [st, setSt] = useState(null);

  const loadStatus = useCallback(() => api.smartoltStatus().then(setSt).catch(() => setSt({ configured: false })), []);
  useEffect(() => {
    loadStatus();
    const id = setInterval(() => { if (!document.hidden) loadStatus(); }, 60000);
    return () => clearInterval(id);
  }, [loadStatus]);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'onus', label: 'ONUs' },
    ...(canManage ? [{ id: 'authorise', label: 'Authorise' }, { id: 'connection', label: 'Connection' }] : []),
  ];

  if (st && !st.configured) {
    return (
      <Screen title="SmartOLT" subtitle="Connect your SmartOLT account to see and manage your fibre customers' ONUs here.">
        {canManage ? <Connection st={st} reload={loadStatus} /> : <Empty>SmartOLT is not connected yet. Ask the account owner to set it up.</Empty>}
      </Screen>
    );
  }

  return (
    <Screen
      title="SmartOLT"
      subtitle={st ? `${st.subdomain}.smartolt.com · ${st.onus ?? 0} ONUs · updated ${ago(st.last_statuses_at)}` : 'Loading…'}
    >
      {st?.last_error && (
        <div style={{ fontSize: 13, color: color.rust, background: color.rustBg, border: `1px solid ${color.rust}`, borderRadius: 8, padding: '10px 13px' }}>
          Last problem talking to SmartOLT ({ago(st.last_error_at)}): {st.last_error}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'overview' && <Overview navigate={navigate} />}
      {tab === 'onus' && <Onus canManage={canManage} navigate={navigate} />}
      {tab === 'authorise' && canManage && <Authorise />}
      {tab === 'connection' && canManage && <Connection st={st} reload={loadStatus} />}
    </Screen>
  );
}

// ── overview ────────────────────────────────────────────────────────────────

function Overview({ navigate }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    const load = () => api.smartoltOverview().then(setD).catch(() => {});
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(id);
  }, []);
  if (!d) return <Empty>Loading…</Empty>;
  const t = d.totals;
  const clientLink = (r) => (r.client_id ? <a onClick={() => navigate(`/clients/${r.client_id}`)} style={{ color: color.green, cursor: 'pointer', fontWeight: 600 }}>{r.client_name}</a> : <span style={{ color: color.muted }}>not linked</span>);
  return (
    <>
      {d.alerts.length > 0 && (
        <div style={{ fontSize: 13, color: color.rust, background: color.rustBg, border: `1px solid ${color.rust}`, borderRadius: 8, padding: '10px 13px', fontWeight: 600 }}>
          {d.alerts.length} outage{d.alerts.length === 1 ? '' : 's'} in progress — most ONUs are down on: {d.alerts.map((a) => a.key.replace(/^olt:|^pon:/, '')).join(' · ')}
        </div>
      )}
      <Grid min={150} gap={14}>
        <Stat label="ONUs" value={t.total} hint={`${t.unlinked} not linked to a client`} />
        <Stat label="Online" value={t.online} tone={color.green} hint={t.total ? `${Math.round((t.online / t.total) * 100)}%` : undefined} />
        <Stat label="Offline" value={t.offline} tone={t.offline ? color.rust : undefined} />
        <Stat label="LOS" value={t.los} tone={t.los ? color.rust : undefined} hint="no light — fibre or ONU" />
        <Stat label="Power fail" value={t.power_fail} tone={t.power_fail ? color.amberInk : undefined} />
        <Stat label="Weak signal" value={t.weak} tone={t.weak ? color.amberInk : undefined} hint="below -27 dBm" />
      </Grid>

      <Card title="OLTs" subtitle="From SmartOLT">
        <Table
          rowKey={(o) => o.olt_id}
          empty="No OLTs yet — press Sync now on the Connection tab"
          toolbar="never"
          rows={d.olts}
          columns={[
            { key: 'name', label: 'OLT', render: (o) => <span style={{ fontWeight: 600 }}>{o.name}</span> },
            { key: 'ip', label: 'Address', render: (o) => <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>{o.ip ?? '—'}</span> },
            { key: 'hardware', label: 'Model', render: (o) => o.hardware ?? '—' },
            { key: 'onus', label: 'ONUs', align: 'right' },
            { key: 'online', label: 'Online', align: 'right', render: (o) => <span style={{ color: o.onus && o.online / o.onus < 0.5 ? color.rust : undefined }}>{o.online}</span> },
          ]}
        />
      </Card>

      <Grid min={380} gap={14}>
        <Card title="Offline for over a day" subtitle="Worth a call or a visit">
          <Table
            rowKey={(r) => r.external_id}
            empty="Nothing has been down that long"
            toolbar="never"
            rows={d.longOffline}
            columns={[
              { key: 'name', label: 'ONU', render: (r) => <span style={{ fontWeight: 600 }}>{r.name ?? r.sn}</span> },
              { key: 'client', label: 'Client', render: clientLink },
              { key: 'status', label: 'State', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'since', label: 'Since', render: (r) => ago(r.offline_since) },
            ]}
          />
        </Card>
        <Card title="Weak signal" subtitle="Online, but with a poor light level">
          <Table
            rowKey={(r) => r.external_id}
            empty="No weak signals"
            toolbar="never"
            rows={d.weak}
            columns={[
              { key: 'name', label: 'ONU', render: (r) => <span style={{ fontWeight: 600 }}>{r.name ?? r.sn}</span> },
              { key: 'client', label: 'Client', render: clientLink },
              { key: 'sig', label: 'Signal', align: 'right', render: (r) => <Signal dbm={r.signal_dbm != null ? Number(r.signal_dbm) : null} cls={r.signal_class} /> },
              { key: 'dist', label: 'Distance', align: 'right', render: (r) => (r.distance_m != null ? `${Math.round(r.distance_m)} m` : '—') },
            ]}
          />
        </Card>
      </Grid>
    </>
  );
}

// ── ONUs ────────────────────────────────────────────────────────────────────

/** Pick a client by typing part of their name, account number or phone. */
function ClientPicker({ onPick }) {
  const store = useStore();
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return (store.clients ?? []).filter((c) => `${c.name} ${c.account_code} ${c.phone}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, store.clients]);
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name, account number or phone…" autoFocus />
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
        {matches.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c)} style={{ textAlign: 'left', padding: '8px 10px', background: 'none', border: 0, borderTop: `1px solid ${color.line}`, cursor: 'pointer', color: color.ink, fontFamily: 'inherit', fontSize: 13 }}>
            <b>{c.name}</b> <span style={{ color: color.muted }}>· {c.account_code} · {c.phone}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Onus({ canManage, navigate }) {
  const store = useStore();
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('all');
  const [olt, setOlt] = useState('all');
  const [busy, setBusy] = useState(null);
  const [linking, setLinking] = useState(null);

  const load = useCallback(() => api.smartoltOnus().then(setRows).catch(() => setRows([])), []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(id);
  }, [load]);

  const olts = useMemo(() => [...new Set((rows ?? []).map((r) => r.olt_name).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => (rows ?? []).filter((r) => {
    if (olt !== 'all' && r.olt_name !== olt) return false;
    if (status === 'all') return true;
    if (status === 'unlinked') return !r.client_id;
    if (status === 'disabled') return r.admin_status === 'disabled';
    if (status === 'weak') return r.signal_dbm != null && r.signal_dbm < -27;
    return r.status === status;
  }), [rows, status, olt]);

  const act = async (r, action) => {
    const words = { reboot: 'Reboot', disable: 'Disable', enable: 'Enable', resync: 'Re-send the configuration to' }[action];
    if ((action === 'reboot' || action === 'disable') && !window.confirm(`${words} ${r.name ?? r.sn}${r.client_name ? ` (${r.client_name})` : ''}?`)) return;
    setBusy(`${r.external_id}:${action}`);
    try {
      await api.smartoltOnuAction(r.external_id, action);
      store.toast(`${words} — sent`);
      load();
    } catch (e) {
      store.toast(`SmartOLT: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const link = async (client) => {
    try {
      await api.smartoltLinkOnu(linking.external_id, client ? client.id : null);
      setLinking(null);
      load();
      store.toast(client ? `Linked to ${client.name}` : 'Unlinked');
    } catch (e) {
      store.toast(e.message);
    }
  };

  if (!rows) return <Empty>Loading…</Empty>;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Field label="Show">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[
            { value: 'all', label: 'All ONUs' }, { value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' },
            { value: 'los', label: 'LOS' }, { value: 'power_fail', label: 'Power fail' }, { value: 'weak', label: 'Weak signal' },
            { value: 'disabled', label: 'Disabled' }, { value: 'unlinked', label: 'Not linked to a client' },
          ]} />
        </Field>
        <Field label="OLT">
          <Select value={olt} onChange={(e) => setOlt(e.target.value)} options={[{ value: 'all', label: 'All OLTs' }, ...olts.map((o) => ({ value: o, label: o }))]} />
        </Field>
      </div>
      <Card title="ONUs" subtitle={`${shown.length} of ${rows.length}`}>
        <Table
          rowKey={(r) => r.external_id}
          empty="No ONUs yet — press Sync now on the Connection tab"
          rows={shown}
          columns={[
            { key: 'name', label: 'ONU', render: (r) => (<div><span style={{ fontWeight: 600 }}>{r.name ?? '—'}</span><div style={{ fontFamily: font.mono, fontSize: 11.5, color: color.muted }}>{r.sn}</div></div>) },
            { key: 'where', label: 'OLT · port', render: (r) => <span style={{ fontSize: 12.5 }}>{r.olt_name ?? '—'}<span style={{ color: color.muted }}> · {r.board ?? '?'}/{r.port ?? '?'}{r.onu_no ? `/${r.onu_no}` : ''}</span></span> },
            { key: 'status', label: 'State', render: (r) => (<div><StatusBadge status={r.status} />{r.status !== 'online' && r.offline_since && <div style={{ fontSize: 11.5, color: color.muted }}>{ago(r.offline_since)}</div>}</div>) },
            { key: 'sig', label: 'Signal', align: 'right', render: (r) => <Signal dbm={r.signal_dbm} cls={r.signal_class} /> },
            { key: 'dist', label: 'Distance', align: 'right', render: (r) => (r.distance_m != null ? `${Math.round(r.distance_m)} m` : '—') },
            { key: 'client', label: 'Client', render: (r) => (r.client_id ? <a onClick={() => navigate(`/clients/${r.client_id}`)} style={{ color: color.green, cursor: 'pointer', fontWeight: 600 }}>{r.client_name}</a> : <span style={{ color: color.muted }}>not linked</span>) },
            { key: 'admin', label: 'Port', render: (r) => (r.admin_status === 'disabled' ? <Badge tone={{ bg: color.amberBg, fg: color.amberInk }}>{r.disabled_by_us ? 'off · unpaid' : 'disabled'}</Badge> : <span style={{ color: color.muted }}>on</span>) },
            ...(canManage ? [{
              key: 'act', label: '', align: 'right',
              render: (r) => (
                <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
                  <Button size="sm" disabled={!!busy} onClick={() => act(r, 'reboot')}>Reboot</Button>
                  <Button size="sm" disabled={!!busy} onClick={() => act(r, r.admin_status === 'disabled' ? 'enable' : 'disable')}>{r.admin_status === 'disabled' ? 'Enable' : 'Disable'}</Button>
                  <Button size="sm" onClick={() => setLinking(r)}>{r.client_id ? 'Change client' : 'Link client'}</Button>
                </span>
              ),
            }] : []),
          ]}
        />
      </Card>

      <Modal open={!!linking} title={linking ? `Client for ${linking.name ?? linking.sn}` : ''} onClose={() => setLinking(null)}
        footer={<>{linking?.client_id && <Button onClick={() => link(null)} style={{ color: color.rust }}>Unlink</Button>}<Button onClick={() => setLinking(null)}>Cancel</Button></>}>
        {linking && <ClientPicker onPick={link} />}
      </Modal>
    </>
  );
}

// ── authorise ───────────────────────────────────────────────────────────────

function Authorise() {
  const store = useStore();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState({ onu_types: [], zones: [], speed_profiles: [] });
  const [client, setClient] = useState(null);

  const load = useCallback(() => {
    setRows(null); setErr('');
    api.smartoltUnconfigured().then(setRows).catch((e) => { setErr(e.message); setRows([]); });
  }, []);
  useEffect(() => {
    load();
    ['onu_types', 'zones', 'speed_profiles'].forEach((w) => api.smartoltLookup(w).then((l) => setOpts((o) => ({ ...o, [w]: l }))).catch(() => {}));
  }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.smartoltAuthorize({ ...form, subscriberId: client?.id ?? null });
      store.toast(`${form.sn} authorised`);
      setForm(null); setClient(null);
      load();
    } catch (e) {
      store.toast(`SmartOLT: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const list = (id, items) => <datalist id={id}>{items.map((o) => <option key={`${o.id}-${o.name}`} value={o.name} />)}</datalist>;

  return (
    <>
      <Card title="Waiting to be authorised" subtitle="ONUs SmartOLT has discovered on your OLTs that are not configured yet" actions={<Button size="sm" onClick={load}>Refresh</Button>}>
        {err && <div style={{ fontSize: 13, color: color.rust, marginBottom: 10 }}>{err}</div>}
        {!rows ? <Empty>Asking SmartOLT…</Empty> : (
          <Table
            rowKey={(r, i) => `${r.sn}-${i}`}
            empty="Nothing is waiting — a newly plugged-in ONU shows up here"
            toolbar="never"
            rows={rows}
            columns={[
              { key: 'sn', label: 'Serial', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>{r.sn}</span> },
              { key: 'olt', label: 'OLT', render: (r) => r.olt_name ?? r.olt_id ?? '—' },
              { key: 'port', label: 'Board / port', render: (r) => `${r.board ?? '?'} / ${r.port ?? '?'}` },
              { key: 'type', label: 'Type', render: (r) => r.onu_type ?? '—' },
              { key: 'a', label: '', align: 'right', render: (r) => <Button size="sm" variant="primary" onClick={() => { setClient(null); setForm({ olt_id: r.olt_id, olt_name: r.olt_name, board: r.board ?? '', port: r.port ?? '', pon_type: r.pon_type || 'gpon', sn: r.sn, onu_type: r.onu_type ?? '', onu_mode: 'Routing', vlan: '', zone: '', name: '', address: '', upload_speed_profile: '', download_speed_profile: '' }); }}>Authorise</Button> },
            ]}
          />
        )}
      </Card>

      <Modal open={!!form} title={form ? `Authorise ${form.sn}` : ''} onClose={() => !busy && setForm(null)} width={620}
        footer={<><Button onClick={() => setForm(null)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Authorising…' : 'Authorise'}</Button></>}>
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {list('so-types', opts.onu_types)}{list('so-zones', opts.zones)}{list('so-speeds', opts.speed_profiles)}
            <Field label="Client" span={2} hint="Optional — the client this ONU belongs to">
              {client ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><b>{client.name}</b> <span style={{ color: color.muted }}>{client.account_code}</span><Button size="sm" onClick={() => setClient(null)}>Change</Button></div>
              ) : <ClientPicker onPick={setClient} />}
            </Field>
            <Field label="Name on SmartOLT" hint="Often the client's account number"><Input value={form.name} onChange={set('name')} placeholder={client?.account_code ?? ''} /></Field>
            <Field label="ONU type"><Input value={form.onu_type} onChange={set('onu_type')} list="so-types" /></Field>
            <Field label="Mode"><Select value={form.onu_mode} onChange={set('onu_mode')} options={['Routing', 'Bridging']} /></Field>
            <Field label="VLAN"><Input value={form.vlan} onChange={set('vlan')} /></Field>
            <Field label="Zone"><Input value={form.zone} onChange={set('zone')} list="so-zones" /></Field>
            <Field label="Address"><Input value={form.address} onChange={set('address')} /></Field>
            <Field label="Download speed profile"><Input value={form.download_speed_profile} onChange={set('download_speed_profile')} list="so-speeds" /></Field>
            <Field label="Upload speed profile"><Input value={form.upload_speed_profile} onChange={set('upload_speed_profile')} list="so-speeds" /></Field>
            <Field label="Board"><Input value={form.board} onChange={set('board')} /></Field>
            <Field label="Port"><Input value={form.port} onChange={set('port')} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}

// ── connection ──────────────────────────────────────────────────────────────

function Connection({ st, reload }) {
  const store = useStore();
  const [f, setF] = useState({ subdomain: st?.subdomain ?? '', apiKey: '', enabled: st?.enabled ?? true, autoDisable: !!st?.auto_disable });
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const run = async (what, fn, ok) => {
    setBusy(what); setResult(null);
    try { const r = await fn(); if (ok) ok(r); return r; } catch (e) { setResult({ error: e.message }); return null; } finally { setBusy(''); }
  };
  const test = () => run('test', () => api.smartoltTest({ subdomain: f.subdomain, apiKey: f.apiKey }), (r) => setResult({ ok: `Connected — ${r.olts} OLT${r.olts === 1 ? '' : 's'}${r.names?.length ? `: ${r.names.join(', ')}` : ''}`, shape: r.shape }));
  const save = async () => {
    const r = await run('save', () => api.saveSmartoltConfig(f));
    if (r) {
      store.toast('Saved');
      setF((x) => ({ ...x, apiKey: '' }));
      // the first list, straight away
      await run('sync', () => api.smartoltSync(), (s) => store.toast(`Loaded ${s.onus ?? 0} ONUs`));
      store.reload?.();
      reload();
    }
  };
  const sync = () => run('sync', () => api.smartoltSync(), (s) => { store.toast(`Loaded ${s.onus ?? 0} ONUs`); reload(); });
  const disconnect = async () => {
    if (!window.confirm('Disconnect SmartOLT? The saved ONU list is removed (nothing changes in SmartOLT itself).')) return;
    await run('del', () => api.deleteSmartoltConfig(), () => { store.reload?.(); reload(); });
  };

  return (
    <>
      <Card title="Connect SmartOLT" subtitle="In SmartOLT: Settings → API, copy the key. The address is the one you log in at.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <Field label="SmartOLT address" hint="e.g. yourcompany.smartolt.com"><Input value={f.subdomain} onChange={set('subdomain')} placeholder="yourcompany.smartolt.com" autoComplete="off" /></Field>
          <Field label="API key" hint={st?.key_last4 ? `Saved (ends ${st.key_last4}) — leave blank to keep it` : 'Stored encrypted, never shown again'}>
            <Input type="password" value={f.apiKey} onChange={set('apiKey')} placeholder={st?.key_last4 ? `••••••••${st.key_last4}` : ''} autoComplete="new-password" />
          </Field>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Toggle checked={f.enabled} onChange={(v) => setF((x) => ({ ...x, enabled: v }))} label="SmartOLT is on" detail="Off stops all syncing and hides the ONU tab and map layer" />
          <Toggle checked={f.autoDisable} onChange={(v) => setF((x) => ({ ...x, autoDisable: v }))} label="Disable the ONU of a client who has not paid"
            detail="An expired, suspended or paused client's ONU is disabled at the OLT, and enabled again when they are active. Only linked ONUs are touched, and only ones this switched off are switched back on." />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <Button onClick={test} disabled={!!busy || !f.subdomain}>{busy === 'test' ? 'Testing…' : 'Test connection'}</Button>
          <Button variant="primary" onClick={save} disabled={!!busy || !f.subdomain}>{busy === 'save' || busy === 'sync' ? 'Saving…' : 'Save'}</Button>
          {st?.configured && <Button onClick={sync} disabled={!!busy}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</Button>}
          {st?.configured && <Button onClick={disconnect} disabled={!!busy} style={{ color: color.rust }}>Disconnect</Button>}
        </div>
        {result?.error && <div style={{ marginTop: 10, fontSize: 13, color: color.rust }}>{result.error}</div>}
        {result?.ok && (
          <div style={{ marginTop: 10, fontSize: 13, color: color.green }}>
            {result.ok}
            {result.shape?.length > 0 && <div style={{ color: color.muted, fontSize: 12, marginTop: 4 }}>Fields SmartOLT returns for an OLT: {result.shape.join(', ')}</div>}
          </div>
        )}
      </Card>
      {st?.configured && (
        <Card title="Status">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, fontSize: 13 }}>
            <div><span style={{ color: color.muted }}>Statuses refreshed</span><br />{ago(st.last_statuses_at)} <span style={{ color: color.muted }}>(every 5 minutes)</span></div>
            <div><span style={{ color: color.muted }}>Full list refreshed</span><br />{ago(st.last_details_at)} <span style={{ color: color.muted }}>(every hour)</span></div>
            <div><span style={{ color: color.muted }}>ONUs</span><br />{st.onus} <span style={{ color: color.muted }}>({st.online} online)</span></div>
          </div>
        </Card>
      )}
    </>
  );
}
