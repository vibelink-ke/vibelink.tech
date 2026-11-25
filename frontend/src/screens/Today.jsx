import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { color, font, radius, cur } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';

/**
 * The home screen: what to look at first each morning. Money in today against yesterday at the same time, who expires
 * today, sites offline, and a short list of things that need a person. Every line opens the list behind it. Each part
 * shows only for a role that may see it. The full dashboard is one tap away.
 */
const money = (n) => `${cur()} ${Math.round(Number(n)).toLocaleString('en-KE')}`;
const since = (iso) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};
const LEVEL = { high: color.rust, medium: '#c08a1e', low: color.green };

function Tile({ label, value, sub, tone, to }) {
  const body = (
    <div style={{ border: `1px solid ${color.line}`, borderRadius: radius.lg, background: color.cardBg, padding: '12px 14px', display: 'grid', gap: 2, height: '100%' }}>
      <span style={{ fontSize: 12, color: color.muted }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums', color: tone ?? color.ink }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: color.muted }}>{sub}</span>}
    </div>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : body;
}

function Spark({ days }) {
  if (!days?.length) return null;
  const max = Math.max(1, ...days.map((d) => d.total));
  const w = 300, h = 44;
  const pts = days.map((d, i) => [(i / (days.length - 1 || 1)) * w, h - 4 - (d.total / max) * (h - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts.at(-1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 44, display: 'block' }} role="img" aria-label="Money in, last 14 days">
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="#e3f2ec" />
      <path d={line} fill="none" stroke={color.green} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color.green} />
    </svg>
  );
}

export default function Today() {
  const store = useStore();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.today().then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const now = new Date();
  const hello = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const first = String(store.session?.name ?? '').split(' ')[0];

  // The SMS balance the top bar already reads: own gateway credits, or the platform balance when there is no own gateway.
  const sms = store.smsCredits;
  const smsLeft = sms == null ? null : sms.configured ? (sms.credits ?? 0) : (store.smsGateways?.platformBalance ?? 0);
  const attention = [...(d?.attention ?? [])];
  if (smsLeft != null && smsLeft < 200) {
    attention.push({ level: smsLeft < 50 ? 'high' : 'medium', text: `SMS balance: ${smsLeft} left`, to: '/settings?tab=sms' });
  }

  const m = d?.money;
  const diff = m && d.moneyYesterdaySoFar > 0 ? Math.round(((m.today - d.moneyYesterdaySoFar) / d.moneyYesterdaySoFar) * 100) : null;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>{hello}{first ? `, ${first}` : ''}</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13.5, color: color.neutralInk }}>
            {now.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })} · updates every minute
          </p>
        </div>
        <Link to="/dashboard" style={{ fontSize: 13, fontWeight: 600, color: color.green }}>Full dashboard →</Link>
      </div>

      {err && <div style={{ fontSize: 13, color: color.rust }}>Could not load today's figures: {err}</div>}
      {!d && !err && <div style={{ fontSize: 13, color: color.muted }}>Loading…</div>}

      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {m && (
              <Tile
                label="Money in today"
                value={money(m.today)}
                sub={diff == null ? `${m.todayCount} payment${m.todayCount === 1 ? '' : 's'}` : `${diff >= 0 ? '+' : ''}${diff}% on yesterday by now`}
                tone={diff != null && diff < 0 ? color.rust : undefined}
                to="/payments"
              />
            )}
            {d.expiring && (
              <Tile label="Expire today" value={d.expiring.count} sub={d.expiredYesterday ? `${d.expiredYesterday} expired yesterday, not renewed` : 'Not yet renewed'} to="/clients" />
            )}
            {d.sitesDown && (
              <Tile
                label="Sites offline"
                value={d.sitesDown.length}
                sub={d.sitesDown.length ? `${d.sitesDown[0].name}, ${since(d.sitesDown[0].offline_since ?? d.sitesDown[0].last_seen)}` : `All ${d.sitesTotal} online`}
                tone={d.sitesDown.length ? color.rust : color.green}
                to="/routers"
              />
            )}
            {d.tickets && <Tile label="Open tickets" value={d.tickets.open} sub={d.tickets.old ? `${d.tickets.old} over 24 h` : 'None waiting long'} to="/tickets" />}
          </div>

          {m && (
            <div style={{ border: `1px solid ${color.line}`, borderRadius: radius.lg, background: color.cardBg, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: color.muted, marginBottom: 6 }}>
                <span>Money in, last 14 days</span>
                <span style={{ fontFamily: font.mono }}>{money(m.days.reduce((a, x) => a + x.total, 0))}</span>
              </div>
              <Spark days={m.days} />
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: color.muted }}>Needs a person</div>
            {attention.length === 0 && <div style={{ fontSize: 13.5, color: color.muted }}>Nothing waiting. Good.</div>}
            {attention.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => navigate(a.to)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.cardBg, cursor: 'pointer', textAlign: 'left', font: 'inherit', fontSize: 13.5, color: color.ink }}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: LEVEL[a.level], flex: 'none' }} aria-hidden="true" />
                <span style={{ flex: 1 }}>{a.text}</span>
                <span style={{ color: color.green, fontWeight: 600, fontSize: 12.5 }}>Open</span>
              </button>
            ))}
          </div>

          {d.expiring?.first?.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: color.muted }}>Expiring today</div>
              {d.expiring.first.map((c) => (
                <Link key={c.id} to={`/clients/${c.id}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.cardBg, textDecoration: 'none', color: color.ink, fontSize: 13.5 }}>
                  <span>{c.name}</span><span style={{ fontFamily: font.mono, color: color.muted }}>{c.account_code}</span>
                </Link>
              ))}
              {d.expiring.count > d.expiring.first.length && <span style={{ fontSize: 12.5, color: color.muted }}>and {d.expiring.count - d.expiring.first.length} more</span>}
            </div>
          )}

          {d.sitesDown?.length > 1 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: color.muted }}>Sites offline</div>
              {d.sitesDown.map((r) => (
                <Link key={r.id} to={`/routers?open=${r.id}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', border: `1px solid ${color.line}`, borderRadius: radius.md, background: color.cardBg, textDecoration: 'none', color: color.ink, fontSize: 13.5 }}>
                  <span>{r.name}</span><span style={{ color: color.rust }}>{since(r.offline_since ?? r.last_seen)}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
