import React, { useMemo, useState } from 'react';
import { color, font, kes } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { Button, Card, Grid, Screen, Stat, Table } from '../../ui/primitives';

const PERIODS = ['Last 4 months', 'Last 30 days', 'Last 7 days', 'This year'];

export default function HotspotRevenue() {
  const store = useStore();
  const [period, setPeriod] = useState('Last 4 months');

  const sales = useMemo(
    () => (store.mpesaTx ?? []).filter((p) => p.voucher_id && p.status === 'applied'),
    [store.mpesaTx]
  );

  const total = sales.reduce((a, p) => a + Number(p.amount ?? 0), 0);
  const avg = sales.length ? Math.round(total / sales.length) : 0;

  const byPlan = useMemo(() => {
    const out = new Map();
    for (const p of store.hsPlans ?? []) out.set(p.id, { title: p.title, price: p.price, sold: 0, revenue: 0 });
    for (const s of sales) {
      const row = out.get(s.plan_id);
      if (row) {
        row.sold += 1;
        row.revenue += Number(s.amount ?? 0);
      }
    }
    return [...out.values()].sort((a, b) => b.revenue - a.revenue);
  }, [store.hsPlans, sales]);

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
          <Button onClick={() => setPeriod(PERIODS[(PERIODS.indexOf(period) + 1) % PERIODS.length])}>{period} ▾</Button>
          <Button onClick={exportCsv}>Export CSV</Button>
        </>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Hotspot revenue" value={`KES ${kes(total)}`} hint={period.toLowerCase()} />
        <Stat label="Vouchers sold" value={sales.length} hint="paid sessions" />
        <Stat label="Average sale" value={`KES ${kes(avg)}`} hint="per voucher" />
        <Stat label="Active bundles" value={(store.hsPlans ?? []).length} hint="on the portal" />
      </Grid>

      <Card title="Revenue by bundle">
        <Table
          rowKey={(r) => r.title}
          empty="No hotspot sales yet"
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
