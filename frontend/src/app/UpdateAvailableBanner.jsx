import React, { useEffect, useRef, useState } from 'react';
import { color, radius } from '../theme/tokens';

/**
 * A deploy replaces the static frontend files while a tenant's tab is still
 * open on the old ones — every JS chunk that tab might still request no
 * longer exists, which is exactly the blank-page/MIME-error failure mode
 * this project hit once already. Rather than wait for a customer to notice
 * something's broken and refresh, this polls the build stamp scripts/
 * write-version.mjs writes into public/version.json on every build and
 * offers a one-click reload the moment it changes.
 *
 * Deliberately not automatic: reloading out from under someone mid-edit
 * (a form half filled in, an STK push in flight) would be worse than the
 * stale tab it's fixing.
 */
export default function UpdateAvailableBanner() {
  const [available, setAvailable] = useState(false);
  const [latest, setLatest] = useState(null);
  const myVersion = useRef(null);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { version, latest: changelog } = await res.json();
        if (myVersion.current === null) {
          myVersion.current = version;
        } else if (version !== myVersion.current && !stopped) {
          setLatest(changelog ?? null);
          setAvailable(true);
        }
      } catch {
        /* offline or mid-deploy — the next tick retries */
      }
    };
    check();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') check();
    }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (!available) return null;

  return (
    <div
      style={{
        position: 'fixed', bottom: 18, right: 18, zIndex: 1000,
        display: 'flex', flexDirection: 'column', gap: 10,
        background: color.ink, color: '#fff',
        borderRadius: radius.lg, padding: '14px 16px',
        boxShadow: '0 12px 32px rgba(0,0,0,.28)',
        fontSize: 13.5, maxWidth: 360,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        {latest?.title ? `New: ${latest.title}` : 'A new version of Vibelink is available.'}
      </div>
      {latest?.items?.length > 0 && (
        <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {latest.items.map((item, i) => (
            <li key={i} style={{ fontSize: 12.5, color: 'rgba(255,255,255,.82)' }}>{item}</li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
        <button
          type="button"
          onClick={() => setAvailable(false)}
          style={{
            border: 'none', borderRadius: radius.md, cursor: 'pointer',
            background: 'transparent', color: 'rgba(255,255,255,.7)', fontSize: 13, padding: '7px 10px',
          }}
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            flex: '0 0 auto', border: 'none', borderRadius: radius.md, cursor: 'pointer',
            background: '#fff', color: color.ink, fontWeight: 600, fontSize: 13, padding: '7px 12px',
          }}
        >
          Update now
        </button>
      </div>
    </div>
  );
}
