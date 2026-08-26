import React from 'react';
import { color, radius } from '../theme/tokens';
import { useStore } from '../state/store';

export default function Toast() {
  const { toastMsg, toastAction } = useStore();
  if (!toastMsg) return null;
  const clickable = !!toastAction;
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={clickable ? toastAction.onClick : undefined}
      style={{
        position: 'fixed',
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#12211d',
        color: '#eaf3ef',
        padding: '10px 16px',
        borderRadius: radius.md,
        fontSize: 13,
        boxShadow: '0 12px 30px rgba(18,23,21,.28)',
        zIndex: 90,
        maxWidth: '80vw',
        // A toast worth clicking through to gets a border that stands out
        // (the same rust used for the Dashboard's own new-activity
        // highlight) and a pointer cursor — nothing else marks it as
        // interactive otherwise.
        border: `1px solid ${clickable ? color.rust : `${color.mint}33`}`,
        cursor: clickable ? 'pointer' : 'default',
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      {toastMsg}
      {clickable && <span style={{ fontSize: 11.5, color: color.mint, fontWeight: 600 }}>View →</span>}
    </div>
  );
}
