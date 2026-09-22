import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { Badge, Card, Screen, Select } from '../ui/primitives';

const PRIORITY_COLOUR = { critical: color.rust, high: color.amberInk, medium: color.muted, low: color.muted };
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

/**
 * Every job (a ticket with real field work behind it — an installation, a callout, a fault) across the whole
 * team, at once: who it is assigned to, and how far along it is. "My jobs" (field-tech.jsx) is the same data
 * from one technician's own seat; this is the same board from the owner's, so nothing sits invisible on
 * somebody's personal queue with nobody else able to see it is stuck.
 */
export default function TeamJobs() {
  const store = useStore();
  const navigate = useNavigate();
  const [staffFilter, setStaffFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('open');

  const staff = store.staff ?? [];
  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const clientById = useMemo(() => Object.fromEntries((store.clients ?? []).map((c) => [c.id, c])), [store.clients]);

  const tickets = store.tickets ?? [];

  // One row per staff member (including "Unassigned"), each with its own open/in-progress/resolved counts — the
  // workload and progress the owner actually wants at a glance, before drilling into any one person's list.
  const byPerson = useMemo(() => {
    const groups = new Map();
    const bump = (id, name) => {
      if (!groups.has(id)) groups.set(id, { id, name, open: 0, in_progress: 0, resolved: 0, total: 0 });
      return groups.get(id);
    };
    for (const t of tickets) {
      const g = t.assigned_to
        ? bump(t.assigned_to, staffById[t.assigned_to]?.name ?? 'Former staff member')
        : bump('__unassigned', 'Unassigned');
      g[t.status] = (g[t.status] ?? 0) + 1;
      g.total += 1;
    }
    return [...groups.values()].sort((a, b) => (b.open + b.in_progress) - (a.open + a.in_progress));
  }, [tickets, staffById]);

  const visible = useMemo(() => tickets
    .filter((t) => staffFilter === 'all' || (staffFilter === '__unassigned' ? !t.assigned_to : t.assigned_to === staffFilter))
    .filter((t) => statusFilter === 'all' || t.status === statusFilter)
    .sort((a, b) => new Date(b.updated_at ?? b.created_at) - new Date(a.updated_at ?? a.created_at)),
    [tickets, staffFilter, statusFilter]);

  return (
    <Screen
      title="Team jobs"
      subtitle="Every job across the team, who it is assigned to, and how far along it is"
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
        {byPerson.map((p) => (
          <div
            key={p.id}
            onClick={() => { setStaffFilter(p.id); setStatusFilter('all'); }}
            style={{
              background: color.cardBg, border: `1px solid ${staffFilter === p.id ? color.green : color.line}`,
              borderRadius: radius.lg, padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, color: p.id === '__unassigned' ? color.rust : color.ink }}>{p.name}</span>
            <span style={{ fontSize: 12, color: color.muted }}>
              {p.open + p.in_progress} open{p.in_progress ? ` (${p.in_progress} in progress)` : ''} · {p.resolved} resolved
            </span>
            <div style={{ height: 6, borderRadius: radius.pill, background: color.tileBg, overflow: 'hidden', display: 'flex' }}>
              {p.total > 0 && (
                <>
                  <div style={{ width: `${(p.open / p.total) * 100}%`, background: color.rust }} />
                  <div style={{ width: `${(p.in_progress / p.total) * 100}%`, background: color.amberInk }} />
                  <div style={{ width: `${(p.resolved / p.total) * 100}%`, background: color.green }} />
                </>
              )}
            </div>
          </div>
        ))}
        {byPerson.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '24px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>
            No jobs raised yet.
          </div>
        )}
      </div>

      <Card
        title={staffFilter === 'all' ? 'Every job' : `Jobs · ${byPerson.find((p) => p.id === staffFilter)?.name ?? ''}`}
        subtitle={`${visible.length} shown`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Everyone' },
                ...byPerson.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Any status' },
                { value: 'open', label: 'Open' },
                { value: 'in_progress', label: 'In progress' },
                { value: 'resolved', label: 'Resolved' },
              ]}
            />
          </div>
        }
      >
        {visible.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>Nothing matches these filters.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {visible.map((t) => {
              const c = clientById[t.subscriber_id];
              const assignee = t.assigned_to ? (staffById[t.assigned_to]?.name ?? 'Former staff member') : 'Unassigned';
              return (
                <div
                  key={t.id}
                  onClick={() => navigate(`/tickets?open=${t.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '10px 4px', borderBottom: `1px solid ${color.line}`, cursor: 'pointer', fontSize: 13,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: radius.pill, background: PRIORITY_COLOUR[t.priority] ?? color.muted, flex: '0 0 auto' }} />
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                    {c?.name && <span style={{ color: color.muted, whiteSpace: 'nowrap' }}>· {c.name}</span>}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
                    <span style={{ fontSize: 12, color: t.assigned_to ? color.neutralInk : color.rust, fontFamily: font.mono }}>{assignee}</span>
                    <Badge tone={t.status}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </Screen>
  );
}
