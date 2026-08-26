import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Stat, Table, Textarea } from '../ui/primitives';

// No secret here. The server mints one when the field arrives empty, and
// Configure pushes it to the router, so nobody types or even sees it during
// onboarding. It stays readable under Edit for manual setups.
const blankRouter = () => ({
  name: '', host: '', secret: '', apiPort: '8728', role: 'both',
});

// Traffic dialog's own table styles — referenced by the per-port table below
// but never actually defined, so opening Traffic and letting a poll fill in
// `ports` threw "th is not defined" the moment that table tried to render,
// which React's error boundary caught by discarding the whole screen rather
// than just the dialog.
const th = {
  textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 600,
  letterSpacing: '.04em', textTransform: 'uppercase', color: color.muted,
  borderBottom: `1px solid ${color.line}`,
};
const td = { padding: '6px 8px', borderBottom: `1px solid ${color.line}` };

/** Bits per second in the units an operator reads, not raw digits. */
const bitrate = (bps) => {
  const n = Number(bps) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} Mbps`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kbps`;
  return `${n} bps`;
};

/**
 * The router row's own actions menu. Seven buttons (Hotspot, Refresh,
 * Traffic, Import, Edit, Check RADIUS, Check hotspot) used to sit side by
 * side on every row regardless of how many routers a tenant had — fine for
 * one router, unreadable for a real deployment with a dozen. Configure and
 * Delete stay outside it: one is the action a new or failed router actually
 * needs first, the other is destructive enough to want its own target
 * separate from a list that opens and closes.
 *
 * Rendered through a portal into document.body rather than as a child of the
 * button, and positioned in `position: fixed` from the button's own
 * getBoundingClientRect(). The table it lives in scrolls horizontally inside
 * its own "scroll-x" container (`overflow-x: auto`), and CSS computes an
 * unset overflow-y as auto the moment its sibling axis is anything but
 * visible — there is no such thing as scrollable on one axis and genuinely
 * visible on the other. So this menu, as a child of that container, was
 * being clipped by it the instant it opened near the bottom or right edge of
 * the table: it existed, it just had nowhere visible to draw itself. A
 * portal escapes that ancestor entirely.
 */
function ActionMenu({ open, anchorRect, menuRef, onToggle, children }) {
  const menuWidth = 184;
  // Clamping `top` to the viewport bottom stopped the menu from starting past
  // the edge, but did nothing about it still opening *downward* from there —
  // a row with little room below it (a tenant with only a router or two, so
  // the table sits low on the page with no scroll to speak of) got a menu
  // whose seven items rendered mostly below the fold. Flip upward instead
  // whenever there is more room above the button than below it; either way,
  // maxHeight + its own scroll is the backstop for a viewport too short for
  // the full list regardless of which side it opens on.
  const spaceBelow = open && anchorRect ? window.innerHeight - anchorRect.bottom : 0;
  const spaceAbove = open && anchorRect ? anchorRect.top : 0;
  const openUpward = open && anchorRect && spaceBelow < 260 && spaceAbove > spaceBelow;
  return (
    <div style={{ display: 'inline-block' }}>
      <Button onClick={onToggle}>Actions ▾</Button>
      {open && anchorRect && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - 8)),
            ...(openUpward
              ? { bottom: window.innerHeight - anchorRect.top + 4, maxHeight: anchorRect.top - 12 }
              : { top: anchorRect.bottom + 4, maxHeight: window.innerHeight - anchorRect.bottom - 12 }),
            overflowY: 'auto',
            zIndex: 1000,
            background: '#fff', border: `1px solid ${color.line}`, borderRadius: radius.md,
            boxShadow: '0 10px 28px rgba(20,26,23,.16)', width: menuWidth, padding: 6,
            display: 'grid', gap: 1,
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}

function MenuItem({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0,
        borderRadius: radius.sm ?? 6, padding: '8px 10px', fontSize: 13, color: color.ink ?? '#161a17',
        cursor: 'pointer', font: 'inherit',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f6f3'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
    >
      {children}
    </button>
  );
}

/**
 * Winbox into your own router directly, over the same tunnel it already
 * dials into — a real VPN peer for your own laptop, not a proxy through the
 * billing server. Reaches only this tenant's own routers; see
 * POST /api/routers/vpn-access for what actually enforces that.
 */
