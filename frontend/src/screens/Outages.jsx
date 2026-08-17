import React, { useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Textarea } from '../ui/primitives';

const BLANK = { site: '', router: '', cause: '', eta: '', note: '' };
const CAUSES = ['Power cut', 'Fibre cut', 'Upstream fault', 'Equipment failure', 'Weather', 'Planned maintenance'];

export default function Outages() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);

  const outages = store.outages ?? [];
  const routersDown = (store.routers ?? []).filter((r) => r.status === 'down');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const [busy, setBusy] = useState(false);

  const declare = async () => {
    if (!f.site.trim()) return store.toast('Name the affected site');
    setBusy(true);
    try {
      const created = await api.createOutage({
        site: f.site,
        routerId: f.router || null,
        cause: f.cause || null,
        eta: f.eta || null,
        note: f.note || null,
      });
      store.setCollection('outages', (os) => [created, ...os]);
      store.toast(f.router ? 'Outage declared — affected clients are being SMSed' : 'Outage declared');
      setOpen(false);
      setF(BLANK);
    } catch (e) {
      store.toast(`Could not declare: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (o) => {
    try {
      const updated = await api.resolveOutage(o.id);
      store.setCollection('outages', (os) => os.map((x) => (x.id === o.id ? updated : x)));
      store.toast(`${o.site} marked resolved`);
    } catch (e) {
      store.toast(`Could not resolve: ${e.message}`);
    }
  };

  const affected = (() => {
    const downRouters = new Set(
      (store.outages ?? []).filter((o) => o.status !== 'resolved').map((o) => o.router_id).filter(Boolean));
    if (!downRouters.size) return 0;
    return (store.clients ?? []).filter((c) => downRouters.has(c.router_id)).length;
  })();

  return (
    <Screen
      title="Service outages"
      subtitle="Declared incidents. The watchdog pings every NAS each minute and flags anything that stops answering."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Declare outage
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Active" value={outages.filter((o) => o.status === 'active').length} tone={outages.length ? color.rust : undefined} hint="ongoing incidents" />
        <Stat label="Routers down" value={routersDown.length} tone={routersDown.length ? color.rust : undefined} hint="per the watchdog" />
        {/* Customers on a router with an open outage. Hardcoded zero before,
            which made an outage look like it affected nobody. */}
        <Stat label="Clients affected" value={affected} hint="on the affected NAS" />
        <Stat label="Resolved this month" value={outages.filter((o) => o.status === 'resolved').length} hint="closed out" />
      </Grid>

      {routersDown.length > 0 && (
        <Card title="Routers not responding" subtitle="Detected automatically — declare an outage to notify clients">
          <Table
            rowKey={(r) => r.id}
            rows={routersDown}
            columns={[
              { key: 'name', label: 'Router', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
              { key: 'host', label: 'NAS', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{r.host}</span> },
              { key: 'last_seen', label: 'Last seen', render: (r) => (r.last_seen ? new Date(r.last_seen).toLocaleString('en-KE') : 'never') },
              {
                key: 'act',
                label: '',
                align: 'right',
                render: (r) => (
                  <Button size="sm" onClick={() => { setF({ ...BLANK, site: r.name, router: r.id }); setOpen(true); }}>
                    Declare
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Card title="Incidents">
        <Table
          rowKey={(o) => o.id}
          empty="No outages declared — the network is healthy"
          rows={outages}
          columns={[
            { key: 'site', label: 'Site', render: (o) => <span style={{ fontWeight: 600 }}>{o.site}</span> },
            { key: 'router_name', label: 'Router', render: (o) => o.router_name || '—' },
            { key: 'cause', label: 'Cause', render: (o) => o.cause || '—' },
            { key: 'eta', label: 'ETA', render: (o) => o.eta || '—' },
            { key: 'status', label: 'Status', render: (o) => <Badge tone={o.status === 'active' ? 'down' : 'resolved'}>{o.status}</Badge> },
            { key: 'started_at', label: 'Started', render: (o) => (o.started_at ? new Date(o.started_at).toLocaleString('en-KE') : '—') },
            {
              key: 'act',
              label: '',
              align: 'right',
              render: (o) =>
                o.status === 'active' ? (
                  <Button size="sm" onClick={() => resolve(o)}>
                    Resolve
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title="Declare outage"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={declare} disabled={busy}>
              {busy ? 'Declaring…' : 'Declare and notify'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Site" span={2}>
            <Input value={f.site} onChange={set('site')} placeholder="Kimumu tower" />
          </Field>
          <Field label="Router">
            <Select
              value={f.router}
              onChange={set('router')}
              options={[{ value: '', label: 'Not router-specific' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
            />
          </Field>
          <Field label="Cause">
            <Select value={f.cause} onChange={set('cause')} options={['', ...CAUSES]} />
          </Field>
          <Field label="ETA" span={2}>
            <Input value={f.eta} onChange={set('eta')} placeholder="2 hours" />
          </Field>
          <Field label="Notes for the SMS" span={2}>
            <Textarea value={f.note} onChange={set('note')} rows={3} />
          </Field>
        </div>
      </Modal>
    </Screen>
  );
}
