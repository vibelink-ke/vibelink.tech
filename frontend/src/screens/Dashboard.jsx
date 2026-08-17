import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, font, radius, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button } from '../ui/primitives';

const RANGES = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'This month'];

const CHANNELS = [
  { label: 'Paybill C2B — PPPoE', swatch: '#0f7a5f', providers: ['daraja'] },
  { label: 'KopoKopo STK — hotspot', swatch: '#54c2a1', providers: ['kopokopo'] },
  { label: 'Bank STK push', swatch: '#c9a227', providers: ['bankstk'] },
  { label: 'Till / paybill (no API)', swatch: '#c3ccc6', providers: ['manual_till'] },
];

const card = {
  background: color.cardBg,
  border: `1px solid ${color.line}`,
  borderRadius: radius.lg,
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

function Tile({ label, value, hint, onClick, valueColor }) {
  return (
    <div
      onClick={onClick}
      style={{
        ...card,
        padding: '16px 18px',
        gap: 8,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: color.muted }}>{label}</span>
      <span style={{ fontFamily: font.mono, fontSize: 26, fontWeight: 500, letterSpacing: '-.02em', color: valueColor ?? color.ink }}>
        {value}
      </span>
      <span style={{ fontSize: 12.5, color: color.neutralInk }}>{hint}</span>
    </div>
  );
}

const greeting = (h = new Date().getHours()) =>
  h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Dashboard() {
  const store = useStore();
  const navigate = useNavigate();
  const [range, setRange] = useState('Today');
  const [menuOpen, setMenuOpen] = useState(false);

  const today = useMemo(
    () =>
      new Date().toLocaleDateString('en-KE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    []
  );

  // Fetched here rather than added to the shared collections: it is the tenant's
  // own standing with us, and only this screen shows it.
  const [licence, setLicence] = useState(null);
  useEffect(() => {
    let live = true;
    api.licence().then((l) => { if (live) setLicence(l); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const clients = store.clients ?? [];
  const active = clients.filter((c) => c.status === 'active');

  // "Collected" comes from applied payments; the backend exposes only the
  // unmatched queue today, so anything not returned stays at zero.
  const collected = (store.mpesaTx ?? [])
    .filter((p) => p.status === 'applied')
    .reduce((a, p) => a + Number(p.amount ?? 0), 0);

  const expiring = useMemo(() => {
    const limit = Date.now() + 72 * 3600 * 1000;
    return clients.filter((c) => c.expires_at && new Date(c.expires_at).getTime() <= limit && c.status !== 'suspended');
  }, [clients]);

  const atRisk = expiring.reduce((a, c) => a + Number(c.credit ?? 0), 0);
  const openTickets = (store.tickets ?? []).filter((t) => t.status !== 'resolved').length;

  const exportCsv = () => {
    const rows = [['metric', 'value'], ['range', range], ['collected', collected], ['online', active.length], ['unmatched', store.unmatched.length]];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dashboard-${range.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    store.toast('Dashboard exported');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>{greeting()}</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: color.neutralInk }}>
            {today} · everything below runs on autopilot
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Button onClick={() => setMenuOpen((o) => !o)}>{range} ▾</Button>
            {menuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 38,
                  right: 0,
                  zIndex: 30,
                  minWidth: 170,
                  background: '#fff',
                  border: `1px solid ${color.line}`,
                  borderRadius: 10,
                  padding: 5,
                  boxShadow: '0 14px 32px rgba(18,23,21,.14)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                {RANGES.map((r) => (
                  <div
                    key={r}
                    onClick={() => {
                      setRange(r);
                      setMenuOpen(false);
                      store.toast('Dashboard range: ' + r);
                    }}
                    style={{ padding: '8px 11px', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
                  >
                    {r}
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button onClick={exportCsv}>Export</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <Tile
          label="COLLECTED TODAY"
          value={`KES ${kes(collected)}`}
          hint={collected ? `across ${store.mpesaTx.length} payments` : 'no collections yet'}
        />
        <Tile
          label="ONLINE NOW"
          value={active.length}
          hint={`${active.filter((c) => c.service === 'pppoe').length} PPPoE · ${active.filter((c) => c.service === 'hotspot').length} hotspot`}
        />
        <Tile label="AUTO-ACTIONS (24H)" value={0} hint="activations, suspends, SMS, receipts" />
        <Tile
          label="NEEDS A HUMAN"
          value={store.unmatched.length}
          valueColor={store.unmatched.length ? color.rust : color.neutralInk}
          hint="unmatched payments →"
          onClick={() => navigate('/payments')}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 14 }}>
        <div style={{ ...card, gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Collections by channel · last 7 days</span>
            <span style={{ fontFamily: font.mono, fontSize: 12, color: color.neutralInk }}>KES {kes(collected)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 170 }}>
            {WEEKDAYS.map((d) => (
              <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 3, height: '100%' }}>
                <div style={{ height: 1, background: '#c3ccc6' }} />
                <span style={{ textAlign: 'center', fontSize: 11, color: color.muted, paddingTop: 5 }}>{d}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', borderTop: '1px solid #eef0ec', paddingTop: 12 }}>
            {CHANNELS.map((c) => (
              <span key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#4a524c' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: c.swatch }} />
                {c.label}
              </span>
            ))}
          </div>
        </div>

        <div style={{ ...card, gap: 14 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Live automation feed</span>
          <div style={{ padding: '26px 0', textAlign: 'center', fontSize: 12.5, color: color.muted }}>
            Nothing has run yet — activity appears here automatically
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <div style={{ ...card, gap: 12 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Expiring next 72 hours</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: font.mono, fontSize: 30, fontWeight: 500 }}>{expiring.length}</span>
            <span style={{ fontSize: 13, color: color.neutralInk }}>accounts · KES {kes(atRisk)} at risk</span>
          </div>
          <div style={{ height: 8, borderRadius: radius.pill, background: '#eef0ec', overflow: 'hidden', display: 'flex' }}>
            {expiring.length > 0 && (
              <>
                <div style={{ width: '62%', background: color.green }} />
                <div style={{ width: '24%', background: color.amber }} />
                <div style={{ width: '14%', background: '#c05a2e' }} />
              </>
            )}
          </div>
          <span style={{ fontSize: 12.5, color: color.neutralInk }}>
            {expiring.length ? `${expiring.length} account(s) need renewal` : 'No accounts expiring yet'}
          </span>
        </div>

        <div style={{ ...card, gap: 12 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Support inbox</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>Open tickets</span>
              <span style={{ fontFamily: font.mono }}>{openTickets}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>Auto-resolved by bot today</span>
              <span style={{ fontFamily: font.mono, color: color.neutralInk }}>0</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>Avg. first response</span>
              <span style={{ fontFamily: font.mono }}>—</span>
            </div>
          </div>
        </div>

        {/* Licence standing. The invoice card is deliberately absent most of the
            month: it appeared permanently at KES 0, which trained everyone to
            ignore the one place that will later say they owe money. */}
        <div style={{ ...card, background: '#0f1a17', borderColor: '#0f1a17', color: '#e6ece8', gap: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Licence</span>
          {licence?.licenceEnds ? (
            <>
              <span style={{ fontFamily: font.mono, fontSize: 24, fontWeight: 500 }}>
                {new Date(licence.licenceEnds).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <span style={{ fontSize: 12.5, color: licence.daysLeft <= 5 ? '#f0a58a' : '#93a09a' }}>
                {licence.daysLeft > 0
                  ? `valid for ${licence.daysLeft} more day${licence.daysLeft === 1 ? '' : 's'}`
                  : 'expired'}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 12.5, color: '#93a09a' }}>No expiry set</span>
          )}

          {licence?.expiringSoon && (
            <span style={{ fontSize: 12.5, color: '#f0a58a', borderTop: '1px solid #1e2c27', paddingTop: 10 }}>
              Renew soon to avoid the account going read-only.
            </span>
          )}

          {licence?.readOnly && (
            <span style={{ fontSize: 12.5, color: '#f0a58a', borderTop: '1px solid #1e2c27', paddingTop: 10 }}>
              Licence expired — you can view everything but not make changes.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
