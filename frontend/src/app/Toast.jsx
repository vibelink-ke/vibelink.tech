import React from 'react';
import { color, radius } from '../theme/tokens';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useInDark } from '../ui/inDark';

export default function Toast() {
  const { toastMsg, toastAction, dismissToast } = useStore();
  const [markRef, dark] = useInDark();
  const marker = <span ref={markRef} hidden />;
  if (!toastMsg) return marker;
  const clickable = !!toastAction;
  // Drawn on <body>: inside the dark page's filtered root, position: fixed meant "bottom of the whole page",
  // so on a long page the toast sat far below the screen. See useInDark.
  return (
    <>
      {marker}
      {createPortal(
    <div
      className={dark ? 'om-dark' : undefined}
      role="status"
      aria-live="polite"
      onClick={clickable ? () => { toastAction.onClick(); dismissToast(); } : undefined}
      style={{
        position: 'fixed',
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#12211d',
        color: '#eaf3ef',
        // Sticky ones (clickable) are the ones that actually matter while
        // nobody may be looking — sized to be seen from across the room,
        // not read up close like a routine "Saved" confirmation.
        padding: clickable ? '16px 20px' : '10px 16px',
        borderRadius: radius.md,
        fontSize: clickable ? 15.5 : 13,
        fontWeight: clickable ? 600 : 400,
        boxShadow: clickable ? '0 16px 40px rgba(18,23,21,.4)' : '0 12px 30px rgba(18,23,21,.28)',
        zIndex: 90,
        maxWidth: clickable ? '92vw' : '80vw',
        width: clickable ? 420 : undefined,
        // A toast worth clicking through to gets a border that stands out
        // (the same rust used for the Dashboard's own new-activity
        // highlight) and a pointer cursor — nothing else marks it as
        // interactive otherwise.
        border: `${clickable ? 2 : 1}px solid ${clickable ? color.rust : `${color.mint}33`}`,
        cursor: clickable ? 'pointer' : 'default',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <span style={{ flex: 1 }}>{toastMsg}</span>
      {clickable && (
        <>
          <span style={{ fontSize: 12.5, color: color.mint, fontWeight: 700, whiteSpace: 'nowrap' }}>View →</span>
          <button
            onClick={(e) => { e.stopPropagation(); dismissToast(); }}
            aria-label="Dismiss"
            style={{
              background: 'none', border: 'none', color: '#eaf3ef99', cursor: 'pointer',
              fontSize: 18, lineHeight: 1, padding: '2px 4px', fontFamily: 'inherit',
            }}
          >
            ×
          </button>
        </>
      )}
    </div>,
        document.body,
      )}
    </>
  );
}
