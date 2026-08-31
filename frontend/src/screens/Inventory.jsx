import React, { useMemo, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Drawer, Empty, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Textarea } from '../ui/primitives';

const CATEGORIES = ['Router', 'ONT', 'CPE', 'Switch', 'Cable', 'Connector', 'Antenna', 'Other'];
// The only categories with no individual identity to speak of — a length of
// cable or a bag of connectors is a count, not a set of accountable units.
// Everything else needs a MAC or a serial precisely because it's the kind
// of gadget that goes missing and needs tracing back to someone.
const UNSERIALIZED_CATEGORIES = ['Cable', 'Connector'];
const STATUSES = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'installed', label: 'Installed' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'retired', label: 'Retired' },
];
const LOCATION_LABEL = { warehouse: 'Warehouse', van: 'Van', premises: 'Premises', repair_bench: 'Repair bench' };

const blank = () => ({
  name: '', category: 'Router', macAddress: '', serialNumber: '',
  status: 'in_stock', notes: '', quantity: '1', unit: '', units: [],
});

function locationText(i) {
  if (i.location === 'van') return `Van — ${i.assigned_staff_name ?? 'unassigned'}`;
  if (i.location === 'premises') return i.subscriber_name ? `Premises — ${i.subscriber_name}` : 'Premises';
  if (i.location === 'repair_bench') return 'Repair bench';
  return i.router_name ? `Warehouse (${i.router_name})` : 'Warehouse';
}

/**
 * Physical gadgets — routers, ONTs, CPEs — grouped by name so "10 CPE210s"
 * reads as one line, not ten, while every one of the ten is still its own
 * record underneath with its own MAC and serial. Ownership and where
 * something's installed are both decided at Issue time, not when it's
 * first added — a gadget just received is in the warehouse and unowned by
 * anyone in particular yet. location (warehouse / a technician's van / a
 * client's premises / the repair bench) is tracked separately from status
 * (condition/lifecycle), matching how Splynx, Sonar and ISPBox all model
 * this — "in stock" alone never answers "which shelf, or whose van".
 */
