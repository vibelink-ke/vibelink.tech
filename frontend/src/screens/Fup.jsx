import React, { useEffect, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { useAction, ActionResult } from '../ui/action';
import { api } from '../api/client';
import { Badge, Bar, Button, Card, Drawer, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table, Toggle } from '../ui/primitives';

/**
 * Fair use policy. The design carried fair use as a free-text note on a tariff;
 * this is the enforceable version — a cap, a window, and the speed to drop to
 * once the cap is hit.
 */

const WINDOWS = [
  { value: 'daily', label: 'Per day' },
  { value: 'weekly', label: 'Per week' },
  { value: 'monthly', label: 'Per calendar month' },
];

const THROTTLE_PRESETS = [512, 1024, 2048, 4096];

const BLANK = {
  name: '',
  planId: '',
  dataCapGb: '',
  windowPeriod: 'monthly',
  throttleDown: 2048,
  throttleUp: 1024,
  notifyAtPct: 80,
  enabled: true,
};

const mbps = (kbps) => (kbps ? `${(kbps / 1000).toFixed(kbps % 1000 ? 1 : 0)} Mbps` : '—');
const windowLabel = (w) => WINDOWS.find((x) => x.value === w)?.label ?? w;

export default function Fup() {
  const store = useStore();
  const [form, setForm] = useState(null);   // BLANK for new, populated for edit
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);

  const [usage, setUsage] = useState([]);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [enforcing, setEnforcing] = useState(false);

  const policies = store.fupPolicies ?? [];
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const loadUsage = async () => {
    try {
      setUsage(await api.fupUsage());
    } catch (e) {
      store.toast(`Could not load usage: ${e.message}`);
    } finally {
      setLoadingUsage(false);
    }
  };

  useEffect(() => {
    loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies.length]);

  const action = useAction();

  const runNow = async () => {
    setEnforcing(true);
    try {
      // This throttles real customers. What it did should stay on screen long
      // enough to read, and to notice if the numbers are not what was expected.
      await action.run('Applying fair use', async () => {
        const r = await api.runFupEnforcement();
        await loadUsage();
        return r;
      }, {
        working: 'Totting up usage and comparing it with each policy…',
        describe: (r) => ({
          lines: [
            `${r.checked} subscriber(s) checked`,
            `${r.warned} warned`,
            `${r.throttled} throttled`,
            `${r.restored} restored to full speed`,
          ],
        }),
      });
    } catch {
      // Reported in the dialog.
    } finally {
      setEnforcing(false);
    }
  };

  const restore = async (u) => {
    try {
      await api.restoreFupSpeed(u.subscriberId);
      await loadUsage();
      store.toast(`${u.name} back on full speed`);
    } catch (e) {
      store.toast(`Could not restore: ${e.message}`);
    }
  };

  const gb = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
  const overCap = usage.filter((u) => u.throttled);
  const nearCap = usage.filter((u) => !u.throttled && u.pct >= 75);

  const openNew = () => setForm({ ...BLANK });
  const openEdit = (p) =>
    setForm({
      id: p.id,
      name: p.name,
      planId: p.plan_id ?? '',
      dataCapGb: p.data_cap_gb,
      windowPeriod: p.window_period,
      throttleDown: p.throttle_down,
      throttleUp: p.throttle_up,
      notifyAtPct: p.notify_at_pct,
      enabled: p.enabled,
    });

  const save = async () => {
    if (!form.name.trim()) return store.toast('Name the policy');
    if (!Number(form.dataCapGb)) return store.toast('Set a data cap in GB');
    setBusy(true);
    try {
      const saved = form.id ? await api.updateFupPolicy(form.id, form) : await api.createFupPolicy(form);
      store.setCollection('fupPolicies', (ps) =>
        form.id ? ps.map((p) => (p.id === saved.id ? saved : p)) : [...ps, saved]
      );
      store.toast(`${saved.name} ${form.id ? 'updated' : 'created'}`);
      setForm(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (p) => {
    try {
      const saved = await api.updateFupPolicy(p.id, {
        name: p.name,
        planId: p.plan_id,
        dataCapGb: p.data_cap_gb,
        windowPeriod: p.window_period,
        throttleDown: p.throttle_down,
        throttleUp: p.throttle_up,
        notifyAtPct: p.notify_at_pct,
        enabled: !p.enabled,
      });
      store.setCollection('fupPolicies', (ps) => ps.map((x) => (x.id === saved.id ? saved : x)));
      store.toast(`${saved.name} ${saved.enabled ? 'enabled' : 'paused'}`);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    }
  };

  const remove = async (p) => {
    try {
      await api.deleteFupPolicy(p.id);
      store.setCollection('fupPolicies', (ps) => ps.filter((x) => x.id !== p.id));
      store.toast(`${p.name} removed`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const active = policies.filter((p) => p.enabled);
  const tightest = active.reduce((min, p) => (min === null || Number(p.data_cap_gb) < min ? Number(p.data_cap_gb) : min), null);

  return (
    <Screen
      title="Fair use policy"
      subtitle="Caps and what happens once a line passes them. Applied on top of the plan's own speed."
      actions={
        <>
          <Button onClick={runNow} disabled={enforcing}>
            {enforcing ? 'Checking…' : 'Run check now'}
          </Button>
          <Button variant="primary" onClick={openNew}>
            + Add policy
          </Button>
        </>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Active policies" value={active.length} tone={active.length ? color.green : undefined} hint={`${policies.length} configured`} />
        <Stat label="Tightest cap" value={tightest === null ? '—' : `${tightest} GB`} hint="across active policies" />
        <Stat label="Near the cap" value={nearCap.length} tone={nearCap.length ? color.amberInk : undefined} hint="past 75% this window" />
        <Stat label="Throttled" value={overCap.length} tone={overCap.length ? color.rust : undefined} hint="running at reduced speed" />
      </Grid>

      <Card
        title="Usage this window"
        subtitle="Totalled from RADIUS session accounting. The enforcement job runs every 15 minutes."
      >
        <Table
          rowKey={(u) => `${u.subscriberId}-${u.windowPeriod}`}
          empty={
            loadingUsage
              ? 'Loading…'
              : policies.length === 0
              ? 'No policies yet — nothing is measured'
              : 'No subscribers matched an active policy'
          }
          rows={usage}
          columns={[
            { key: 'name', label: 'Client', render: (u) => <span style={{ fontWeight: 600 }}>{u.name}</span> },
            { key: 'policy', label: 'Policy' },
            { key: 'windowPeriod', label: 'Window' },
            {
              key: 'used',
              label: 'Used',
              align: 'right',
              render: (u) => (
                <span style={{ fontFamily: font.mono }}>
                  {gb(u.usedMb)} / {gb(u.capMb)}
                </span>
              ),
            },
            {
              key: 'bar',
              label: '',
              width: 150,
              render: (u) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Bar pct={u.pct} tone={u.pct >= 100 ? color.rust : u.pct >= 75 ? color.amber : color.green} />
                  <span style={{ fontSize: 11, color: u.pct >= 100 ? color.rust : color.muted }}>{u.pct}%</span>
                </div>
              ),
            },
            {
              key: 'state',
              label: 'State',
              render: (u) =>
                u.throttled ? (
                  <Badge tone="expired">throttled to {Math.round(u.throttleDown / 1000)} Mbps</Badge>
                ) : u.warned ? (
                  <Badge tone="grace">warned</Badge>
                ) : (
                  <Badge tone="active">full speed</Badge>
                ),
            },
            {
              key: 'act',
              label: '',
              align: 'right',
              render: (u) =>
                u.throttled ? (
                  <span onClick={() => restore(u)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    Restore speed
                  </span>
                ) : null,
            },
          ]}
        />
      </Card>

      <Card title="Policies" subtitle="Evaluated most specific first — a plan policy beats an all-plans one">
        <Table
          rowKey={(p) => p.id}
          empty="No fair-use policies — every line runs uncapped"
          rows={policies}
          columns={[
            { key: 'name', label: 'Policy', render: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span> },
            {
              key: 'scope',
              label: 'Applies to',
              render: (p) => (p.plan_title ? p.plan_title : <span style={{ color: color.muted }}>All plans</span>),
            },
            {
              key: 'cap',
              label: 'Cap',
              align: 'right',
              render: (p) => <span style={{ fontFamily: font.mono }}>{p.data_cap_gb} GB</span>,
            },
            { key: 'window_period', label: 'Window', render: (p) => windowLabel(p.window_period) },
            {
              key: 'throttle',
              label: 'Throttled to',
              render: (p) => (
                <span style={{ fontFamily: font.mono, fontSize: 12 }}>
                  {mbps(p.throttle_down)} / {mbps(p.throttle_up)}
                </span>
              ),
            },
            { key: 'notify_at_pct', label: 'Warn at', align: 'right', render: (p) => `${p.notify_at_pct}%` },
            {
              key: 'enabled',
              label: 'Status',
              render: (p) => <Badge tone={p.enabled ? 'active' : 'unused'}>{p.enabled ? 'Enforced' : 'Paused'}</Badge>,
            },
            {
              key: 'act',
              label: '',
              align: 'right',
              render: (p) => (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <span onClick={() => setViewing(p)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>View</span>
                  <span onClick={() => openEdit(p)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Edit</span>
                  <span onClick={() => toggleEnabled(p)} style={{ color: color.amberInk, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>
                    {p.enabled ? 'Pause' : 'Enable'}
                  </span>
                  <span onClick={() => remove(p)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Drawer open={!!viewing} title={viewing?.name} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <KV k="Applies to" v={viewing.plan_title ?? 'All plans'} />
            <KV k="Data cap" v={`${viewing.data_cap_gb} GB`} />
            <KV k="Window" v={windowLabel(viewing.window_period)} />
            <KV k="Throttled down to" v={mbps(viewing.throttle_down)} />
            <KV k="Throttled up to" v={mbps(viewing.throttle_up)} />
            <KV k="Warning SMS at" v={`${viewing.notify_at_pct}% of cap`} />
            <KV k="Status" v={viewing.enabled ? 'Enforced' : 'Paused'} />
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: color.muted }}>
                WARNING THRESHOLD
              </span>
              <div style={{ marginTop: 6 }}>
                <Bar pct={viewing.notify_at_pct} tone={color.amber} />
              </div>
              <span style={{ fontSize: 11.5, color: color.muted }}>
                Warn at {((viewing.data_cap_gb * viewing.notify_at_pct) / 100).toFixed(1)} GB of {viewing.data_cap_gb} GB
              </span>
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: color.neutralInk,
                background: color.tileBg,
                borderRadius: 8,
                padding: '10px 12px',
                lineHeight: 1.5,
              }}
            >
              Enforcement writes a reduced <code>Mikrotik-Rate-Limit</code> for the session,
              the same mechanism the walled garden uses. Usage resets at the start of each{' '}
              {viewing.window_period === 'monthly' ? 'calendar month' : viewing.window_period.replace('ly', '')}.
            </div>
          </>
        )}
      </Drawer>

      <Modal
        open={!!form}
        title={form?.id ? `Edit ${form.name}` : 'Add fair-use policy'}
        width={560}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : form?.id ? 'Save changes' : 'Create policy'}
            </Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Policy name" span={2}>
              <Input value={form.name} onChange={set('name')} placeholder="Home unlimited — 300 GB" />
            </Field>

            <Field label="Applies to" span={2} hint="A plan-specific policy overrides the all-plans one">
              <Select
                value={form.planId}
                onChange={set('planId')}
                options={[
                  { value: '', label: 'All plans' },
                  ...(store.plans ?? []).map((p) => ({ value: p.id, label: `${p.title} (${p.service})` })),
                ]}
              />
            </Field>

            <Field label="Data cap (GB)">
              <Input type="number" min="1" value={form.dataCapGb} onChange={set('dataCapGb')} />
            </Field>
            <Field label="Window">
              <Select value={form.windowPeriod} onChange={set('windowPeriod')} options={WINDOWS} />
            </Field>

            <Field label="Throttle download to" hint={mbps(form.throttleDown)}>
              <Select
                value={String(form.throttleDown)}
                onChange={set('throttleDown')}
                options={THROTTLE_PRESETS.map((k) => ({ value: String(k), label: mbps(k) }))}
              />
            </Field>
            <Field label="Throttle upload to" hint={mbps(form.throttleUp)}>
              <Select
                value={String(form.throttleUp)}
                onChange={set('throttleUp')}
                options={THROTTLE_PRESETS.map((k) => ({ value: String(k), label: mbps(k) }))}
              />
            </Field>

            <Field label="Warn the client at (% of cap)" span={2} hint={
              form.dataCapGb
                ? `SMS goes out at ${((Number(form.dataCapGb) * Number(form.notifyAtPct)) / 100).toFixed(1)} GB`
                : 'Set a cap to see the trigger point'
            }>
              <Input type="number" min="1" max="100" value={form.notifyAtPct} onChange={set('notifyAtPct')} />
            </Field>

            <div style={{ gridColumn: '1 / -1' }}>
              <Toggle
                checked={!!form.enabled}
                onChange={(v) => setForm((s) => ({ ...s, enabled: v }))}
                label="Enforce this policy"
                detail="Paused policies stay configured but do not throttle anyone"
              />
            </div>
          </div>
        )}
      </Modal>

      <ActionResult state={action.state} onClose={action.dismiss} />
    </Screen>
  );
}
