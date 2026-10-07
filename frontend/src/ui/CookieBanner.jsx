import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Cookie notice. Shown once to every visitor until they choose, and again whenever "Cookie settings" is clicked
 * (window.dispatchEvent(new Event('vibelink:cookie-settings'))).
 *
 * The choice lives in a first-party cookie (vl_consent, one year) with a copy in localStorage:
 *   essential  only what the site needs to work: the sign-in session, and remembering theme and preferences
 *   all        also allows optional cookies, such as analytics, should any be added
 * Nothing optional runs today. Code that ever adds analytics must ask consentGiven() first (lib/consent.js) and listen
 * for the 'vibelink:consent' event.
 */
const COOKIE = 'vl_consent';

export function readConsent() {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
    if (m && (m[1] === 'all' || m[1] === 'essential')) return m[1];
  } catch { /* cookies blocked */ }
  try {
    const v = localStorage.getItem(COOKIE);
    if (v === 'all' || v === 'essential') return v;
  } catch { /* storage blocked */ }
  return null;
}

function saveConsent(value) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE}=${value}; Max-Age=${365 * 86400}; Path=/; SameSite=Lax${secure}`;
  } catch { /* cookies blocked */ }
  try { localStorage.setItem(COOKIE, value); } catch { /* storage blocked */ }
  window.vibelinkConsent = value;
  window.dispatchEvent(new CustomEvent('vibelink:consent', { detail: value }));
}

export default function CookieBanner() {
  const [open, setOpen] = useState(() => readConsent() === null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    window.vibelinkConsent = readConsent();
    const reopen = () => { setMore(true); setOpen(true); };
    window.addEventListener('vibelink:cookie-settings', reopen);
    return () => window.removeEventListener('vibelink:cookie-settings', reopen);
  }, []);

  if (!open) return null;
  const choose = (value) => { saveConsent(value); setOpen(false); setMore(false); };

  const btn = {
    border: 0, borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  };

  return createPortal(
    <div
      role="dialog"
      aria-label="Cookie notice"
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 100000, maxWidth: 640, margin: '0 auto',
        background: '#0e1a2b', color: '#e8eef6', borderRadius: 12, padding: '16px 18px',
        boxShadow: '0 12px 40px rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.12)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', fontSize: 13.5, lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>Cookies</div>
      <div style={{ color: '#c4cfdd' }}>
        We use essential cookies to keep you signed in and to remember your settings. We do not use advertising cookies.
        {' '}
        <span onClick={() => setMore((m) => !m)} style={{ color: '#5cd3fa', cursor: 'pointer', fontWeight: 600 }}>
          {more ? 'Hide details' : 'Details'}
        </span>
      </div>
      {more && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(255,255,255,.06)', borderRadius: 8, color: '#c4cfdd', display: 'grid', gap: 6 }}>
          <div><b style={{ color: '#fff' }}>Essential</b> (always on): your sign-in session, security checks, and remembering your theme and preferences. The site cannot work without them.</div>
          <div><b style={{ color: '#fff' }}>Optional</b> (only if you accept): measuring how the site is used so we can improve it. None are active at the moment; if we add any, they will run only if you chose Accept all.</div>
          <div>Your choice is kept in a cookie called <code>vl_consent</code> for one year. You can change it any time with Cookie settings.</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button style={{ ...btn, background: '#06aeef', color: '#04121f' }} onClick={() => choose('all')}>Accept all</button>
        <button style={{ ...btn, background: 'rgba(255,255,255,.1)', color: '#e8eef6' }} onClick={() => choose('essential')}>Essential only</button>
      </div>
    </div>,
    document.body,
  );
}
