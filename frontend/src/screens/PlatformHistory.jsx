import React, { useEffect, useState } from 'react';
import { color, font, kes } from '../theme/tokens';
import { api } from '../api/client';
import { Badge, Card, Screen, Table } from '../ui/primitives';

const money = { fontFamily: font.mono, fontSize: 13 };
const when = (d) => (d ? new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS_TONE = { paid: 'active', failed: 'suspended' };

/**
 * The two directions money moves between the platform and its tenants, each its own history — the
 * settings screens only ever showed what's currently stuck or currently owed (Tenants.jsx's "Payouts
 * awaiting Safaricom", SaasRevenue.jsx's open statements); neither kept a plain log of what actually
 * happened. "Payouts" is money the platform sent a tenant (settlements — collected on their behalf,
 * settled to their own bank/till); "Pay-ins" is money a tenant sent the platform (tenant_payments —
 * their own licence/statement fees). Confirmed live as two separate database tables with no existing
 * screen reading either one's completed rows.
 */
export default function PlatformHistory() {
  const [payouts, setPayouts] = useState(null);
  const [payIns, setPayIns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.platformPayouts().then(setPayouts).catch((e) => setError(e.message));
    api.platformPayIns().then(setPayIns).catch((e) => setError(e.message));
  }, []);

  return (
    <Screen title="Payout & pay-in history" subtitle="Every completed transfer between the platform and its tenants, both directions">
      {error && <p style={{ color: color.rust }}>Could not load: {error}</p>}

      <Card title="Payouts" subtitle="Money the platform has sent to a tenant — collected on their behalf, settled to their own bank or till">
        {!payouts ? (
          <p style={{ color: color.muted, fontSize: 13.5 }}>Loading…</p>
        ) : (
          <Table
            rowKey={(r) => r.id}
            empty="No payouts recorded yet"
            rows={payouts}
            columns={[
              { key: 'tenant', label: 'Tenant', render: (r) => <span style={{ fontWeight: 600 }}>{r.tenant}</span> },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span style={money}>KES {kes(r.amount)}</span> },
              { key: 'fee', label: 'Fee', align: 'right', render: (r) => <span style={{ ...money, color: color.muted }}>{r.fee ? `KES ${kes(r.fee)}` : '—'}</span> },
              { key: 'method', label: 'Method' },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'default'}>{r.status}</Badge> },
              { key: 'reference', label: 'Reference', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{r.reference ?? '—'}</span> },
              { key: 'at', label: 'When', render: (r) => when(r.at) },
            ]}
          />
        )}
      </Card>

      <Card title="Pay-ins" subtitle="Money a tenant has sent to the platform — their own licence and statement fees">
        {!payIns ? (
          <p style={{ color: color.muted, fontSize: 13.5 }}>Loading…</p>
        ) : (
          <Table
            rowKey={(r) => r.id}
            empty="No pay-ins recorded yet"
            rows={payIns}
            columns={[
              { key: 'tenant', label: 'Tenant', render: (r) => <span style={{ fontWeight: 600 }}>{r.tenant}</span> },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span style={money}>KES {kes(r.amount)}</span> },
              { key: 'method', label: 'Method' },
              { key: 'phone', label: 'From', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{r.phone ?? '—'}</span> },
              { key: 'reference', label: 'Reference', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{r.reference ?? '—'}</span> },
              { key: 'at', label: 'When', render: (r) => when(r.at) },
            ]}
          />
        )}
      </Card>
    </Screen>
  );
}
