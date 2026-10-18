import React, { useCallback, useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Select, Stat, Table } from '../../ui/primitives';

/**
 * Router chaining monitor. On a hotspot the main router bridges the guest network and other routers (Tenda and the like) are plugged into its
 * Ethernet ports, or into each other, to extend the signal. Billing finds each one by its MAC on the bridge, adds it here by itself, and watches
 * it: present is up, two misses in a row is down and the owner is told (one message however many went down together).
 */
const KIND_LABEL = { router: 'Router', onu: 'ONU' };
const STATUS_TONE = { up: 'active', down: 'down', unknown: 'default' };
const FOUND = { high: { label: 'Found', tone: 'active' }, likely: { label: 'Check', tone: 'pending' }, manual: { label: 'Added by hand', tone: 'default' } };
const ago = (d) => {
  if (!d) return '—';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default function RouterChaining() {
  const store = useStore();
  const can = !!store.session?.perms?.['chaining.manage'];
  const [rows, setRows] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanRouter, setScanRouter] = useState('');
  const [adding, setAdding] = useState(null);
  const [show, setShow] = useState('watched');
  const [scans, setScans] = useState([]);
  const [seenId, setSeenId] = useState(null);      // the router whose last scan is shown below, port by port
  const routers = (store.routers ?? []).filter((r) => r.role === 'hotspot' || r.role === 'both' || !r.role);

  const load = useCallback(() => Promise.all([api.chainedRouters().then(setRows), api.chainingScans().then(setScans).catch(() => {})]).catch((e) => store.toast(`Could not load: ${e.message}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  // every minute, and every 3 seconds while a scan is running so its progress shows
  const anyRunning = scans.some((x) => x.running);
  useEffect(() => { load(); const t = setInterval(load, anyRunning ? 3000 : 60000); return () => clearInterval(t); }, [load, anyRunning]);
  useEffect(() => { if (!scanRouter && routers[0]) setScanRouter(routers[0].id); }, [routers, scanRouter]);

  // A scan runs in the background and can take minutes on a big router: start it, then watch its progress in the Routers table.
  const startScan = async (routerId) => {
    setScanning(true);
    try {
      const r = await api.scanChaining({ routerId });
      setSeenId(routerId);
      store.toast(r.started ? 'Scanning in the background. Its progress shows in the Routers table; you can leave this page.' : 'That router is already being scanned.');
    } catch (e) { store.toast(`Could not scan: ${e.message}`); } finally { setScanning(false); await load(); }
  };
  const scan = () => startScan(scanRouter);
  const change = async (c, body, done) => {
    try { await api.updateChainedRouter(c.id, body); await load(); if (done) store.toast(done); } catch (e) { store.toast(`Could not change: ${e.message}`); }
  };
  const rename = (c) => {
    const name = window.prompt('Name for this router (for example the shop or room it is in):', c.name || c.hostname || '');
    if (name !== null) change(c, { name }, 'Renamed');
  };
  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.name || c.mac} from the list? If it is still plugged in, it is found again on the next pass. Use Ignore to stop watching it.`)) return;
    try { await api.deleteChainedRouter(c.id); await load(); } catch (e) { store.toast(`Could not remove: ${e.message}`); }
  };
  const addManual = async () => {
    try { await api.addChainedRouter({ routerId: adding.routerId, mac: adding.mac, name: adding.name, kind: adding.kind }); setAdding(null); await load(); store.toast('Added. It is checked on the next pass.'); }
    catch (e) { store.toast(`Could not add: ${e.message}`); }
  };

  const seenRow = scans.find((x) => x.id === seenId);
  const seen = seenRow?.report ? { router: seenRow.name, routerId: seenRow.id, seen: seenRow.report.seen ?? [], hostsRead: seenRow.report.hostsRead ?? seenRow.hosts, hotspotOn: seenRow.report.hotspotOn } : null;
  const all = rows ?? [];
  const watched = all.filter((c) => !c.ignored);
  const shown = show === 'onu' ? watched.filter((c) => c.kind === 'onu') : show === 'router' ? watched.filter((c) => c.kind !== 'onu') : show === 'ignored' ? all.filter((c) => c.ignored) : show === 'down' ? watched.filter((c) => c.status === 'down') : show === 'check' ? watched.filter((c) => c.confidence === 'likely') : watched;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Grid min={190} gap={14}>
        <Stat label="Watched" value={rows ? watched.length : '…'} hint="chained routers" />
        <Stat label="Down" value={watched.filter((c) => c.status === 'down').length} tone={watched.some((c) => c.status === 'down') ? color.rust : undefined} hint="not answering" />
        <Stat label="To check" value={watched.filter((c) => c.confidence === 'likely').length} hint="found by behaviour, not by name" />
        <Stat label="Ignored" value={all.filter((c) => c.ignored).length} hint="not watched" />
      </Grid>

      <Card
        title="Router chaining"
        subtitle="Routers and fibre units (ONU/ONT of an xPON, GPON or EPON network) plugged into the hotspot's Ethernet ports are found by their MAC and watched. Nothing to set up: a new one appears here within a few minutes of being plugged in."
        actions={can && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select style={{ width: 180 }} value={scanRouter} onChange={(e) => setScanRouter(e.target.value)} options={routers.map((r) => ({ value: r.id, label: r.name }))} />
            <Button size="sm" onClick={scan} disabled={scanning || !scanRouter || scans.find((x) => x.id === scanRouter)?.running}>{scanning || scans.find((x) => x.id === scanRouter)?.running ? 'Scanning…' : 'Scan now'}</Button>
            <Button size="sm" onClick={() => setAdding({ routerId: scanRouter, mac: '', name: '', kind: 'router' })}>+ Add by MAC</Button>
          </div>
        )}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {[['watched', 'Watched'], ['router', 'Routers'], ['onu', 'ONUs'], ['down', 'Down'], ['check', 'To check'], ['ignored', 'Ignored']].map(([k, l]) => (
            <Button key={k} size="sm" variant={show === k ? 'primary' : 'default'} onClick={() => setShow(k)}>{l}</Button>
          ))}
        </div>
        <Table
          rowKey={(c) => c.id}
          empty={rows ? (show === 'watched' ? 'No chained routers found yet. They appear by themselves once a router is plugged into a hotspot port and a few devices connect through it.' : 'Nothing here.') : 'Loading…'}
          rows={shown}
          columns={[
            { key: 'name', label: 'Router', render: (c) => <span><b>{c.name || c.hostname || 'Unnamed router'}</b>{c.hostname && c.name ? <span style={{ color: color.muted }}> · {c.hostname}</span> : null}</span> },
            { key: 'kind', label: 'Type', render: (c) => <Badge>{KIND_LABEL[c.kind] ?? 'Router'}</Badge> },
            { key: 'mac', label: 'MAC', render: (c) => <span><span style={{ fontFamily: font.mono, fontSize: 12 }}>{c.mac}</span>{c.vendor ? <span style={{ color: color.muted, fontSize: 12 }}> · {c.vendor}</span> : null}</span> },
            { key: 'where', label: 'Plugged into', render: (c) => <span>{c.router_name}{c.port ? <span style={{ color: color.muted }}> · {c.port}</span> : null}</span> },
            { key: 'behind', label: 'Devices behind', render: (c) => c.behind || '—' },
            { key: 'ip', label: 'Address', render: (c) => (c.ip ? <span style={{ fontFamily: font.mono, fontSize: 12 }}>{c.ip}</span> : '—') },
            { key: 'status', label: 'State', render: (c) => (c.ignored ? <Badge>ignored</Badge> : <span><Badge tone={STATUS_TONE[c.status] ?? 'default'}>{c.status}</Badge>{c.note ? <div style={{ fontSize: 11.5, color: color.muted, marginTop: 3, maxWidth: 240 }}>{c.note}</div> : null}</span>) },
            { key: 'seen', label: 'Last seen', render: (c) => (c.status === 'down' && c.offline_since ? `down ${ago(c.offline_since)}` : ago(c.last_seen)) },
            { key: 'found', label: 'Found', render: (c) => <Badge tone={FOUND[c.confidence]?.tone}>{FOUND[c.confidence]?.label ?? c.confidence}</Badge> },
            { key: 'act', label: '', align: 'right', render: (c) => can && (
              <span style={{ display: 'inline-flex', gap: 6 }}>
                <Button size="sm" onClick={() => rename(c)}>Rename</Button>
                <Button size="sm" onClick={() => change(c, { ignored: !c.ignored }, c.ignored ? 'Watching it again' : 'Ignored: not watched and no alerts')}>{c.ignored ? 'Watch' : 'Ignore'}</Button>
                <Button size="sm" onClick={() => remove(c)}>Remove</Button>
              </span>
            ) },
          ]}
        />
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: color.muted }}>
          "Found" means the router named itself like one (Tenda, TP-Link…). "Check" means it was picked by behaviour: a router-looking device carrying a group of others on one port. If it is something else, press Ignore. Up means seen on the bridge or answering in the last 3 minutes. Two misses in a row mark it down and you get one message, however many went down together.
        </p>
      </Card>

      <Card title="Routers" subtitle="Every router is read every 2 minutes. If one shows no devices, its line here says why.">
        <Table
          rowKey={(x) => x.id}
          empty="No routers."
          rows={scans}
          columns={[
            { key: 'name', label: 'Router', render: (x) => <span><b>{x.name}</b><span style={{ color: color.muted }}> · {x.role}</span></span> },
            { key: 'status', label: 'State', render: (x) => <Badge tone={x.status === 'up' ? 'active' : 'down'}>{x.status}</Badge> },
            { key: 'devices', label: 'Chained devices', render: (x) => x.devices },
            { key: 'last', label: 'Last scan', render: (x) => (x.running ? <Badge tone="pending">scanning…</Badge> : (x.at ? ago(x.at) : 'not yet')) },
            { key: 'note', label: 'What it did', render: (x) => <span style={{ fontSize: 12.5, color: x.ok === false ? color.rust : color.inkSoft }}>{x.note || (x.at ? '' : 'Waiting for the next pass.')}</span> },
            { key: 'act', label: '', align: 'right', render: (x) => (
              <span style={{ display: 'inline-flex', gap: 6 }}>
                {x.report && <Button size="sm" onClick={() => setSeenId(x.id)}>What it saw</Button>}
                {can && <Button size="sm" onClick={() => startScan(x.id)} disabled={scanning || x.running}>{x.running ? 'Scanning…' : 'Scan now'}</Button>}
              </span>
            ) },
          ]}
        />
      </Card>

      {seen && (
        <Card title={`What the scan saw on ${seen.router}`} subtitle={`Read ${seen.hostsRead} device address${seen.hostsRead === 1 ? '' : 'es'} from the router's bridge. The hotspot runs on ${seen.hotspotOn?.length ? seen.hotspotOn.join(', ') : 'an interface billing could not read'}.`}>
          <Table
            rowKey={(x) => x.port}
            empty={seen.hostsRead === 0 ? "The router's bridge lists no devices. Either nothing is connected, or the hotspot is not on a bridge (then there is no table to read)." : 'Every device was on an uplink or a wireless port.'}
            rows={seen.seen ?? []}
            columns={[
              { key: 'port', label: 'Port', render: (x) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{x.port}</span> },
              { key: 'bridge', label: 'Bridge', render: (x) => x.bridge || '—' },
              { key: 'devices', label: 'Devices seen', render: (x) => x.devices },
              {
                key: 'verdict', label: 'Decided',
                render: (x) => (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <span style={{ color: x.router ? color.green : color.muted }}>{x.verdict}{x.router ? `: ${x.router}` : ''}</span>
                    {can && x.candidates?.length > 0 && (
                      <div style={{ display: 'grid', gap: 4 }}>
                        <span style={{ fontSize: 12, color: color.muted }}>Is one of these a router? Nothing here is added by itself.</span>
                        {x.candidates.map((d) => (
                          <div key={d.mac} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                            <span style={{ fontFamily: font.mono, fontSize: 12 }}>{d.mac}</span>
                            <span style={{ color: color.muted, flex: 1 }}>{[d.vendor, d.hostname, d.ip].filter(Boolean).join(' · ') || 'no name'}{d.note ? <span style={{ display: 'block', fontSize: 11.5, color: '#8a6d1d' }}>{d.note}</span> : null}</span>
                            {[['router', 'Add as router'], ['onu', 'Add as ONU']].map(([kind, text]) => (
                              <Button key={kind} size="sm" onClick={async () => {
                                try { await api.addChainedRouter({ routerId: seen.routerId, mac: d.mac, name: d.hostname || '', kind }); await load(); store.toast(`Added as ${kind === 'onu' ? 'an ONU' : 'a router'}. It is watched from the next pass.`); }
                                catch (e) { store.toast(`Could not add: ${e.message}`); }
                              }}>{text}</Button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        open={!!adding}
        title="Add a chained router by MAC"
        onClose={() => setAdding(null)}
        footer={<><Button onClick={() => setAdding(null)}>Cancel</Button><Button variant="primary" onClick={addManual} disabled={!adding?.mac?.trim()}>Add</Button></>}
      >
        {adding && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Plugged into router"><Select options={routers.map((r) => ({ value: r.id, label: r.name }))} value={adding.routerId} onChange={(e) => setAdding({ ...adding, routerId: e.target.value })} /></Field>
            <Field label="Type"><Select options={[{ value: 'router', label: 'Router or extender' }, { value: 'onu', label: 'Fibre unit (ONU/ONT)' }]} value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })} /></Field>
            <Field label="MAC address" hint="Printed on the label."><Input value={adding.mac} onChange={(e) => setAdding({ ...adding, mac: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" style={{ fontFamily: font.mono }} autoFocus /></Field>
            <Field label="Name"><Input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="Shop 4 extender" /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
