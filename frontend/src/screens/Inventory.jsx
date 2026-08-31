import React, { useMemo, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Drawer, Empty, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Textarea } from '../ui/primitives';

const CATEGORIES = ['Router', 'ONT', 'CPE', 'Switch', 'Cable', 'Connector', 'Antenna', 'Other'];
const STATUSES = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'installed', label: 'Installed' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'retired', label: 'Retired' },
];
const LOCATION_LABEL = { warehouse: 'Warehouse', van: 'Van', premises: 'Premises', repair_bench: 'Repair bench' };

const blank = () => ({
  name: '', category: 'Router', macAddress: '', serialNumber: '',
  ownedByTenant: true, subscriberId: '', routerId: '', status: 'in_stock', notes: '', quantity: '1', unit: '',
});

function locationText(i) {
  if (i.location === 'van') return `Van — ${i.assigned_staff_name ?? 'unassigned'}`;
  if (i.location === 'premises') return i.subscriber_name ? `Premises — ${i.subscriber_name}` : 'Premises';
  if (i.location === 'repair_bench') return 'Repair bench';
  return i.router_name ? `Warehouse (${i.router_name})` : 'Warehouse';
}

/**
 * Physical gadgets — routers, ONTs, CPEs — tracked whether they belong to
 * the ISP or to the client at whose premises they sit, plus bulk stock
 * (cable, connectors, spares) that has no individual identity, only a
 * count. The MAC address is what actually survives a relabeling or a
 * reassignment, which is the point of tracking a serialized gadget by one
 * at all: accountability that doesn't depend on someone remembering which
 * box is whose. location (warehouse / a technician's van / a client's
 * premises / the repair bench) is tracked separately from status
 * (condition/lifecycle), matching how Splynx, Sonar and ISPBox all model
 * this — "in stock" alone never answers "which shelf, or whose van".
 */
