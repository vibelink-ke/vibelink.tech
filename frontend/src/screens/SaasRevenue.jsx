import React, { useMemo, useState } from 'react';
import { color, font, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { Card, Empty, Field, Grid, Input, Screen, Stat, Table } from '../ui/primitives';

/** Pricing knobs, transcribed from `state.pricing`. */
const DEFAULT_PRICING = { perClient: 22, hotspotPct: 3, setupFee: 550, minRevenue: 5000 };

/** Mirrors billTenants() in backend/src/jobs.js. */
function feeFor(t, pricing) {
  const type = t.planType ?? t.plan_type;
  const amount = Number(t.planAmount ?? t.plan_amount ?? 0);
  if (type === 'flat') return amount;
  if (type === 'per_device') return amount * Number(t.devices ?? 0);
  const pct = Number(t.revsharePct ?? t.revshare_pct ?? 0);
  return Math.min(Number(t.collected ?? 0) * (pct / 100), 120000);
}

export default function SaasRevenue() {
  const store = useStore();
  const [pricing, setPricing] = useState(DEFAULT_PRICING);

  /**
   * Above the early return, because hooks cannot be skipped.
   *
   * This sat below it. On the first render the session is still resolving, so
   * isPlatformOwner is false, the component returns early and React counts one
   * hook. A moment later the session arrives, the guard falls through to the
   * rest of the screen, and React counts two — "Rendered more hooks than during
   * the previous render", and the page dies. It failed for exactly the person
   * the screen is for, every time they opened it.
   */
  const tenants = store.tenants ?? [];
  const rows = useMemo(
    () => tenants.map((t) => ({ ...t, fee: feeFor(t, pricing) })),
    [tenants, pricing]
  );

  if (!store.isPlatformOwner) {
    return (
      <Screen title="SaaS revenue">
        <Card>
          <Empty>This screen is only visible to the platform owner. Switch the role in the top bar.</Empty>
        </Card>
      </Screen>
    );
  }

  const set = (k) => (e) => setPricing((p) => ({ ...p, [k]: e.target.value }));

  const mrr = rows.reduce((a, r) => a + r.fee, 0);
  const billable = rows.filter((r) => r.status === 'active' || r.status === 'readonly').length;

  return (
    <Screen
      title="SaaS revenue"
      subtitle="What the platform earns. Invoices are raised on the 1st by the billTenants job."
    >
      <Grid min={200} gap={14}>
        <Stat label="MRR" value={`KES ${kes(mrr)}`} tone={mrr ? color.green : undefined} hint="across all tenants" />
        <Stat label="Billable tenants" value={billable} hint="active or read-only" />
        <Stat label="ARR" value={`KES ${kes(mrr * 12)}`} hint="MRR × 12" />
        <Stat label="Avg. per tenant" value={`KES ${kes(billable ? Math.round(mrr / billable) : 0)}`} hint="monthly" />
      </Grid>

      <Card title="Pricing" subtitle="Defaults applied when onboarding a new ISP">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <Field label="Per client (KES/month)">
            <Input value={pricing.perClient} onChange={set('perClient')} type="number" />
          </Field>
          <Field label="Hotspot revenue share (%)">
            <Input value={pricing.hotspotPct} onChange={set('hotspotPct')} type="number" step="0.1" />
          </Field>
          <Field label="Setup fee (KES)">
            <Input value={pricing.setupFee} onChange={set('setupFee')} type="number" />
          </Field>
          <Field label="Minimum monthly (KES)">
            <Input value={pricing.minRevenue} onChange={set('minRevenue')} type="number" />
          </Field>
        </div>
      </Card>

      <Card title="Per-tenant billing">
        <Table
          rowKey={(r) => r.id}
          empty="No tenants to bill yet"
          rows={rows}
          columns={[
            { key: 'name', label: 'ISP', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { key: 'plan', label: 'Model', render: (r) => r.planType ?? r.plan_type ?? '—' },
            { key: 'devices', label: 'Active devices', align: 'right', render: (r) => <span style={{ fontFamily: font.mono }}>{r.devices ?? 0}</span> },
            {
              key: 'collected',
              label: 'They collected',
              align: 'right',
              render: (r) => <span style={{ fontFamily: font.mono }}>KES {kes(r.collected)}</span>,
            },
            {
              key: 'fee',
              label: 'Your fee',
              align: 'right',
              render: (r) => <span style={{ fontFamily: font.mono, color: color.green, fontWeight: 600 }}>KES {kes(r.fee)}</span>,
            },
          ]}
        />
        <div style={{ marginTop: 12, fontSize: 11.5, color: color.muted }}>
          Revenue share is capped at KES 120,000 per tenant per month, matching the cap in billTenants().
        </div>
      </Card>
    </Screen>
  );
}
