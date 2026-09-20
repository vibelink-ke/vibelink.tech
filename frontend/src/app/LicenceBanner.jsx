import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import useLicence from './useLicence';

/** Set by the licence page's "View the dashboard (read-only)" button, for the rest of this browser session. */
export const VIEW_ONLY_KEY = 'vibelink.viewOnly';
const viewOnlyChosen = () => { try { return sessionStorage.getItem(VIEW_ONLY_KEY) === '1'; } catch { return false; } };

/**
 * Two jobs, both about the licence:
 *
 *  1. A tenant whose licence has expired is taken to the Licence page — the
 *     expired page, with the ways to pay — instead of a dashboard they cannot
 *     change. They can still choose to look around (view-only), and then get the
 *     banner below on every screen.
 *  2. A line across the top when the licence has expired or is about to.
 *
 * Only the dashboard is affected by an expired licence. Customers and hotspot
 * visitors are not, and the wording says so, because that is the first thing
 * anyone wonders. Only someone allowed to see billing is redirected or offered
 * the button; everyone else is told to ask the account owner.
 */
export default function LicenceBanner() {
  const store = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const lic = useLicence();
  const canPay = !!store.session?.perms?.['billing.view'];

  const expired = !!lic?.readOnly;

  // The expired page, until they choose to view the dashboard read-only.
  useEffect(() => {
    if (expired && canPay && pathname !== '/licence' && !viewOnlyChosen()) navigate('/licence', { replace: true });
  }, [expired, canPay, pathname, navigate]);

  // The Licence page says all of this itself.
  if (!lic || pathname === '/licence') return null;
  const trialEnding = !expired && lic.trial && lic.daysLeft != null && lic.daysLeft <= 7;
  const renewSoon = !expired && !lic.trial && lic.daysLeft != null && lic.daysLeft <= 7;
  if (!expired && !trialEnding && !renewSoon) return null;

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
          ? <><b>{lic.trialEnded ? 'Your free trial has ended.' : 'Your licence has expired.'}</b> The dashboard is view-only until it is renewed. Your customers and hotspot visitors are not affected.</>
          : trialEnding
            ? <><b>Your free trial ends in {lic.daysLeft} day{lic.daysLeft === 1 ? '' : 's'}.</b> You are not charged during the trial.</>
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
          {trialEnding ? 'See options' : 'Pay now'}
        </button>
      )}
    </div>
  );
}
