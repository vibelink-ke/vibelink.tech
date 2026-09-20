import React, { useEffect, useRef, useState } from 'react';
import { color, radius } from '../theme/tokens';
import { Button } from './primitives';

/**
 * "Export ▾" with CSV, Excel and PDF underneath. `onExport(format)` gets 'csv', 'xlsx'
 * or 'pdf'; the button shows a short wait while it works, since the Excel and PDF
 * writers load on first use.
 */
export default function ExportMenu({ onExport, label = 'Export', disabled, title }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away, { passive: true });
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const pick = async (format) => {
    setOpen(false);
    setBusy(true);
    try { await onExport(format); } finally { setBusy(false); }
  };

  const item = {
    display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 13, background: 'none',
    border: 0, color: color.ink, cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div ref={box} style={{ position: 'relative', display: 'inline-block' }}>
      <Button onClick={() => setOpen((o) => !o)} disabled={disabled || busy} title={title}>
        {busy ? 'Preparing…' : `${label} ▾`}
      </Button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 190, zIndex: 30,
            background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.md,
            boxShadow: '0 8px 24px rgba(0,0,0,.14)', overflow: 'hidden',
          }}
        >
          <button type="button" role="menuitem" style={item} onClick={() => pick('xlsx')}>Excel (.xlsx)</button>
          <button type="button" role="menuitem" style={{ ...item, borderTop: `1px solid ${color.line}` }} onClick={() => pick('pdf')}>PDF (.pdf)</button>
          <button type="button" role="menuitem" style={{ ...item, borderTop: `1px solid ${color.line}` }} onClick={() => pick('csv')}>CSV (.csv)</button>
        </div>
      )}
    </div>
  );
}
