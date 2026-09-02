import React, { useEffect, useState } from 'react';
import { color, font, radius } from '../theme/tokens';

/**
 * Reachable any time from the sidebar's version number, unlike
 * UpdateAvailableBanner (which only ever fires for a tab that's still open
 * when a deploy happens). Same source of truth — public/changelog.json,
 * hand-maintained per release — just shown in full rather than only the
 * latest entry.
 */
export default function WhatsNew({ onClose }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/changelog.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (!cancelled) setEntries([...d].reverse()); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: radius.lg, width: 460, maxWidth: '100%',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '16px 20px', borderBottom: `1px solid ${color.line}` }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: color.ink }}>What's new</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: color.muted, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {entries === null && <span style={{ fontSize: 13, color: color.muted }}>Loading…</span>}
          {entries?.length === 0 && <span style={{ fontSize: 13, color: color.muted }}>Nothing recorded yet.</span>}
          {entries?.map((e, i) => (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: color.ink }}>{e.title}</span>
                <span style={{ fontSize: 11.5, fontFamily: font.mono, color: color.muted }}>{e.date}</span>
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(e.items ?? []).map((item, j) => (
                  <li key={j} style={{ fontSize: 12.5, color: color.neutralInk }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
