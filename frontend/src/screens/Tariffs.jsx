import React, { useMemo, useState } from 'react';
import { color, font, kes, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Drawer, Field, Input, KV, Modal, Screen, Table } from '../ui/primitives';

/**
 * PPPoE tariffs — which are rows in `plans`, not the old `tariffs` table.
 *
 * They used to be separate catalogues of the same idea, and only `plans` was
 * connected to anything: subscribers.plan_id references it, activateSubscriber
 * reads its rates into radreply, and fair use measures against its cap. Creating
 * a "tariff" therefore produced something no other screen could see — you would
 * add one, open the client form, and be told there were no plans yet.
 */
const PERIODS = [
  { value: 43200, label: 'Monthly' },
  { value: 10080, label: 'Weekly' },
  { value: 1440, label: 'Daily' },
];

const BLANK = { title: '', price: '', speedDown: '', speedUp: '', capGb: '', durationMin: 43200 };

const mbps = (kbps) => (kbps ? Math.round(kbps / 1000) : 0);
const speed = (p) => (p.rate_down ? `${mbps(p.rate_down)}/${mbps(p.rate_up)} Mbps` : '—');
const periodLabel = (m) => PERIODS.find((x) => x.value === Number(m))?.label ?? `${m} min`;
const capLabel = (p) => (p.data_cap_mb ? `${Math.round(p.data_cap_mb / 1024)} GB` : 'Uncapped');

const selectStyle = {
  padding: '7px 10px', border: `1px solid ${color.line}`, borderRadius: radius.md,
  background: color.subtleBg, fontSize: 13, width: '100%',
};

export default function Tariffs() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);

  const tariffs = useMemo(
    () => (store.plans ?? []).filter((p) => p.service === 'pppoe'),
    [store.plans]
  );

  // A direct plan_id match now, rather than guessing by matching titles across
  // two tables — which meant the count sat at 0 unless the names happened to align.
  const subsPerPlan = useMemo(() => {
    const out = {};
    for (const c of store.clients ?? []) out[c.plan_id] = (out[c.plan_id] ?? 0) + 1;
    return out;
  }, [store.clients]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const payload = (v) => ({
    title: v.title,
    price: Number(v.price),
    durationMin: Number(v.durationMin) || 43200,
    rateDown: Number(v.speedDown) * 1000 || 0,
    rateUp: Number(v.speedUp) * 1000 || 0,
    dataCapMb: v.capGb === '' || v.capGb == null ? null : Math.round(Number(v.capGb) * 1024),
  });

  const create = async () => {
    if (!f.title.trim() || !f.price) return store.toast('Title and price are required');
    setBusy(true);
    try {
      const created = await api.createPlan({ service: 'pppoe', ...payload(f) });
      store.setCollection('plans', (ps) => [...ps, created]);
      store.toast(`${created.title} created — it is now selectable on the client form`);
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
      store.setCollection('plans', (ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
      store.toast(`${updated.title} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
  };

  const remove = async (p) => {
    const inUse = subsPerPlan[p.id] ?? 0;
    if (inUse && !window.confirm(`${inUse} subscriber${inUse === 1 ? '' : 's'} are on ${p.title}. Retire it anyway? They keep their current speed until moved to another plan.`))
      return;
    try {
      await api.deletePlan(p.id);
      store.setCollection('plans', (ps) => ps.filter((x) => x.id !== p.id));
      store.toast(`${p.title} retired`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const editFrom = (p) => ({
    id: p.id,
    title: p.title,
    price: p.price,
    speedDown: p.rate_down ? p.rate_down / 1000 : '',
    speedUp: p.rate_up ? p.rate_up / 1000 : '',
    capGb: p.data_cap_mb ? Math.round(p.data_cap_mb / 1024) : '',
    durationMin: p.duration_min ?? 43200,
  });

  const fields = (v, update) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Field label="Title" span={2}>
        <Input value={v.title} onChange={update('title')} placeholder="Home 10 Mbps" />
      </Field>
      <Field label="Price (KES)">
        <Input value={v.price} onChange={update('price')} type="number" />
      </Field>
      <Field label="Billing period">
        <select value={v.durationMin} onChange={update('durationMin')} style={selectStyle}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </Field>
      <Field label="Download (Mbps)">
        <Input value={v.speedDown} onChange={update('speedDown')} type="number" />
      </Field>
      <Field label="Upload (Mbps)">
        <Input value={v.speedUp} onChange={update('speedUp')} type="number" />
      </Field>
      <Field label="Data cap (GB)" span={2}>
        <Input value={v.capGb} onChange={update('capGb')} type="number" placeholder="leave blank for uncapped" />
      </Field>
      <span style={{ gridColumn: '1 / -1', fontSize: 12, color: color.muted }}>
        Speeds become the Mikrotik-Rate-Limit sent to the router when a payment activates the
        subscriber. The cap is what Fair use policy measures against.
      </span>
    </div>
  );

  return (
    <Screen
      title="Internet tariffs"
      subtitle="PPPoE pricing tiers. These are what Clients get billed against each cycle, and what the client form offers under Plan."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Create service plan
        </Button>
      }
    >
      <Card pad={0}>
        <div style={{ padding: '4px 20px 10px' }}>
          <Table
            rowKey={(p) => p.id}
            empty="No tariffs yet — create your first pricing tier"
            rows={tariffs}
            columns={[
              { key: 'title', label: 'Title', render: (p) => <span style={{ fontWeight: 600 }}>{p.title}</span> },
              { key: 'price', label: 'Price', render: (p) => <span style={{ fontFamily: font.mono }}>KES {kes(p.price)}</span> },
              { key: 'period', label: 'Period', render: (p) => periodLabel(p.duration_min) },
              { key: 'speed', label: 'Speed', render: speed },
              { key: 'cap', label: 'Data cap', render: (p) => <span style={{ color: color.neutralInk }}>{capLabel(p)}</span> },
              { key: 'subs', label: 'Subscribers', render: (p) => <span style={{ fontFamily: font.mono }}>{subsPerPlan[p.id] ?? 0}</span> },
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
        </div>
      </Card>

      <Modal
        open={open}
        title="Create service plan"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? 'Saving…' : 'Create plan'}
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
            <KV k="Billing period" v={periodLabel(viewing.duration_min)} />
            <KV k="Download" v={viewing.rate_down ? `${mbps(viewing.rate_down)} Mbps` : '—'} />
            <KV k="Upload" v={viewing.rate_up ? `${mbps(viewing.rate_up)} Mbps` : '—'} />
            <KV k="Data cap" v={capLabel(viewing)} />
            <KV k="Subscribers" v={subsPerPlan[viewing.id] ?? 0} />
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
