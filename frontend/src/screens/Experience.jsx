import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { api } from '../api/client';
import { Tabs } from '../ui/primitives';

/**
 * Customer experience: a 0 to 10 score per home customer and per site, from the last week's reconnects, very short
 * sessions, the customer's own speed tests and their tickets (backend experience.js). For finding a struggling tower,
 * and calling a customer before they call you or leave.
 */
export const scoreTone = (s) => (s == null ? { bg: color.subtleBg, fg: color.muted } : s >= 7 ? { bg: '#e3f2ec', fg: color.green } : s >= 5 ? { bg: '#fbf0d9', fg: '#a86a00' } : { bg: '#fbe6df', fg: color.rust });
export function Score({ value }) {
  const t = scoreTone(value);
  return (
    <span style={{ display: 'inline-flex', minWidth: 36, justifyContent: 'center', padding: '2px 8px', borderRadius: 99, background: t.bg, color: t.fg, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>
      {value == null ? '–' : value.toFixed(1)}
    </span>
  );
}

const box = { background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '14px 16px' };
const th = { padding: '6px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: color.muted, textAlign: 'left' };
const td = { padding: '8px', borderTop: `1px solid ${color.line}`, fontSize: 13, verticalAlign: 'top' };

function People({ rows, empty }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: color.muted, padding: '8px 0' }}>{empty}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead><tr><th style={th}>Customer</th><th style={th}>Site</th><th style={th}>Why</th><th style={{ ...th, textAlign: 'right' }}>Score</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>
                <Link to={`/clients/${r.id}`} style={{ color: color.ink, fontWeight: 600, textDecoration: 'none' }}>{r.name}</Link>
                <div style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>{r.account_code} · {r.phone}</div>
              </td>
              <td style={td}>{r.site ?? '—'}</td>
              <td style={{ ...td, color: color.neutralInk }}>
                {r.reasons.join('; ')}
                {r.risk && <div style={{ fontSize: 12, color: color.rust, marginTop: 2 }}>{r.status === 'expired' ? 'Expired' : `Owes ${Math.round(r.owed).toLocaleString('en-KE')}`}</div>}
              </td>
              <td style={{ ...td, textAlign: 'right' }}><Score value={r.score} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Experience() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('worst');
  useEffect(() => { api.experience().then(setD).catch((e) => setErr(e.message)); }, []);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>Customer experience</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13.5, color: color.neutralInk, maxWidth: '70ch' }}>
          A score from 0 to 10 for each home customer over the last 7 days: how often the line reconnects, sessions that last under
          5 minutes, their own speed tests and their tickets. 10 means none of these. Sites get the average of their customers.
        </p>
      </div>
      {err && <div style={{ color: color.rust, fontSize: 13 }}>Could not load: {err}</div>}
      {!d && !err && <div style={{ color: color.muted, fontSize: 13 }}>Working out the scores…</div>}
      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <div style={box}><div style={{ fontSize: 12, color: color.muted }}>Average</div><div style={{ marginTop: 4 }}><Score value={d.average} /></div><div style={{ fontSize: 12, color: color.muted, marginTop: 4 }}>{d.counted} customers scored</div></div>
            <div style={box}><div style={{ fontSize: 12, color: color.muted }}>Below 5</div><div style={{ fontSize: 22, fontWeight: 700 }}>{d.worst.filter((r) => r.score < 5).length}</div><div style={{ fontSize: 12, color: color.muted }}>having a bad week</div></div>
            <div style={box}><div style={{ fontSize: 12, color: color.muted }}>Likely to leave</div><div style={{ fontSize: 22, fontWeight: 700, color: d.risk.length ? color.rust : color.ink }}>{d.risk.length}</div><div style={{ fontSize: 12, color: color.muted }}>low score and owing or expired</div></div>
            <div style={box}><div style={{ fontSize: 12, color: color.muted }}>No data</div><div style={{ fontSize: 22, fontWeight: 700 }}>{d.noData}</div><div style={{ fontSize: 12, color: color.muted }}>not online this week</div></div>
          </div>

          <div style={box}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Sites, worst first</div>
            {d.sites.length === 0 ? <div style={{ fontSize: 13, color: color.muted }}>No sessions recorded this week.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                  <thead><tr><th style={th}>Site</th><th style={{ ...th, textAlign: 'right' }}>Customers</th><th style={{ ...th, textAlign: 'right' }}>Below 5</th><th style={{ ...th, textAlign: 'right' }}>Average</th></tr></thead>
                  <tbody>
                    {d.sites.map((s) => (
                      <tr key={s.router_id ?? 'none'}>
                        <td style={td}>{s.router_id ? <Link to={`/routers?open=${s.router_id}`} style={{ color: color.ink, textDecoration: 'none', fontWeight: 600 }}>{s.site}</Link> : s.site}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.n}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: s.below5 ? color.rust : color.muted }}>{s.below5}</td>
                        <td style={{ ...td, textAlign: 'right' }}><Score value={s.avg} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={box}>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'worst', label: `Having a bad week (${d.worst.length})` }, { id: 'risk', label: `Likely to leave (${d.risk.length})` }]} />
            <div style={{ marginTop: 10 }}>
              {tab === 'worst'
                ? <People rows={d.worst} empty="Nobody below 7 this week." />
                : <People rows={d.risk} empty="Nobody with a low score is also owing or expired." />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
