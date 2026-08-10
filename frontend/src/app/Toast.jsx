import React from 'react';
import { color, radius } from '../theme/tokens';
import { useStore } from '../state/store';

export default function Toast() {
  const { toastMsg } = useStore();
  if (!toastMsg) return null;
  return (
    <div
      role="status"
      aria-live="polite"
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
        border: `1px solid ${color.mint}33`,
      }}
    >
      {toastMsg}
    </div>
  );
}
