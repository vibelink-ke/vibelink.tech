import React, { useCallback, useEffect, useState } from 'react';
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

export default function Routers() {
  const store = useStore();
  const [ovpn, setOvpn] = useState(null); // { script, nasIp, username, defaultApiPort }
  const [form, setForm] = useState(null); // blankRouter() when the confirm modal is open
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);         // the router row open for editing
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
    a.download = `${ovpn.username}.rsc`;
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

  const runAutoconfig = async (r, opts) => {
    setConfiguring(r.id);
    setResult({ router: r, state: 'running', opts });
    try {
      const res = await api.autoconfigRouter(r.id, opts ?? {});
      setAdminPrompt(null);
      setPlan(null);
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
  const checkRadius = async (r) => {
    setRadiusReport({ router: r, state: 'running' });
    try {
      const res = await api.radiusCheck(r.id);
      setRadiusReport({ router: r, state: 'done', ...res });
    } catch (e) {
      setRadiusReport({ router: r, state: 'done', error: e.message, ...(e.body ?? {}) });
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
    if (!window.confirm(`Revoke ${c.username}? Any router still using it loses the tunnel, and ${c.assigned_ip} is freed.`))
      return;
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
          <Button onClick={() => setForm(blankRouter())}>Add manually</Button>
          <Button variant="primary" onClick={openDialog}>
            + Onboard via OVPN
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

      {/* Only worth showing when some credential is not backing a live router:
          those are the ones holding an address for no reason. */}
      {(store.ovpnClients ?? []).length > 0 && (
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
                  return owner
                    ? owner.name
                    : <span style={{ color: color.muted }}>no router — safe to revoke</span>;
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

      {/* The mismatch that cost days: the router dials in on one address while
          the row says another, every push times out, and it reads as "the
          router is down" rather than "we are calling the wrong number". */}
      {tunnels.stale.filter((r) => r.suggestion).map((r) => (
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
                ) : (
                  <span
                    title={r.autoconfig_last_error ?? `RouterOS ${r.ros_version ?? ''}`.trim()}
                    style={{ color: r.autoconfig_last_ok ? color.green : color.rust }}
                  >
                    {r.autoconfig_last_ok ? 'yes' : 'failed'}
                  </span>
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
                  {/* Only for routers that serve a hotspot. Offering it on a
                      PPPoE-only tower would invite pushing a captive portal
                      onto a link that has no guests on it. */}
                  {(r.role === 'hotspot' || r.role === 'both') && (
                    <Button
                      onClick={() => runHotspot(r, {})}
                      disabled={configuring === r.id}
                      title="Push DHCP, hotspot server, profile, walled garden and the anti-sharing rule"
                    >
                      Hotspot
                    </Button>
                  )}
                  {/* Re-sends the same settings without asking about ports again —
                      after a reset, after config drift, or after a first attempt
                      that failed. Previously this was hidden until a push had
                      already succeeded, which withheld the retry button from
                      exactly the routers that needed retrying. */}
                  <Button
                    onClick={() => runAutoconfig(r, {})}
                    disabled={configuring === r.id}
                    title="Push the current settings again, without asking about ports"
                  >
                    {configuring === r.id ? 'Sending…' : 'Refresh'}
                  </Button>
                  <Button
                    onClick={() =>
                      setEdit({
                        id: r.id, name: r.name, host: String(r.host).split('/')[0],
                        // The real secret, not blank: it is generated for you, so this
                        // is the only place to read it when configuring a router by hand.
                        secret: r.secret ?? '', apiPort: String(r.api_port ?? 8728), role: r.role ?? 'both',
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button onClick={() => checkRadius(r)}>Check RADIUS</Button>
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
        title="Paste this into the MikroTik terminal"
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
                Username <strong style={{ fontFamily: font.mono }}>{ovpn.username}</strong>
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
              The tunnel gives the router a stable address in your own {ovpn.subnet ?? 'tunnel'} range, so CoA
              can always reach it. Come back here once it connects.
            </span>
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
              <Button onClick={() => setResult(null)}>Close</Button>
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
        title={`RADIUS · ${radiusReport?.router?.name ?? ''}`}
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
                    Press Configure to push the correct values, or Refresh to re-send them.
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
                  <label key={i.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
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