export default function Inventory() {
  const store = useStore();
  const items = store.inventory ?? [];
  const [form, setForm] = useState(null);   // null = closed, object = open (new or editing)
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [adjustBusy, setAdjustBusy] = useState(null);
  const [issuing, setIssuing] = useState(null);   // { item, staffId, quantity, macAddress, serialNumber, note }
  const [issueBusy, setIssueBusy] = useState(false);
  const [history, setHistory] = useState(null);   // { item, rows, loading }

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const openNewStock = () => setForm(blank());
  const openEdit = (i) => setForm({
    id: i.id, name: i.name, category: i.category || 'Other', macAddress: i.mac_address || '',
    serialNumber: i.serial_number || '', ownedByTenant: i.owned_by_tenant,
    subscriberId: i.subscriber_id || '', routerId: i.router_id || '', status: i.status, notes: i.notes || '',
    quantity: String(i.quantity ?? 1), unit: i.unit || '',
  });

  // Whether this is one identified gadget or a multi-unit stock line is
  // decided by the quantity itself now — one form for both, no separate
  // "gadget" vs "stock" choice to make up front.
  const isBulk = Number(form?.quantity) > 1;

  const save = async () => {
    if (!form.name.trim()) return store.toast('Name it');
    if (!(Number(form.quantity) >= 1)) return store.toast('Quantity must be at least 1');
    setBusy(true);
    try {
      if (form.id) {
        await api.updateInventoryItem(form.id, form);
        store.toast(`${form.name} updated`);
      } else {
        await api.createInventoryItem(form);
        store.toast(`${form.name} added`);
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

  const adjust = async (i, delta) => {
    setAdjustBusy(i.id);
    try {
      const { quantity } = await api.adjustInventoryQuantity(i.id, delta);
      store.setCollection('inventory', (xs) => xs.map((x) => (x.id === i.id ? { ...x, quantity } : x)));
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    } finally {
      setAdjustBusy(null);
    }
  };

  const openIssue = (i) => setIssuing({ item: i, staffId: '', quantity: '1', macAddress: '', serialNumber: '', note: '' });

  const submitIssue = async () => {
    if (!issuing.staffId) return store.toast('Pick a technician');
    const singleUnit = issuing.item.tracking === 'bulk' && Number(issuing.quantity || 1) === 1;
    if (singleUnit && (!issuing.macAddress.trim() || !issuing.serialNumber.trim())) {
      return store.toast('Record both the MAC address and serial number of the unit being issued');
    }
    setIssueBusy(true);
    try {
      const r = await api.issueInventoryItem(issuing.item.id, {
        staffId: issuing.staffId,
        quantity: issuing.item.tracking === 'bulk' ? Number(issuing.quantity) || 1 : undefined,
        macAddress: issuing.macAddress || undefined,
        serialNumber: issuing.serialNumber || undefined,
        note: issuing.note || undefined,
      });
      store.setCollection('inventory', await api.inventory());
      store.toast(r.warning || `${issuing.item.name} issued`);
      setIssuing(null);
    } catch (e) {
      store.toast(`Could not issue: ${e.message}`);
    } finally {
      setIssueBusy(false);
    }
  };

  const returnItem = async (i) => {
    try {
      await api.returnInventoryItem(i.id);
      store.setCollection('inventory', await api.inventory());
      store.toast(`${i.name} returned to the warehouse`);
    } catch (e) {
      store.toast(`Could not return: ${e.message}`);
    }
  };

  const openHistory = async (i) => {
    setHistory({ item: i, rows: [], loading: true });
    try {
      const rows = await api.inventoryMovements(i.id);
      setHistory({ item: i, rows, loading: false });
    } catch (e) {
      setHistory({ item: i, rows: [], loading: false });
      store.toast(`Could not load history: ${e.message}`);
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'ours') return items.filter((i) => i.owned_by_tenant);
    if (filter === 'client') return items.filter((i) => !i.owned_by_tenant);
    if (filter === 'bulk') return items.filter((i) => i.tracking === 'bulk');
    if (filter.startsWith('loc:')) return items.filter((i) => i.location === filter.slice(4));
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const oursCount = items.filter((i) => i.owned_by_tenant).length;
  const bulkCount = items.filter((i) => i.tracking === 'bulk').length;
  const vanCount = items.filter((i) => i.location === 'van').length;

  return (
    <Screen
      title="Inventory"
      subtitle="Gadgets at client premises, in the store, or in a technician's van — whose they are, and which device is which by MAC address."
      actions={
        <Button variant="primary" onClick={openNewStock}>+ Add stock</Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Total lines" value={items.length} />
        <Stat label="Ours" value={oursCount} hint="ours to recover if a client leaves" />
        <Stat label="With technicians" value={vanCount} hint="issued, not yet installed or returned" />
        <Stat label="Bulk stock lines" value={bulkCount} hint="cable, connectors, spares" />
      </Grid>

      <Card
        title="Gadgets & stock"
        actions={
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'ours', label: 'Ours' },
              { value: 'client', label: "Client-owned" },
              { value: 'bulk', label: 'Bulk stock only' },
              { value: 'loc:warehouse', label: 'In warehouse' },
              { value: 'loc:van', label: 'With a technician' },
              { value: 'loc:premises', label: 'At a premises' },
              { value: 'loc:repair_bench', label: 'At the repair bench' },
              ...STATUSES,
            ]}
          />
        }
      >
        <Table
          rowKey={(i) => i.id}
          empty="Nothing tracked yet"
          rows={filtered}
          columns={[
            {
              key: 'name', label: 'Gadget / stock',
              render: (i) => (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{i.name}</span>
                  {i.category && <span style={{ fontSize: 11.5, color: color.muted }}>{i.category}</span>}
                </div>
              ),
            },
            {
              key: 'identity', label: 'MAC / quantity',
              render: (i) => i.tracking === 'bulk' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: font.mono, fontSize: 12.5 }}>
                  <Button size="sm" onClick={() => adjust(i, -1)} disabled={adjustBusy === i.id || i.quantity <= 0}>−</Button>
                  {i.quantity}{i.unit ? ` ${i.unit}` : ''}
                  <Button size="sm" onClick={() => adjust(i, 1)} disabled={adjustBusy === i.id}>+</Button>
                </span>
              ) : i.mac_address ? (
                <span style={{ fontFamily: font.mono, fontSize: 12 }}>{i.mac_address}</span>
              ) : (
                <span style={{ color: color.muted }}>—</span>
              ),
            },
            {
              key: 'owned_by_tenant', label: 'Ownership',
              render: (i) => <Badge tone={i.owned_by_tenant ? 'active' : 'default'}>{i.owned_by_tenant ? 'Ours' : "Client's own"}</Badge>,
            },
            {
              key: 'location', label: 'Location',
              render: (i) => i.tracking === 'bulk'
                ? <span style={{ color: color.muted }}>In store</span>
                : <Badge tone={i.location === 'van' ? 'pending' : i.location === 'repair_bench' ? 'suspended' : 'default'}>{locationText(i)}</Badge>,
            },
            { key: 'status', label: 'Status', render: (i) => <Badge tone={i.status === 'faulty' ? 'suspended' : i.status === 'installed' ? 'active' : 'default'}>{i.status}</Badge> },
            {
              key: 'act', label: '', align: 'right',
              render: (i) => (
                <span style={{ whiteSpace: 'nowrap' }}>
                  {i.tracking === 'serialized' && i.location === 'warehouse' && (
                    <span onClick={() => openIssue(i)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Issue</span>
                  )}
                  {i.tracking === 'bulk' && i.quantity > 0 && (
                    <span onClick={() => openIssue(i)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Issue</span>
                  )}
                  {(i.location === 'van' || i.location === 'repair_bench') && (
                    <span onClick={() => returnItem(i)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Return</span>
                  )}
                  {i.tracking === 'serialized' && (
                    <span onClick={() => openHistory(i)} style={{ color: color.neutralInk, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>History</span>
                  )}
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
        title={form?.id ? `Edit ${form.name}` : 'Add stock'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : form?.id ? 'Save changes' : 'Add stock'}
            </Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" span={2} hint="e.g. TP-Link CPE210, MikroTik hAP lite, CAT6 cable">
              <Input value={form.name} onChange={set('name')} placeholder="TP-Link CPE210" />
            </Field>
            <Field label="Category">
              <Select value={form.category} onChange={set('category')} options={CATEGORIES} />
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={set('status')} options={STATUSES} />
            </Field>
            <Field label="Quantity" hint={isBulk ? "More than 1 — no individual MAC/serial for the line" : undefined}>
              <Input type="number" min="1" value={form.quantity} onChange={set('quantity')} />
            </Field>
            {isBulk && (
              <Field label="Unit" hint="Optional — meters, pcs, boxes">
                <Input value={form.unit} onChange={set('unit')} placeholder="meters" />
              </Field>
            )}

            {!isBulk && (
              <>
                <Field label="MAC address" hint="Survives a relabel or reassignment — the real identifier">
                  <Input value={form.macAddress} onChange={set('macAddress')} placeholder="AA:BB:CC:DD:EE:FF" style={{ fontFamily: font.mono }} />
                </Field>
                <Field label="Serial number">
                  <Input value={form.serialNumber} onChange={set('serialNumber')} />
                </Field>
              </>
            )}

            <Field label="Has the client paid for it?" span={2} hint="No means it's still ours to recover; Yes means it belongs to them now">
              <Select
                value={form.ownedByTenant ? 'no' : 'yes'}
                onChange={(e) => setForm((s) => ({ ...s, ownedByTenant: e.target.value === 'no' }))}
                options={[{ value: 'no', label: "No — mark it as the company's" }, { value: 'yes', label: "Yes — it's the client's own" }]}
              />
            </Field>

            {!isBulk && (
              <>
                <Field label="Client installed at" span={2}>
                  <Select
                    value={form.subscriberId}
                    onChange={set('subscriberId')}
                    options={[
                      { value: '', label: 'Unassigned' },
                      ...store.clients.map((c) => ({ value: c.id, label: `${c.name} · ${c.account_code}` })),
                    ]}
                  />
                </Field>
                <Field label="Site" span={2} hint="Optional — for gear tied to a site rather than one client">
                  <Select
                    value={form.routerId}
                    onChange={set('routerId')}
                    options={[{ value: '', label: 'None' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
                  />
                </Field>
              </>
            )}
            <Field label="Notes" span={2}>
              <Textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Any other detail worth keeping" />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!issuing}
        title={`Issue ${issuing?.item?.name ?? ''}`}
        onClose={() => setIssuing(null)}
        footer={
          <>
            <Button onClick={() => setIssuing(null)}>Cancel</Button>
            <Button variant="primary" onClick={submitIssue} disabled={issueBusy}>
              {issueBusy ? 'Issuing…' : 'Issue'}
            </Button>
          </>
        }
      >
        {issuing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Technician">
              <Select
                value={issuing.staffId}
                onChange={(e) => setIssuing((s) => ({ ...s, staffId: e.target.value }))}
                options={[
                  { value: '', label: (store.technicians ?? []).length ? 'Select…' : 'No technicians on staff yet' },
                  ...(store.technicians ?? []).map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </Field>
            {issuing.item.tracking === 'bulk' && (
              <Field label="Quantity" hint={`${issuing.item.quantity} in stock`}>
                <Input type="number" value={issuing.quantity} onChange={(e) => setIssuing((s) => ({ ...s, quantity: e.target.value }))} />
              </Field>
            )}
            {issuing.item.tracking === 'bulk' && Number(issuing.quantity || 1) === 1 && (
              <>
                <div style={{ fontSize: 12, color: color.muted }}>
                  Issuing exactly one unit — record its real MAC and serial number. Both are required:
                  this is the moment it stops being an anonymous count and becomes a specific gadget
                  the technician is accountable for.
                </div>
                <Field label="MAC address">
                  <Input value={issuing.macAddress} onChange={(e) => setIssuing((s) => ({ ...s, macAddress: e.target.value }))} placeholder="AA:BB:CC:DD:EE:FF" style={{ fontFamily: font.mono }} />
                </Field>
                <Field label="Serial number">
                  <Input value={issuing.serialNumber} onChange={(e) => setIssuing((s) => ({ ...s, serialNumber: e.target.value }))} />
                </Field>
              </>
            )}
            {issuing.item.tracking === 'serialized' && (
              <div style={{ fontSize: 12, color: color.muted, fontFamily: font.mono }}>
                MAC {issuing.item.mac_address || '—'} · Serial {issuing.item.serial_number || '—'}
              </div>
            )}
            <Field label="Note" hint="Optional">
              <Textarea rows={2} value={issuing.note} onChange={(e) => setIssuing((s) => ({ ...s, note: e.target.value }))} />
            </Field>
          </div>
        )}
      </Modal>

      <Drawer open={!!history} title={`History — ${history?.item?.name ?? ''}`} onClose={() => setHistory(null)}>
        {history?.loading ? (
          <Empty>Loading…</Empty>
        ) : !history?.rows?.length ? (
          <Empty>No movements recorded yet.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {history.rows.map((m) => (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, borderLeft: `2px solid ${color.line}`, paddingLeft: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5, textTransform: 'capitalize' }}>{m.action}</span>
                <span style={{ fontSize: 12, color: color.muted }}>
                  {new Date(m.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
                  {m.staff_name ? ` · ${m.staff_name}` : ''}
                  {m.subscriber_name ? ` · ${m.subscriber_name}` : ''}
                  {m.to_location ? ` · ${LOCATION_LABEL[m.to_location] ?? m.to_location}` : ''}
                </span>
                {m.note && <span style={{ fontSize: 12.5, color: color.inkSoft }}>{m.note}</span>}
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </Screen>
  );
}
