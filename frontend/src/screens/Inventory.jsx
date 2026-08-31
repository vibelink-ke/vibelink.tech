import React, { useMemo, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Textarea } from '../ui/primitives';

const CATEGORIES = ['Router', 'ONT', 'CPE', 'Switch', 'Cable', 'Antenna', 'Other'];
const STATUSES = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'installed', label: 'Installed' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'retired', label: 'Retired' },
];

const blank = () => ({
  name: '', category: 'Router', macAddress: '', serialNumber: '',
  ownedByTenant: true, subscriberId: '', routerId: '', status: 'in_stock', notes: '',
});

/**
 * Physical gadgets — routers, ONTs, CPEs — tracked whether they belong to
 * the ISP or to the client at whose premises they sit. The MAC address is
 * what actually survives a relabeling or a reassignment, which is the
 * point of tracking one at all: accountability that doesn't depend on
 * someone remembering which box is whose.
 */
export default function Inventory() {
  const store = useStore();
  const items = store.inventory ?? [];
  const [form, setForm] = useState(null);   // null = closed, object = open (new or editing)
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');   // all | ours | client | status:*

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const openNew = () => setForm(blank());
  const openEdit = (i) => setForm({
    id: i.id, name: i.name, category: i.category || 'Other', macAddress: i.mac_address || '',
    serialNumber: i.serial_number || '', ownedByTenant: i.owned_by_tenant,
    subscriberId: i.subscriber_id || '', routerId: i.router_id || '', status: i.status, notes: i.notes || '',
  });

  const save = async () => {
    if (!form.name.trim()) return store.toast('Give the gadget a name');
    setBusy(true);
    try {
      if (form.id) {
        await api.updateInventoryItem(form.id, form);
        store.toast(`${form.name} updated`);
      } else {
        await api.createInventoryItem(form);
        store.toast(`${form.name} added to inventory`);
      }
      store.setCollection('inventory', await api.inventory());
      setForm(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (i) => {
    if (!window.confirm(`Delete "${i.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteInventoryItem(i.id);
      store.setCollection('inventory', (xs) => xs.filter((x) => x.id !== i.id));
      store.toast(`${i.name} removed`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'ours') return items.filter((i) => i.owned_by_tenant);
    if (filter === 'client') return items.filter((i) => !i.owned_by_tenant);
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const oursCount = items.filter((i) => i.owned_by_tenant).length;

  return (
    <Screen
      title="Inventory"
      subtitle="Gadgets at client premises and in the store — whose they are, and which device is which by MAC address."
      actions={
        <Button variant="primary" onClick={openNew}>
          + Add gadget
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Total gadgets" value={items.length} />
        <Stat label="Ours" value={oursCount} hint="ours to recover if a client leaves" />
        <Stat label="Client-owned" value={items.length - oursCount} />
        <Stat label="Installed" value={items.filter((i) => i.status === 'installed').length} />
      </Grid>

      <Card
        title="Gadgets"
        actions={
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'ours', label: 'Ours' },
              { value: 'client', label: "Client-owned" },
              ...STATUSES,
            ]}
          />
        }
      >
        <Table
          rowKey={(i) => i.id}
          empty="No gadgets tracked yet"
          rows={filtered}
          columns={[
            {
              key: 'name', label: 'Gadget',
              render: (i) => (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{i.name}</span>
                  {i.category && <span style={{ fontSize: 11.5, color: color.muted }}>{i.category}</span>}
                </div>
              ),
            },
            {
              key: 'mac_address', label: 'MAC address',
              render: (i) => i.mac_address
                ? <span style={{ fontFamily: font.mono, fontSize: 12 }}>{i.mac_address}</span>
                : <span style={{ color: color.muted }}>—</span>,
            },
            {
              key: 'owned_by_tenant', label: 'Ownership',
              render: (i) => <Badge tone={i.owned_by_tenant ? 'active' : 'default'}>{i.owned_by_tenant ? 'Ours' : "Client's own"}</Badge>,
            },
            {
              key: 'subscriber_name', label: 'At premises',
              render: (i) => i.subscriber_name
                ? <span>{i.subscriber_name}{i.subscriber_account_code ? ` · ${i.subscriber_account_code}` : ''}</span>
                : <span style={{ color: color.muted }}>Unassigned</span>,
            },
            { key: 'router_name', label: 'Site / router', render: (i) => i.router_name ?? '—' },
            { key: 'status', label: 'Status', render: (i) => <Badge tone={i.status === 'faulty' ? 'suspended' : i.status === 'installed' ? 'active' : 'default'}>{i.status}</Badge> },
            {
              key: 'act', label: '', align: 'right',
              render: (i) => (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <span onClick={() => openEdit(i)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Edit</span>
                  <span onClick={() => remove(i)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!form}
        title={form?.id ? `Edit ${form.name}` : 'Add gadget'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : form?.id ? 'Save changes' : 'Add gadget'}
            </Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Gadget name" span={2} hint="e.g. TP-Link CPE210, MikroTik hAP lite">
              <Input value={form.name} onChange={set('name')} placeholder="TP-Link CPE210" />
            </Field>
            <Field label="Category">
              <Select value={form.category} onChange={set('category')} options={CATEGORIES} />
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={set('status')} options={STATUSES} />
            </Field>
            <Field label="MAC address" hint="Survives a relabel or reassignment — the real identifier">
              <Input value={form.macAddress} onChange={set('macAddress')} placeholder="AA:BB:CC:DD:EE:FF" style={{ fontFamily: font.mono }} />
            </Field>
            <Field label="Serial number" hint="Optional">
              <Input value={form.serialNumber} onChange={set('serialNumber')} />
            </Field>
            <Field label="Ownership" span={2} hint="Whose gadget is this — the ISP's, or the client's own?">
              <Select
                value={form.ownedByTenant ? 'ours' : 'client'}
                onChange={(e) => setForm((s) => ({ ...s, ownedByTenant: e.target.value === 'ours' }))}
                options={[{ value: 'ours', label: 'Ours — recover it if the client leaves' }, { value: 'client', label: "Client's own — nothing to recover" }]}
              />
            </Field>
            <Field label="Installed at (client)" span={2}>
              <Select
                value={form.subscriberId}
                onChange={set('subscriberId')}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...store.clients.map((c) => ({ value: c.id, label: `${c.name} · ${c.account_code}` })),
                ]}
              />
            </Field>
            <Field label="Site / router" span={2} hint="Optional — for gear tied to a site rather than one client">
              <Select
                value={form.routerId}
                onChange={set('routerId')}
                options={[{ value: '', label: 'None' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
              />
            </Field>
            <Field label="Notes" span={2}>
              <Textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Any other detail worth keeping" />
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
