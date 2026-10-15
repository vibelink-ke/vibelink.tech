import React, { useEffect, useState } from 'react';
import { color, font, kes, cur } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Empty, Grid, Input, Stat, Table } from '../../ui/primitives';

export default function HotspotDashboard() {
  const store = useStore();
  const [checking, setChecking] = useState(false);
  // Everyone connected right now, matched to the code behind each device address.
  const [onlineList, setOnlineList] = useState(null);
  const [onlineFilter, setOnlineFilter] = useState('');
  const loadOnline = () => api.hotspotOnline().then(setOnlineList).catch(() => setOnlineList((l) => l ?? []));
  useEffect(() => {
    loadOnline();
    const id = setInterval(() => { if (!document.hidden) loadOnline(); }, 30000);
    return () => clearInterval(id);
  }, []);
  const shownOnline = (onlineList ?? []).filter((r) => {
    const q = onlineFilter.trim().toLowerCase();
    if (!q) return true;
    return [r.code, r.signed_in_as, r.phone, r.plan, r.label, r.ip, r.router].some((x) => x && String(x).toLowerCase().includes(q));
  });
  // Find who a device address, phone or code belongs to (the router's active list shows an auto signed-in phone by its address).
  const [finder, setFinder] = useState('');
  const [found, setFound] = useState([]);
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    const q = finder.trim();
    if (q.length < 3) { setFound([]); return undefined; }
    setFinding(true);
    const id = setTimeout(() => {
      api.hotspotFind(q).then((r) => setFound(r)).catch(() => setFound([])).finally(() => setFinding(false));
    }, 350);
    return () => clearTimeout(id);
  }, [finder]);
  const vouchers = store.vouchers ?? [];
  // "in_use" means the code is activated and not yet expired — a customer
  // entitled to be connected, not proof that they are. /api/vouchers now
  // carries a real `online` flag (the same radacct/live_sessions check
  // /api/subscribers uses for PPPoE), so this screen can finally tell "paid
  // and valid" apart from "actually on the network right now" instead of
  // showing every still-valid code as a live session.
  const inUse = vouchers.filter((v) => v.status === 'in_use');
  const online = inUse.filter((v) => v.online);
  const unused = vouchers.filter((v) => v.status === 'unused');
  const expired = vouchers.filter((v) => v.status === 'expired');

  // Revenue today / sold today — a real count/sum query (GET /api/hotspot/today),
  // not derived from store.mpesaTx (capped at 500, GET /api/payments) or
  // store.vouchers (capped at 1000, GET /api/vouchers). Both caps are well
  // within reach on a single busy day, and silently undercounting either one
  // read as "today" losing transactions it actually had.
  const [today, setToday] = useState(null);
  useEffect(() => {
    const load = () => api.hotspotToday().then(setToday).catch(() => {});
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(id);
  }, []);
  const revenue = today?.revenue ?? 0;
  const soldToday = today?.sold ?? 0;

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
      <Card title="Find a device" subtitle="Paste a device address from the router (for example one shown in its Active list), a phone number or a code">
        <Input value={finder} onChange={(e) => setFinder(e.target.value)} placeholder="e.g. 72:10:FF:34:7A:B1, 0712…, or a code" />
        {finder.trim().length >= 3 && (
          <div style={{ marginTop: 10 }}>
            <Table
              rowKey={(r) => `${r.kind}-${r.code}`}
              empty={finding ? 'Looking…' : 'Nothing found for that'}
              rows={found}
              columns={[
                { key: 'code', label: 'Code', render: (r) => <span style={{ fontFamily: font.mono, fontWeight: 700 }}>{r.code}</span> },
                { key: 'kind', label: 'Type', render: (r) => (r.kind === 'access code' ? `Access code${r.label ? ' · ' + r.label : ''}` : 'Voucher') },
                { key: 'devices', label: 'Device(s)', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{r.devices || '—'}</span> },
                { key: 'status', label: 'Status', render: (r) => `${r.status}${r.expires_at ? ' · until ' + new Date(r.expires_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}` },
                { key: 'phone', label: 'Phone / plan', render: (r) => [r.phone, r.plan].filter(Boolean).join(' · ') || '—' },
              ]}
            />
          </div>
        )}
      </Card>

      <Grid min={200} gap={14}>
        <Stat label="Online now" value={online.length} hint="actually connected right now" />
        <Stat label="Active codes" value={inUse.length} hint="paid & valid, online or not" />
        {/* Counted from the vouchers themselves rather than hardcoded. */}
        <Stat label="Sold today" value={soldToday} hint="vouchers issued" />
        <Stat label="Revenue today" value={`${cur()} ${kes(revenue)}`} hint="hotspot only" />
        <Stat label="Unused codes" value={unused.length} hint={`${expired.length} expired`} />
      </Grid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
        <Card
          title="Live sessions"
          subtitle="Everyone connected on the router right now, with the code behind each device address"
          actions={
            <Button size="sm" onClick={async () => { await checkOnline(); loadOnline(); }} disabled={checking}
              title="Ask each router who is connected right now">
              {checking ? 'Asking routers…' : 'Refresh'}
            </Button>
          }
        >
          <div style={{ marginBottom: 10 }}>
            <Input value={onlineFilter} onChange={(e) => setOnlineFilter(e.target.value)} placeholder={`Search ${(onlineList ?? []).length} connected: code, device address, phone`} />
          </div>
          <Table
            rowKey={(r) => `${r.signed_in_as}-${r.ip}`}
            empty={onlineList === null ? 'Loading…' : 'Nobody connected right now'}
            rows={shownOnline}
            columns={[
              { key: 'code', label: 'Code', render: (r) => (r.code
                ? <span style={{ fontFamily: font.mono, fontWeight: 700 }}>{r.code}</span>
                : <span style={{ color: color.muted }}>not matched</span>) },
              { key: 'kind', label: 'Type', render: (r) => (r.kind ? `${r.kind}${r.label ? ' · ' + r.label : ''}` : '—') },
              { key: 'via', label: 'Signed in as', render: (r) => (r.by_address
                ? <span style={{ fontFamily: font.mono, fontSize: 12 }}>{r.signed_in_as}</span>
                : <span style={{ color: color.muted }}>typed the code</span>) },
              { key: 'phone', label: 'Phone / plan', render: (r) => [r.phone, r.plan].filter(Boolean).join(' · ') || '—' },
              { key: 'ip', label: 'Address', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{r.ip ?? '—'}</span> },
              { key: 'expires_at', label: 'Expires', render: (r) => (r.expires_at ? new Date(r.expires_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—') },
            ]}
          />
        </Card>

        <Card title="Top bundles" subtitle="By copies sold">
          {store.hsPlans?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {store.hsPlans.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{p.title}</span>
                  <span style={{ fontFamily: font.mono, color: color.neutralInk }}>{cur()} {kes(p.price)}</span>
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
