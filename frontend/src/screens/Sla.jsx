import React, { useMemo, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Bar, Button, Card, Drawer, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table, Tabs, Toggle } from '../ui/primitives';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const HOURS = [
  '24/7',
  'Mon–Fri 08:00–17:00',
  'Mon–Sat 08:00–18:00',
  'Mon–Sun 06:00–22:00',
];

const BLANK = {
  name: '',
  priority: 'high',
  respondMins: '60',
  resolveMins: '480',
  uptime: '99.5',
  businessHours: '24/7',
  escalateTo: '',
  enabled: true,
};

const mins = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 60) return `${v} min`;
  if (v % 60 === 0) return `${v / 60} h`;
  return `${Math.floor(v / 60)} h ${v % 60} min`;
};

export default function Sla() {
  const store = useStore();
  const [tab, setTab] = useState('policies');
  const [form, setForm] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);

  const policies = store.slaPolicies ?? [];
  const tickets = store.tickets ?? [];
  const staff = store.staff ?? [];
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const openNew = () => setForm({ ...BLANK });
  const openEdit = (p) =>
    setForm({
      id: p.id,
      name: p.name,
      priority: p.priority,
      respondMins: String(p.respond_mins),
      resolveMins: String(p.resolve_mins),
      uptime: String(p.uptime),
      businessHours: p.business_hours ?? '24/7',
      escalateTo: p.escalate_to ?? '',
      enabled: p.enabled !== false,
    });

  const save = async () => {
    if (!form.name.trim()) return store.toast('Name the policy');
    setBusy(true);
    const payload = {
      name: form.name,
      priority: form.priority,
      respondMins: Number(form.respondMins) || 60,
      resolveMins: Number(form.resolveMins) || 480,
      uptime: Number(form.uptime) || 99.5,
      businessHours: form.businessHours,
      escalateTo: form.escalateTo || null,
      enabled: form.enabled,
    };
    try {
      const saved = form.id ? await api.updateSlaPolicy(form.id, payload) : await api.createSlaPolicy(payload);
      store.setCollection('slaPolicies', (ps) =>
        ps.some((p) => p.id === saved.id) ? ps.map((p) => (p.id === saved.id ? saved : p)) : [...ps, saved]
      );
      store.toast(`${saved.name} ${form.id ? 'updated' : 'added'}`);
      setForm(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const togglePolicy = async (p) => {
    try {
      const saved = await api.updateSlaPolicy(p.id, { enabled: !p.enabled });
      store.setCollection('slaPolicies', (ps) => ps.map((x) => (x.id === saved.id ? saved : x)));
      store.toast(`${saved.name} ${saved.enabled ? 'active' : 'paused'}`);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    }
  };

  const remove = async (p) => {
    try {
      await api.deleteSlaPolicy(p.id);
      store.setCollection('slaPolicies', (ps) => ps.filter((x) => x.id !== p.id));
      store.toast(`${p.name} removed`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const openTickets = tickets.filter((t) => t.status !== 'resolved');

  /** How far through its resolve target each open ticket is. */
  const tracked = useMemo(
    () =>
      openTickets.map((t) => {
        const policy = policies.find((p) => p.priority === t.priority && p.enabled !== false);
        if (!policy || !t.created_at) return { ...t, pct: null, policy: null };
        const elapsed = (Date.now() - new Date(t.created_at)) / 60000;
        return { ...t, policy, pct: (elapsed / Number(policy.resolve_mins)) * 100, elapsed };
      }),
    [openTickets, policies]
  );

  const breaching = tracked.filter((t) => t.pct !== null && t.pct > 100);
  const atRisk = tracked.filter((t) => t.pct !== null && t.pct > 75 && t.pct <= 100);
  const uncovered = tracked.filter((t) => t.pct === null);
  const staffName = (id) => staff.find((s) => s.id === id)?.name ?? '—';

  return (
    <Screen
      title="SLA management"
      subtitle="Response and resolution targets, and how the open tickets are tracking against them."
      actions={
        <Button variant="primary" onClick={openNew}>
          + Add policy
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Policies" value={policies.length} hint={`${policies.filter((p) => p.enabled !== false).length} active`} />
        <Stat label="Breaching" value={breaching.length} tone={breaching.length ? color.rust : undefined} hint="past the resolve target" />
        <Stat label="At risk" value={atRisk.length} tone={atRisk.length ? color.amberInk : undefined} hint="over 75% of target" />
        <Stat label="Uncovered" value={uncovered.length} hint="no policy for that priority" />
      </Grid>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'policies', label: 'Policies' },
          { id: 'tracking', label: `Ticket tracking (${openTickets.length})` },
        ]}
      />

      {tab === 'policies' ? (
        <Card title="Policies">
          <Table
            rowKey={(p) => p.id}
            empty="No SLA policies yet"
            rows={policies}
            columns={[
              { key: 'name', label: 'Policy', render: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span> },
              { key: 'priority', label: 'Applies to', render: (p) => <Badge tone="default">{p.priority}</Badge> },
              { key: 'respond_mins', label: 'Respond within', render: (p) => mins(p.respond_mins) },
              { key: 'resolve_mins', label: 'Resolve within', render: (p) => mins(p.resolve_mins) },
              { key: 'business_hours', label: 'Cover', render: (p) => p.business_hours ?? '24/7' },
              { key: 'uptime', label: 'Uptime', align: 'right', render: (p) => <span style={{ fontFamily: font.mono }}>{p.uptime}%</span> },
              {
                key: 'enabled',
                label: 'Status',
                render: (p) => <Badge tone={p.enabled !== false ? 'active' : 'unused'}>{p.enabled !== false ? 'Active' : 'Paused'}</Badge>,
              },
              {
                key: 'act',
                label: '',
                align: 'right',
                render: (p) => (
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <span onClick={() => setViewing(p)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>View</span>
                    <span onClick={() => openEdit(p)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Edit</span>
                    <span onClick={() => togglePolicy(p)} style={{ color: color.amberInk, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>
                      {p.enabled !== false ? 'Pause' : 'Activate'}
                    </span>
                    <span onClick={() => remove(p)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      ) : (
        <Card title="Open tickets against SLA" subtitle="Sorted by how close they are to breaching">
          <Table
            rowKey={(t) => t.id}
            empty="No open tickets"
            rows={[...tracked].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))}
            columns={[
              { key: 'number', label: 'Ref', render: (t) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{t.number}</span> },
              { key: 'subject', label: 'Subject' },
              { key: 'priority', label: 'Priority', render: (t) => <Badge tone="default">{t.priority}</Badge> },
              { key: 'policy', label: 'Policy', render: (t) => t.policy?.name ?? <span style={{ color: color.muted }}>none</span> },
              { key: 'age', label: 'Age', render: (t) => (t.elapsed ? mins(Math.round(t.elapsed)) : '—') },
              {
                key: 'bar',
                label: 'Against target',
                width: 150,
                render: (t) =>
                  t.pct === null ? (
                    <span style={{ color: color.muted, fontSize: 12 }}>no policy</span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <Bar pct={t.pct} tone={t.pct > 100 ? color.rust : t.pct > 75 ? color.amber : color.green} />
                      <span style={{ fontSize: 11, color: t.pct > 100 ? color.rust : color.muted }}>
                        {Math.round(t.pct)}% {t.pct > 100 ? '· breached' : ''}
                      </span>
                    </div>
                  ),
              },
            ]}
          />
        </Card>
      )}

      <Drawer open={!!viewing} title={viewing?.name} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <KV k="Applies to priority" v={viewing.priority} />
            <KV k="Respond within" v={mins(viewing.respond_mins)} />
            <KV k="Resolve within" v={mins(viewing.resolve_mins)} />
            <KV k="Cover" v={viewing.business_hours ?? '24/7'} />
            <KV k="Uptime target" v={`${viewing.uptime}%`} />
            <KV k="Escalate to" v={viewing.escalate_to ? staffName(viewing.escalate_to) : 'Nobody set'} />
            <KV k="Status" v={viewing.enabled !== false ? 'Active' : 'Paused'} />

            <div style={{ marginTop: 8, borderTop: `1px solid ${color.line}`, paddingTop: 12 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: color.muted }}>
                TICKETS UNDER THIS POLICY
              </span>
              {tracked.filter((t) => t.policy?.id === viewing.id).length === 0 ? (
                <p style={{ margin: '8px 0 0', fontSize: 12.5, color: color.muted }}>None open right now.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {tracked
                    .filter((t) => t.policy?.id === viewing.id)
                    .map((t) => (
                      <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                          <span>{t.subject}</span>
                          <span style={{ fontFamily: font.mono, color: t.pct > 100 ? color.rust : color.muted }}>
                            {Math.round(t.pct)}%
                          </span>
                        </div>
                        <Bar pct={t.pct} tone={t.pct > 100 ? color.rust : t.pct > 75 ? color.amber : color.green} />
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </Drawer>

      <Modal
        open={!!form}
        title={form?.id ? `Edit ${form.name}` : 'Add SLA policy'}
        width={560}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : form?.id ? 'Save changes' : 'Add policy'}
            </Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" span={2}>
              <Input value={form.name} onChange={set('name')} placeholder="Business lines" />
            </Field>
            <Field label="Applies to priority">
              <Select value={form.priority} onChange={set('priority')} options={PRIORITIES} />
            </Field>
            <Field label="Uptime target (%)">
              <Input value={form.uptime} onChange={set('uptime')} type="number" step="0.1" />
            </Field>
            <Field label="Respond within (min)" hint={mins(form.respondMins)}>
              <Input value={form.respondMins} onChange={set('respondMins')} type="number" />
            </Field>
            <Field label="Resolve within (min)" hint={mins(form.resolveMins)}>
              <Input value={form.resolveMins} onChange={set('resolveMins')} type="number" />
            </Field>
            <Field label="Cover" hint="When the clock runs">
              <Select value={form.businessHours} onChange={set('businessHours')} options={HOURS} />
            </Field>
            <Field label="Escalate to" hint="Pinged when a ticket breaches">
              <Select
                value={form.escalateTo}
                onChange={set('escalateTo')}
                options={[{ value: '', label: staff.length ? 'Nobody' : 'No staff yet' }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
              />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Toggle
                checked={!!form.enabled}
                onChange={(v) => setForm((s) => ({ ...s, enabled: v }))}
                label="Policy active"
                detail="Paused policies stop counting against open tickets"
              />
            </div>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
