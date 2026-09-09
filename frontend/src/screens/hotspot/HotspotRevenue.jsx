import React, { useEffect, useState } from 'react';
import { color, font, kes } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Grid, Screen, Stat, Table } from '../../ui/primitives';

const PERIODS = [
  { label: 'Last 4 months', value: '4m' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'This year', value: 'year' },
];

export default function HotspotRevenue() {
  const store = useStore();
  const [periodIdx, setPeriodIdx] = useState(0);
  const period = PERIODS[periodIdx];
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // A real date-ranged query on the server, not a filter over whatever
  // /api/payments happened to have loaded — that endpoint caps at the 500
  // most recent payments of every kind (PPPoE included), so a busy tenant's
  // hotspot sales could be crowded out of it entirely, and the period
  // selector used to just relabel the same unfiltered numbers regardless
  // of which one was picked.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.hotspotRevenue(period.value)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) store.toast('Could not load hotspot revenue'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period.value]);

  const byPlan = data?.byPlan ?? [];
  const total = data?.total ?? 0;
  const avg = data?.avg ?? 0;
  const count = data?.count ?? 0;

  const exportCsv = () => {
    const rows = [['bundle', 'sold', 'revenue'], ...byPlan.map((r) => [r.title, r.sold, r.revenue])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hotspot-revenue.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    store.toast('Revenue exported');
  };

  return (
    <Screen
      actions={
        <>
          <Button onClick={() => setPeriodIdx((i) => (i + 1) % PERIODS.length)}>{period.label} ▾</Button>
          <Button onClick={exportCsv}>Export CSV</Button>
        </>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Hotspot revenue" value={loading ? '…' : `KES ${kes(total)}`} hint={period.label.toLowerCase()} />
        <Stat label="Vouchers sold" value={loading ? '…' : count} hint="paid sessions" />
        <Stat label="Average sale" value={loading ? '…' : `KES ${kes(avg)}`} hint="per voucher" />
        <Stat label="Active bundles" value={(store.hsPlans ?? []).length} hint="on the portal" />
      </Grid>

      <Card title="Revenue by bundle">
        <Table
          rowKey={(r) => r.title}
          empty={loading ? 'Loading…' : 'No hotspot sales in this period'}
          rows={byPlan.filter((r) => r.sold > 0)}
          columns={[
            { key: 'title', label: 'Bundle', render: (r) => <span style={{ fontWeight: 600 }}>{r.title}</span> },
            { key: 'price', label: 'Price', render: (r) => <span style={{ fontFamily: font.mono }}>KES {kes(r.price)}</span> },
            { key: 'sold', label: 'Sold', align: 'right', render: (r) => <span style={{ fontFamily: font.mono }}>{r.sold}</span> },
            {
              key: 'revenue',
              label: 'Revenue',
              align: 'right',
              render: (r) => <span style={{ fontFamily: font.mono, color: color.green }}>KES {kes(r.revenue)}</span>,
            },
          ]}
        />
      </Card>
    </Screen>
  );
}
