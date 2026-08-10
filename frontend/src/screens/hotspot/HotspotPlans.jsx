import React, { useState } from 'react';
import { color, font, kes } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Field, Input, Modal, Screen, Select, Table } from '../../ui/primitives';

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

export default function HotspotPlans() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const create = async () => {
    if (!f.title.trim() || !f.price) return store.toast('Title and price are required');
    setBusy(true);
    try {
      const created = await api.createPlan({
        service: 'hotspot',
        title: f.title,
        price: Number(f.price),
        durationMin: (Number(f.durationCount) || 1) * UNIT_MINUTES[f.durationUnit],
        devices: Number(f.devices) || 1,
        rateDown: (Number(f.speed) || 0) * 1000,
        rateUp: (Number(f.speed) || 0) * 1000,
        dataCapMb: CAP_MB[f.dataCap] ?? null,
      });
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Title" span={2}>
            <Input value={f.title} onChange={set('title')} placeholder="3 hours unlimited" />
          </Field>
          <Field label="Price (KES)">
            <Input value={f.price} onChange={set('price')} type="number" />
          </Field>
          <Field label="Devices">
            <Input value={f.devices} onChange={set('devices')} type="number" />
          </Field>
          <Field label="Duration">
            <Input value={f.durationCount} onChange={set('durationCount')} type="number" />
          </Field>
          <Field label="Unit">
            <Select value={f.durationUnit} onChange={set('durationUnit')} options={UNITS} />
          </Field>
          <Field label="Speed (Mbps)">
            <Input value={f.speed} onChange={set('speed')} type="number" />
          </Field>
          <Field label="Data cap">
            <Select value={f.dataCap} onChange={set('dataCap')} options={CAPS} />
          </Field>
        </div>
      </Modal>
    </Screen>
  );
}
