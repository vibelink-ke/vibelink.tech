import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import useLicence from './useLicence';

const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;

/**
 * A line across the top for a tenant whose licence is still running but needs
 * attention: an unpaid statement to pay, a trial about to end, or a licence
 * about to run out. An expired licence is not a banner — it locks the dashboard
 * (see LicenceLocked); this only notices when the licence expires while the
 * tab is open and tells the app to lock.
 *
 * Only someone allowed to see billing is shown the amount and offered the button;
 * everyone else is told to ask the account owner.
 */
export default function LicenceBanner() {
  const store = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const lic = useLicence();
  const canPay = !!store.session?.perms?.['billing.view'];

  // It ran out while they were working: lock straight away.
  useEffect(() => {
    if (lic?.readOnly) window.dispatchEvent(new Event('vibelink:licence-expired'));
  }, [lic]);

  // The Licence page says all of this itself.
  if (!lic || lic.readOnly || pathname === '/licence') return null;

  const due = Number(lic.amountDue ?? 0);
  const days = lic.daysLeft;
  const owes = !lic.trial && due > 0;
  const trialEnding = lic.trial && days != null && days <= 7;
  const renewSoon = !lic.trial && !owes && days != null && days <= 7;
  if (!owes && !trialEnding && !renewSoon) return null;

  const tone = { bg: color.amberBg, line: '#efe0b8', fg: color.amberInk };
  const left = days != null && days >= 0 ? ` Your licence has ${days} day${days === 1 ? '' : 's'} left.` : '';

  let message;
  let label = 'Pay now';
  if (owes) {
    label = canPay ? `Pay ${kes(due)}` : 'Pay now';
    message = <><b>You have an unpaid statement{canPay ? ` — ${kes(due)} is due` : ''}.</b>{left} Pay it to keep your licence running.</>;
  } else if (trialEnding) {
    label = 'See options';
    message = <><b>Your free trial ends in {days} day{days === 1 ? '' : 's'}.</b> You are not charged during the trial.</>;
  } else {
    message = <><b>Your licence runs out in {days} day{days === 1 ? '' : 's'}.</b> Pay before then to keep the dashboard working.</>;
  }

  return (
    <div style={{
      background: tone.bg, borderBottom: `1px solid ${tone.line}`, color: tone.fg,
      padding: '10px 26px', fontSize: 13.5, display: 'flex', gap: 12, alignItems: 'center',
      justifyContent: 'space-between', flexWrap: 'wrap',
    }}>
      <span>
        {message}
        {!canPay && owes && ' Ask the account owner to pay it.'}
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
