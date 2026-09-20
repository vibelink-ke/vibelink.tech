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
  const head = ['Tenant', 'Reference', 'Month', 'Hotspot revenue', 'Hotspot %', 'Hotspot fee',
    'Active PPPoE clients', 'Rate per client', 'PPPoE fee', 'Total', 'Status'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.name, r.billing_ref, month, r.hotspot_revenue, r.hotspot_pct, r.hotspot_fee,
    r.pppoe_active, r.pppoe_rate, r.pppoe_fee, r.total, r.live ? 'estimate' : r.status,
  ].map(cell).join(','));
  const blob = new Blob([[head.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tenant-charges-${month}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
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
      hotspot_commission_pct: t.hotspot_commission_pct ?? r.hotspot_pct ?? 3,
      pppoe_client_rate: t.pppoe_client_rate ?? r.pppoe_rate ?? 16,
      settlement_frequency: t.settlement_frequency ?? 'daily',
    });
  };

  const saveRates = async () => {
    const pct = Number(editing.hotspot_commission_pct);
    const rate = Number(editing.pppoe_client_rate);
    if (!(pct >= 0 && pct <= 100)) return store.toast('The hotspot percentage must be between 0 and 100');
    if (!(rate >= 0)) return store.toast('The per-client rate must be zero or more');
    setBusy(true);
    try {
      const updated = await api.updateTenant(editing.id, {
        hotspot_commission_pct: pct, pppoe_client_rate: rate, settlement_frequency: editing.settlement_frequency,
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
      subtitle="What tenants owe the platform each month — a percentage of hotspot revenue plus a rate per active PPPoE client, at each tenant's own rate. Payouts to tenants are never reduced by this."
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
      {error && <p style={{ color: color.rust }}>Could not load: {error}</p>}
      {!data && !error && <p style={{ color: color.muted }}>Working it out…</p>}

      {data && (
        <>
          <Grid min={200} gap={14}>
            <Stat label={data.current ? 'Due so far' : 'Total due'} value={`KES ${kes(totals.total)}`} tone={totals.total ? color.green : undefined} />
            <Stat label="Hotspot commission" value={`KES ${kes(totals.hotspotFee)}`} hint={`on KES ${kes(totals.hotspotRevenue)} of hotspot sales`} />
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
              empty="No billable tenants this month (trials, the demo and your own tenant are not charged)"
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
                { key: 'rev', label: 'Hotspot sales', align: 'right', render: (r) => <span style={money}>KES {kes(r.hotspot_revenue)}</span> },
                { key: 'pct', label: 'Rate', align: 'right', render: (r) => <span style={{ ...money, color: color.muted }}>{Number(r.hotspot_pct)}%</span> },
                { key: 'hf', label: 'Hotspot fee', align: 'right', render: (r) => <span style={money}>KES {kes(r.hotspot_fee)}</span> },
                { key: 'act', label: 'Active PPPoE', align: 'right', render: (r) => <span style={money}>{r.pppoe_active}</span> },
                { key: 'rate', label: 'Rate', align: 'right', render: (r) => <span style={{ ...money, color: color.muted }}>KES {Number(r.pppoe_rate)}</span> },
                { key: 'pf', label: 'PPPoE fee', align: 'right', render: (r) => <span style={money}>KES {kes(r.pppoe_fee)}</span> },
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
              Hotspot sales are voucher payments received in the month. An active PPPoE client is a PPPoE line with
              status active when the statement is drawn. Trials, the demo tenant and your own tenant are not charged.
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
            <Field label="Hotspot commission (%)" hint="Of their hotspot sales each month. Standard is 3.">
              <Input type="number" step="0.1" min="0" max="100" value={editing.hotspot_commission_pct} onChange={set('hotspot_commission_pct')} />
            </Field>
            <Field label="Per active PPPoE client (KES)" hint="Each month. Standard is 16.">
              <Input type="number" step="1" min="0" value={editing.pppoe_client_rate} onChange={set('pppoe_client_rate')} />
            </Field>
            <Field label="Payout schedule" span={2} hint="How often what we collect for them is paid out — always in full.">
              <Select value={editing.settlement_frequency} onChange={set('settlement_frequency')} options={FREQUENCIES} />
            </Field>
            <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12.5, color: color.muted }}>
              New rates apply to this month and after. A statement already drawn for an earlier month keeps the rates it was drawn at.
            </p>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
