import React, { useState } from 'react';
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

  const routers = store.routers ?? [];
  const up = routers.filter((r) => r.status === 'up').length;
  const down = routers.filter((r) => r.status === 'down').length;

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const mintScript = async () => {
    setBusy(true);
    try {
      const res = await api.ovpnScript();
      setOvpn(res);
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
      subtitle="MikroTiks reach us over an OVPN tunnel, so no port-forwarding or static public IP is needed on your side."
      actions={
        <>
          <Button onClick={() => setForm(BLANK_ROUTER)}>Add manually</Button>
          <Button variant="primary" onClick={mintScript} disabled={busy}>
            {busy ? 'Working…' : '+ Onboard via OVPN'}
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
          ]}
        />
      </Card>

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
              The tunnel gives the router a stable address on 10.50.0.0/24. Come back here once it connects.
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
