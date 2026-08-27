import React, { useEffect, useMemo, useState } from 'react';
import { color, font, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Bar, Card, Grid, Screen, Select, Stat, Table } from '../ui/primitives';

export default function Analytics() {
  const store = useStore();
  const [month, setMonth] = useState('This month');

  // MRR/churn need real per-plan and per-payment math (a plan's own billing
  // period, actual applied payments) that the client-side store doesn't
  // hold — this is the same "MRR, churn and revenue on one dashboard" every
  // platform reviewed for this leads with, computed server-side once
  // rather than re-derived from whatever happens to be in the store.
  const [mrr, setMrr] = useState(null);
  useEffect(() => { api.mrrAnalytics().then(setMrr).catch(() => setMrr(null)); }, []);

  const clients = store.clients ?? [];
  const routers = store.routers ?? [];
  const tickets = store.tickets ?? [];

  const byStatus = useMemo(() => {
    const out = {};
    for (const c of clients) out[c.status] = (out[c.status] ?? 0) + 1;
    return out;
  }, [clients]);

  const byRouter = useMemo(() => {
    const out = new Map(routers.map((r) => [r.id, { name: r.name, count: 0 }]));
    for (const c of clients) {
      const row = out.get(c.router_id);
      if (row) row.count += 1;
    }
    return [...out.values()].sort((a, b) => b.count - a.count);
  }, [clients, routers]);

  const arpu = clients.length
    ? Math.round((store.tariffs ?? []).reduce((a, t) => a + Number(t.price ?? 0), 0) / Math.max(1, (store.tariffs ?? []).length))
    : 0;

  const churnRisk = clients.filter((c) => c.status === 'expired' || c.status === 'suspended').length;
  const peak = Math.max(1, ...byRouter.map((r) => r.count));

  return (
    <Screen
      title="Analytics"
      subtitle="How the base is distributed and where the pressure is."
      actions={<Select value={month} onChange={(e) => setMonth(e.target.value)} options={['This month', 'Last month', 'Last 3 months', 'This year']} style={{ width: 170 }} />}
    >
      <Grid min={200} gap={14}>
        <Stat label="Subscribers" value={clients.length} hint="all statuses" />
        <Stat label="Active" value={byStatus.active ?? 0} tone={color.green} hint="paying and online" />
        <Stat
          label="MRR"
          value={mrr ? `KES ${kes(mrr.mrr)}` : '—'}
          hint={mrr ? `ARPU KES ${kes(mrr.arpu)} · ${mrr.activeCount} active` : 'loading…'}
        />
        <Stat
          label="Churn rate"
          value={mrr ? `${mrr.churnRatePct}%` : '—'}
          tone={mrr?.churnRatePct > 5 ? color.rust : undefined}
          hint={mrr ? `${mrr.churnedThisMonth} churned, ${mrr.newThisMonth} new this month` : 'loading…'}
        />
        <Stat
          label="Revenue this month"
          value={mrr ? `KES ${kes(mrr.revenueThisMonth)}` : '—'}
          tone={color.green}
          hint="applied payments, month to date"
        />
        <Stat label="Churn risk" value={churnRisk} tone={churnRisk ? color.rust : undefined} hint="expired or suspended" />
      </Grid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
        <Card title="Subscribers by status">
          {clients.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>No subscribers yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.entries(byStatus).map(([status, n]) => (
                <div key={status} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ textTransform: 'capitalize' }}>{status}</span>
                    <span style={{ fontFamily: font.mono }}>{n}</span>
                  </div>
                  <Bar
                    pct={(n / clients.length) * 100}
                    tone={status === 'active' ? color.green : status === 'grace' ? color.amber : color.rust}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Load per router">
          {byRouter.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>No routers onboarded</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {byRouter.map((r) => (
                <div key={r.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{r.name}</span>
                    <span style={{ fontFamily: font.mono }}>{r.count}</span>
                  </div>
                  <Bar pct={(r.count / peak) * 100} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Tickets by priority">
        <Table
          rowKey={(r) => r.priority}
          empty="No tickets to analyse"
          rows={['critical', 'high', 'medium', 'low']
            .map((p) => ({
              priority: p,
              total: tickets.filter((t) => t.priority === p).length,
              open: tickets.filter((t) => t.priority === p && t.status !== 'resolved').length,
            }))
            .filter((r) => r.total > 0)}
          columns={[
            { key: 'priority', label: 'Priority', render: (r) => <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{r.priority}</span> },
            { key: 'total', label: 'Total', align: 'right', render: (r) => <span style={{ fontFamily: font.mono }}>{r.total}</span> },
            { key: 'open', label: 'Still open', align: 'right', render: (r) => <span style={{ fontFamily: font.mono }}>{r.open}</span> },
          ]}
        />
      </Card>
    </Screen>
  );
}