export default function Inventory() {
  const store = useStore();
  const items = store.inventory ?? [];
  const [form, setForm] = useState(null);   // null = closed, object = open (new or editing)
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState(null);   // { item, delta }
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [issuing, setIssuing] = useState(null);   // { item, staffId, quantity, macAddress, serialNumber, subscriberId, routerId, ownedByTenant, note }
  const [issueBusy, setIssueBusy] = useState(false);
  const [history, setHistory] = useState(null);   // { item, rows, loading }
  const [viewing, setViewing] = useState(null);   // a serialized group being inspected

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const openNewStock = () => setForm(blank());
  const openEdit = (i) => setForm({
    id: i.id, name: i.name, category: i.category || 'Other', macAddress: i.mac_address || '',
    serialNumber: i.serial_number || '', status: i.status, notes: i.notes || '',
    quantity: String(i.quantity ?? 1), unit: i.unit || '', units: [],
  });

  // Whether this is one identified gadget, several identical identified
  // units, or a multi-unit stock line with no identity at all is decided by
  // the quantity and category together — one form for all three, no
  // separate choice to make up front.
  const qtyNum = Number(form?.quantity) || 1;
  const isMulti = qtyNum > 1;
  const exempt = UNSERIALIZED_CATEGORIES.includes(form?.category);

  const setUnitField = (idx, key) => (e) =>
    setForm((s) => {
      const units = [...s.units];
      units[idx] = { ...units[idx], [key]: e.target.value };
      return { ...s, units };
    });

  const save = async () => {
    if (!form.name.trim()) return store.toast('Name it');
    if (!(qtyNum >= 1)) return store.toast('Quantity must be at least 1');
    if (isMulti && !exempt) {
      const units = form.units.slice(0, qtyNum);
      if (units.length !== qtyNum || units.some((u) => !u?.macAddress?.trim() && !u?.serialNumber?.trim())) {
        return store.toast(`Record a MAC or serial for each of the ${qtyNum} units`);
      }
    }
    if (!isMulti && !exempt && !form.macAddress.trim() && !form.serialNumber.trim()) {
      return store.toast('Record a MAC address or serial number for this gadget');
    }
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
      setViewing((v) => (v ? { ...v, units: v.units.filter((x) => x.id !== i.id) } : v));
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const submitAdjust = async () => {
    const delta = Number(adjusting.delta);
    if (!delta) return store.toast('Enter how many to add or remove');
    setAdjustBusy(true);
    try {
      const { quantity } = await api.adjustInventoryQuantity(adjusting.item.id, delta);
      store.setCollection('inventory', (xs) => xs.map((x) => (x.id === adjusting.item.id ? { ...x, quantity } : x)));
      setAdjusting(null);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    } finally {
      setAdjustBusy(false);
    }
  };

  const openIssue = (i) => setIssuing({
    item: i, staffId: '', quantity: '1', macAddress: '', serialNumber: '',
    subscriberId: '', routerId: '', ownedByTenant: true, note: '',
  });

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
        subscriberId: issuing.subscriberId || undefined,
        routerId: issuing.routerId || undefined,
        ownedByTenant: issuing.subscriberId ? issuing.ownedByTenant : undefined,
        note: issuing.note || undefined,
      });
      const fresh = await api.inventory();
      store.setCollection('inventory', fresh);
      setViewing((v) => (v ? { ...v, units: fresh.filter((x) => v.units.some((u) => u.id === x.id)) } : v));
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
      const fresh = await api.inventory();
      store.setCollection('inventory', fresh);
      setViewing((v) => (v ? { ...v, units: fresh.filter((x) => v.units.some((u) => u.id === x.id)) } : v));
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
    let rows = items;
    if (filter === 'ours') rows = rows.filter((i) => i.owned_by_tenant);
    else if (filter === 'client') rows = rows.filter((i) => !i.owned_by_tenant);
    else if (filter === 'bulk') rows = rows.filter((i) => i.tracking === 'bulk');
    else if (filter.startsWith('loc:')) rows = rows.filter((i) => i.location === filter.slice(4));
    else if (filter !== 'all') rows = rows.filter((i) => i.status === filter);

    const needle = search.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((i) =>
        (i.mac_address ?? '').toLowerCase().includes(needle) ||
        (i.serial_number ?? '').toLowerCase().includes(needle) ||
        (i.name ?? '').toLowerCase().includes(needle));
    }
    return rows;
  }, [items, filter, search]);

  /**
   * "10 CPE210s" is 10 individual records once bought, but nobody wants to
   * scroll 10 identical-looking rows to find one — grouped here by name +
   * category for display, each still fully addressable (Issue/Return/
   * History/Edit/Delete) one at a time inside its own View.
   */
  const groups = useMemo(() => {
    const map = new Map();
    for (const i of filtered) {
      if (i.tracking === 'bulk') {
        map.set(i.id, { key: i.id, bulk: true, item: i });
        continue;
      }
      const key = `${(i.name ?? '').toLowerCase()}|${i.category ?? ''}`;
      if (!map.has(key)) map.set(key, { key, bulk: false, name: i.name, category: i.category, units: [] });
      map.get(key).units.push(i);
    }
    return [...map.values()];
  }, [filtered]);

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
        <Stat label="Total units" value={items.length} />
        <Stat label="Ours" value={oursCount} hint="ours to recover if a client leaves" />
        <Stat label="With technicians" value={vanCount} hint="issued, not yet installed or returned" />
        <Stat label="Bulk stock lines" value={bulkCount} hint="cable, connectors, spares" />
      </Grid>

      <Card
        title="Gadgets & stock"
        actions={
          <>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by MAC, serial or name…"
            style={{ fontFamily: font.mono, fontSize: 12.5, width: 220 }}
          />
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
          </>
        }
      >
        <Table
          rowKey={(g) => g.key}
          empty="Nothing tracked yet"
          rows={groups}
          columns={[
            {
              key: 'name', label: 'Gadget / stock',
              render: (g) => (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{g.bulk ? g.item.name : g.name}</span>
                  <span style={{ fontSize: 11.5, color: color.muted }}>{g.bulk ? g.item.category : g.category}</span>
                </div>
              ),
            },
            {
              key: 'quantity', label: 'Quantity',
              render: (g) => g.bulk ? (
                <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>
                  {g.item.quantity}{g.item.unit ? ` ${g.item.unit}` : ''}
                </span>
              ) : (
                <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>{g.units.length}</span>
              ),
            },
            {
              key: 'status', label: 'Status',
              render: (g) => g.bulk
                ? <Badge tone={g.item.status === 'faulty' ? 'suspended' : g.item.status === 'installed' ? 'active' : 'default'}>{g.item.status}</Badge>
                : (g.units.length === 1
                  ? <Badge tone={g.units[0].status === 'faulty' ? 'suspended' : g.units[0].status === 'installed' ? 'active' : 'default'}>{g.units[0].status}</Badge>
                  : <span style={{ color: color.muted, fontSize: 12 }}>varies</span>),
            },
            {
              key: 'act', label: '', align: 'right',
              render: (g) => g.bulk ? (
                <span style={{ whiteSpace: 'nowrap' }}>
                  {g.item.quantity > 0 && (
                    <span onClick={() => openIssue(g.item)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Issue</span>
                  )}
                  <span onClick={() => setAdjusting({ item: g.item, delta: '' })} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Adjust</span>
                  <span onClick={() => openEdit(g.item)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Edit</span>
                  <span onClick={() => remove(g.item)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                </span>
              ) : (
                <span onClick={() => setViewing(g)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>View</span>
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
            <Field
              label="Quantity"
              hint={!form.id ? (exempt ? 'Any amount — no individual identity needed' : 'More than 1 asks for each unit\'s own MAC/serial below') : undefined}
            >
              <Input type="number" min="1" disabled={!!form.id} value={form.quantity} onChange={set('quantity')} />
            </Field>
            {exempt && isMulti && (
              <Field label="Unit" hint="Optional — meters, pcs, boxes">
                <Input value={form.unit} onChange={set('unit')} placeholder="meters" />
              </Field>
            )}

            {!form.id && !exempt && isMulti && (
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>One MAC or serial per unit ({qtyNum})</span>
                {Array.from({ length: qtyNum }).map((_, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Input
                      value={form.units[idx]?.macAddress ?? ''}
                      onChange={setUnitField(idx, 'macAddress')}
                      placeholder={`Unit ${idx + 1} MAC`}
                      style={{ fontFamily: font.mono, fontSize: 12.5 }}
                    />
                    <Input
                      value={form.units[idx]?.serialNumber ?? ''}
                      onChange={setUnitField(idx, 'serialNumber')}
                      placeholder={`Unit ${idx + 1} serial`}
                    />
                  </div>
                ))}
              </div>
            )}

            {!isMulti && !exempt && (
              <>
                <Field label="MAC address" hint="Survives a relabel or reassignment — the real identifier">
                  <Input value={form.macAddress} onChange={set('macAddress')} placeholder="AA:BB:CC:DD:EE:FF" style={{ fontFamily: font.mono }} />
                </Field>
                <Field label="Serial number">
                  <Input value={form.serialNumber} onChange={set('serialNumber')} />
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
            <Field label="Client installed at" hint="Optional — leave unassigned if it's just going into the tech's van for now">
              <Select
                value={issuing.subscriberId}
                onChange={(e) => setIssuing((s) => ({ ...s, subscriberId: e.target.value }))}
                options={[
                  { value: '', label: 'Not yet — goes to the van' },
                  ...store.clients.map((c) => ({ value: c.id, label: `${c.name} · ${c.account_code}` })),
                ]}
              />
            </Field>
            {issuing.subscriberId && (
              <Field label="Has the client paid for it?" hint="No means it stays ours to recover; Yes means it's theirs from now on">
                <Select
                  value={issuing.ownedByTenant ? 'no' : 'yes'}
                  onChange={(e) => setIssuing((s) => ({ ...s, ownedByTenant: e.target.value === 'no' }))}
                  options={[{ value: 'no', label: "No — remains the company's" }, { value: 'yes', label: "Yes — it's the client's own" }]}
                />
              </Field>
            )}
            <Field label="Site" hint="Optional — for gear tied to a site rather than one client">
              <Select
                value={issuing.routerId}
                onChange={(e) => setIssuing((s) => ({ ...s, routerId: e.target.value }))}
                options={[{ value: '', label: 'None' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
              />
            </Field>
            <Field label="Note" hint="Optional">
              <Textarea rows={2} value={issuing.note} onChange={(e) => setIssuing((s) => ({ ...s, note: e.target.value }))} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!adjusting}
        title={`Adjust ${adjusting?.item?.name ?? ''}`}
        onClose={() => setAdjusting(null)}
        footer={
          <>
            <Button onClick={() => setAdjusting(null)}>Cancel</Button>
            <Button variant="primary" onClick={submitAdjust} disabled={adjustBusy}>
              {adjustBusy ? 'Saving…' : 'Apply'}
            </Button>
          </>
        }
      >
        {adjusting && (
          <Field
            label="Change in quantity"
            hint={`Currently ${adjusting.item.quantity}${adjusting.item.unit ? ` ${adjusting.item.unit}` : ''} — use a positive number for stock received, negative for stock used`}
          >
            <Input type="number" value={adjusting.delta} onChange={(e) => setAdjusting((s) => ({ ...s, delta: e.target.value }))} placeholder="e.g. 50 or -20" />
          </Field>
        )}
      </Modal>

      <Drawer open={!!viewing} title={`${viewing?.name ?? ''} — ${viewing?.units?.length ?? 0} unit(s)`} onClose={() => setViewing(null)} width={640}>
        {viewing && (
          <Table
            rowKey={(i) => i.id}
            empty="Nothing here"
            rows={viewing.units}
            columns={[
              {
                key: 'identity', label: 'MAC / serial',
                render: (i) => (
                  <div style={{ display: 'flex', flexDirection: 'column', fontFamily: font.mono, fontSize: 12 }}>
                    <span>{i.mac_address || '—'}</span>
                    <span style={{ color: color.muted }}>{i.serial_number || '—'}</span>
                  </div>
                ),
              },
              { key: 'location', label: 'Location', render: (i) => <Badge tone={i.location === 'van' ? 'pending' : i.location === 'repair_bench' ? 'suspended' : 'default'}>{locationText(i)}</Badge> },
              { key: 'status', label: 'Status', render: (i) => <Badge tone={i.status === 'faulty' ? 'suspended' : i.status === 'installed' ? 'active' : 'default'}>{i.status}</Badge> },
              {
                key: 'act', label: '', align: 'right',
                render: (i) => (
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {i.location === 'warehouse' && (
                      <span onClick={() => openIssue(i)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Issue</span>
                    )}
                    {(i.location === 'van' || i.location === 'repair_bench') && (
                      <span onClick={() => returnItem(i)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Return</span>
                    )}
                    <span onClick={() => openHistory(i)} style={{ color: color.neutralInk, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>History</span>
                    <span onClick={() => openEdit(i)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Edit</span>
                    <span onClick={() => remove(i)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Drawer>

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
