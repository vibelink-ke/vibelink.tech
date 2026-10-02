import React, { useEffect, useMemo, useState } from 'react';
import { color, font, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Empty, Field, Grid, Input, Modal, Screen, Select, Stat, Table } from '../ui/primitives';

const STATUS_TONE = { open: 'pending', invoiced: 'default', paid: 'active', waived: 'default' };
const FREQUENCIES = [
  { value: 'daily', label: 'Daily — every night' },
  { value: 'weekly', label: 'Weekly — Mondays' },
  { value: 'manual', label: 'Manual — only when they request it' },
];

/** The last `count` Nairobi months, newest first, as 'YYYY-MM'. */
function recentMonths(count = 13) {
  const [y0, m0] = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }).slice(0, 7).split('-').map(Number);
  const out = [];
  let y = y0;
  let m = m0;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

const monthLabel = (key) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const money = { fontFamily: font.mono, fontSize: 13 };

function downloadCsv(month, rows) {
  const head = ['Tenant', 'Reference', 'Month', 'Billing mode', 'Revenue', 'Hotspot %', 'Hotspot fee',
    'Active PPPoE clients', 'Rate per client', 'PPPoE fee', 'Flat fee', 'Total', 'Status'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.name, r.billing_ref, month, r.billing_mode ?? 'tiered', r.hotspot_revenue, r.hotspot_pct, r.hotspot_fee,
    r.pppoe_active, r.pppoe_rate, r.pppoe_fee, r.flat_fee ?? 0, r.total, r.live ? 'estimate' : r.status,
  ].map(cell).join(','));
  const blob = new Blob([[head.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tenant-charges-${month}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const shortMonth = (key) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-KE', { month: 'short', timeZone: 'UTC' });
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

/** Billed vs received per month — grouped bars, plus SMS credit sales as a third series. */
function TrendChart({ series }) {
  const W = 720;
  const H = 210;
  const pad = { l: 38, r: 8, t: 10, b: 24 };
  const top = Math.max(1000, ...series.flatMap((s) => [s.billed, s.received, s.sms]));
  const step = (W - pad.l - pad.r) / series.length;
  const bar = Math.min(14, step / 4);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const ticks = [0, 0.5, 1].map((f) => f * top);
  const series3 = [['billed', color.mint], ['received', color.green], ['sms', color.amber]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Billed, received and SMS revenue by month">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={color.line} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={color.muted}>{compact(t)}</text>
        </g>
      ))}
      {series.map((s, i) => {
        const x0 = pad.l + i * step + step / 2 - (bar * 3 + 4) / 2;
        return (
          <g key={s.month} opacity={s.current ? 0.6 : 1}>
            {series3.map(([k, fill], j) => (
              <rect key={k} x={x0 + j * (bar + 2)} y={y(s[k])} width={bar} height={Math.max(0, y(0) - y(s[k]))} rx="2" fill={fill}>
                <title>{`${shortMonth(s.month)} ${s.month.slice(0, 4)} — ${k}: KES ${kes(s[k])}${s.current && k === 'billed' ? ' (estimate)' : ''}`}</title>
              </rect>
            ))}
            <text x={pad.l + i * step + step / 2} y={H - 8} textAnchor="middle" fontSize="10" fill={color.muted}>{shortMonth(s.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

const LegendDot = ({ c, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: color.muted }}>
    <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{label}
  </span>
);

/**
 * The platform's own revenue at a glance, above the per-tenant table: recurring revenue (what the last
 * closed month billed), how much of what is billed actually gets paid, how much is still owed and for how
 * long, and the other income stream (SMS credit sales). Billed and received are kept apart on purpose:
 * a tenant who pays ahead or late makes received differ from billed month to month.
 */
function Overview({ overview }) {
  if (!overview) return null;
  const { kpis, series, aging, overdue } = overview;
  const pct = (n) => (n == null ? '—' : `${n.toFixed(0)}%`);
  const change = kpis.mrrChangePct;
  const thisMonth = series[series.length - 1];
  return (
    <>
      <Grid min={190} gap={14}>
        <Stat
          label="Monthly recurring revenue"
          value={`KES ${kes(kpis.mrr)}`}
          hint={change == null ? 'last closed month billed' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}% vs the month before`}
        />
        <Stat label="Annualised (ARR)" value={`KES ${kes(kpis.arr)}`} hint="last closed month × 12" />
        <Stat label="Average per tenant" value={`KES ${kes(kpis.arpa)}`} hint={`${kpis.payingTenants} paying tenants`} />
        <Stat
          label="Collection rate"
          value={pct(kpis.collectionRate)}
          tone={kpis.collectionRate != null && kpis.collectionRate < 80 ? color.rust : undefined}
          hint="of billed, last 3 closed months"
        />
        <Stat label="Outstanding" value={`KES ${kes(kpis.outstanding)}`} tone={kpis.outstanding > 0 ? color.amberInk : undefined} hint="unpaid statements" />
        <Stat label="SMS credit sales" value={`KES ${kes(thisMonth.sms)}`} hint="this month, on top of statements" />
      </Grid>

      <Card title="Billed vs received" subtitle="Last 12 months. Received is cash that came in that month (statements, activation fees); this month's billed figure is an estimate.">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
          <LegendDot c={color.mint} label="Billed" />
          <LegendDot c={color.green} label="Received from tenants" />
          <LegendDot c={color.amber} label="SMS credit sales" />
        </div>
        <TrendChart series={series} />
      </Card>

      {overdue.length > 0 && (
        <Card
          title="Who owes what"
          subtitle={`KES ${kes(aging.current)} current · KES ${kes(aging.one)} one month late · KES ${kes(aging.twoPlus)} two or more months late`}
        >
          <Table
            rowKey={(r) => r.tenantId}
            toolbar="never"
            rows={overdue}
            columns={[
              { key: 'tenant', label: 'Tenant', render: (r) => <span style={{ fontWeight: 600 }}>{r.tenant}</span> },
              { key: 'n', label: 'Statements', align: 'right', render: (r) => r.statements },
              { key: 'oldest', label: 'Oldest', render: (r) => monthLabel(r.oldest) },
              { key: 'credit', label: 'Credit held', align: 'right', render: (r) => <span style={{ ...money, color: color.muted }}>{r.credit > 0 ? `KES ${kes(r.credit)}` : '—'}</span> },
              { key: 'owed', label: 'Owes', align: 'right', render: (r) => <span style={{ ...money, fontWeight: 700 }}>KES {kes(r.owed)}</span> },
            ]}
          />
        </Card>
      )}
    </>
  );
}

/**
 * What each tenant owes the platform for a month: a percentage of their hotspot
 * revenue plus a rate per active PPPoE client, at THEIR rate (set here, per
 * tenant). Payouts to tenants are never reduced by any of this — it is billed
 * separately. A closed month is a stored statement, unaffected by later rate
 * changes; the current month is a live estimate.
 */
export default function SaasRevenue() {
  const store = useStore();
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState(null);

  // Above the early return below, because hooks cannot be skipped.
  const load = async (key = month) => {
    setError(null);
    try {
      setData(await api.platformCharges(key));
    } catch (e) {
      setError(e.message);
      setData(null);
    }
  };
  useEffect(() => {
    if (store.isPlatformOwner) api.platformRevenueOverview().then(setOverview).catch(() => setOverview(null));
  }, [store.isPlatformOwner]);
  useEffect(() => {
    if (!store.isPlatformOwner) return;
    setData(null);
    load(month);
  }, [month, store.isPlatformOwner]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!store.isPlatformOwner) {
    return (
      <Screen title="SaaS revenue">
        <Card>
          <Empty>This screen is only visible to the platform owner.</Empty>
        </Card>
      </Screen>
    );
  }

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const tenants = store.tenants ?? [];
  const hasLive = rows.some((r) => r.live);

  const setStatus = async (r, status) => {
    try {
      await api.setChargeStatus(r.id, status);
      await load();
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      const out = await api.generateCharges(month);
      store.toast(out.created ? `${out.created} statement${out.created === 1 ? '' : 's'} drawn` : 'Nothing new to draw');
      await load();
    } catch (e) {
      store.toast(`Could not draw statements: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const openRates = (r) => {
    const t = tenants.find((x) => x.id === r.tenant_id) ?? {};
    setEditing({
      id: r.tenant_id, name: r.name,
      flat_monthly_fee: t.flat_monthly_fee ?? '',
      billing_mode: t.billing_mode ?? r.billing_mode ?? 'tiered',
      hotspot_commission_pct: t.hotspot_commission_pct ?? r.hotspot_pct ?? 3,
      pppoe_client_rate: t.pppoe_client_rate ?? r.pppoe_rate ?? 16,
      settlement_frequency: t.settlement_frequency ?? 'daily',
    });
  };

  const saveRates = async () => {
    const flat = editing.flat_monthly_fee === '' ? null : Number(editing.flat_monthly_fee);
    const pct = Number(editing.hotspot_commission_pct);
    const rate = Number(editing.pppoe_client_rate);
    if (flat !== null && !(flat >= 0)) return store.toast('The fixed fee must be zero or more');
    if (editing.billing_mode === 'revenue' && !(pct >= 0 && pct <= 100)) return store.toast('The hotspot percentage must be between 0 and 100');
    if (editing.billing_mode === 'revenue' && !(rate >= 0)) return store.toast('The per-client rate must be zero or more');
    setBusy(true);
    try {
      const updated = await api.updateTenant(editing.id, {
        flat_monthly_fee: flat,
        billing_mode: editing.billing_mode,
        hotspot_commission_pct: pct,
        pppoe_client_rate: rate,
        settlement_frequency: editing.settlement_frequency,
      });
      store.setCollection('tenants', (ts) => ts.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
      store.toast(`${editing.name}'s rates saved`);
      setEditing(null);
      await load();
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setEditing((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Screen
      title="SaaS revenue"
      subtitle="What tenants owe the platform each month — revenue share (hotspot % plus a rate per active PPPoE client) or a flat fee tiered on total revenue, chosen per tenant, unless overridden with a fixed fee. Payouts to tenants are never reduced by this."
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            options={months.map((m, i) => ({ value: m, label: i === 0 ? `${monthLabel(m)} (so far)` : monthLabel(m) }))}
          />
          <Button onClick={() => downloadCsv(month, rows)} disabled={!rows.length}>Export CSV</Button>
        </div>
      }
    >
      <Overview overview={overview} />

      {error && <p style={{ color: color.rust }}>Could not load: {error}</p>}
      {!data && !error && <p style={{ color: color.muted }}>Working it out…</p>}

      {data && (
        <>
          <Grid min={200} gap={14}>
            <Stat label={data.current ? 'Due so far' : 'Total due'} value={`KES ${kes(totals.total)}`} tone={totals.total ? color.green : undefined} />
            <Stat label="Hotspot commission" value={`KES ${kes(totals.hotspotFee)}`} hint="across revenue-share tenants" />
            <Stat label="PPPoE fees" value={`KES ${kes(totals.pppoeFee)}`} hint={`${totals.pppoeActive} active clients`} />
            <Stat label="Tenants charged" value={String(rows.length)} />
          </Grid>

          {!data.current && hasLive && (
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5 }}>
                  Some tenants have no statement for {monthLabel(month)} yet — the figures below are worked out now.
                  Drawing them fixes the figures and the rates used.
                </span>
                <Button variant="primary" onClick={generate} disabled={busy}>Draw statements</Button>
              </div>
            </Card>
          )}

          <Card title={`Charges — ${monthLabel(month)}`}>
            <Table
              rowKey={(r) => r.tenant_id}
              empty="No billable tenants this month (trials, tenants not yet activated, the demo and your own tenant are not charged)"
              rows={rows}
              columns={[
                {
                  key: 'name', label: 'Tenant',
                  render: (r) => (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600 }}>{r.name}</span>
                      <span style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>{r.billing_ref ?? r.subdomain}</span>
                    </div>
                  ),
                },
                { key: 'rev', label: 'Revenue', align: 'right', render: (r) => <span style={money}>KES {kes(r.hotspot_revenue)}</span> },
                ...(rows.some((r) => r.billing_mode === 'revenue')
                  ? [
                      { key: 'pct', label: 'Hotspot %', align: 'right', render: (r) => (r.billing_mode === 'revenue' ? <span style={{ ...money, color: color.muted }}>{Number(r.hotspot_pct)}%</span> : '—') },
                      { key: 'hf', label: 'Hotspot fee', align: 'right', render: (r) => (r.billing_mode === 'revenue' ? <span style={money}>KES {kes(r.hotspot_fee)}</span> : '—') },
                    ]
                  : []),
                { key: 'act', label: 'Active PPPoE', align: 'right', render: (r) => <span style={{ ...money, color: color.muted }}>{r.pppoe_active}</span> },
                ...(rows.some((r) => r.billing_mode === 'revenue')
                  ? [
                      { key: 'rate', label: 'Rate', align: 'right', render: (r) => (r.billing_mode === 'revenue' ? <span style={{ ...money, color: color.muted }}>KES {Number(r.pppoe_rate)}</span> : '—') },
                      { key: 'pf', label: 'PPPoE fee', align: 'right', render: (r) => (r.billing_mode === 'revenue' ? <span style={money}>KES {kes(r.pppoe_fee)}</span> : '—') },
                    ]
                  : []),
                {
                  key: 'basis', label: 'Charged by', align: 'right',
                  render: (r) => (tenants.find((t) => t.id === r.tenant_id)?.flat_monthly_fee != null
                    ? <Badge tone="default">fixed override</Badge>
                    : <span style={{ fontSize: 11.5, color: color.muted }}>{r.billing_mode === 'revenue' ? 'revenue share' : 'revenue tier'}</span>),
                },
                { key: 'total', label: 'Total', align: 'right', render: (r) => <span style={{ ...money, fontWeight: 700 }}>KES {kes(r.total)}</span> },
                {
                  key: 'status', label: 'Status',
                  render: (r) => r.live
                    ? <Badge tone="default">estimate</Badge>
                    : (
                      <Select
                        value={r.status}
                        onChange={(e) => setStatus(r, e.target.value)}
                        options={['open', 'invoiced', 'paid', 'waived']}
                      />
                    ),
                },
                {
                  key: 'edit', label: '', align: 'right',
                  render: (r) => (
                    <span onClick={() => openRates(r)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Set rates
                    </span>
                  ),
                },
              ]}
            />
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: color.muted }}>
              A revenue-share tenant's "Revenue" is hotspot (voucher) sales only, and their fee is that at the tenant's own
              hotspot % plus their own rate per active PPPoE client. A tiered tenant's "Revenue" is hotspot and PPPoE combined,
              and their fee is the flat tier it falls into: under KES 10,000 pays KES 1,000, KES 10,001–20,000 pays KES 2,000,
              over KES 20,000 pays KES 3,000. Either way, a fixed override replaces the calculation entirely. Trials are never
              charged, and a tenant's first statement is the first full month after you activate them. The demo tenant and your
              own tenant are not charged.
            </p>
          </Card>
        </>
      )}

      <Modal
        open={!!editing}
        title={`Rates — ${editing?.name ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveRates} disabled={busy}>{busy ? 'Saving…' : 'Save rates'}</Button>
          </>
        }
      >
        {editing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="How is this tenant charged?" span={2} hint="A fixed override below replaces either one; payouts to them are never reduced either way.">
              <Select
                value={editing.billing_mode}
                onChange={set('billing_mode')}
                options={[
                  { value: 'revenue', label: 'Revenue share — hotspot % plus a rate per active PPPoE client' },
                  { value: 'tiered', label: 'Flat fee tiered on total revenue' },
                ]}
              />
            </Field>
            {editing.billing_mode === 'revenue' ? (
              <>
                <Field label="Hotspot commission (%)" hint="Of their hotspot sales each month. Standard is 3.">
                  <Input type="number" step="0.1" min="0" max="100" value={editing.hotspot_commission_pct} onChange={set('hotspot_commission_pct')} />
                </Field>
                <Field label="Per active PPPoE client (KES)" hint="Each month. Standard is 16.">
                  <Input type="number" step="1" min="0" value={editing.pppoe_client_rate} onChange={set('pppoe_client_rate')} />
                </Field>
              </>
            ) : (
              <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12.5, color: color.muted }}>
                Under KES 10,000 of combined hotspot + PPPoE revenue pays KES 1,000, KES 10,001–20,000 pays KES 2,000, over KES 20,000 pays KES 3,000.
              </p>
            )}
            <Field label="Fixed monthly fee override (KES)" span={2} hint="Leave blank to use the billing mode above.">
              <Input type="number" step="1" min="0" placeholder="No override" value={editing.flat_monthly_fee} onChange={set('flat_monthly_fee')} />
            </Field>
            <Field label="Payout schedule" span={2} hint="How often what we collect for them is paid out — always in full.">
              <Select value={editing.settlement_frequency} onChange={set('settlement_frequency')} options={FREQUENCIES} />
            </Field>
            <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12.5, color: color.muted }}>
              Changes apply to this month and after. A statement already drawn for an earlier month keeps the amount it was drawn at.
            </p>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
