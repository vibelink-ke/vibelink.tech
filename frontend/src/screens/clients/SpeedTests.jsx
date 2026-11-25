import React, { useEffect, useState } from 'react';
import { color, radius } from '../../theme/tokens';
import { api } from '../../api/client';

/**
 * The speed tests this customer ran themselves (portal, wallet, "You're connected" page), newest first, against the speed
 * they pay for. Lets a technician see "slow since Tuesday" before going out.
 */
const when = (iso) => new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function ClientSpeedTests({ clientId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    api.subscriberSpeedTests(clientId).then((r) => live && setRows(r)).catch(() => live && setRows([]));
    return () => { live = false; };
  }, [clientId]);

  const tone = (r) => {
    if (!r.plan_down_kbps) return color.muted;
    const share = (Number(r.down_mbps) * 1000) / Number(r.plan_down_kbps);
    return share >= 0.7 ? color.green : share >= 0.4 ? '#a86a00' : color.rust;
  };
  return (
    <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '14px 20px 16px', marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Speed tests</div>
      <div style={{ fontSize: 12, color: color.muted, paddingBottom: 10 }}>
        Tests the customer ran themselves, from their device to our server. Two tests under 40% of the package in a day open a ticket.
      </div>
      {rows === null ? <span style={{ fontSize: 13, color: color.muted }}>Loading…</span>
        : !rows.length ? <span style={{ fontSize: 13, color: color.muted }}>No speed tests yet. The customer can run one from their portal.</span>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
                <thead>
                  <tr style={{ color: color.muted, fontSize: 11.5, textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>When</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Down</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Up</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Ping</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Of package</th>
                    <th style={{ padding: '6px 8px' }}>From</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${color.line}`, fontVariantNumeric: 'tabular-nums' }}>
                      <td style={{ padding: '7px 8px' }}>{when(r.created_at)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, color: tone(r) }}>{Number(r.down_mbps)} Mbps</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.up_mbps != null ? `${Number(r.up_mbps)} Mbps` : '—'}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.ping_ms != null ? `${Number(r.ping_ms)} ms` : '—'}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                        {r.plan_down_kbps ? `${Math.round((Number(r.down_mbps) * 100000) / Number(r.plan_down_kbps))}% of ${Number(r.plan_down_kbps) / 1000}` : '—'}
                      </td>
                      <td style={{ padding: '7px 8px', color: color.muted }}>{r.source === 'portal' ? 'Portal' : r.source === 'wallet' ? 'Wallet' : r.source === 'connected' ? 'Hotspot' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}
