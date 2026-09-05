import React, { useState } from 'react';
import { color, font, kes } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Drawer, Field, Input, KV, Modal, Screen, Select, Table } from '../../ui/primitives';

const BLANK = { title: '', price: '', durationCount: '3', durationUnit: 'Hours', devices: '1', speed: '', dataCap: 'Unlimited' };
const UNITS = ['Minutes', 'Hours', 'Days', 'Weeks', 'Months'];
const CAPS = ['Unlimited', '250 MB', '500 MB', '1 GB', '2 GB', '5 GB'];

const duration = (mins) => {
  if (!mins) return '—';
  if (mins % 43200 === 0) return `${mins / 43200} month(s)`;
  if (mins % 10080 === 0) return `${mins / 10080} week(s)`;
  if (mins % 1440 === 0) return `${mins / 1440} day(s)`;
  if (mins % 60 === 0) return `${mins / 60} hour(s)`;
  return `${mins} min`;
};

const UNIT_MINUTES = { Minutes: 1, Hours: 60, Days: 1440, Weeks: 10080, Months: 43200 };
const CAP_MB = { Unlimited: null, '250 MB': 250, '500 MB': 500, '1 GB': 1024, '2 GB': 2048, '5 GB': 5120 };

/**
 * The reverse of UNIT_MINUTES — turning a stored duration_min back into the
 * count+unit pair the form edits. Picks the largest unit that divides it
 * evenly, same rule the read-only duration() label above already uses, so a
 * bundle created as "3 Hours" reopens as "3 Hours" rather than "180 Minutes".
 */
function minutesToCountUnit(mins) {
  const m = Number(mins) || 0;
  if (m && m % 43200 === 0) return { durationCount: String(m / 43200), durationUnit: 'Months' };
  if (m && m % 10080 === 0) return { durationCount: String(m / 10080), durationUnit: 'Weeks' };
  if (m && m % 1440 === 0) return { durationCount: String(m / 1440), durationUnit: 'Days' };
  if (m && m % 60 === 0) return { durationCount: String(m / 60), durationUnit: 'Hours' };
  return { durationCount: String(m || 1), durationUnit: 'Minutes' };
}

/** The reverse of CAP_MB — nearest labelled option, or Unlimited for null/0. */
function mbToCapLabel(mb) {
  if (!mb) return 'Unlimited';
  const found = Object.entries(CAP_MB).find(([, v]) => v === mb);
  return found ? found[0] : 'Unlimited';
}

