import React, { useEffect, useMemo, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { api } from '../../api/client';
import { Card, Grid, Select, Stat, Table } from '../../ui/primitives';

const GAIN = '#0f7a5f';
const kes = (n) => `KES ${Math.round(Number(n ?? 0)).toLocaleString('en-KE')}`;
const monthLabel = (m) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const money = { fontFamily: font.mono, fontSize: 13 };
const profitColor = (n) => (n < 0 ? color.rust : n > 0 ? GAIN : color.muted);

/**
 * What the business earned against what it spent.
 *
 * Income is money received — PPPoE payments on client accounts and hotspot
 * voucher sales. Expenses count when they are paid, so a bill logged but not
 * yet paid does not reduce profit until the money leaves; it is shown as
 * "still to pay" instead. Salaries appear here on their own because paid
 * payroll is recorded as an expense.
 */
export default function ProfitLoss() {
  const [months, setMonths] = useState('6');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api.profitLoss(Number(months))
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [months]);

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
    const income = sum('income');
    const expenses = sum('expenses');
    return {
      pppoe: sum('pppoe'), hotspot: sum('hotspot'), other: sum('other'),
      income, expenses, profit: income - expenses,
      margin: income > 0 ? ((income - expenses) / income) * 100 : null,
    };
  }, [data]);

  const showOther = totals.other > 0;
  const rows = data?.rows ?? [];
  const peak = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expenses)));

  const categoryRows = useMemo(() => {
    const byCat = {};
    for (const r of rows) for (const [c, v] of Object.entries(r.byCategory)) byCat[c] = (byCat[c] ?? 0) + v;
    return Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount }));
  }, [rows]);

  const tableRows = [...rows].reverse();

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: color.muted }}>
          Cash basis: income when received, expenses when paid.
        </span>
        <Select
          value={months}
          onChange={(e) => setMonths(e.target.value)}
          options={[
            { value: '3', label: 'Last 3 months' },
            { value: '6', label: 'Last 6 months' },
            { value: '12', label: 'Last 12 months' },
          ]}
        />
      </div>

      {error && <p style={{ color: color.rust }}>Could not load the report: {error}</p>}
      {!data && !error && <p style={{ color: color.muted }}>Working it out…</p>}

      {data && (
        <>
          <Grid min={200} gap={14}>
            <Stat label="Income" value={kes(totals.income)} />
            <Stat label="Expenses paid" value={kes(totals.expenses)} />
            <Stat label="Net profit" value={kes(totals.profit)} tone={profitColor(totals.profit)} />
            <Stat label="Margin" value={totals.margin == null ? '—' : `${totals.margin.toFixed(1)}%`} />
          </Grid>

          <Card title="Income and expenses by month">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 170, padding: '4px 4px 0' }}>
              {rows.map((r) => (
                <div key={r.month} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 136, width: '100%', justifyContent: 'center' }}>
                    <div
                      title={`Income ${kes(r.income)}`}
                      style={{ width: '38%', maxWidth: 34, height: `${(r.income / peak) * 100}%`, minHeight: r.income ? 2 : 0, background: color.green, borderRadius: '3px 3px 0 0' }}
                    />
                    <div
                      title={`Expenses ${kes(r.expenses)}`}
                      style={{ width: '38%', maxWidth: 34, height: `${(r.expenses / peak) * 100}%`, minHeight: r.expenses ? 2 : 0, background: color.amber, borderRadius: '3px 3px 0 0' }}
                    />
                  </div>
                  <span style={{ fontSize: 11.5, color: color.muted, whiteSpace: 'nowrap' }}>{monthLabel(r.month)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: color.muted }}>
              <span><span style={{ display: 'inline-block', width: 9, height: 9, background: color.green, borderRadius: 2, marginRight: 6 }} />Income</span>
              <span><span style={{ display: 'inline-block', width: 9, height: 9, background: color.amber, borderRadius: 2, marginRight: 6 }} />Expenses</span>
            </div>
          </Card>

          <Card title="Month by month">
            <Table
          toolbar="never"
              rowKey={(r) => r.month}
              empty="No income or expenses in this period"
              rows={[...tableRows, { month: 'total', total: true, ...totals }]}
              columns={[
                {
                  key: 'month', label: 'Month',
                  render: (r) => <span style={{ fontWeight: r.total ? 700 : 600 }}>{r.total ? 'Total' : monthLabel(r.month)}</span>,
                },
                { key: 'pppoe', label: 'PPPoE income', align: 'right', render: (r) => <span style={money}>{kes(r.pppoe)}</span> },
                { key: 'hotspot', label: 'Hotspot income', align: 'right', render: (r) => <span style={money}>{kes(r.hotspot)}</span> },
                ...(showOther ? [{ key: 'other', label: 'Other', align: 'right', render: (r) => <span style={money}>{kes(r.other)}</span> }] : []),
                { key: 'income', label: 'Total income', align: 'right', render: (r) => <span style={{ ...money, fontWeight: 700 }}>{kes(r.income)}</span> },
                { key: 'expenses', label: 'Expenses', align: 'right', render: (r) => <span style={money}>{kes(r.expenses)}</span> },
                {
                  key: 'profit', label: 'Profit', align: 'right',
                  render: (r) => <span style={{ ...money, fontWeight: 700, color: profitColor(r.profit) }}>{kes(r.profit)}</span>,
                },
              ]}
            />
          </Card>

          <Card title="Where the money went">
            <Table
          toolbar="never"
              rowKey={(r) => r.category}
              empty="No paid expenses in this period"
              rows={categoryRows}
              columns={[
                { key: 'category', label: 'Category', render: (r) => <span style={{ fontWeight: 600 }}>{r.category}</span> },
                { key: 'amount', label: 'Paid', align: 'right', render: (r) => <span style={money}>{kes(r.amount)}</span> },
                {
                  key: 'share', label: 'Share', align: 'right',
                  render: (r) => <span style={{ color: color.muted, fontSize: 12.5 }}>{totals.expenses > 0 ? `${((r.amount / totals.expenses) * 100).toFixed(0)}%` : '—'}</span>,
                },
              ]}
            />
            {data.stillToPay.count > 0 && (
              <p style={{ margin: '12px 0 0', fontSize: 13, color: color.muted }}>
                Still to pay: <b style={{ color: color.ink }}>{kes(data.stillToPay.amount)}</b> across {data.stillToPay.count} logged
                expense{data.stillToPay.count === 1 ? '' : 's'} — not counted above until they are paid.
              </p>
            )}
          </Card>
        </>
      )}
    </>
  );
}
