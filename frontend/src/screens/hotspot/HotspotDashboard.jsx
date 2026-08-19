import React, { useEffect, useState } from 'react';
import { color, font, kes } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Empty, Grid, Stat, Table } from '../../ui/primitives';

export default function HotspotDashboard() {
  const store = useStore();
  const [checking, setChecking] = useState(false);
  const vouchers = store.vouchers ?? [];
  const inUse = vouchers.filter((v) => v.status === 'in_use');
  const unused = vouchers.filter((v) => v.status === 'unused');
  const expired = vouchers.filter((v) => v.status === 'expired');

  const revenue = (store.mpesaTx ?? [])
    .filter((p) => p.voucher_id && p.status === 'applied')
    .reduce((a, p) => a + Number(p.amount ?? 0), 0);

  // Issued since midnight. A voucher exists because somebody paid for it, so
  // this is the day's hotspot sales without needing a separate tally.
  const soldToday = (store.vouchers ?? []).filter((v) => {
    const at = v.created_at ? new Date(v.created_at) : null;
    return at && at.toDateString() === new Date().toDateString();
  }).length;

  /**
   * "Online now" reads from voucher.status === 'in_use', which is only as
   * fresh as the last time something asked the router — RADIUS accounting
   * is silent when the tunnel is down, and nothing on this screen ever
   * triggered a check before. Same action Clients uses to "check who is
   * online" for PPPoE; here it also updates hotspot voucher status.
   */
  const checkOnline = async () => {
    setChecking(true);
    try {
      const res = await api.refreshPresence();
      await store.reload({ quiet: true });
      const parts = [`${res.online} connected on ${res.asked} router${res.asked === 1 ? '' : 's'}`];
      if (res.unreachable?.length) parts.push(`could not reach ${res.unreachable.join(', ')}`);
      store.toast(parts.join(' — '));
    } catch (e) {
      store.toast(`Could not ask the routers: ${e.message}`);
    } finally {
      setChecking(false);
    }
  };

  // Asked once on arrival rather than only on a manual click — an operator
  // opening this screen wants to know who is on right now, not the state
  // from whenever somebody last happened to press the button.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkOnline(); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Grid min={200} gap={14}>
        <Stat label="Online now" value={inUse.length} hint="active voucher sessions" />
        {/* Counted from the vouchers themselves rather than hardcoded. */}
        <Stat label="Sold today" value={soldToday} hint="vouchers issued" />
        <Stat label="Revenue today" value={`KES ${kes(revenue)}`} hint="hotspot only" />
        <Stat label="Unused codes" value={unused.length} hint={`${expired.length} expired`} />
      </Grid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
        <Card
          title="Live sessions"
          subtitle="Vouchers currently connected"
          actions={
            <Button size="sm" onClick={checkOnline} disabled={checking}
              title="Ask each router who is connected right now">
              {checking ? 'Asking routers…' : 'Refresh'}
            </Button>
          }
        >
          <Table
            rowKey={(v) => v.id}
            empty="Nobody connected right now"
            rows={inUse}
            columns={[
              { key: 'code', label: 'Code', render: (v) => <span style={{ fontFamily: font.mono }}>{v.code}</span> },
              { key: 'phone', label: 'Phone' },
              { key: 'data_used_mb', label: 'Used', align: 'right', render: (v) => `${v.data_used_mb ?? 0} MB` },
              {
                key: 'expires_at',
                label: 'Expires',
                render: (v) => (v.expires_at ? new Date(v.expires_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—'),
              },
            ]}
          />
        </Card>

        <Card title="Top bundles" subtitle="By copies sold">
          {store.hsPlans?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {store.hsPlans.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{p.title}</span>
                  <span style={{ fontFamily: font.mono, color: color.neutralInk }}>KES {kes(p.price)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No hotspot bundles configured yet</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
