import React, { useEffect, useState } from 'react';
import { color, radius } from '../../theme/tokens';
import { api } from '../../api/client';

/** The service agreements this customer signed at installation, each with its signed copy. */
export default function ClientAgreements({ clientId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.subscriberAgreements(clientId).then(setRows).catch(() => setRows([])); }, [clientId]);
  if (!rows) return null;
  return (
    <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '14px 20px', marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Service agreement</div>
      {rows.length === 0
        ? <div style={{ fontSize: 12.5, color: color.muted, marginTop: 4 }}>Not signed yet. The technician gets the customer to sign on their phone at installation.</div>
        : rows.map((a) => (
          <div key={a.token} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 13, padding: '8px 0', borderTop: `1px solid ${color.line}`, marginTop: 6 }}>
            <span>
              Signed by <b>{a.signed_name}</b> on {new Date(a.signed_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {a.technician ? <span style={{ color: color.muted }}> · with {a.technician}</span> : null}
            </span>
            <a href={a.link} target="_blank" rel="noreferrer" style={{ color: color.green, fontWeight: 600 }}>Open the signed copy</a>
          </div>
        ))}
    </div>
  );
}
