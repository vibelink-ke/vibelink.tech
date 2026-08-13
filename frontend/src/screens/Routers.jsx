import React, { useCallback, useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Stat, Table, Textarea } from '../ui/primitives';

const BLANK_ROUTER = { name: '', host: '', secret: '', apiPort: '8728', role: 'both' };

export default function Routers() {
  const store = useStore();
  const [ovpn, setOvpn] = useState(null); // { script, nasIp, username, defaultApiPort }
  const [form, setForm] = useState(null); // BLANK_ROUTER when the confirm modal is open
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(null);   // router id currently being probed
  const [edit, setEdit] = useState(null);         // the router row open for editing
  // Asked before minting: RouterOS 6 and 7 need different cipher names. The
  // address is filled in from the deployment rather than typed.
  const [dial, setDial] = useState({ open: false, routerosVersion: '7', serverHost: '' });
  const [detected, setDetected] = useState(null);   // { serverHost, detected, port }

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

  // CoA is the one link that fails quietly — auth and accounting show up in logs,
  // but a CoA that never lands just means speed changes wait for a reconnect.
  const testCoa = async (r) => {
    setTesting(r.id);
    try {
      const res = await api.testCoa(r.id);
      store.toast(`${r.name}: ${res.detail}`);
      store.setCollection('routers', (rs) =>
        rs.map((x) => (x.id === r.id
          ? { ...x, coa_last_at: new Date().toISOString(), coa_last_ok: res.reachable, coa_last_error: res.reachable ? null : res.detail }
          : x)));
    } catch (e) {
      store.toast(`CoA test failed: ${e.message}`);
    } finally {
      setTesting(null);
    }
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
  const removeRouter = async (r) => {
    if (!window.confirm(`Delete ${r.name}? Its tunnel credentials are revoked and ${r.host} is freed for reuse.`))
      return;
    try {
      await api.deleteRouter(r.id);
      store.setCollection('routers', (rs) => rs.filter((x) => x.id !== r.id));
      store.toast(`${r.name} deleted`);
    } catch (e) {
      store.toast(e.message);
    }
  };

  const confirmRouter = async () => {
    if (!form.name.trim() || !form.host.trim() || !form.secret.trim())
      return store.toast('Nickname, NAS address and RADIUS secret are all required');
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
          <Button onClick={() => setForm(BLANK_ROUTER)}>Add manually</Button>
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
              key: 'coa',
              label: 'CoA',
              render: (r) =>
                !r.coa_last_at ? (
                  <span style={{ color: color.muted }}>untested</span>
                ) : (
                  <span
                    title={r.coa_last_error ?? 'Router answered the last change request'}
                    style={{ color: r.coa_last_ok ? color.green : color.rust }}
                  >
                    {r.coa_last_ok ? 'reachable' : 'no answer'}
                  </span>
                ),
            },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (r) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button onClick={() => testCoa(r)} disabled={testing === r.id}>
                    {testing === r.id ? 'Testing…' : 'Test CoA'}
                  </Button>
                  <Button
                    onClick={() =>
                      setEdit({
                        id: r.id, name: r.name, host: String(r.host).split('/')[0],
                        secret: '', apiPort: String(r.api_port ?? 8728), role: r.role ?? 'both',
                      })
                    }
                  >
                    Edit
                  </Button>
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
            <Button variant="primary" onClick={() => setForm({ ...BLANK_ROUTER, host: ovpn.nasIp, apiPort: String(ovpn.defaultApiPort ?? 8728) })}>
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
              <Input
                value={edit.secret}
                autoComplete="off"
                placeholder="leave blank to keep the current one"
                onChange={(e) => setEdit((s) => ({ ...s, secret: e.target.value }))}
              />
            </Field>
            <span style={{ gridColumn: '1 / -1', fontSize: 12, color: color.muted }}>
              The NAS address is how RADIUS recognises this router and where CoA is sent — it must
              stay the router’s tunnel address. Changing the secret here means changing it on the
              MikroTik too, or authentication stops.
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
            <Field label="RADIUS shared secret" span={2}>
              <Input value={form.secret} onChange={set('secret')} autoComplete="off" />
            </Field>
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
