import React, { useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Field, Input, Screen, Select, Table } from '../../ui/primitives';

/**
 * Permanent, staff-issued hotspot logins — "Lounge WiFi", "Staff WiFi" — as
 * distinct from a voucher: no expiry, no purchase behind them, and shared by
 * design via their own Max devices cap rather than one device per code.
 * hotspot_settings.multi_device and this screen's max_devices are unrelated
 * — that toggle only ever governs voucher-issued logins.
 */
const CUSTOM = '__custom';
const mbps = (kbps) => (Math.round(Number(kbps) / 100) / 10).toString();

export default function AccessCodes() {
  const store = useStore();
  const codes = store.accessCodes ?? [];
  const [creating, setCreating] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  // Who is connected on each code changes minute to minute, unlike the codes
  // themselves, so the list is re-read on a timer (paused while the tab is
  // hidden) rather than only when the screen opens.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      api.hotspotAccessCodes().then((fresh) => store.setCollection('accessCodes', () => fresh)).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One speed for every access code.
  const [all, setAll] = useState({ down: '', up: '', saved: null, busy: false });
  useEffect(() => {
    api.accessCodesSpeed().then((r) => setAll((a) => ({
      ...a, saved: r.downKbps && r.upKbps ? r : null,
      down: r.downKbps ? mbps(r.downKbps) : '', up: r.upKbps ? mbps(r.upKbps) : '',
    }))).catch(() => {});
  }, []);
  const applyAll = async () => {
    const d = Number(all.down);
    const u = Number(all.up);
    if (!(d > 0 && u > 0)) return store.toast('Enter both a download and an upload speed in Mbps');
    if (codes.length && !window.confirm(`Put all ${codes.length} access code(s) on ${d}/${u} Mbps? A speed set on an individual code is replaced.`)) return;
    setAll((a) => ({ ...a, busy: true }));
    try {
      const out = await api.setAccessCodesSpeed(d, u);
      const fresh = await api.hotspotAccessCodes();
      store.setCollection('accessCodes', () => fresh);
      setAll((a) => ({ ...a, busy: false, saved: { downKbps: out.downKbps, upKbps: out.upKbps } }));
      store.toast(`All access codes are now ${d}/${u} Mbps`);
    } catch (e) {
      setAll((a) => ({ ...a, busy: false }));
      store.toast(`Could not set the speed: ${e.message}`);
    }
  };

  // Starts blank rather than pre-fetching a suggestion: an auto-fill landing
  // after the modal opens could overwrite a username/password already typed
  // by hand in that window. Typing your own is just as valid as pressing
  // Generate below — this only avoids the two racing.
  const openCreate = () => setCreating({ label: '', username: '', password: '', maxDevices: 5, planId: '', downMbps: '', upMbps: '' });

  const genCredentials = async () => {
    try {
      const { account, password } = await api.newSubscriberCredentials();
      setCreating((s) => ({ ...s, username: account, password }));
    } catch (e) {
      store.toast(`Could not generate: ${e.message}`);
    }
  };

  const submitCreate = async () => {
    if (!creating.label.trim()) return store.toast('Give this code a label — "Lounge WiFi", "Staff WiFi"');
    if (creating.planId === CUSTOM && !(Number(creating.downMbps) > 0 && Number(creating.upMbps) > 0)) {
      return store.toast('Enter both a download and an upload speed in Mbps');
    }
    setBusy(true);
    try {
      const made = await api.createAccessCode({
        label: creating.label.trim(),
        username: creating.username,
        password: creating.password,
        maxDevices: Number(creating.maxDevices),
        planId: creating.planId && creating.planId !== CUSTOM ? creating.planId : null,
        ...(creating.planId === CUSTOM ? { speedDownMbps: creating.downMbps, speedUpMbps: creating.upMbps } : {}),
      });
      store.setCollection('accessCodes', (cs) => [made, ...cs]);
      store.toast(`${made.label} created`);
      setCreating(null);
    } catch (e) {
      store.toast(`Could not create: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (c) => {
    setTogglingId(c.id);
    try {
      const updated = await api.updateAccessCode(c.id, { enabled: !c.enabled });
      store.setCollection('accessCodes', (cs) => cs.map((x) => (x.id === c.id ? updated : x)));
      store.toast(`${c.label} ${updated.enabled ? 'enabled' : 'disabled'}`);
    } catch (e) {
      store.toast(`Could not change it: ${e.message}`);
    } finally {
      setTogglingId(null);
    }
  };

  // Same shape as "creating" — pre-filled from the row rather than fetched,
  // since everything it needs is already sitting in the table.
  const openEdit = (c) => setEditing({
    id: c.id,
    label: c.label,
    maxDevices: c.max_devices,
    planId: c.rate_down_kbps && c.rate_up_kbps ? CUSTOM : (c.plan_id ?? ''),
    downMbps: c.rate_down_kbps ? mbps(c.rate_down_kbps) : '',
    upMbps: c.rate_up_kbps ? mbps(c.rate_up_kbps) : '',
  });

  const submitEdit = async () => {
    if (editing.planId === CUSTOM && !(Number(editing.downMbps) > 0 && Number(editing.upMbps) > 0)) {
      return store.toast('Enter both a download and an upload speed in Mbps');
    }
    setBusy(true);
    try {
      const updated = await api.updateAccessCode(editing.id, {
        maxDevices: Number(editing.maxDevices),
        planId: editing.planId && editing.planId !== CUSTOM ? editing.planId : null,
        ...(editing.planId === CUSTOM
          ? { speedDownMbps: editing.downMbps, speedUpMbps: editing.upMbps }
          : { speedDownMbps: '', speedUpMbps: '' }),
      });
      store.setCollection('accessCodes', (cs) => cs.map((x) => (x.id === updated.id ? updated : x)));
      store.toast(`${editing.label} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.label}"? Anyone still connected with it will need a different code.`)) return;
    try {
      await api.deleteAccessCode(c.id);
      store.setCollection('accessCodes', (cs) => cs.filter((x) => x.id !== c.id));
      store.toast(`${c.label} deleted`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  return (
    <Screen
      actions={
        <Button variant="primary" onClick={openCreate}>+ New access code</Button>
      }
    >
      <Card
        title="One speed for all access codes"
        subtitle={all.saved
          ? `Every access code is on ${mbps(all.saved.downKbps)}/${mbps(all.saved.upKbps)} Mbps (download/upload) unless it has a speed of its own`
          : 'Set one speed for every access code at once, instead of choosing it code by code'}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Download (Mbps)">
            <Input type="number" min="0.1" step="0.1" value={all.down} onChange={(e) => setAll((a) => ({ ...a, down: e.target.value }))} style={{ width: 150 }} />
          </Field>
          <Field label="Upload (Mbps)">
            <Input type="number" min="0.1" step="0.1" value={all.up} onChange={(e) => setAll((a) => ({ ...a, up: e.target.value }))} style={{ width: 150 }} />
          </Field>
          <div style={{ paddingBottom: 6 }}>
            <Button variant="primary" onClick={applyAll} disabled={all.busy || !all.down || !all.up}>
              {all.busy ? 'Applying…' : codes.length ? `Apply to all ${codes.length} code(s)` : 'Save'}
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title="Access codes"
        subtitle="Permanent logins that don't expire — for a lounge, staff, or anyone you'd rather not hand a voucher"
      >
        <Table
          rowKey={(c) => c.id}
          empty='No access codes yet — "+ New access code" sets one up'
          rows={codes}
          columns={[
            { key: 'label', label: 'Label', render: (c) => <span style={{ fontWeight: 500 }}>{c.label}</span> },
            { key: 'username', label: 'Username', render: (c) => <span style={{ fontFamily: font.mono }}>{c.username}</span> },
            { key: 'password', label: 'Password', render: (c) => <span style={{ fontFamily: font.mono }}>{c.password}</span> },
            { key: 'max_devices', label: 'Max devices', align: 'right', render: (c) => c.max_devices },
            {
              key: 'online',
              label: 'Online now',
              render: (c) => {
                const n = Number(c.online ?? 0);
                if (c.enabled === false) return <span style={{ color: color.muted }}>—</span>;
                const dot = (
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 7,
                    background: n > 0 ? color.green : color.muted,
                  }}
                  />
                );
                // One device per code: it is simply on or off. A shared code says how
                // full it is, which is what tells you it is about to turn people away.
                return c.max_devices > 1
                  ? <span>{dot}<b style={{ fontWeight: 600 }}>{n}</b><span style={{ color: color.muted }}> of {c.max_devices}</span></span>
                  : <span>{dot}{n > 0 ? 'Online' : <span style={{ color: color.muted }}>Offline</span>}</span>;
              },
            },
            {
              key: 'plan',
              label: 'Speed',
              render: (c) => c.rate_down_kbps && c.rate_up_kbps
                ? <span>{mbps(c.rate_down_kbps)}/{mbps(c.rate_up_kbps)} Mbps<span style={{ color: color.muted }}> · custom</span></span>
                : c.plan_title
                ? <span>{c.plan_title}{c.rate_down ? <span style={{ color: color.muted }}> · {Math.round(c.rate_down / 1000)}/{Math.round(c.rate_up / 1000)} Mbps</span> : null}</span>
                : all.saved
                ? <span>{mbps(all.saved.downKbps)}/{mbps(all.saved.upKbps)} Mbps<span style={{ color: color.muted }}> · all codes</span></span>
                : <span style={{ color: color.muted }}>Default</span>,
            },
            {
              key: 'status',
              label: 'Status',
              render: (c) => (
                <Button
                  size="sm"
                  disabled={togglingId === c.id}
                  style={c.enabled === false
                    ? { color: color.muted, borderColor: color.muted }
                    : { color: color.green, borderColor: color.green }}
                  onClick={() => toggleEnabled(c)}
                  title={c.enabled === false ? 'Disabled — nobody can log in with this code' : 'Active — click to disable'}
                >
                  {togglingId === c.id ? 'Working…' : c.enabled === false ? 'Disabled' : 'Active'}
                </Button>
              ),
            },
            {
              key: 'actions', label: '', align: 'right',
              render: (c) => (
                <span style={{ display: 'inline-flex', gap: 8 }}>
                  <Button size="sm" onClick={() => openEdit(c)}>Edit</Button>
                  <Button size="sm" style={{ color: color.rust, borderColor: color.rust }} onClick={() => remove(c)}>
                    Delete
                  </Button>
                </span>
              ),
            },
          ]}
        />
      </Card>

      {editing && (
        <Card title={`Edit ${editing.label}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
            <Field label="Max devices" hint="How many phones/laptops can be online on this code at once">
              <Input
                type="number" min={1} max={50}
                value={editing.maxDevices}
                onChange={(e) => setEditing((s) => ({ ...s, maxDevices: e.target.value }))}
              />
            </Field>
            <Field label="Speed" hint="Pick a bundle's speed, or set your own">
              <Select
                value={editing.planId}
                onChange={(e) => setEditing((s) => ({ ...s, planId: e.target.value }))}
                options={[
                  { value: '', label: 'Default' },
                  { value: CUSTOM, label: 'Custom speed…' },
                  ...(store.hsPlans ?? []).map((p) => ({ value: p.id, label: `${p.title} · ${p.rate_down}k/${p.rate_up}k` })),
                ]}
              />
            </Field>
            {editing.planId === CUSTOM && (
              <div style={{ display: 'flex', gap: 12 }}>
                <Field label="Download (Mbps)" hint="e.g. 5, or 0.5">
                  <Input
                    type="number" min="0.1" step="0.1"
                    value={editing.downMbps}
                    onChange={(e) => setEditing((s) => ({ ...s, downMbps: e.target.value }))}
                  />
                </Field>
                <Field label="Upload (Mbps)" hint="e.g. 2">
                  <Input
                    type="number" min="0.1" step="0.1"
                    value={editing.upMbps}
                    onChange={(e) => setEditing((s) => ({ ...s, upMbps: e.target.value }))}
                  />
                </Field>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={submitEdit} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {creating && (
        <Card title="New access code">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
            <Field label="Label" hint={'What you\'ll recognise it by — "Lounge WiFi", "Staff WiFi"'}>
              <Input value={creating.label} onChange={(e) => setCreating((s) => ({ ...s, label: e.target.value }))} autoFocus />
            </Field>
            <Field label="Username" hint="2-12 letters/digits">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={creating.username}
                  onChange={(e) => setCreating((s) => ({ ...s, username: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) }))}
                  style={{ fontFamily: font.mono }}
                />
                <Button onClick={genCredentials}>Generate</Button>
              </div>
            </Field>
            <Field label="Password" hint="2-12 letters/digits">
              <Input
                value={creating.password}
                onChange={(e) => setCreating((s) => ({ ...s, password: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) }))}
                style={{ fontFamily: font.mono }}
              />
            </Field>
            <Field label="Max devices" hint="How many phones/laptops can be online on this code at once">
              <Input
                type="number" min={1} max={50}
                value={creating.maxDevices}
                onChange={(e) => setCreating((s) => ({ ...s, maxDevices: e.target.value }))}
              />
            </Field>
            <Field label="Speed" hint="Pick a bundle's speed, or set your own">
              <Select
                value={creating.planId}
                onChange={(e) => setCreating((s) => ({ ...s, planId: e.target.value }))}
                options={[
                  { value: '', label: 'Default' },
                  { value: CUSTOM, label: 'Custom speed…' },
                  ...(store.hsPlans ?? []).map((p) => ({ value: p.id, label: `${p.title} · ${p.rate_down}k/${p.rate_up}k` })),
                ]}
              />
            </Field>
            {creating.planId === CUSTOM && (
              <div style={{ display: 'flex', gap: 12 }}>
                <Field label="Download (Mbps)" hint="e.g. 5, or 0.5">
                  <Input
                    type="number" min="0.1" step="0.1"
                    value={creating.downMbps}
                    onChange={(e) => setCreating((s) => ({ ...s, downMbps: e.target.value }))}
                  />
                </Field>
                <Field label="Upload (Mbps)" hint="e.g. 2">
                  <Input
                    type="number" min="0.1" step="0.1"
                    value={creating.upMbps}
                    onChange={(e) => setCreating((s) => ({ ...s, upMbps: e.target.value }))}
                  />
                </Field>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button onClick={() => setCreating(null)} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={submitCreate} disabled={busy}>
                {busy ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </Screen>
  );
}
