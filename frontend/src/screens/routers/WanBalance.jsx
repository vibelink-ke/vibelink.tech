import React, { useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Field, Input, Modal, Select } from '../../ui/primitives';

/**
 * Internet links of one router: failover, or sharing the load with failover. The router is read when this opens, so the links it already
 * has are offered as a start. Nothing is written until Apply, and Apply is only offered after Check has shown what will change.
 */
export default function WanBalance({ router, onClose }) {
  const store = useStore();
  const [info, setInfo] = useState(null);       // what the router has, read when this opens
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('failover');
  const [links, setLinks] = useState([]);
  const [review, setReview] = useState(null);   // the answer to Check
  const [busy, setBusy] = useState(null);       // 'check' | 'apply' | 'remove'

  const load = async () => {
    setError(null); setInfo(null); setReview(null);
    try {
      const out = await api.routerWanLinks(router.id);
      setInfo(out);
      const start = out.saved?.links?.length ? out.saved.links : out.candidates;
      setMode(out.saved?.mode ?? 'failover');
      setLinks(start.map((l, i) => ({
        iface: l.iface ?? '', gateway: l.gateway ?? '', weight: String(l.weight ?? 1), probe: l.probe ?? out.probes[i] ?? '',
      })));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, [router.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Any change makes the last Check stale: Apply is only for what was checked.
  const change = (fn) => { setReview(null); fn(); };
  const setLink = (i, k, v) => change(() => setLinks((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l))));
  const move = (i, by) => change(() => setLinks((ls) => {
    const out = [...ls]; const j = i + by;
    if (j < 0 || j >= out.length) return ls;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }));
  const addLink = () => change(() => setLinks((ls) => {
    const used = new Set(ls.map((l) => l.probe));
    return [...ls, { iface: '', gateway: '', weight: '1', probe: (info?.probes ?? []).find((p) => !used.has(p)) ?? '' }];
  }));
  const body = () => ({ mode, links: links.map((l) => ({ ...l, weight: Number(l.weight) || 1 })) });

  const check = async () => {
    setBusy('check'); setError(null);
    try { setReview(await api.routerWanBalance(router.id, { ...body(), apply: false })); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };
  const apply = async () => {
    if (!window.confirm(`Apply this to ${router.name}?\n\nCustomers on this router may lose their connection for a few seconds while the routes change. If billing cannot reach the router afterwards, the router undoes it by itself within 5 minutes.`)) return;
    setBusy('apply'); setError(null);
    try {
      const out = await api.routerWanBalance(router.id, { ...body(), apply: true });
      store.toast(mode === 'balance' ? 'Load sharing is on' : 'Failover is on');
      await load();
      if (out.notes?.length) setError(out.notes.join(' '));
    } catch (e) {
      setError(e.message);
    } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove the link setup from ${router.name}?\n\nThe router goes back to the default route it had before. Customers may lose their connection for a few seconds.`)) return;
    setBusy('remove'); setError(null);
    try {
      const out = await api.removeRouterWanBalance(router.id);
      store.toast('Link setup removed');
      if (out.notes?.length) setError(out.notes.join(' '));
      await load();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(null); }
  };

  const ifaceOptions = [
    { value: '', label: 'Choose…' },
    ...(info?.interfaces ?? []).map((i) => ({
      value: i.name,
      label: `${i.name}${i.addresses?.length ? ` (${i.addresses[0]})` : ''}${i.running ? '' : ' · not running'}`,
    })),
  ];
  const on = info?.live?.active;
  const small = { fontSize: 12, color: color.muted, lineHeight: 1.5 };

  return (
    <Modal
      open
      width={760}
      title={`Internet links: ${router.name}`}
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          {on && <Button onClick={remove} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove'}</Button>}
          <Button onClick={onClose} disabled={!!busy}>Close</Button>
          <Button onClick={check} disabled={!!busy || !info || links.length < 2}>{busy === 'check' ? 'Checking…' : 'Check'}</Button>
          <Button variant="primary" onClick={apply} disabled={!!busy || !review || review.blockers?.length > 0}>
            {busy === 'apply' ? 'Applying… up to 2 minutes' : 'Apply'}
          </Button>
        </>
      )}
    >
      {error && <div style={{ fontSize: 13, color: color.rust, marginBottom: 10, lineHeight: 1.5 }}>{error}</div>}
      {!info && !error && <div style={small}>Reading the router's links…</div>}
      {info && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
            {on ? (
              <>
                <span style={{ fontWeight: 600 }}>{info.live.mode === 'balance' ? 'Load sharing is on.' : 'Failover is on.'}</span>
                {info.live.links.map((l) => (
                  <Badge key={l.n} tone={l.up ? 'up' : 'down'}>Link {l.n} {l.up ? 'up' : 'down'}</Badge>
                ))}
                <Button size="sm" onClick={load} disabled={!!busy}>Refresh</Button>
              </>
            ) : (
              <span style={small}>Not set up on this router. RouterOS {info.version}.</span>
            )}
          </div>

          {on && info.stats && (() => {
            const bytes = (n) => { const v = Number(n) || 0; if (v >= 1e12) return `${(v / 1e12).toFixed(2)} TB`; if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`; if (v >= 1e6) return `${(v / 1e6).toFixed(0)} MB`; return `${(v / 1e3).toFixed(0)} KB`; };
            const speed = (b) => (b == null ? '—' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} Mbps` : `${(b / 1e3).toFixed(0)} kbps`);
            const both = (rx, tx) => `${bytes(rx)} ↓ ${bytes(tx)} ↑`;
            const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };
            const saved = info.saved?.links ?? [];
            const total30 = info.stats.usage.reduce((n, u) => n + u.rx_30 + u.tx_30, 0);
            const cell = { padding: '6px 8px', borderTop: `1px solid ${color.line}`, fontSize: 12.5, whiteSpace: 'nowrap' };
            const head = { padding: '4px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: color.muted, textAlign: 'left' };
            return (
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Statistics</div>
                {!info.stats.state && <div style={small}>The first reading is taken within 2 minutes of applying. Open this again after that.</div>}
                {info.stats.state && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead><tr>{['Link', 'State', 'Speed now', 'Today', '7 days', '30 days', 'Share', 'Outages, 30 days'].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                      <tbody>
                        {saved.map((l, i) => {
                          const s = info.stats.state.links.find((x) => x.n === i + 1);
                          const u = info.stats.usage.find((x) => x.iface === l.iface) ?? {};
                          const o = info.stats.outages[i + 1];
                          return (
                            <tr key={l.iface}>
                              <td style={cell}><b>{i + 1}</b> {l.iface}</td>
                              <td style={cell}>{s ? `${s.up ? 'Up' : 'Down'} for ${ago(s.since)}` : '—'}</td>
                              <td style={{ ...cell, fontFamily: font.mono }}>{s ? `${speed(s.rxBps)} ↓ ${speed(s.txBps)} ↑` : '—'}</td>
                              <td style={{ ...cell, fontFamily: font.mono }}>{both(u.rx_today, u.tx_today)}</td>
                              <td style={{ ...cell, fontFamily: font.mono }}>{both(u.rx_7, u.tx_7)}</td>
                              <td style={{ ...cell, fontFamily: font.mono }}>{both(u.rx_30, u.tx_30)}</td>
                              <td style={{ ...cell, fontFamily: font.mono }}>{total30 ? `${Math.round((((u.rx_30 ?? 0) + (u.tx_30 ?? 0)) / total30) * 100)}%` : '—'}</td>
                              <td style={cell}>{o?.count ? `${o.count}, ${o.minutes >= 120 ? `${(o.minutes / 60).toFixed(1)} h` : `${o.minutes} min`} down` : 'None'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {info.stats.recent.length > 0 && (
                  <div style={{ ...small, marginTop: 8 }}>
                    {info.stats.recent.slice(0, 6).map((e) => (
                      <div key={`${e.at}${e.link}`}>{new Date(e.at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: link {e.link} ({e.iface}) {e.up ? 'came back' : 'went down'}</div>
                    ))}
                  </div>
                )}
                <div style={{ ...small, marginTop: 6 }}>Read from the router every 2 minutes. When a link goes down or comes back, the alert goes to the same phone as the router-offline alert.</div>
              </div>
            );
          })()}
          <Field label="What the links are for">
            <Select
              value={mode}
              onChange={(e) => change(() => setMode(e.target.value))}
              options={[
                { value: 'failover', label: 'Failover only: use link 1, switch to the next when it stops' },
                { value: 'balance', label: 'Share the load across the links, and leave out a link that stops' },
              ]}
            />
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {links.map((l, i) => (
              <div key={i} style={{ border: `1px solid ${color.line}`, borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                    Link {i + 1}{i === 0 ? (mode === 'failover' ? ' (main)' : ' (also carries the tunnel to billing)') : ''}
                  </span>
                  <Button size="sm" onClick={() => move(i, -1)} disabled={i === 0 || !!busy}>Up</Button>
                  <Button size="sm" onClick={() => move(i, 1)} disabled={i === links.length - 1 || !!busy}>Down</Button>
                  <Button size="sm" onClick={() => change(() => setLinks((ls) => ls.filter((_, n) => n !== i)))} disabled={!!busy}>Remove link</Button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: mode === 'balance' ? '1.4fr 1.2fr .6fr 1.1fr' : '1.4fr 1.2fr 1.1fr', gap: 10 }}>
                  <Field label="Interface">
                    <Select value={l.iface} onChange={(e) => setLink(i, 'iface', e.target.value)} options={ifaceOptions} />
                  </Field>
                  <Field label="Gateway" hint="From the provider. For a PPPoE uplink, its interface name">
                    <Input value={l.gateway} onChange={(e) => setLink(i, 'gateway', e.target.value)} placeholder="e.g. 41.90.1.1" style={{ fontFamily: font.mono }} />
                  </Field>
                  {mode === 'balance' && (
                    <Field label="Share" hint="1 to 10">
                      <Input type="number" min="1" max="10" value={l.weight} onChange={(e) => setLink(i, 'weight', e.target.value)} />
                    </Field>
                  )}
                  <Field label="Test address" hint="Pinged through this link only">
                    <Input value={l.probe} onChange={(e) => setLink(i, 'probe', e.target.value)} style={{ fontFamily: font.mono }} />
                  </Field>
                </div>
              </div>
            ))}
            {links.length < 4 && <div><Button onClick={addLink} disabled={!!busy}>Add a link</Button></div>}
            {mode === 'balance' && (
              <div style={small}>
                Share is the size of each link compared with the others: for a 100 Mbps link and a 50 Mbps link, enter 2 and 1.
              </div>
            )}
          </div>

          {review && (
            <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
              {review.blockers?.map((b) => <div key={b} style={{ color: color.rust }}>Cannot apply: {b}</div>)}
              {!review.blockers?.length && (
                <>
                  <div style={{ fontWeight: 600 }}>What Apply will do</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{review.plan?.map((p) => <li key={p}>{p}</li>)}</ul>
                </>
              )}
              {review.warnings?.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, color: color.amberInk }}>Before you apply</div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: color.amberInk }}>{review.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
