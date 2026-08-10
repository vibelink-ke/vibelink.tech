import React, { useMemo, useState } from 'react';
import { color, font, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Drawer, Field, Input, KV, Modal, Screen, Table } from '../ui/primitives';

const BLANK = { title: '', price: '', speedDown: '', speedUp: '', fairUse: '' };
const speed = (t) => (t.speed_down ? `${Math.round(t.speed_down / 1000)}/${Math.round((t.speed_up ?? 0) / 1000)} Mbps` : '—');

export default function Tariffs() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);

  const saveEdit = async () => {
    if (!editing.title?.trim() || !editing.price) return store.toast('Title and price are required');
    try {
      const updated = await api.updateTariff(editing.id, {
        title: editing.title,
        price: Number(editing.price),
        speedDown: Number(editing.speedDown) * 1000 || 0,
        speedUp: Number(editing.speedUp) * 1000 || 0,
        fairUse: editing.fairUse || null,
      });
      store.setCollection('tariffs', (ts) => ts.map((t) => (t.id === updated.id ? updated : t)));
      store.toast(`${updated.title} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
  };

  // schema.sql has no FK from subscribers to tariffs — subscribers.plan_id points at
  // `plans`. Tariffs and plans are parallel catalogues, so the only link available is
  // the title. Counts stay 0 until a plan of the same name exists.
  const subsPerTariff = useMemo(() => {
    const planIdsByTitle = new Map();
    for (const p of store.plans ?? []) {
      if (!planIdsByTitle.has(p.title)) planIdsByTitle.set(p.title, new Set());
      planIdsByTitle.get(p.title).add(p.id);
    }
    const out = {};
    for (const t of store.tariffs ?? []) {
      const ids = planIdsByTitle.get(t.title);
      out[t.id] = ids ? (store.clients ?? []).filter((c) => ids.has(c.plan_id)).length : 0;
    }
    return out;
  }, [store.clients, store.plans, store.tariffs]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const create = async () => {
    if (!f.title.trim() || !f.price) return store.toast('Title and price are required');
    setBusy(true);
    try {
      const created = await api.createTariff({
        title: f.title,
        price: Number(f.price),
        speedDown: Number(f.speedDown) * 1000 || 0,
        speedUp: Number(f.speedUp) * 1000 || 0,
        fairUse: f.fairUse || null,
      });
      store.setCollection('tariffs', (ts) => [...ts, created]);
      store.toast('Service plan created');
      setOpen(false);
      setF(BLANK);
    } catch (e) {
      store.toast(`Could not create: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t) => {
    try {
      await api.deleteTariff(t.id);
      store.setCollection('tariffs', (ts) => ts.filter((x) => x.id !== t.id));
      store.toast(`${t.title} deactivated`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  return (
    <Screen
      title="Internet tariffs"
      subtitle="PPPoE pricing tiers. These are what Clients get billed against each cycle."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Create service plan
        </Button>
      }
    >
      <Card pad={0}>
        <div style={{ padding: '4px 20px 10px' }}>
          <Table
            rowKey={(t) => t.id}
            empty="No tariffs yet — create your first pricing tier"
            rows={store.tariffs ?? []}
            columns={[
              { key: 'title', label: 'Title', render: (t) => <span style={{ fontWeight: 600 }}>{t.title}</span> },
              { key: 'price', label: 'Monthly price', render: (t) => <span style={{ fontFamily: font.mono }}>KES {kes(t.price)}</span> },
              { key: 'speed', label: 'Speed', render: speed },
              { key: 'fair_use', label: 'Fair use', render: (t) => <span style={{ color: color.neutralInk }}>{t.fair_use ?? 'None'}</span> },
              { key: 'subs', label: 'Subscribers', render: (t) => <span style={{ fontFamily: font.mono }}>{subsPerTariff[t.id] ?? 0}</span> },
              {
                key: 'act',
                label: '',
                align: 'right',
                render: (t) => (
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <span onClick={() => setViewing(t)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>View</span>
                    <span
                      onClick={() =>
                        setEditing({
                          id: t.id,
                          title: t.title,
                          price: t.price,
                          speedDown: t.speed_down ? t.speed_down / 1000 : '',
                          speedUp: t.speed_up ? t.speed_up / 1000 : '',
                          fairUse: t.fair_use ?? '',
                        })
                      }
                      style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}
                    >
                      Edit
                    </span>
                    <span onClick={() => remove(t)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Title" span={2}>
            <Input value={f.title} onChange={set('title')} placeholder="Home 10 Mbps" />
          </Field>
          <Field label="Monthly price (KES)">
            <Input value={f.price} onChange={set('price')} type="number" />
          </Field>
          <Field label="Fair use">
            <Input value={f.fairUse} onChange={set('fairUse')} placeholder="None" />
          </Field>
          <Field label="Download (Mbps)">
            <Input value={f.speedDown} onChange={set('speedDown')} type="number" />
          </Field>
          <Field label="Upload (Mbps)">
            <Input value={f.speedUp} onChange={set('speedUp')} type="number" />
          </Field>
        </div>
      </Modal>

      <Drawer open={!!viewing} title={viewing?.title} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <KV k="Monthly price" v={`KES ${kes(viewing.price)}`} />
            <KV k="Download" v={viewing.speed_down ? `${viewing.speed_down / 1000} Mbps` : '—'} />
            <KV k="Upload" v={viewing.speed_up ? `${viewing.speed_up / 1000} Mbps` : '—'} />
            <KV k="Fair use" v={viewing.fair_use ?? 'None'} />
            <KV k="Subscribers" v={subsPerTariff[viewing.id] ?? 0} />
            <KV k="Active" v={viewing.active ? 'Yes' : 'No'} />
            <KV k="Rate limit sent to RADIUS" v={`${(viewing.speed_up ?? 0) / 1000}M/${(viewing.speed_down ?? 0) / 1000}M`} />
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
        {editing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Title" span={2}>
              <Input value={editing.title} onChange={(e) => setEditing((s) => ({ ...s, title: e.target.value }))} />
            </Field>
            <Field label="Monthly price (KES)">
              <Input type="number" value={editing.price} onChange={(e) => setEditing((s) => ({ ...s, price: e.target.value }))} />
            </Field>
            <Field label="Fair use">
              <Input value={editing.fairUse} onChange={(e) => setEditing((s) => ({ ...s, fairUse: e.target.value }))} />
            </Field>
            <Field label="Download (Mbps)">
              <Input type="number" value={editing.speedDown} onChange={(e) => setEditing((s) => ({ ...s, speedDown: e.target.value }))} />
            </Field>
            <Field label="Upload (Mbps)">
              <Input type="number" value={editing.speedUp} onChange={(e) => setEditing((s) => ({ ...s, speedUp: e.target.value }))} />
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