export default function HotspotPlans() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const payload = (v) => ({
    title: v.title,
    price: Number(v.price),
    durationMin: (Number(v.durationCount) || 1) * UNIT_MINUTES[v.durationUnit],
    devices: Number(v.devices) || 1,
    rateDown: (Number(v.speed) || 0) * 1000,
    rateUp: (Number(v.speed) || 0) * 1000,
    dataCapMb: CAP_MB[v.dataCap] ?? null,
  });

  const create = async () => {
    if (!f.title.trim() || !f.price) return store.toast('Title and price are required');
    setBusy(true);
    try {
      const created = await api.createPlan({ service: 'hotspot', ...payload(f) });
      store.setCollection('hsPlans', (ps) => [...ps, created]);
      store.toast(`${created.title} added to the portal`);
      setOpen(false);
      setF(BLANK);
    } catch (e) {
      store.toast(`Could not create: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing.title?.trim() || !editing.price) return store.toast('Title and price are required');
    try {
      const updated = await api.updatePlan(editing.id, payload(editing));
      store.setCollection('hsPlans', (ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
      store.toast(`${updated.title} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete ${p.title}? This removes it from the database. A voucher already sold on this bundle keeps working — only the bundle itself, and the ability to sell it again, goes away.`)) return;
    try {
      const res = await api.deletePlan(p.id);
      store.setCollection('hsPlans', (ps) => ps.filter((x) => x.id !== p.id));
      // A plan named on an invoice cannot be destroyed without blanking the
      // plan on a bill already sent, so the server keeps it and says so.
      store.toast(res?.kept ? res.message : `${p.title} deleted`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const editFrom = (p) => ({
    id: p.id,
    title: p.title,
    price: p.price,
    devices: p.devices ?? 1,
    speed: p.rate_down ? p.rate_down / 1000 : '',
    dataCap: mbToCapLabel(p.data_cap_mb),
    ...minutesToCountUnit(p.duration_min),
  });

  const fields = (v, update) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Field label="Title" span={2}>
        <Input value={v.title} onChange={update('title')} placeholder="3 hours unlimited" />
      </Field>
      <Field label="Price (KES)">
        <Input value={v.price} onChange={update('price')} type="number" />
      </Field>
      <Field label="Devices">
        <Input value={v.devices} onChange={update('devices')} type="number" />
      </Field>
      <Field label="Duration">
        <Input value={v.durationCount} onChange={update('durationCount')} type="number" />
      </Field>
      <Field label="Unit">
        <Select value={v.durationUnit} onChange={update('durationUnit')} options={UNITS} />
      </Field>
      <Field label="Speed (Mbps)">
        <Input value={v.speed} onChange={update('speed')} type="number" />
      </Field>
      <Field label="Data cap">
        <Select value={v.dataCap} onChange={update('dataCap')} options={CAPS} />
      </Field>
    </div>
  );

  return (
    <Screen
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Create bundle
        </Button>
      }
    >
      <Card title="Hotspot bundles" subtitle="What the captive portal offers. Served by GET /portal/plans.">
        <Table
          rowKey={(p) => p.id}
          empty="No bundles yet — the portal has nothing to sell"
          rows={store.hsPlans ?? []}
          columns={[
            { key: 'title', label: 'Bundle', render: (p) => <span style={{ fontWeight: 600 }}>{p.title}</span> },
            { key: 'price', label: 'Price', render: (p) => <span style={{ fontFamily: font.mono }}>KES {kes(p.price)}</span> },
            { key: 'duration_min', label: 'Duration', render: (p) => duration(p.duration_min) },
            { key: 'devices', label: 'Devices', align: 'right' },
            { key: 'rate_down', label: 'Speed', render: (p) => (p.rate_down ? `${Math.round(p.rate_down / 1000)} Mbps` : '—') },
            {
              key: 'data_cap_mb',
              label: 'Data cap',
              render: (p) => (p.data_cap_mb ? `${p.data_cap_mb} MB` : <span style={{ color: color.muted }}>Unlimited</span>),
            },
            {
              key: 'act',
              label: '',
              align: 'right',
              render: (p) => (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <span onClick={() => setViewing(p)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>View</span>
                  <span onClick={() => setEditing(editFrom(p))} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Edit</span>
                  <span onClick={() => remove(p)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title="Create bundle"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? 'Saving…' : 'Create bundle'}
            </Button>
          </>
        }
      >
        {fields(f, set)}
      </Modal>

      <Drawer open={!!viewing} title={viewing?.title} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <KV k="Price" v={`KES ${kes(viewing.price)}`} />
            <KV k="Duration" v={duration(viewing.duration_min)} />
            <KV k="Devices" v={viewing.devices ?? 1} />
            <KV k="Speed" v={viewing.rate_down ? `${Math.round(viewing.rate_down / 1000)} Mbps` : '—'} />
            <KV k="Data cap" v={viewing.data_cap_mb ? `${viewing.data_cap_mb} MB` : 'Unlimited'} />
            <KV k="Active" v={viewing.active ? 'Yes' : 'No'} />
            <KV k="Rate limit sent to RADIUS" v={`${viewing.rate_up ?? 0}k/${viewing.rate_down ?? 0}k`} />
          </>
        )}
      </Drawer>

      <Modal
        open={!!editing}
        title={`Edit ${editing?.title ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>Save changes</Button>
          </>
        }
      >
        {editing && fields(editing, (k) => (e) => setEditing((s) => ({ ...s, [k]: e.target.value })))}
      </Modal>
    </Screen>
  );
}
