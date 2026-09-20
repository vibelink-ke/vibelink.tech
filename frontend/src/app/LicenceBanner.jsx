import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';

/**
 * A line across the top of the dashboard once the licence has expired — or is
 * about to — with a way straight to paying. Only the dashboard is affected by
 * an expired licence; the banner says so, because the first thing anyone
 * wonders is whether their customers are cut off. They are not.
 *
 * Shown to everyone signed in (the licence status is not sensitive), but only
 * someone allowed to pay is offered the button; the others are told to ask
 * the account owner.
 */
export default function LicenceBanner() {
  const store = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [lic, setLic] = useState(null);
  const canPay = !!store.session?.perms?.['billing.view'];

  useEffect(() => {
    if (!store.session) return undefined;
    let live = true;
    const check = () => api.licence().then((l) => { if (live) setLic(l); }).catch(() => {});
    check();
    const id = setInterval(check, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { live = false; clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [store.session]);

  // The billing page shows all of this itself.
  if (!lic || pathname === '/licence') return null;
  const expired = !!lic.readOnly;
  const soon = !expired && lic.daysLeft != null && lic.daysLeft <= 7;
  if (!expired && !soon) return null;

  const tone = expired
    ? { bg: '#fdf1ec', line: '#f0d8ce', fg: color.rust }
    : { bg: color.amberBg, line: '#efe0b8', fg: color.amberInk };

  return (
    <div style={{
      background: tone.bg, borderBottom: `1px solid ${tone.line}`, color: tone.fg,
      padding: '10px 26px', fontSize: 13.5, display: 'flex', gap: 12, alignItems: 'center',
      justifyContent: 'space-between', flexWrap: 'wrap',
    }}>
      <span>
        {expired
          ? <><b>Your licence has expired.</b> The dashboard is view-only until it is renewed. Your customers and hotspot visitors are not affected.</>
          : <><b>Your licence runs out in {lic.daysLeft} day{lic.daysLeft === 1 ? '' : 's'}.</b> Pay before then to keep the dashboard fully working.</>}
        {!canPay && ' Ask the account owner to renew it.'}
      </span>
      {canPay && (
        <button
          type="button"
          onClick={() => navigate('/licence')}
          style={{
            border: 0, borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            background: tone.fg, color: '#fff',
          }}
        >
          Pay now
        </button>
      )}
    </div>
  );
}
