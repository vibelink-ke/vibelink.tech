import React, { useState } from 'react';
import Footer from '../app/Footer';
import { color, font, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import Toast from '../app/Toast';
import useLicence from '../app/useLicence';
import Licence from './Licence';

/**
 * What a signed-in tenant sees once their licence has expired: nothing but this. No menu, no
 * dashboard, not even read-only — a plain "License Expired" dialog, the way desktop software says it.
 * Renew now opens what is owed and the ways to pay it (below the dialog); Exit signs out. Their
 * customers and hotspot visitors are unaffected — only the staff dashboard is locked.
 */
const BLUE = 'linear-gradient(180deg, #0c62b8 0%, #08478f 100%)';

export default function LicenceLocked() {
  const store = useStore();
  const lic = useLicence();
  const [paying, setPaying] = useState(false);
  const canPay = !!store.session?.perms?.['billing.view'];
  const due = Number(lic?.amountDue ?? 0);

  const button = (primary) => ({
    minWidth: 118, padding: '7px 18px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
    background: primary ? '#0c62b8' : '#f6f6f6', color: primary ? '#fff' : '#111',
    border: `1px solid ${primary ? '#08478f' : '#8a8a8a'}`, borderRadius: 2,
  });

  return (
    <div
      className={store.dark ? 'om-dark' : undefined}
      style={{
        minHeight: '100vh', background: color.pageBg, color: color.ink, fontFamily: font.sans,
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6vh 16px 40px', gap: 24,
      }}
    >
      <div
        role="alertdialog"
        aria-labelledby="licence-expired-title"
        style={{ width: '100%', maxWidth: 440, background: '#fff', border: '1px solid #b9c2cc', boxShadow: '0 12px 40px rgba(0,0,0,.28)', color: '#111' }}
      >
        {/* the window's own title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0 0 12px', height: 34, fontSize: 13 }}>
          <span>License Expired</span>
          <button
            type="button"
            onClick={() => store.signOut()}
            aria-label="Exit"
            title="Exit"
            style={{ width: 46, height: 34, border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#333', fontFamily: 'inherit' }}
          >
            &#x2715;
          </button>
        </div>

        <div className="no-invert" style={{ background: BLUE, color: '#fff', textAlign: 'center', padding: '22px 12px 24px' }}>
          <h1 id="licence-expired-title" style={{ margin: 0, fontSize: 30, fontWeight: 400, letterSpacing: '.01em' }}>License Expired</h1>
        </div>

        <div style={{ padding: '30px 34px 34px', textAlign: 'center', fontSize: 15 }}>
          <div style={{ color: '#a80000', fontWeight: 700, fontSize: 16, marginBottom: 22 }}>Your License is Expired!</div>
          <div style={{ lineHeight: 1.5 }}>
            Contact Vibelink to renew your license.
            {due > 0 && canPay && <div style={{ marginTop: 12, fontWeight: 600 }}>Amount due: KES {kes(due)}</div>}
            {!canPay && <div style={{ marginTop: 12, fontSize: 13.5, color: '#444' }}>Please ask the account owner to renew it.</div>}
          </div>
        </div>

        <div style={{ background: '#e8e8e8', padding: '16px 12px', display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          {canPay && (
            <button type="button" onClick={() => setPaying((p) => !p)} style={button(true)}>
              {paying ? 'Hide payment' : 'Renew now'}
            </button>
          )}
          <button type="button" onClick={() => store.signOut()} style={button(false)}>Exit</button>
        </div>
      </div>

      {paying && canPay && (
        <div style={{ width: '100%', maxWidth: 1000 }}>
          <Licence />
        </div>
      )}
      <Footer company={store.session?.company} floating />
      <Toast />
    </div>
  );
}
