import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import useLicence from './useLicence';

/** Set by the licence page's "View the dashboard (read-only)" button, for the rest of this browser session. */
export const VIEW_ONLY_KEY = 'vibelink.viewOnly';
const viewOnlyChosen = () => { try { return sessionStorage.getItem(VIEW_ONLY_KEY) === '1'; } catch { return false; } };
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;

/**
 * Three jobs, all about the licence:
 *
 *  1. A tenant whose licence has expired is taken to the Licence page — the
 *     expired page, with the ways to pay — instead of a dashboard they cannot
 *     change. They can still choose to look around (view-only), and then get the
 *     banner below on every screen.
 *  2. A line across the top when the licence has expired, with the amount to pay.
 *  3. The same line for a tenant whose licence is still running but who has an
 *     unpaid statement, so it is paid before it can cost them access.
 *
 * Everyone signed in gets the expired page, not just the owner: staff who cannot
 * pay are told to ask the owner, and can still look around read-only.
 *
 * Only the dashboard is affected by an expired licence. Customers and hotspot
 * visitors are not, and the wording says so, because that is the first thing
 * anyone wonders. Only someone allowed to see billing is offered the button and
 * the amount.
 */
export default function LicenceBanner() {
  const store = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const lic = useLicence();
  const canPay = !!store.session?.perms?.['billing.view'];

  // The session already says so at sign-in; the licence lookup takes over once it arrives.
  const expired = !!(lic ? lic.readOnly : store.session?.licenceExpired);

  // The expired page, until they choose to view the dashboard read-only.
  useEffect(() => {
    if (expired && pathname !== '/licence' && !viewOnlyChosen()) navigate('/licence', { replace: true });
  }, [expired, pathname, navigate]);

  // The Licence page says all of this itself.
  if (!lic || pathname === '/licence') return null;

  const due = Number(lic.amountDue ?? 0);
  const owes = !expired && !lic.trial && due > 0;
  const trialEnding = !expired && lic.trial && lic.daysLeft != null && lic.daysLeft <= 7;
  const renewSoon = !expired && !lic.trial && !owes && lic.daysLeft != null && lic.daysLeft <= 7;
  if (!expired && !owes && !trialEnding && !renewSoon) return null;

  const tone = expired
    ? { bg: '#fdf1ec', line: '#f0d8ce', fg: color.rust }
    : { bg: color.amberBg, line: '#efe0b8', fg: color.amberInk };

  const days = lic.daysLeft;
  const runsOut = days != null && days >= 0 ? ` Your licence has ${days} day${days === 1 ? '' : 's'} left.` : '';

  let message;
  let label = 'Pay now';
  if (expired) {
    label = canPay && due > 0 ? `Pay ${kes(due)}` : lic.trialEnded ? 'Activate' : 'Pay now';
    message = (
      <>
        <b>{lic.trialEnded ? 'Your free trial has ended.' : 'Your licence has expired.'}</b>
        {canPay && due > 0
          ? ` Pay ${kes(due)} to ${lic.trialEnded ? 'activate' : 'renew'} it.`
          : ' The dashboard is view-only until it is renewed.'}
        {' '}Your customers and hotspot visitors are not affected.
      </>
    );
  } else if (owes) {
    label = canPay ? `Pay ${kes(due)}` : 'Pay now';
    message = <><b>You have an unpaid statement{canPay ? ` — ${kes(due)} is due` : ''}.</b>{runsOut} Pay it to keep your licence running.</>;
  } else if (trialEnding) {
    label = 'See options';
    message = <><b>Your free trial ends in {days} day{days === 1 ? '' : 's'}.</b> You are not charged during the trial.</>;
  } else {
    message = <><b>Your licence runs out in {days} day{days === 1 ? '' : 's'}.</b> Pay before then to keep the dashboard fully working.</>;
  }

  return (
    <div style={{
      background: tone.bg, borderBottom: `1px solid ${tone.line}`, color: tone.fg,
      padding: '10px 26px', fontSize: 13.5, display: 'flex', gap: 12, alignItems: 'center',
      justifyContent: 'space-between', flexWrap: 'wrap',
    }}>
      <span>
        {message}
        {!canPay && (expired || owes) && ' Ask the account owner to pay it.'}
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
          {label}
        </button>
      )}
    </div>
  );
}
