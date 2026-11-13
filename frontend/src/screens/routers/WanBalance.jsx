import React, { useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Field, Input, Modal, Select } from '../../ui/primitives';

const TYPES = [
  { value: 'pppoe', label: 'PPPoE (username and password)' },
  { value: 'dhcp', label: 'DHCP (automatic address)' },
  { value: 'static', label: 'Static (fixed address)' },
];

/**
 * Internet links of one router: sharing the load with failover, or failover only. Each link is PPPoE, DHCP or static, and can be one the
 * router already has or one this sets up. The router is read when this opens, so the links it already has are offered as a start.
 * Nothing is written until Apply, and Apply is only offered after Check has shown what will change.
 */
export default function WanBalance({ router, onClose }) {
  const store = useStore();
  const [info, setInfo] = useState(null);       // what the router has, read when this opens
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('balance');
  const [protect, setProtect] = useState(true);
  const [sticky, setSticky] = useState('customer');
  const [hold, setHold] = useState('3');        // minutes a returning link must stay steady before it is used again
  const [pins, setPins] = useState([]);         // traffic that always uses one link
  const [links, setLinks] = useState([]);
  const [review, setReview] = useState(null);   // the answer to Check
  const [busy, setBusy] = useState(null);       // 'check' | 'apply' | 'remove'

  const blankLink = (probe = '', probe2 = '') => ({ type: 'pppoe', iface: '', address: '', gateway: '', user: '', password: '', weight: '1', mbps: '', probe, probe2 });

  const load = async () => {
    setError(null); setInfo(null); setReview(null);
    try {
      const out = await api.routerWanLinks(router.id);
      setInfo(out);
      const start = out.saved?.links?.length ? out.saved.links : out.candidates;
      setMode(out.saved?.mode ?? 'balance');
      setProtect(out.saved ? out.saved.protect !== false : true);
      setSticky(out.saved?.sticky === 'pair' ? 'pair' : 'customer');
      setHold(String(out.saved?.hold ?? 3));
      setPins((out.saved?.pins ?? []).map((x) => ({ ...x, link: String(x.link) })));
      const filled = start.map((l, i) => ({
        ...blankLink(), ...l, password: '', weight: String(l.weight ?? 1), mbps: l.mbps ? String(l.mbps) : '', probe: l.probe ?? out.probes[i] ?? '',
        probe2: l.probe2 ?? out.probes2?.[i] ?? '',
      }));
      setLinks(!out.saved && filled.length === 1 ? [...filled, blankLink(out.probes[1] ?? '', out.probes2?.[1] ?? '')] : filled);
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
    const used = new Set(ls.flatMap((l) => [l.probe, l.probe2]));
    return [...ls, blankLink((info?.probes ?? []).find((p) => !used.has(p)) ?? '', (info?.probes2 ?? []).find((p) => !used.has(p)) ?? '')];
  }));
  const body = () => ({ mode, protect, sticky, hold: hold === '' ? 3 : Number(hold), pins: pins.map((x) => ({ ...x, link: Number(x.link) || 0 })), links: links.map((l) => ({ ...l, weight: Number(l.weight) || 1, mbps: Number(l.mbps) || null })) });

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
    if (!window.confirm(`Remove the link setup from ${router.name}?\n\nThe router goes back to the default route it had before, and any link this set up for you (a PPPoE or DHCP client, an address) is taken off again. Customers may lose their connection for a few seconds.`)) return;
    setBusy('remove'); setError(null);
    try {
      const out = await api.removeRouterWanBalance(router.id);
      store.toast('Link setup removed');
      await load();
      if (out.notes?.length) setError(out.notes.join(' '));
    } catch (e) {
      setError(e.message);
    } finally { setBusy(null); }
  };

  const portOptions = [
    { value: '', label: 'Choose…' },
    ...(info?.interfaces ?? []).map((i) => ({
      value: i.name,
      label: `${i.name}${i.addresses?.length ? ` (${i.addresses[0]})` : ''}${i.running ? '' : ' · nothing plugged in'}`,
    })),
  ];
  // What the router already has on a port, so the form can say "already there" instead of asking for it again.
  const existing = (l) => (info?.candidates ?? []).find((c) => c.iface === l.iface && c.type === l.type);
  const on = info?.live?.active;
  const small = { fontSize: 12, color: color.muted, lineHeight: 1.5 };

  return (
    <Modal
      open
      width={780}
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
                  <Badge key={l.n} tone={l.up ? 'up' : l.held ? 'pending' : 'down'}>Link {l.n} {l.up ? 'up' : l.held ? 'held back until steady' : 'down'}</Badge>
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
                          const name = l.out ?? l.iface;
                          const s = info.stats.state.links.find((x) => x.n === i + 1);
                          const u = info.stats.usage.find((x) => x.iface === name) ?? {};
                          const o = info.stats.outages[i + 1];
                          return (
                            <tr key={name}>
                              <td style={cell}><b>{i + 1}</b> {name}</td>
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
                { value: 'balance', label: 'Use all the links together, and leave out a link that stops' },
                { value: 'failover', label: 'Failover only: use link 1, switch to the next when it stops' },
              ]}
            />
          </Field>

          {mode === 'balance' && (
            <Field label="How a customer's traffic is spread" hint="The first keeps banks, games and streaming from seeing a customer's address change. The second fills the links more evenly.">
              <Select
                value={sticky}
                onChange={(e) => change(() => setSticky(e.target.value))}
                options={[
                  { value: 'customer', label: 'Each customer stays on one link (recommended)' },
                  { value: 'pair', label: "One customer's different sites may use different links" },
                ]}
              />
            </Field>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {links.map((l, i) => {
              const have = existing(l);
              return (
                <div key={i} style={{ border: `1px solid ${color.line}`, borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                      Link {i + 1}{i === 0 ? (mode === 'failover' ? ' (main)' : ' (also carries the tunnel to billing)') : ''}
                      {have && <span style={{ ...small, fontWeight: 400 }}> · in use on the router now</span>}
                    </span>
                    <Button size="sm" onClick={() => move(i, -1)} disabled={i === 0 || !!busy}>Up</Button>
                    <Button size="sm" onClick={() => move(i, 1)} disabled={i === links.length - 1 || !!busy}>Down</Button>
                    <Button size="sm" onClick={() => change(() => setLinks((ls) => ls.filter((_, n) => n !== i)))} disabled={!!busy}>Remove link</Button>
                  </div>
                  {have && !l.edit && (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 260px', fontSize: 13, lineHeight: 1.5 }}>
                        {l.type === 'pppoe' ? `PPPoE on ${l.iface}${l.user ? `, user ${l.user}` : ''}`
                          : l.type === 'dhcp' ? `DHCP on ${l.iface}`
                            : `Static on ${l.iface}${l.address ? `, address ${l.address}` : ''}, gateway ${l.gateway}`}
                        <div style={small}>Read from the router. It is used as it is; nothing about it is changed.</div>
                      </div>
                      {mode === 'balance' && (
                        <div style={{ flex: '0 0 170px' }}>
                          <Field label="Speed (Mbps)" hint="What this link carries">
                            <Input type="number" min="1" value={l.mbps} onChange={(e) => setLink(i, 'mbps', e.target.value)} placeholder="e.g. 100" />
                          </Field>
                        </div>
                      )}
                      <Button size="sm" onClick={() => setLink(i, 'edit', true)} disabled={!!busy}>Change details</Button>
                    </div>
                  )}
                  {(!have || l.edit) && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                    <Field label="Kind">
                      <Select value={l.type} onChange={(e) => setLink(i, 'type', e.target.value)} options={TYPES} />
                    </Field>
                    <Field label="Port" hint="Where the provider's cable is plugged in">
                      <Select value={l.iface} onChange={(e) => setLink(i, 'iface', e.target.value)} options={portOptions} />
                    </Field>
                    {l.type === 'pppoe' && (
                      <>
                        <Field label="PPPoE username">
                          <Input value={l.user} onChange={(e) => setLink(i, 'user', e.target.value)} autoComplete="off" />
                        </Field>
                        <Field label="PPPoE password" hint={have ? 'Leave empty to keep the one on the router' : 'Sent to the router only, never stored here'}>
                          <Input type="password" value={l.password} onChange={(e) => setLink(i, 'password', e.target.value)} autoComplete="new-password" />
                        </Field>
                      </>
                    )}
                    {l.type === 'static' && (
                      <>
                        <Field label="Address" hint={have ? 'Already on the port' : "The router's own, with its size"}>
                          <Input value={l.address} onChange={(e) => setLink(i, 'address', e.target.value)} placeholder="e.g. 41.90.1.2/30" style={{ fontFamily: font.mono }} />
                        </Field>
                        <Field label="Gateway" hint="The provider's side">
                          <Input value={l.gateway} onChange={(e) => setLink(i, 'gateway', e.target.value)} placeholder="e.g. 41.90.1.1" style={{ fontFamily: font.mono }} />
                        </Field>
                      </>
                    )}
                    {mode === 'balance' && (
                      <Field label="Speed (Mbps)" hint="What the provider sells you on this link">
                        <Input type="number" min="1" value={l.mbps} onChange={(e) => setLink(i, 'mbps', e.target.value)} placeholder="e.g. 100" />
                      </Field>
                    )}
                    <Field label="Test address" hint="Pinged through this link only">
                      <Input value={l.probe} onChange={(e) => setLink(i, 'probe', e.target.value)} style={{ fontFamily: font.mono }} />
                    </Field>
                    <Field label="Second test address" hint="The link is down only when both stop. Empty for one">
                      <Input value={l.probe2} onChange={(e) => setLink(i, 'probe2', e.target.value)} style={{ fontFamily: font.mono }} />
                    </Field>
                  </div>
                  )}
                  {l.type === 'dhcp' && (!have || l.edit) && <div style={{ ...small, marginTop: 6 }}>Nothing to type: the provider's side hands out the address and the gateway.</div>}
                </div>
              );
            })}
            {!on && info.candidates.length === 0 && (
              <div style={{ fontSize: 13, color: color.amberInk, lineHeight: 1.5 }}>
                The link this router is using now could not be recognised. Fill it in as link 1 yourself, with the same port and details the router has, and the new link as link 2.
              </div>
            )}
            {links.length < 4 && <div><Button onClick={addLink} disabled={!!busy}>Add a link</Button></div>}
            {mode === 'balance' && (
              <div style={small}>
                Enter each link's speed and traffic is split to match, so both fill up together: a 200 Mbps link gets twice the connections of a 100 Mbps one. Leave the speeds empty to split evenly.
              </div>
            )}
          </div>

          <div style={{ maxWidth: 360 }}>
            <Field label="Wait before using a link that came back (minutes)" hint="The link must answer steadily for this long first, so a link that keeps blinking is left out. 0 uses it again at once.">
              <Input type="number" min="0" max="30" value={hold} onChange={(e) => change(() => setHold(e.target.value))} />
            </Field>
          </div>

          {mode === 'balance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Traffic that always uses one link</div>
              <div style={small}>For a customer with a public address, a VoIP provider, or a bank that only accepts one of your addresses. If that link is down, the traffic uses another link until it is back.</div>
              {pins.map((x, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr auto', gap: 8, alignItems: 'center' }}>
                  <Select
                    value={x.match}
                    onChange={(e) => change(() => setPins((ps) => ps.map((y, n) => (n === i ? { ...y, match: e.target.value } : y))))}
                    options={[{ value: 'customer', label: "A customer's address" }, { value: 'site', label: "A site's address" }]}
                  />
                  <Input
                    value={x.address}
                    onChange={(e) => change(() => setPins((ps) => ps.map((y, n) => (n === i ? { ...y, address: e.target.value } : y))))}
                    placeholder="10.5.0.20 or 41.90.64.0/24"
                    style={{ fontFamily: font.mono }}
                  />
                  <Select
                    value={x.link}
                    onChange={(e) => change(() => setPins((ps) => ps.map((y, n) => (n === i ? { ...y, link: e.target.value } : y))))}
                    options={links.map((_, n) => ({ value: String(n + 1), label: `Link ${n + 1}` }))}
                  />
                  <Button size="sm" onClick={() => change(() => setPins((ps) => ps.filter((_, n) => n !== i)))} disabled={!!busy}>Remove</Button>
                </div>
              ))}
              <div><Button onClick={() => change(() => setPins((ps) => [...ps, { match: 'customer', address: '', link: '1' }]))} disabled={!!busy || pins.length >= 40}>Add fixed traffic</Button></div>
            </div>
          )}

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={protect} onChange={(e) => change(() => setProtect(e.target.checked))} style={{ marginTop: 3 }} />
            <span>
              Close the router to the internet on these links
              <div style={small}>New connections from the internet to the router itself are refused, except ping. Customers' traffic, billing and Winbox (VPN) are not affected. The rules that keep open connections working on every link are added either way.</div>
            </span>
          </label>

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