function WinboxAccess({ store }) {
  const [peers, setPeers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Hidden by default: this list carries staff names and tunnel addresses,
  // which is not something to leave sitting open on a screen someone else
  // might glance at (a shared screen, a demo, a support call).
  const [visible, setVisible] = useState(false);

  const load = useCallback(async () => {
    try { setPeers(await api.vpnAccessList()); } catch { /* shown as empty */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await api.vpnAccessCreate({});
      const blob = new Blob([res.config], { type: 'application/x-openvpn-profile' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = res.filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      store.toast(`Downloaded — import into any OpenVPN client, then Winbox to a router's tunnel address (${res.yourAddress} is yours on the tunnel)`);
      load();
    } catch (e) {
      store.toast(`Could not create a VPN peer: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (p) => {
    if (!window.confirm(`Revoke ${p.staff_name ?? p.username}'s Winbox access? Any current connection drops within a few minutes.`)) return;
    try {
      await api.vpnAccessRevoke(p.id);
      store.toast('Revoked');
      load();
    } catch (e) {
      store.toast(`Could not revoke: ${e.message}`);
    }
  };

  return (
    <Card
      title="Winbox access"
      actions={
        <>
          <Button onClick={() => setVisible((v) => !v)}>{visible ? 'Hide' : `Show${peers.length ? ` (${peers.length})` : ''}`}</Button>
          <Button variant="primary" onClick={generate} disabled={busy}>{busy ? 'Generating…' : '+ Generate .ovpn'}</Button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: color.muted }}>
        A VPN profile for your own laptop, over the same tunnel your routers already use. Import it into
        any OpenVPN client, connect, then open Winbox pointed at a router's tunnel address — it only
        reaches your own routers, nothing else on the platform.
      </p>
      {!visible ? (
        <p style={{ fontSize: 12.5, color: color.muted }}>
          {peers.length ? `${peers.length} peer${peers.length === 1 ? '' : 's'} issued — hidden.` : 'No Winbox access issued yet.'}
        </p>
      ) : peers.length === 0 ? (
        <p style={{ fontSize: 12.5, color: color.muted }}>No Winbox access issued yet.</p>
      ) : (
        <Table
          rowKey={(p) => p.id}
          rows={peers}
          columns={[
            { key: 'staff_name', label: 'Issued to', render: (p) => p.staff_name ?? '—' },
            { key: 'username', label: 'Peer', render: (p) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{p.username}</span> },
            { key: 'ip', label: 'Address', render: (p) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{p.ip}</span> },
            { key: 'connected_at', label: 'Last connected', render: (p) => (p.connected_at ? new Date(p.connected_at).toLocaleString('en-KE') : 'never') },
            { key: 'actions', label: '', align: 'right', render: (p) => <Button onClick={() => revoke(p)}>Revoke</Button> },
          ]}
        />
      )}
    </Card>
  );
}

// A handshake this stale means the tunnel is down, not just quiet — the
// mikrotikScript sets persistent-keepalive=25s, so a live peer re-handshakes
// at least that often even carrying no real traffic.
const WG_STALE_MINUTES = 3;

/**
 * Per-peer connectivity, filled in from the actual protocol rather than
 * inferred: last_handshake/rx_bytes/tx_bytes come from `wg show` inside the
 * wireguard container itself (see jobs.js's pollWireguardStatus) — a peer
 * existing in the database has never meant its key reached the live
 * interface, only that this side minted one.
 */
function WireguardPeers({ store }) {
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setPeers(await api.wgPeers()); } catch { /* shown as empty */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!window.confirm(`Remove the WireGuard peer "${p.name}"? Its router loses the tunnel until re-onboarded.`)) return;
    try {
      await api.deleteWgPeer(p.id);
      store.toast('Peer removed');
      load();
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    }
  };

  if (!loading && peers.length === 0) return null;

  return (
    <Card title="WireGuard peers" actions={<Button onClick={load}>Refresh</Button>}>
      <Table
        rowKey={(p) => p.id}
        rows={peers}
        columns={[
          { key: 'name', label: 'Peer', render: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span> },
          { key: 'router_name', label: 'Router', render: (p) => p.router_name ?? <span style={{ color: color.muted }}>Unassigned</span> },
          { key: 'assigned_ip', label: 'Address', render: (p) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{String(p.assigned_ip).split('/')[0]}</span> },
          {
            key: 'status',
            label: 'Status',
            render: (p) => {
              const mins = p.last_handshake ? (Date.now() - new Date(p.last_handshake)) / 60000 : Infinity;
              const up = mins <= WG_STALE_MINUTES;
              return (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: up ? color.green : color.rust }}>
                  {up ? 'Connected' : p.last_handshake ? 'Disconnected' : 'Never connected'}
                </span>
              );
            },
          },
          {
            key: 'last_handshake', label: 'Last handshake',
            render: (p) => (p.last_handshake ? new Date(p.last_handshake).toLocaleString('en-KE') : 'never'),
          },
          {
            key: 'traffic', label: 'Traffic', align: 'right',
            render: (p) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>
              {formatBytes(p.rx_bytes)} ↓ / {formatBytes(p.tx_bytes)} ↑
            </span>,
          },
          { key: 'actions', label: '', align: 'right', render: (p) => <Button onClick={() => remove(p)}>Remove</Button> },
        ]}
      />
    </Card>
  );
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(1)} GB`;
}

export default function Routers() {
  const store = useStore();
  const [ovpn, setOvpn] = useState(null); // { script, nasIp, username, defaultApiPort }
  const [form, setForm] = useState(null); // blankRouter() when the confirm modal is open
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);         // the router row open for editing
  const [menuFor, setMenuFor] = useState(null);   // router id whose Actions menu is open
  const [menuRect, setMenuRect] = useState(null); // that menu's toggle button, at the moment it opened
  const menuNodeRef = useRef(null);               // the portal's own DOM node, for the outside-click check
  const [configuring, setConfiguring] = useState(null);   // router id being pushed to
  const [adminPrompt, setAdminPrompt] = useState(null);   // first-run credentials
  const [plan, setPlan] = useState(null);                 // ports read back, awaiting choices
  const [result, setResult] = useState(null);             // outcome of the last push
  const [showSecret, setShowSecret] = useState(false);
  // Asked before minting: RouterOS 6 and 7 need different cipher names. The
  // address is filled in from the deployment rather than typed.
  const [dial, setDial] = useState({ open: false, routerosVersion: '7', serverHost: '' });
  const [detected, setDetected] = useState(null);   // { serverHost, detected, port }
  // What OpenVPN says is actually connected, which is the only reliable answer.
  const [tunnels, setTunnels] = useState({ tunnels: [], stale: [] });

  // Closes whichever row's Actions menu is open on any click outside it. The
  // menu itself is portalled to document.body, so it is not a DOM descendant
  // of anything in the table — checking menuNodeRef.current directly is what
  // tells a click on a menu item apart from a click genuinely elsewhere.
  //
  // The listener is attached a tick late, on purpose. Confirmed by logging
  // it directly: the very click that opens the menu (onToggle sets menuFor)
  // was itself being caught by this same effect before the click had finished
  // dispatching, closing the menu in the same gesture that opened it — open
  // and close, one user action apart from zero, indistinguishable from the
  // button doing nothing at all. Registering via setTimeout(…, 0) pushes the
  // addEventListener call to the next macrotask, after the opening click has
  // fully finished bubbling, so it can only ever catch a later, separate click.
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (e) => {
      if (menuNodeRef.current?.contains(e.target)) return;
      setMenuFor(null);
    };
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [menuFor]);

  // Prefill the dial address when the dialog opens. The server knows it — either
  // from OVPN_PUBLIC_HOST / ROOT_DOMAIN, or from the hostname this page arrived
  // on, which by definition resolves to the server from outside.
  const openDialog = useCallback(async () => {
    setDial((d) => ({ ...d, open: true }));
    try {
      const info = await api.tunnelInfo();
      setDetected(info);
      setDial((d) => (d.serverHost ? d : { ...d, serverHost: info.serverHost }));
    } catch {
      // Not fatal — the field is still editable.
    }
  }, []);

  const routers = store.routers ?? [];
  const up = routers.filter((r) => r.status === 'up').length;
  const down = routers.filter((r) => r.status === 'down').length;

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const mintScript = async () => {
    if (!dial.serverHost.trim())
      return store.toast('Enter the address this router should dial');
    setBusy(true);
    try {
      const res = await api.ovpnScript(dial);
      setOvpn(res);
      setDial((d) => ({ ...d, open: false }));
    } catch (e) {
      store.toast(`Could not mint the OVPN script: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The other tunnel, which this screen has been recommending without offering.
   *
   * The subtitle has said "use WireGuard on RouterOS 7" since the beginning and
   * there was no button for it, so every router went onto OVPN including the
   * ones that should not have. It matters more than a preference: OpenVPN here
   * is TCP, single-threaded in RouterOS, and rebuilds a TLS session from scratch
   * every time the path blinks. WireGuard is in-kernel and stateless — a
   * changed address or a NAT timeout costs one keepalive rather than a redial,
   * which is exactly the failure filling the tunnel log.
   *
   * The private key is generated on the router's side of the exchange and shown
   * once. We keep only the public key, so a lost script means a new peer rather
   * than a recovered one — said plainly in the dialog.
   */
  const mintWireguard = async () => {
    const name = window.prompt('Name this router (for the peer list)');
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const res = await api.wgPeer({ name: name.trim() });
      setOvpn({
        kind: 'wireguard',
        script: res.script,
        username: name.trim(),
        nasIp: res.assignedIp,
        defaultApiPort: 8728,
      });
      setDial((d) => ({ ...d, open: false }));
    } catch (e) {
      store.toast(`Could not mint the WireGuard peer: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * WireGuard as the preferred transport, OVPN as a router-decided standby —
   * see wireguard.js's failoverScript for why the switch has to happen on
   * the router rather than here: this side cannot tell "this router's
   * WireGuard is down" from "this router is down", only the router itself
   * knows which transport last actually worked.
   */
  const mintFailover = async () => {
    const name = window.prompt('Name this router (for the peer list)');
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const res = await api.failoverScript({ name: name.trim() });
      setOvpn({
        kind: 'failover',
        script: res.script,
        username: res.ovpnUsername,
        nasIp: res.assignedIp,
        defaultApiPort: 8728,
      });
      setDial((d) => ({ ...d, open: false }));
    } catch (e) {
      store.toast(`Could not set up WireGuard/OVPN failover: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(ovpn.script);
      store.toast('Script copied — paste it into the MikroTik terminal');
    } catch {
      store.toast('Copy failed — select the text and copy manually');
    }
  };

  const downloadScript = () => {
    const blob = new Blob([ovpn.script], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ovpn.username.replace(/[^\w.-]+/g, '-')}.rsc`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // There is no Test CoA button any more. CoA is an optimisation — without it a
  // new speed applies at the subscriber's next reconnect rather than instantly —
  // and Configure switches it on anyway, so a button that mostly reported
  // "no answer" only made a working router look broken. POST
  // /api/routers/:id/test-coa still exists for diagnosis.

  /**
   * Step one of Configure: log in and read the ports, so the operator can say
   * which are LAN before anything is changed. Nothing is written yet.
   *
   * The admin login is only needed the first time — the server creates its own
   * account from it and uses that thereafter, so an operator changing their own
   * password does not quietly break every later push.
   */
  const openConfigure = async (r, creds) => {
    setConfiguring(r.id);
    try {
      const info = await api.routerInterfaces(r.id, creds ?? {});
      setAdminPrompt(null);
      setPlan({
        router: r,
        creds: creds ?? {},
        lan: info.lan ?? [],
        bridges: info.bridges ?? [],
        version: info.version,
        identity: info.identity,
        // Nothing preselected: bridging a port that carries the uplink would take
        // the site off the internet, and only the operator knows which that is.
        selected: [],
        bridge: (info.bridges ?? [])[0]?.name ?? 'bridge-lan',
      });
    } catch (e) {
      if (e.status === 428) setAdminPrompt({ router: r, username: 'admin', password: '' });
      else store.toast(`${r.name}: ${e.message}`);
    } finally {
      setConfiguring(null);
    }
  };

  /**
   * Apply the configuration, and say what happened.
   *
   * A toast was not enough: the push takes several seconds against a router over
   * a tunnel, and a dialog that simply closed left no way to tell "it worked"
   * from "nothing happened". The result stays on screen until dismissed, listing
   * each step, and offers to run again.
   */
  const loadTunnels = useCallback(() => {
    api.routerTunnels().then(setTunnels).catch(() => {});
  }, []);

  useEffect(() => { loadTunnels(); }, [loadTunnels]);

  /**
   * Adopt the address a router is really dialling in on.
   *
   * The alternative was retyping it into Edit, which is how the two got out of
   * step in the first place.
   */
  const adoptAddress = async (router, address) => {
    try {
      const updated = await api.updateRouter(router.id, { host: address });
      store.setCollection('routers', (rs) => rs.map((x) => (x.id === router.id ? updated : x)));
      store.toast(`${router.name} now points at ${address}`);
      loadTunnels();
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    }
  };

  /**
   * Live throughput, polled while the panel is open.
   *
   * Every poll is a fresh connection to the router, so closing the panel stops
   * the load entirely — no socket left behind when a tab is closed or a laptop
   * is shut. Five seconds is slow enough not to punish a rural link and fast
   * enough that plugging a cable in shows up while you are still holding it.
   */
  const [traffic, setTraffic] = useState(null);   // { router, ports, error, at }

  useEffect(() => {
    if (!traffic?.router) return undefined;
    let live = true;
    const tick = async () => {
      try {
        const out = await api.routerTraffic(traffic.router.id);
        if (live) setTraffic((t) => (t?.router?.id === traffic.router.id
          ? { ...t, ports: out.ports, at: out.at, error: null } : t));
      } catch (e) {
        if (live) setTraffic((t) => (t?.router?.id === traffic.router.id
          ? { ...t, error: e.message } : t));
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { live = false; clearInterval(id); };
  }, [traffic?.router?.id]);

  /**
   * Import the router's own PPPoE accounts.
   *
   * Preview first, always. Creating several hundred customers is not something
   * to do on a misclick, and the operator needs to see how many are new, how
   * many already exist, and which cannot come across before agreeing to it.
   */
  const [importing, setImporting] = useState(null);   // { router, preview, result, busy }

  const previewImport = async (r) => {
    setImporting({ router: r, busy: true });
    try {
      const preview = await api.previewSecrets(r.id);
      setImporting({ router: r, preview, busy: false });
    } catch (e) {
      setImporting({ router: r, error: e.message, busy: false });
    }
  };

  const applyImport = async () => {
    setImporting((i) => ({ ...i, busy: true }));
    try {
      const result = await api.importSecrets(importing.router.id);
      setImporting((i) => ({ ...i, result, busy: false }));
      store.setCollection('clients', await api.subscribers());
      store.toast(`Imported ${result.imported} client(s)`);
    } catch (e) {
      setImporting((i) => ({ ...i, error: e.message, busy: false }));
    }
  };

  /**
   * Close the result dialog once a push has succeeded.
   *
   * Only on success, and only after a pause long enough to read the summary.
   * A failure stays until dismissed: it names the step that broke and is the
   * one thing worth keeping on screen. Closing that automatically would hide
   * the only explanation the operator gets.
   */
  useEffect(() => {
    if (result?.state !== 'ok') return undefined;
    // Two and a half seconds: long enough to read "configured" and see the
    // list, short enough that it does not feel like waiting on the app.
    const id = setTimeout(() => setResult(null), 2500);
    return () => clearTimeout(id);
  }, [result?.state, result?.router?.id]);

  const runAutoconfig = async (r, opts) => {
    setConfiguring(r.id);
    // The port picker has served its purpose the moment Apply is pressed, and
    // leaving it up stacks two dialogs: a dead form on top, the live progress
    // behind it. The result dialog takes over from here and reports running,
    // succeeded or failed.
    //
    // Safe to discard the selection: if the push stops to ask for the admin
    // password, that path reopens Configure, which reads the ports again.
    setPlan(null);
    setResult({ router: r, state: 'running', opts });
    try {
      const res = await api.autoconfigRouter(r.id, opts ?? {});
      setAdminPrompt(null);
      setResult({ router: r, state: 'ok', applied: res.applied ?? [], version: res.version, opts });
      store.setCollection('routers', (rs) =>
        rs.map((x) => (x.id === r.id
          ? { ...x, autoconfig_last_ok: true, autoconfig_last_at: new Date().toISOString(), ros_version: res.version }
          : x)));
    } catch (e) {
      // 428 is the server saying it has no account yet and needs one from you.
      if (e.status === 428) {
        setResult(null);
        setAdminPrompt({ router: r, username: 'admin', password: '' });
      } else {
        // Whatever it managed before failing is worth showing — it says how far
        // it got, which is the difference between "wrong password" and "wrong port".
        setResult({ router: r, state: 'failed', error: e.message, applied: e.body?.applied ?? [], opts });
        store.setCollection('routers', (rs) =>
          rs.map((x) => (x.id === r.id ? { ...x, autoconfig_last_ok: false } : x)));
      }
    } finally {
      setConfiguring(null);
    }
  };

  /**
   * Push the hotspot, separately from Configure.
   *
   * Its own button because the two are wanted at different moments: a PPPoE
   * tower is set up once and left alone, while a hotspot site gets pushed,
   * checked, and pushed again after a plan changes. Sharing one button meant
   * re-sending PPPoE just to fix a captive portal.
   *
   * Reuses the same result dialog, so "it is working" and "it failed at the
   * firewall" look the same wherever they came from.
   */
  const runHotspot = async (r, opts) => {
    setConfiguring(r.id);
    setResult({ router: r, state: 'running', hotspot: true, opts });
    try {
      const res = await api.pushHotspot(r.id, opts ?? {});
      setAdminPrompt(null);
      setResult({ router: r, state: 'ok', hotspot: true, applied: res.applied ?? [], opts });
      store.setCollection('routers', (rs) =>
        rs.map((x) => (x.id === r.id
          ? { ...x, autoconfig_last_ok: true, autoconfig_last_at: new Date().toISOString() }
          : x)));
    } catch (e) {
      if (e.status === 428) {
        setResult(null);
        setAdminPrompt({ router: r, username: 'admin', password: '', hotspot: true });
      } else {
        setResult({ router: r, state: 'failed', hotspot: true, error: e.message,
                    applied: e.body?.applied ?? [], opts });
      }
    } finally {
      setConfiguring(null);
    }
  };

  /**
   * Read the router's RADIUS settings back and compare them with ours.
   *
   * "RADIUS is not working" is not something anyone can act on. This turns it
   * into a specific wrong value — or confirms both ends agree, which points the
   * search somewhere else entirely.
   */
  const [radiusReport, setRadiusReport] = useState(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const checkRadius = async (r) => {
    setRadiusReport({ router: r, kind: 'RADIUS', state: 'running' });
    try {
      const res = await api.radiusCheck(r.id);
      setRadiusReport({ router: r, kind: 'RADIUS', state: 'done', ...res });
    } catch (e) {
      setRadiusReport({ router: r, kind: 'RADIUS', state: 'done', error: e.message, ...(e.body ?? {}) });
    }
  };

  /**
   * Why the captive portal is not appearing.
   *
   * Shares the report dialog with Check RADIUS, because the shape of the
   * answer is the same: a list of things that must all be true, with the ones
   * that are not explained. "The login page does not pop" has half a dozen
   * causes that look identical from a guest's phone, and every one of them is
   * readable on the router.
   */
  const checkHotspot = async (r) => {
    setRadiusReport({ router: r, kind: 'Hotspot', state: 'running' });
    try {
      const res = await api.hotspotCheck(r.id);
      setRadiusReport({ router: r, kind: 'Hotspot', state: 'done', ...res });
    } catch (e) {
      setRadiusReport({ router: r, kind: 'Hotspot', state: 'done', error: e.message, ...(e.body ?? {}) });
    }
  };

  /** Re-send the same configuration. Safe by design: pushes update, not duplicate. */
  const rerun = (r) => {
    const last = result?.opts ?? {};
    runAutoconfig(r, last);
  };

  const saveEdit = async () => {
    if (!edit.name?.trim() || !edit.host?.trim())
      return store.toast('Nickname and NAS address are both required');
    setBusy(true);
    try {
      const updated = await api.updateRouter(edit.id, {
        name: edit.name, host: edit.host, secret: edit.secret,
        apiPort: Number(edit.apiPort) || undefined, role: edit.role,
      });
      store.setCollection('routers', (rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      store.toast(`${updated.name} updated`);
      setEdit(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Deleting a router strands any subscriber pointing at it, so the server
  // refuses while any remain and says how many.
  const removeRouter = async (r, force = false) => {
    if (!force && !window.confirm(`Delete ${r.name}? Its tunnel credentials are revoked and ${r.host} is freed for reuse.`))
      return;
    try {
      const res = await api.deleteRouter(r.id, force);
      store.setCollection('routers', (rs) => rs.filter((x) => x.id !== r.id));
      // The server revoked the matching tunnel credential too; drop it here so the
      // count and the list agree without a reload.
      store.setCollection('ovpnClients', (cs) =>
        cs.filter((c) => String(c.assigned_ip).split('/')[0] !== String(r.host).split('/')[0]));
      store.toast(res.detached
        ? `${r.name} deleted — ${res.freed ?? r.host} freed, ${res.detached} customer(s) detached`
        : `${r.name} deleted — ${res.freed ?? r.host} is free again`);
    } catch (e) {
      // The server refuses while customers are attached, but offers a way
      // through rather than leaving the operator stuck — which is what blocked
      // clearing duplicate rows for one physical router.
      if (e.body?.canForce) {
        const n = e.body.subscribers;
        if (window.confirm(
          `${e.message}

Delete anyway? ${n} customer${n === 1 ? '' : 's'} stay, but lose their router. `
          + 'They keep working and keep their speed; only mid-session speed changes wait for a reconnect '
          + 'until you give them another router.'
        )) {
          return removeRouter(r, true);
        }
        return;
      }
      store.toast(e.message);
    }
  };

  /**
   * Minting a script allocates an address and a credential straight away, so
   * abandoning the flow halfway leaves one behind holding an address. Deleting a
   * router clears its own, but never these — nothing links them to a router.
   */
  const revokeTunnel = async (c) => {
    // The last line of defence. The label already says it, but Revoke is one
    // click and the consequence is a router nobody can reach.
    if (c.connectedNow && !window.confirm(
      `${c.username} is carrying a live tunnel on ${String(c.assigned_ip).split('/')[0]} right now.

Revoking it disconnects that router, and it cannot be reconfigured remotely
afterwards — somebody has to go to the site with the new script.

Revoke anyway?`
    )) return;

    // Said fully, because revoking alone fixes nothing and makes things worse
    // until the second half is done: the router keeps retrying the dead
    // credential every few seconds and stays off the tunnel meanwhile.
    if (!window.confirm(
      `Revoke ${c.username}?

`
      + `The router using it goes offline and keeps retrying every few seconds until you `
      + `press "+ Onboard via OVPN" and paste the new script into it. ${c.assigned_ip} is freed.`
    )) return;
    try {
      const res = await api.revokeOvpnClient(c.id);
      store.setCollection('ovpnClients', (cs) => cs.filter((x) => x.id !== c.id));
      store.toast(`${c.username} revoked — ${res.freed} is free again`);
    } catch (e) {
      store.toast(e.message);
    }
  };

  const confirmRouter = async () => {
    if (!form.name.trim() || !form.host.trim())
      return store.toast('Nickname and NAS address are both required');
    setBusy(true);
    try {
      const created = await api.createRouter({
        name: form.name,
        host: form.host,
        secret: form.secret,
        apiPort: Number(form.apiPort) || 8728,
        role: form.role,
      });
      store.setCollection('routers', (rs) => [...rs, created]);
      store.toast(`${created.name} onboarded`);
      setForm(null);
      setOvpn(null);
    } catch (e) {
      store.toast(`Could not add the router: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Routers"
      subtitle="MikroTiks reach us over a tunnel, so you need no port-forwarding and no static public IP. Use WireGuard on RouterOS 7; RouterOS 6 has no WireGuard, so use OVPN there."
      actions={
        <>
          {(store.ovpnClients ?? []).length > 0 && (
            <Button
              onClick={() => setShowCredentials((v) => !v)}
              title="Usernames and tunnel addresses. Only needed when a router dials in on an address no row mentions."
            >
              {showCredentials ? 'Hide tunnel credentials' : 'Tunnel credentials'}
            </Button>
          )}
          <Button onClick={() => setForm(blankRouter())}>Add manually</Button>
          <Button onClick={openDialog}>+ Onboard via OVPN</Button>
          <Button variant="primary" onClick={mintWireguard} disabled={busy}
                  title="RouterOS 7 only. Survives a changing address far better than OVPN.">
            + Onboard via WireGuard
          </Button>
          <Button onClick={mintFailover} disabled={busy}
                  title="RouterOS 7 only. WireGuard as usual, with the router itself switching to OVPN if a carrier or CGNAT link ever blocks WireGuard's UDP port.">
            + Onboard with failover
          </Button>
        </>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Routers" value={routers.length} hint="across all sites" />
        <Stat label="Up" value={up} tone={color.green} hint="responding to ping" />
        <Stat label="Down" value={down} tone={down ? color.rust : undefined} hint="watchdog runs every minute" />
        <Stat label="OVPN clients" value={(store.ovpnClients ?? []).length} hint="tunnels issued" />
      </Grid>

      {showCredentials && (store.ovpnClients ?? []).length > 0 && (
        <Card title="Tunnel credentials">
          <Table
            rowKey={(c) => c.id}
            empty="None issued"
            rows={store.ovpnClients ?? []}
            columns={[
              { key: 'username', label: 'Username', render: (c) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{c.username}</span> },
              { key: 'assigned_ip', label: 'Address', render: (c) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{c.assigned_ip}</span> },
              {
                key: 'router',
                label: 'In use by',
                render: (c) => {
                  const owner = routers.find((r) => String(r.host).split('/')[0] === String(c.assigned_ip).split('/')[0]);
                  if (owner) return owner.name;
                  /*
                   * A credential with no matching router row is not
                   * automatically spare. The server checks the OpenVPN status
                   * file, and if a router is dialled in on this one right now,
                   * revoking it cuts that tunnel — after which the router
                   * cannot be reached to put it right.
                   *
                   * That is also the shape of the mismatch itself: a router
                   * connected on one address while its row in the app points
                   * at another. Saying so here is the whole diagnosis.
                   */
                  if (c.connectedNow) {
                    return (
                      <span style={{ color: color.rust, fontWeight: 600 }}>
                        a router is connected on this now — do not revoke; point a router row at{' '}
                        <span style={{ fontFamily: font.mono }}>{String(c.assigned_ip).split('/')[0]}</span>
                      </span>
                    );
                  }
                  return <span style={{ color: color.muted }}>no router — safe to revoke</span>;
                },
              },
              {
                key: 'connected_at',
                label: 'Last connected',
                render: (c) => (c.connected_at ? new Date(c.connected_at).toLocaleString('en-KE') : 'never'),
              },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (c) => <Button onClick={() => revokeTunnel(c)}>Revoke</Button>,
              },
            ]}
          />
        </Card>
      )}

      <WinboxAccess store={store} />
      <WireguardPeers store={store} />

      {/* A router hammering the tunnel with a credential we no longer have.
          Revoking does not stop it trying — RouterOS retries every few seconds
          for ever — so without this the fleet reads as down and nothing says
          why. */}
      {tunnels.rejected?.length > 0 && (
        <div style={{
          fontSize: 13, color: color.rust, background: '#fdece5',
          border: '1px solid #f3c7b6', borderRadius: radius.md,
          padding: '10px 13px', marginBottom: 12,
        }}>
          {tunnels.rejected.map((r) => (
            <div key={r.username}>
              <strong>{r.username}</strong> is trying to connect with a credential that no longer
              exists — {r.tries} attempt{r.tries === 1 ? '' : 's'} in the last ten minutes. Press{' '}
              <strong>+ Onboard via OVPN</strong> and paste the new script into that router; the
              first line removes the old tunnel.
            </div>
          ))}
        </div>
      )}

      {/* The mismatch that cost days: the router dials in on one address while
          the row says another, every push times out, and it reads as "the
          router is down" rather than "we are calling the wrong number". */}
      {/* Optional chaining, because a reply that omits `stale` — an older API
          behind a half-finished deploy, or an error body — would otherwise take
          the whole Routers page down rather than hiding one banner. */}
      {(tunnels.stale ?? []).filter((r) => r.suggestion).map((r) => (
        <div
          key={r.id}
          style={{
            fontSize: 13, color: color.amberInk, background: color.amberBg,
            border: '1px solid #ecd9a8', borderRadius: radius.md,
            padding: '10px 13px', display: 'flex', gap: 10,
            alignItems: 'center', flexWrap: 'wrap', marginBottom: 12,
          }}
        >
          <span>
            <strong>{r.name}</strong> is set to <code>{String(r.host).split('/')[0]}</code>,
            but the tunnel connected is <code>{r.suggestion}</code>. Pushes will
            time out until these match.
          </span>
          <Button onClick={() => adoptAddress(r, r.suggestion)}>
            Use {r.suggestion}
          </Button>
        </div>
      ))}

      <Card title="Onboarded routers">
        <Table
          rowKey={(r) => r.id}
          empty="No routers yet — onboard your first MikroTik over OVPN"
          rows={routers}
          columns={[
            { key: 'name', label: 'Nickname', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { key: 'host', label: 'NAS address', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{r.host}</span> },
            { key: 'api_port', label: 'API port', align: 'right', render: (r) => <span style={{ fontFamily: font.mono }}>{r.api_port}</span> },
            { key: 'role', label: 'Role' },
            { key: 'onboarding', label: 'Onboarded' },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status}>{r.status}</Badge> },
            {
              key: 'last_seen',
              label: 'Last seen',
              render: (r) => (r.last_seen ? new Date(r.last_seen).toLocaleString('en-KE') : '—'),
            },
            {
              // CoA is an optimisation, not a requirement: without it a new speed
              // applies when the subscriber next reconnects rather than instantly.
              // It had a column of its own reading "no answer", which made a
              // perfectly working router look broken.
              key: 'configured',
              label: 'Configured',
              render: (r) =>
                !r.autoconfig_last_at ? (
                  <span style={{ color: color.muted }}>not yet</span>
                ) : r.autoconfig_last_ok ? (
                  <span title={`RouterOS ${r.ros_version ?? ''}`.trim()} style={{ color: color.green }}>
                    yes
                  </span>
                ) : (
                  /* The reason, not just the word. It was in a tooltip nobody
                     hovers, so a router said "failed" for days while the message
                     naming the broken step sat one pixel away, unread. */
                  <div style={{ display: 'grid', gap: 2, maxWidth: 260 }}>
                    <span style={{ color: color.rust, fontWeight: 600 }}>failed</span>
                    {r.autoconfig_last_error && (
                      <span
                        title={r.autoconfig_last_error}
                        style={{ fontSize: 12, color: color.muted, lineHeight: 1.35 }}
                      >
                        {r.autoconfig_last_error}
                      </span>
                    )}
                  </div>
                ),
            },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (r) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button
                    variant={r.autoconfig_last_ok ? undefined : 'primary'}
                    onClick={() => openConfigure(r)}
                    disabled={configuring === r.id}
                  >
                    {configuring === r.id ? 'Reading…' : r.autoconfig_last_ok ? 'Reconfigure' : 'Configure'}
                  </Button>
                  <ActionMenu
                    open={menuFor === r.id}
                    anchorRect={menuFor === r.id ? menuRect : null}
                    menuRef={menuNodeRef}
                    onToggle={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenuFor((id) => (id === r.id ? null : r.id));
                      setMenuRect(rect);
                    }}
                  >
                    {/* Only for routers that serve a hotspot. Offering it on a
                        PPPoE-only tower would invite pushing a captive portal
                        onto a link that has no guests on it. */}
                    {(r.role === 'hotspot' || r.role === 'both') && (
                      <MenuItem
                        onClick={() => { setMenuFor(null); runHotspot(r, {}); }}
                        title="Push DHCP, hotspot server, profile, walled garden and the anti-sharing rule"
                      >
                        Hotspot
                      </MenuItem>
                    )}
                    {/* Re-sends the same settings without asking about ports again —
                        after a reset, after config drift, or after a first attempt
                        that failed. Previously this was hidden until a push had
                        already succeeded, which withheld the retry button from
                        exactly the routers that needed retrying. */}
                    <MenuItem
                      onClick={() => { setMenuFor(null); runAutoconfig(r, {}); }}
                      title="Push the current settings again, without asking about ports"
                    >
                      Refresh
                    </MenuItem>
                    <MenuItem
                      onClick={() => { setMenuFor(null); setTraffic({ router: r, ports: null, error: null }); }}
                      title="Live throughput on every port"
                    >
                      Traffic
                    </MenuItem>
                    <MenuItem
                      onClick={() => { setMenuFor(null); previewImport(r); }}
                      title="Create clients from the PPPoE accounts already on this router"
                    >
                      Import
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setMenuFor(null);
                        setEdit({
                          id: r.id, name: r.name, host: String(r.host).split('/')[0],
                          // The real secret, not blank: it is generated for you, so this
                          // is the only place to read it when configuring a router by hand.
                          secret: r.secret ?? '', apiPort: String(r.api_port ?? 8728), role: r.role ?? 'both',
                        });
                      }}
                    >
                      Edit
                    </MenuItem>
                    <MenuItem onClick={() => { setMenuFor(null); checkRadius(r); }}>Check RADIUS</MenuItem>
                    <MenuItem
                      onClick={() => { setMenuFor(null); checkHotspot(r); }}
                      title="Ask the router why the login page is not appearing"
                    >
                      Check hotspot
                    </MenuItem>
                  </ActionMenu>
                  <Button onClick={() => removeRouter(r)}>Delete</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Step 0 — the two things the script cannot guess */}
      <Modal
        open={dial.open}
        title="Onboard over OVPN"
        onClose={() => setDial((d) => ({ ...d, open: false }))}
        footer={
          <>
            <Button onClick={() => setDial((d) => ({ ...d, open: false }))}>Cancel</Button>
            <Button variant="primary" onClick={mintScript} disabled={busy}>
              {busy ? 'Working…' : 'Generate script'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="RouterOS version">
            <select
              value={dial.routerosVersion}
              onChange={(e) => setDial((d) => ({ ...d, routerosVersion: e.target.value }))}
              style={{
                padding: '7px 10px', border: `1px solid ${color.line}`, borderRadius: radius.md,
                background: color.subtleBg, fontSize: 13, width: '100%',
              }}
            >
              <option value="7">RouterOS 7</option>
              <option value="6">RouterOS 6</option>
            </select>
          </Field>
          <span style={{ fontSize: 12, color: color.muted }}>
            Check with <code style={{ fontFamily: font.mono }}>/system resource print</code>. The two
            versions spell the cipher differently, and the wrong one fails with a bare “syntax error”.
          </span>

          <Field label="Address the router should dial">
            <Input
              value={dial.serverHost}
              onChange={(e) => setDial((d) => ({ ...d, serverHost: e.target.value }))}
              placeholder={detected ? '' : 'detecting…'}
            />
          </Field>
          {/* A hostname only this browser can resolve produces a script that fails
              on the router with no useful error, so say so before it is pasted. */}
          {detected?.detected || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(dial.serverHost) ? (
            <span style={{ fontSize: 12, color: color.rust }}>
              This looks like a private or local address. Fine on a bench where the router shares
              your network — but a router at a customer site cannot dial it. In production set
              ROOT_DOMAIN (or OVPN_PUBLIC_HOST) on the server.
            </span>
          ) : (
            <span style={{ fontSize: 12, color: color.muted }}>
              Detected from this deployment. Override it if the tunnel answers on a different name
              or address — it just has to be something this router can reach on port {detected?.port ?? 1194}.
            </span>
          )}
        </div>
      </Modal>

      {/* Step 1 — the generated RouterOS script */}
      <Modal
        open={!!ovpn && !form}
        title={ovpn?.kind === 'wireguard'
          ? 'Paste this into the MikroTik terminal (WireGuard)'
          : ovpn?.kind === 'failover'
          ? 'Paste this into the MikroTik terminal (WireGuard + OVPN failover)'
          : 'Paste this into the MikroTik terminal'}
        width={640}
        onClose={() => setOvpn(null)}
        footer={
          <>
            <Button onClick={copyScript}>Copy</Button>
            <Button onClick={downloadScript}>Download .rsc</Button>
            <Button variant="primary" onClick={() => setForm({ ...blankRouter(), host: ovpn.nasIp, apiPort: String(ovpn.defaultApiPort ?? 8728) })}>
              Tunnel is up — continue
            </Button>
          </>
        }
      >
        {ovpn && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 16, fontSize: 12.5, flexWrap: 'wrap' }}>
              <span>
                {ovpn.kind === 'wireguard' ? 'Peer' : ovpn.kind === 'failover' ? 'OVPN username' : 'Username'}{' '}
                <strong style={{ fontFamily: font.mono }}>{ovpn.username}</strong>
              </span>
              <span>
                Tunnel IP <strong style={{ fontFamily: font.mono }}>{ovpn.nasIp}</strong>
              </span>
            </div>
            <Textarea
              readOnly
              value={ovpn.script}
              rows={7}
              style={{ fontFamily: font.mono, fontSize: 12, background: '#12211d', color: '#eaf3ef', borderColor: '#12211d' }}
            />
            <span style={{ fontSize: 12, color: color.muted }}>
              {ovpn.kind === 'wireguard' ? (
                <>
                  RouterOS 7 only. The private key in this script is shown once and is not
                  stored here — if you lose it, make a new peer rather than looking for it.
                  The router keeps a stable address in your tunnel range, so RADIUS CoA can
                  always reach it. Come back here once the handshake completes.
                </>
              ) : ovpn.kind === 'failover' ? (
                <>
                  RouterOS 7 only. WireGuard comes up as usual; OVPN is added disabled,
                  as a standby the router itself switches to if WireGuard's handshake ever
                  goes stale for more than 90 seconds, and switches back from once WireGuard
                  recovers — checked every 2 minutes by a scheduler this script also adds.
                  The private key and OVPN password are shown once and are not stored.
                  Come back here once the WireGuard handshake completes.
                </>
              ) : (
                <>
                  Paste this even if the router already has a tunnel — the first line removes the old one, so the router reconnects with this credential and this address. Revoking alone does not change anything on the router. The tunnel gives the router a stable address in your own {ovpn.subnet ?? 'tunnel'} range, so CoA
                  can always reach it. Come back here once it connects.
                </>
              )}
            </span>
          </div>
        )}
      </Modal>

      {/* Live traffic. Its own dialog rather than a column, because it polls and
          a table that repaints every five seconds is unreadable while scanning
          a list of routers. */}
      <Modal
        open={!!traffic}
        title={`Traffic on ${traffic?.router?.name ?? ''}`}
        onClose={() => setTraffic(null)}
        footer={<Button onClick={() => setTraffic(null)}>Close</Button>}
      >
        {traffic?.error && (
          <div style={{ fontSize: 13, color: color.rust, marginBottom: 10 }}>{traffic.error}</div>
        )}
        {!traffic?.ports && !traffic?.error && (
          <div style={{ fontSize: 13, color: color.muted }}>Reading the router…</div>
        )}
        {traffic?.ports && (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>PORT</th>
                  <th style={{ ...th, textAlign: 'right' }}>DOWN</th>
                  <th style={{ ...th, textAlign: 'right' }}>UP</th>
                </tr>
              </thead>
              <tbody>
                {traffic.ports.map((p) => (
                  <tr key={p.name}>
                    <td style={{ ...td, fontFamily: font.mono, fontSize: 12.5 }}>
                      {p.name}
                      {!p.running && (
                        <span style={{ color: color.muted, fontFamily: 'inherit' }}> · no link</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: font.mono }}>{bitrate(p.rxBps)}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: font.mono }}>{bitrate(p.txBps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 10, fontSize: 12, color: color.muted }}>
              Updating every 5 seconds. Down and up are from the router's point of
              view: down is what it received on that port.
            </div>
          </>
        )}
      </Modal>

      {/* Import: preview, then confirm. */}
      <Modal
        open={!!importing}
        title={`Import from ${importing?.router?.name ?? ''}`}
        onClose={() => !importing?.busy && setImporting(null)}
        footer={
          <>
            <Button onClick={() => setImporting(null)} disabled={importing?.busy}>Close</Button>
            {importing?.preview && !importing?.result && (
              <Button
                variant="primary"
                onClick={applyImport}
                disabled={importing.busy || !importing.preview.importable.length}
              >
                {importing.busy ? 'Importing…' : `Import ${importing.preview.importable.length}`}
              </Button>
            )}
          </>
        }
      >
        {importing?.error && (
          <div style={{ fontSize: 13, color: color.rust }}>{importing.error}</div>
        )}
        {importing?.busy && !importing?.preview && (
          <div style={{ fontSize: 13, color: color.muted }}>Reading /ppp/secret…</div>
        )}

        {importing?.preview && !importing?.result && (
          <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
            <span>
              <strong>{importing.preview.importable.length}</strong> new of{' '}
              {importing.preview.total} account(s) on the router.
            </span>
            {!!importing.preview.already.length && (
              <span style={{ color: color.muted }}>
                {importing.preview.already.length} already exist here and are left alone — the
                system is authoritative once a customer is billed from it.
              </span>
            )}
            {!!importing.preview.noPassword.length && (
              <span style={{ color: color.amberInk }}>
                {importing.preview.noPassword.length} have no password on the router and cannot be
                imported: {importing.preview.noPassword.slice(0, 5).join(', ')}
                {importing.preview.noPassword.length > 5 ? '…' : ''}
              </span>
            )}
            {!!importing.preview.importable.length && (
              <div style={{ maxHeight: 180, overflow: 'auto', fontFamily: font.mono, fontSize: 12.5 }}>
                {importing.preview.importable.slice(0, 100).map((x) => (
                  <div key={x.name}>{x.name}{x.remoteAddress ? ` · ${x.remoteAddress}` : ''}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {importing?.result && (
          <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
            <span><strong>{importing.result.imported}</strong> client(s) created.</span>
            {!!importing.result.needPhone && (
              <span style={{ color: color.amberInk }}>
                None have a phone number — the router does not store one. Payments are matched on
                the phone number, so add them before these customers pay.
              </span>
            )}
            {!!importing.result.failed?.length && (
              <span style={{ color: color.rust }}>
                {importing.result.failed.length} could not be created:{' '}
                {importing.result.failed.slice(0, 3).map((f) => `${f.name} (${f.error})`).join('; ')}
              </span>
            )}
          </div>
        )}
      </Modal>

      {/* First push only: the admin login used to mint our own account */}
      <Modal
        open={!!adminPrompt}
        title={`${adminPrompt?.hotspot ? 'Hotspot' : 'Configure'} ${adminPrompt?.router?.name ?? 'router'}`}
        onClose={() => setAdminPrompt(null)}
        footer={
          <>
            <Button onClick={() => setAdminPrompt(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={configuring === adminPrompt?.router?.id}
              onClick={() => {
                const creds = { username: adminPrompt.username, password: adminPrompt.password };
                // Go back to whichever push asked for the password, not always
                // Configure — a hotspot push that stopped for credentials must
                // resume as a hotspot push.
                return adminPrompt.hotspot
                  ? runHotspot(adminPrompt.router, creds)
                  : openConfigure(adminPrompt.router, creds);
              }}
            >
              {configuring === adminPrompt?.router?.id ? 'Connecting…' : 'Continue'}
            </Button>
          </>
        }
      >
        {adminPrompt && (
          <div style={{ display: 'grid', gap: 12 }}>
            <span style={{ fontSize: 13, color: color.muted }}>
              Your router login is needed once. It is used to create a dedicated{' '}
              <strong style={{ fontFamily: font.mono }}>vibelink-svc</strong> account and is not
              stored — every push after this uses that account, so changing your own password later
              will not break anything.
            </span>
            <Field label="Router admin username">
              <Input
                value={adminPrompt.username}
                autoComplete="off"
                onChange={(e) => setAdminPrompt((s) => ({ ...s, username: e.target.value }))}
              />
            </Field>
            <Field label="Router admin password">
              <Input
                type="password"
                value={adminPrompt.password}
                autoComplete="off"
                onChange={(e) => setAdminPrompt((s) => ({ ...s, password: e.target.value }))}
              />
            </Field>
            <span style={{ fontSize: 12, color: color.muted }}>
              This will point RADIUS at the server, switch CoA on, and enable accounting for PPPoE
              and hotspot. Re-running it later is safe — it updates rather than duplicates. The
              account it creates is commented “do not delete”; removing it on the router just means
              entering these details again.
            </span>
          </div>
        )}
      </Modal>

      {/* What the push actually did. Stays until dismissed — a dialog that just
          closed left no way to tell success from nothing happening. */}
      <Modal
        open={!!result}
        title={
          result?.state === 'running' ? `Configuring ${result?.router?.name ?? ''}…`
            : result?.state === 'ok' ? `${result?.router?.name} configured`
            : `${result?.router?.name} — configuration failed`
        }
        width={540}
        onClose={() => result?.state !== 'running' && setResult(null)}
        footer={
          result?.state === 'running' ? null : (
            <>
              <Button onClick={() => setResult(null)}>
                {result?.state === 'ok' ? 'Close now' : 'Close'}
              </Button>
              <Button
                variant="primary"
                disabled={configuring === result?.router?.id}
                onClick={() => rerun(result.router)}
              >
                {configuring === result?.router?.id ? 'Sending…' : 'Send again'}
              </Button>
            </>
          )
        }
      >
        {result && (
          <div style={{ display: 'grid', gap: 12 }}>
            {result.state === 'running' && (
              <span style={{ fontSize: 13 }}>
                Talking to the router over the tunnel. This takes a few seconds — RADIUS, CoA,
                accounting, and the bridge and PPPoE server if you chose ports.
              </span>
            )}

            {result.state === 'ok' && (
              <>
                <span style={{ fontSize: 13, color: color.green, fontWeight: 600 }}>
                  Success{result.version ? ` · RouterOS ${result.version}` : ''}
                </span>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 4 }}>
                  {result.applied.map((line) => <li key={line}>{line}</li>)}
                </ul>
                <span style={{ fontSize: 12, color: color.muted }}>
                  Closing on its own in a moment.
                </span>
              </>
            )}

            {result.state === 'failed' && (
              <>
                <span style={{ fontSize: 13, color: color.rust }}>{result.error}</span>
                {result.applied.length > 0 && (
                  <>
                    <span style={{ fontSize: 12.5, color: color.muted }}>Completed before it stopped:</span>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 4 }}>
                      {result.applied.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </>
                )}
                <span style={{ fontSize: 12, color: color.muted }}>
                  Sending again is safe — every step updates what is there rather than adding a
                  second copy.
                </span>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Both sides of the RADIUS setup, side by side. */}
      <Modal
        open={!!radiusReport}
        title={`${radiusReport?.kind ?? 'RADIUS'} · ${radiusReport?.router?.name ?? ''}`}
        width={560}
        onClose={() => setRadiusReport(null)}
        footer={<Button onClick={() => setRadiusReport(null)}>Close</Button>}
      >
        {radiusReport && (
          <div style={{ display: 'grid', gap: 14 }}>
            {radiusReport.state === 'running' && <span style={{ fontSize: 13 }}>Reading the router…</span>}

            {radiusReport.expected && (
              <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
                <span style={{ fontWeight: 600 }}>What the router should point at</span>
                <span>RADIUS server <strong style={{ fontFamily: font.mono }}>{radiusReport.expected.radiusServer}</strong>{' '}
                  · auth {radiusReport.expected.authPort} · accounting {radiusReport.expected.acctPort}</span>
                <span>CoA back to this router on port <strong style={{ fontFamily: font.mono }}>{radiusReport.expected.coaPort}</strong></span>
                <span>Its NAS address here is <strong style={{ fontFamily: font.mono }}>{radiusReport.expected.nasAddress}</strong></span>
                <span style={{ color: radiusReport.knownToRadius ? color.neutralInk : color.rust }}>
                  {radiusReport.knownToRadius
                    ? 'RADIUS accepts requests from that address only. A router sending from any other — its LAN address rather than its tunnel address — is dropped without a reply.'
                    : 'RADIUS has no record of that address, so every request from it is dropped without a reply.'}
                </span>
              </div>
            )}

            {radiusReport.error && (
              <span style={{ fontSize: 12.5, color: color.rust }}>{radiusReport.error}</span>
            )}

            {radiusReport.pageUrl && (
              <span style={{ fontSize: 12.5, color: color.muted }}>
                Guests should be served{' '}
                <strong style={{ fontFamily: font.mono }}>{radiusReport.pageUrl}</strong>
                {radiusReport.interface ? <> on <strong style={{ fontFamily: font.mono }}>{radiusReport.interface}</strong></> : null}
              </span>
            )}

            {radiusReport.checks && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>What the router actually says</span>
                {radiusReport.checks.map((c) => (
                  <div key={c.name} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'baseline' }}>
                    <span style={{ color: c.ok ? color.green : color.rust, fontWeight: 700 }}>{c.ok ? '✓' : '✕'}</span>
                    <span style={{ flex: 1 }}>{c.name}</span>
                    {!c.ok && <span style={{ color: color.muted }}>{c.detail}</span>}
                  </div>
                ))}
                {!radiusReport.ok && (
                  <span style={{ fontSize: 12, color: color.muted, marginTop: 4 }}>
                    {radiusReport.kind === 'Hotspot'
                      ? 'Press Hotspot and choose the LAN ports to build what is missing.'
                      : 'Press Configure to push the correct values, or Refresh to re-send them.'}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Step two of Configure: which ports are LAN. Nothing has been written yet. */}
      <Modal
        open={!!plan}
        title={`Configure ${plan?.router?.name ?? 'router'}`}
        width={560}
        onClose={() => setPlan(null)}
        footer={
          <>
            <Button onClick={() => setPlan(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={configuring === plan?.router?.id}
              onClick={() =>
                runAutoconfig(plan.router, {
                  ...plan.creds,
                  bridge: plan.bridge,
                  lanPorts: plan.selected,
                })
              }
            >
              {configuring === plan?.router?.id ? 'Applying…' : 'Apply to router'}
            </Button>
          </>
        }
      >
        {plan && (
          <div style={{ display: 'grid', gap: 14 }}>
            <span style={{ fontSize: 12.5, color: color.muted }}>
              {plan.identity ? `${plan.identity} · ` : ''}RouterOS {plan.version ?? '?'} · RADIUS,
              accounting and CoA will be set regardless. Ports below are optional: pick them and a
              PPPoE server is built on a bridge of those ports.
            </span>

            <Field label="LAN ports for subscribers">
              <div style={{ display: 'grid', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                {plan.lan.length === 0 && (
                  <span style={{ fontSize: 12.5, color: color.muted }}>
                    No free ports — every interface is already in a bridge or in use.
                  </span>
                )}
                {plan.lan.map((i) => (
                  <label
                    key={i.name}
                    title={i.uplink ? `Cannot be bridged: ${i.uplink}` : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                      // The uplink is not a choice to be made carefully, it is a
                      // choice that must not be available. The router told us
                      // which port it is; the server refuses it too.
                      opacity: i.uplink ? 0.55 : 1,
                      cursor: i.uplink ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={!!i.uplink}
                      checked={plan.selected.includes(i.name)}
                      onChange={(e) =>
                        setPlan((s) => ({
                          ...s,
                          selected: e.target.checked
                            ? [...s.selected, i.name]
                            : s.selected.filter((n) => n !== i.name),
                        }))
                      }
                    />
                    <span style={{ fontFamily: font.mono }}>{i.name}</span>
                    <span style={{ color: color.muted, fontSize: 12 }}>
                      {i.type}{i.running ? ' · link up' : ' · no link'}
                      {/* Which bridge it is already in. Ticking a port that is
                          already bridged is a no-op, and not showing that led to
                          a hotspot being built on a bridge believed to be empty. */}
                      {i.bridge ? ` · in ${i.bridge}` : ''}
                    </span>
                    {i.uplink && (
                      <span style={{ color: color.rust, fontSize: 12, fontWeight: 600 }}>
                        · your internet — cannot be bridged
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </Field>

            {plan.selected.length > 0 && (
              <Field label="Bridge name">
                <Input
                  value={plan.bridge}
                  onChange={(e) => setPlan((s) => ({ ...s, bridge: e.target.value }))}
                />
              </Field>
            )}

            <span style={{ fontSize: 12, color: color.rust }}>
              Do not tick the port your internet comes in on. Bridging the uplink into the LAN
              takes the site offline. Ports already in another bridge are skipped rather than moved.
            </span>
          </div>
        )}
      </Modal>

      {/* Edit an existing router */}
      <Modal
        open={!!edit}
        title={`Edit ${edit?.name ?? 'router'}`}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {edit && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Nickname" span={2}>
              <Input value={edit.name} onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))} />
            </Field>
            <Field label="NAS address">
              <Input value={edit.host} onChange={(e) => setEdit((s) => ({ ...s, host: e.target.value }))} />
            </Field>
            <Field label="API port">
              <Input
                type="number"
                value={edit.apiPort}
                onChange={(e) => setEdit((s) => ({ ...s, apiPort: e.target.value }))}
              />
            </Field>
            <Field label="RADIUS shared secret" span={2}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={edit.secret}
                  autoComplete="off"
                  // Masked by default: this screen gets opened in front of other
                  // people, and the secret is only ever needed for manual setup.
                  type={showSecret ? 'text' : 'password'}
                  style={{ fontFamily: font.mono, fontSize: 12 }}
                  onChange={(e) => setEdit((s) => ({ ...s, secret: e.target.value }))}
                />
                <Button onClick={() => setShowSecret((v) => !v)}>{showSecret ? 'Hide' : 'Show'}</Button>
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(edit.secret);
                      store.toast('Secret copied');
                    } catch {
                      store.toast('Copy failed — select the text and copy manually');
                    }
                  }}
                >
                  Copy
                </Button>
              </div>
            </Field>
            <span style={{ gridColumn: '1 / -1', fontSize: 12, color: color.muted }}>
              The NAS address is how RADIUS recognises this router and where CoA is sent — it must
              stay the router’s tunnel address. Configure pushes this secret for you; copy it only
              if you are setting the MikroTik up by hand, and if you change it here, change it there
              too or authentication stops.
            </span>
          </div>
        )}
      </Modal>

      {/* Step 2 — confirm the NAS details */}
      <Modal
        open={!!form}
        title="Confirm router"
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={confirmRouter} disabled={busy}>
              {busy ? 'Adding…' : 'Add router'}
            </Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Nickname" span={2}>
              <Input value={form.name} onChange={set('name')} placeholder="Kimumu tower" />
            </Field>
            <Field label="NAS address">
              <Input value={form.host} onChange={set('host')} placeholder="10.50.0.1" />
            </Field>
            <Field label="API port">
              <Input value={form.apiPort} onChange={set('apiPort')} type="number" />
            </Field>
            {/* No secret field. It is generated on the server and pushed to the
                router by Configure, so showing it here only invited someone to
                replace a random value with a memorable one. It remains readable
                under Edit for anyone configuring a MikroTik by hand. */}
            <Field label="Role" span={2}>
              <select
                value={form.role}
                onChange={set('role')}
                style={{
                  padding: '7px 10px',
                  border: `1px solid ${color.line}`,
                  borderRadius: radius.md,
                  background: color.subtleBg,
                  fontSize: 13,
                  width: '100%',
                }}
              >
                <option value="both">PPPoE and hotspot</option>
                <option value="pppoe">PPPoE only</option>
                <option value="hotspot">Hotspot only</option>
              </select>
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
