import React, { useState } from 'react';
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
export default function AccessCodes() {
  const store = useStore();
  const codes = store.accessCodes ?? [];
  const [creating, setCreating] = useState(null);
  const [busy, setBusy] = useState(false);

  // Starts blank rather than pre-fetching a suggestion: an auto-fill landing
  // after the modal opens could overwrite a username/password already typed
  // by hand in that window. Typing your own is just as valid as pressing
  // Generate below — this only avoids the two racing.
  const openCreate = () => setCreating({ label: '', username: '', password: '', maxDevices: 5, planId: '' });

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
    setBusy(true);
    try {
      const made = await api.createAccessCode({
        label: creating.label.trim(),
        username: creating.username,
        password: creating.password,
        maxDevices: Number(creating.maxDevices),
        planId: creating.planId || null,
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
              key: 'plan',
              label: 'Speed',
              render: (c) => c.plan_title
                ? <span>{c.plan_title}{c.rate_down ? <span style={{ color: color.muted }}> · {Math.round(c.rate_down / 1000)}/{Math.round(c.rate_up / 1000)} Mbps</span> : null}</span>
                : <span style={{ color: color.muted }}>Default</span>,
            },
            {
              key: 'del', label: '', align: 'right',
              render: (c) => (
                <Button size="sm" style={{ color: color.rust, borderColor: color.rust }} onClick={() => remove(c)}>
                  Delete
                </Button>
              ),
            },
          ]}
        />
      </Card>

      {creating && (
        <Card title="New access code">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
            <Field label="Label" hint={'What you\'ll recognise it by — "Lounge WiFi", "Staff WiFi"'}>
              <Input value={creating.label} onChange={(e) => setCreating((s) => ({ ...s, label: e.target.value }))} autoFocus />
            </Field>
            <Field label="Username" hint="4-12 letters/digits">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={creating.username}
                  onChange={(e) => setCreating((s) => ({ ...s, username: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) }))}
                  style={{ fontFamily: font.mono }}
                />
                <Button onClick={genCredentials}>Generate</Button>
              </div>
            </Field>
            <Field label="Password" hint="4-12 letters/digits">
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
            <Field label="Speed" hint="Optional — leave unset for the router's own default">
              <Select
                value={creating.planId}
                onChange={(e) => setCreating((s) => ({ ...s, planId: e.target.value }))}
                options={[
                  { value: '', label: 'Default' },
                  ...(store.hsPlans ?? []).map((p) => ({ value: p.id, label: `${p.title} · ${p.rate_down}k/${p.rate_up}k` })),
                ]}
              />
            </Field>
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
