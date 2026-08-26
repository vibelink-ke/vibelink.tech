import React, { useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Bar, Button, Card, Drawer, Field, Grid, Input, KV, Modal, RowAction, RowActions, Screen, Select, Stat, Table } from '../ui/primitives';

const BLANK = { name: '', cidr: '', routerId: '', service: 'pppoe', purpose: 'normal' };

const act = (c) => ({ fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10, color: c });

/** Usable host count for a CIDR block (excludes network + broadcast for /≤30). */
export function cidrHosts(cidr) {
  const bits = Number(String(cidr).split('/')[1]);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return 0;
  const size = 2 ** (32 - bits);
  return size > 2 ? size - 2 : size;
}

export default function Networks() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const pools = store.ipPools ?? [];
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const totalHosts = pools.reduce((a, p) => a + cidrHosts(p.cidr), 0);
  const totalUsed = pools.reduce((a, p) => a + Number(p.used ?? 0), 0);

  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  /** Who actually holds addresses in this range. */
  const viewPool = async (p) => {
    setViewing({ pool: p, loading: true });
    try {
      setViewing({ ...(await api.ipPoolUsage(p.id)), loading: false });
    } catch (e) {
      setViewing(null);
      store.toast(`Could not read the pool: ${e.message}`);
    }
  };

  const saveEdit = async () => {
    if (!editing.name?.trim() || !editing.cidr?.trim())
      return store.toast('Name and CIDR are required');
    try {
      const updated = await api.updateIpPool(editing.id, {
        name: editing.name, cidr: editing.cidr,
        routerId: editing.routerId, service: editing.service, purpose: editing.purpose,
      });
      store.setCollection('ipPools', (ps) => ps.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
      store.toast(`${updated.name} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
  };

  // The server refuses while clients hold addresses inside the range and says
  // how many, so there is no need to guess here.
  const removePool = async (p) => {
    if (!window.confirm(`Delete ${p.name} (${p.cidr})?`)) return;
    try {
      await api.deleteIpPool(p.id);
      store.setCollection('ipPools', (ps) => ps.filter((x) => x.id !== p.id));
      store.toast(`${p.name} deleted`);
    } catch (e) {
      store.toast(e.message);
    }
  };

  const create = async () => {
    if (!f.name.trim() || !f.cidr.trim()) return store.toast('Name and CIDR are required');
    if (!cidrHosts(f.cidr)) return store.toast('That does not look like a valid CIDR block');
    setBusy(true);
    try {
      const created = await api.createIpPool({
        name: f.name,
        cidr: f.cidr,
        routerId: f.routerId || null,
        service: f.service,
        purpose: f.purpose,
      });
      store.setCollection('ipPools', (ps) => [...ps, created]);
      store.toast('IP pool created');
      setOpen(false);
      setF(BLANK);
    } catch (e) {
      store.toast(`Could not create the pool: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Networks"
      subtitle="IP pools handed out to PPPoE and hotspot sessions, per router."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Add IP pool
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Pools" value={pools.length} hint="configured" />
        <Stat label="Addresses" value={totalHosts.toLocaleString()} hint="usable across all pools" />
        <Stat label="In use" value={totalUsed.toLocaleString()} hint="assigned to subscribers" />
        <Stat
          label="Utilisation"
          value={totalHosts ? `${Math.round((totalUsed / totalHosts) * 100)}%` : '—'}
          hint="across all pools"
        />
      </Grid>

      <Card title="IP pools">
        <Table
          rowKey={(p) => p.id}
          empty="No IP pools yet — sessions cannot be assigned addresses until you add one"
          rows={pools}
          columns={[
            { key: 'name', label: 'Pool', render: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span> },
            { key: 'cidr', label: 'Range', render: (p) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{p.cidr}</span> },
            { key: 'router_name', label: 'Router', render: (p) => p.router_name ?? <span style={{ color: color.muted }}>Any</span> },
            { key: 'service', label: 'Service' },
            {
              key: 'used',
              label: 'Used',
              align: 'right',
              render: (p) => (
                <span style={{ fontFamily: font.mono }}>
                  {p.used ?? 0} / {cidrHosts(p.cidr)}
                </span>
              ),
            },
            {
              key: 'bar',
              label: 'Utilisation',
              width: 140,
              render: (p) => {
                const hosts = cidrHosts(p.cidr) || 1;
                const pct = (Number(p.used ?? 0) / hosts) * 100;
                return <Bar pct={pct} tone={pct > 85 ? color.rust : pct > 60 ? color.amber : color.green} />;
              },
            },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (p) => (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <RowActions>
                    <RowAction onClick={() => viewPool(p)}>View</RowAction>
                    <RowAction tone={color.green} onClick={() => setEditing({ ...p, routerId: p.router_id ?? '' })}>
                      Edit
                    </RowAction>
                    {p.locked && p.router_id ? (
                      <span style={{ fontSize: 11.5, color: color.muted }} title="Created automatically for its router — delete the router to free it up">
                        🔒 Locked
                      </span>
                    ) : (
                      <RowAction tone={color.rust} onClick={() => removePool(p)}>Delete</RowAction>
                    )}
                  </RowActions>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        open={!!viewing}
        title={viewing?.pool?.name ?? 'Pool'}
        onClose={() => setViewing(null)}
      >
        {viewing?.loading && <span style={{ fontSize: 13 }}>Reading…</span>}
        {viewing && !viewing.loading && (
          <>
            <KV k="Range" v={viewing.pool.cidr} />
            <KV k="Service" v={viewing.pool.service} />
            <KV k="Usable addresses" v={viewing.hosts} />
            <KV k="In use" v={viewing.used} />
            <KV k="Free" v={viewing.free} />
            <div style={{ marginTop: 14 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Who holds one</span>
              {viewing.taken.length === 0 ? (
                <p style={{ fontSize: 12.5, color: color.muted }}>Nobody yet.</p>
              ) : (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, display: 'grid', gap: 4 }}>
                  {viewing.taken.map((t) => (
                    <li key={t.ip}>
                      <span style={{ fontFamily: font.mono }}>{t.ip}</span> — {t.name} ({t.account_code}, {t.status})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Drawer>

      <Modal
        open={!!editing}
        title={`Edit ${editing?.name ?? 'pool'}`}
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
            <Field label="Name" span={2}>
              <Input value={editing.name} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} />
            </Field>
            <Field label="CIDR" hint={editing.cidr ? `${cidrHosts(editing.cidr)} usable addresses` : ''}>
              <Input value={editing.cidr} onChange={(e) => setEditing((s) => ({ ...s, cidr: e.target.value }))} />
            </Field>
            <Field
              label="Router"
              hint={editing.locked ? 'Locked to this router — delete the router to free the pool up' : undefined}
            >
              <Select
                value={editing.routerId ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, routerId: e.target.value }))}
                disabled={editing.locked}
                options={[{ value: '', label: 'Any router' },
                  ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
              />
            </Field>
            <span style={{ gridColumn: '1 / -1', fontSize: 12, color: color.muted }}>
              Narrowing a range that clients already sit inside does not move them — check View
              first to see who holds an address.
            </span>
          </div>
        )}
      </Modal>

      <Modal
        open={open}
        title="Add IP pool"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? 'Saving…' : 'Create pool'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Name" span={2}>
            <Input value={f.name} onChange={set('name')} placeholder="PPPoE Kimumu" />
          </Field>
          <Field label="CIDR" hint={f.cidr ? `${cidrHosts(f.cidr)} usable addresses` : 'e.g. 10.10.0.0/22'}>
            <Input value={f.cidr} onChange={set('cidr')} placeholder="10.10.0.0/22" />
          </Field>
          <Field label="Service">
            <Select value={f.service} onChange={set('service')} options={[{ value: 'pppoe', label: 'PPPoE' }, { value: 'hotspot', label: 'Hotspot' }]} />
          </Field>
          <Field label="Router" span={2}>
            <Select
              value={f.routerId}
              onChange={set('routerId')}
              options={[
                { value: '', label: 'Any router' },
                ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </Field>
        </div>
      </Modal>
    </Screen>
  );
}
