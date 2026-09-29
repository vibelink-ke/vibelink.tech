import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { Badge, Button, Empty, Screen, Table } from '../ui/primitives';

/**
 * Every router and every customer, newest first — a plain list next to the Map's picture of the
 * same data, for "what got installed this week" rather than "where is everything."
 *
 * A router's install date is when its row was created here (routers.created_at); a client's is the
 * same (subscribers.created_at, already tracked). Neither is when a technician physically visited —
 * the field app's own ticket photos are the record of that (Tickets → a job's FIELD WORK section) —
 * this is "added to the system," which is close enough for "recently installed" in practice.
 */
const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'All time' },
];

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const hasCoords = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && !(Number(lat) === 0 && Number(lng) === 0);

export default function Installations() {
  const store = useStore();
  const navigate = useNavigate();
  const [range, setRange] = useState(30);
  const [type, setType] = useState('all');   // all | router | client

  const rows = useMemo(() => {
    const routers = (store.routers ?? []).map((r) => ({
      id: `r:${r.id}`, kind: 'router', name: r.name, place: r.site || null,
      lat: r.lat, lng: r.lng, installedAt: r.created_at, raw: r,
    }));
    const clients = (store.clients ?? []).map((c) => ({
      id: `c:${c.id}`, kind: 'client', name: c.name, place: c.location || null,
      lat: c.lat, lng: c.lng, installedAt: c.created_at, raw: c,
    }));
    const all = [...routers, ...clients].sort((a, b) => new Date(b.installedAt ?? 0) - new Date(a.installedAt ?? 0));
    const cutoff = range ? Date.now() - range * 86400000 : null;
    return all.filter((r) => (!cutoff || new Date(r.installedAt ?? 0).getTime() >= cutoff) && (type === 'all' || r.kind === type));
  }, [store.routers, store.clients, range, type]);

  const counts = useMemo(() => ({
    router: rows.filter((r) => r.kind === 'router').length,
    client: rows.filter((r) => r.kind === 'client').length,
  }), [rows]);

  return (
    <Screen
      title="Installations"
      subtitle="Every router and client, newest first — filter to see what was recently added."
      actions={<Button onClick={() => navigate('/map')}>Open on the map</Button>}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {RANGES.map((r) => (
          <span
            key={r.value}
            onClick={() => setRange(r.value)}
            style={{
              padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${range === r.value ? color.green : color.line}`,
              background: range === r.value ? color.green : '#fff',
              color: range === r.value ? '#fff' : color.ink,
            }}
          >
            {r.label}
          </span>
        ))}
        <span style={{ width: 1, background: color.line, margin: '2px 4px' }} />
        {[['all', 'Both'], ['router', `Routers (${counts.router})`], ['client', `Clients (${counts.client})`]].map(([v, label]) => (
          <span
            key={v}
            onClick={() => setType(v)}
            style={{
              padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${type === v ? color.green : color.line}`,
              background: type === v ? color.green : '#fff',
              color: type === v ? '#fff' : color.ink,
            }}
          >
            {label}
          </span>
        ))}
      </div>

      <Table
        rowKey={(r) => r.id}
        empty="Nothing installed in this window"
        rows={rows}
        onRowClick={(r) => navigate(r.kind === 'router' ? '/routers' : `/clients/${r.raw.id}`)}
        columns={[
          { key: 'kind', label: 'Type', render: (r) => <Badge tone={r.kind === 'router' ? 'active' : 'unused'}>{r.kind === 'router' ? 'Router' : 'Client'}</Badge> },
          { key: 'name', label: 'Name', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
          { key: 'place', label: 'Location', render: (r) => r.place || (hasCoords(r.lat, r.lng) ? <span style={{ fontFamily: font.mono, fontSize: 12 }}>{Number(r.lat).toFixed(4)}, {Number(r.lng).toFixed(4)}</span> : <span style={{ color: color.muted }}>Not set</span>) },
          { key: 'installedAt', label: 'Installed', render: (r) => fmtDate(r.installedAt) },
        ]}
      />
    </Screen>
  );
}
