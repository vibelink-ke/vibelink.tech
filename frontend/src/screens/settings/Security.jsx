import React, { useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Modal, Textarea, Toggle } from '../../ui/primitives';

/**
 * Anti-tunnel hardening. Two things: what the hotspot routers do to stop guests getting out without paying (the choices are applied to every
 * hotspot router the next time it is configured, which saving here triggers), and who may reach a router's own management services.
 */
const CHOICES = [
  { key: 'dns', label: 'Stop DNS tunnels', detail: 'Guests must be allowed to look up names (or the login popup never appears), so "free internet" apps hide traffic inside those lookups. Very long lookups are dropped and each guest gets a sensible rate.' },
  { key: 'icmp', label: 'Stop ping tunnels', detail: 'Pings to the router are limited to small, few ones, so nothing can ride inside them.' },
  { key: 'ipv6', label: 'Close IPv6 for guests', detail: 'The hotspot only polices IPv4: an IPv6 address on the guest network would walk straight past the paywall.' },
  {
    key: 'sni', label: 'Check website names before payment',
    detail: 'Before paying, a guest may only open the sites in the walled garden. Those share addresses with the rest of the internet (Cloudflare), so a tunnel app can ask for any other site on the same address. With this on, only connections that name an allowed site get through. Test a purchase on a phone after switching it on; it needs a recent RouterOS and is skipped on routers that cannot do it.',
    warn: true,
  },
  { key: 'vpnPorts', label: 'Block VPN and proxy ports for guests', detail: 'Closes the usual VPN and proxy ports and protocols (OpenVPN, WireGuard, L2TP, PPTP, IPsec, SOCKS, Shadowsocks, Tor). A VPN running over the ordinary web port (443) looks like any website and cannot be stopped this way.', warn: true },
];

export default function Security() {
  const store = useStore();
  const [data, setData] = useState(null);
  const [options, setOptions] = useState({});
  const [cidrs, setCidrs] = useState('');
  const [busy, setBusy] = useState(false);
  const [look, setLook] = useState(null);       // { router, plan, allow, applied, busy, error }

  useEffect(() => {
    api.antiTunnel().then((d) => { setData(d); setOptions(d.options); setCidrs((d.adminCidrs ?? []).join('\n')); })
      .catch((e) => store.toast(`Could not load: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const out = await api.saveAntiTunnel({ options, adminCidrs: cidrs.split(/[\s,]+/).filter(Boolean) });
      setData((d) => ({ ...d, options: out.options, adminCidrs: out.adminCidrs }));
      store.toast('Saved. Every hotspot router is being updated now.');
    } catch (e) { store.toast(`Could not save: ${e.message}`); } finally { setBusy(false); }
  };

  const hotspotRouters = store.routers ?? [];
  const check = async (router) => {
    setLook({ router, busy: true });
    try { setLook({ router, busy: false, ...(await api.routerManagement(router.id, { apply: false })) }); }
    catch (e) { setLook({ router, busy: false, error: e.message }); }
  };
  const lock = async () => {
    setLook((l) => ({ ...l, busy: true, error: null }));
    try { const r = await api.routerManagement(look.router.id, { apply: true }); setLook({ router: look.router, busy: false, ...r }); }
    catch (e) { setLook((l) => ({ ...l, busy: false, error: e.message })); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card
        title="Getting out without paying"
        subtitle="What every hotspot router does to stop guests tunnelling out before they have a bundle"
        actions={<Button variant="primary" onClick={save} disabled={busy || !data}>{busy ? 'Saving…' : 'Save and apply'}</Button>}
      >
        {!data ? <div style={{ fontSize: 13, color: color.muted }}>Loading…</div> : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {CHOICES.map((c) => (
              <div key={c.key} style={{ borderBottom: `1px solid ${color.line}` }}>
                <Toggle checked={!!options[c.key]} onChange={(v) => setOptions((o) => ({ ...o, [c.key]: v }))} label={c.label} detail={c.detail} />
              </div>
            ))}
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: color.muted }}>
              Only rules marked "ispAntiTunnel" are ever added or removed on a router, and switching a choice off removes its rules again. Nothing else on the router is touched.
            </p>
          </div>
        )}
      </Card>

      <Card
        title="Router management access"
        subtitle="Who may reach a router's own API, Winbox and SSH. Everyone else is shut out, and telnet, ftp and the router's web pages are switched off."
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: color.inkSoft }}>
            Always allowed: the tunnel to billing{data?.tunnel ? <> (<span style={{ fontFamily: font.mono }}>{data.tunnel}</span>)</> : ''}. Add your own office or home addresses below, one per line, if you reach routers directly (for example <span style={{ fontFamily: font.mono }}>41.90.1.5</span> or <span style={{ fontFamily: font.mono }}>41.90.1.0/24</span>). Save them with the button above first.
          </div>
          <Textarea rows={3} value={cidrs} onChange={(e) => setCidrs(e.target.value)} placeholder="41.90.1.5" style={{ fontFamily: font.mono, fontSize: 12.5 }} />
          <div style={{ fontSize: 12.5, color: color.muted }}>
            Closing a router is safe to try: it undoes itself after 5 minutes unless billing gets back in through the new rules and confirms. Press Check first to see exactly what would change.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {hotspotRouters.length === 0 && <span style={{ fontSize: 13, color: color.muted }}>No routers yet.</span>}
            {hotspotRouters.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderTop: `1px solid ${color.line}`, paddingTop: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name} <Badge tone={r.status === 'up' ? 'active' : 'default'}>{r.status ?? '—'}</Badge></span>
                <Button size="sm" onClick={() => check(r)} disabled={r.status !== 'up'} title={r.status === 'up' ? '' : 'The router must be up'}>Check</Button>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Modal
        open={!!look}
        title={`Management access: ${look?.router?.name ?? ''}`}
        onClose={() => setLook(null)}
        footer={
          <>
            <Button onClick={() => setLook(null)}>{look?.applied ? 'Close' : 'Cancel'}</Button>
            {look?.plan && !look.applied && (
              <Button variant="primary" onClick={lock} disabled={look.busy}>{look.busy ? 'Working…' : 'Close it to everyone else'}</Button>
            )}
          </>
        }
      >
        {look?.busy && !look.plan && <p>Reading the router…</p>}
        {look?.error && <p style={{ color: color.rust }}>{look.error}</p>}
        {look?.plan && (
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              {look.applied
                ? <>Done. Only <b>{look.allow.join(', ')}</b> can reach this router's management services now, and billing got back in, so the safety undo was cancelled.</>
                : <>Only <b>{look.allow.join(', ')}</b> would be allowed. The router undoes this by itself after 5 minutes unless billing gets back in.</>}
            </p>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', color: color.muted }}><th>Service</th><th>Now</th><th>After</th></tr></thead>
              <tbody>
                {look.plan.map((p) => (
                  <tr key={p.name} style={{ borderTop: `1px solid ${color.line}` }}>
                    <td style={{ fontFamily: font.mono }}>{p.name}{p.port ? `:${p.port}` : ''}</td>
                    <td>{p.wasDisabled ? 'off' : (p.wasAddress || 'anyone')}</td>
                    <td style={{ color: p.changes ? color.ink : color.muted, fontWeight: p.changes ? 600 : 400 }}>{p.willDisable ? 'off' : p.willAddress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
