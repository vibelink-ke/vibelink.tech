import React, { useEffect, useState } from 'react';
import { font } from '../theme/tokens';

/**
 * What a customer sees after scanning a staff ID badge's QR code, at
 * /verify-staff/<token>. Same reasoning as CustomerPortal: a different
 * audience on the same hostname, rendered outside the admin shell — no
 * sidebar, no store, no session, because the person here has none and never
 * will. A plain fetch rather than the admin api client for the same reason
 * CustomerPortal uses its own tiny one.
 */
const token = window.location.pathname.split('/verify-staff/')[1]?.split(/[/?#]/)[0] ?? '';

export default function VerifyStaff() {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let live = true;
    if (!token) { setState({ loading: false, data: null, error: 'No staff ID in this link.' }); return; }
    fetch(`/api/public/staff-verify/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error ?? 'Could not verify this ID.');
        return data;
      })
      .then((data) => { if (live) setState({ loading: false, data, error: null }); })
      .catch((e) => { if (live) setState({ loading: false, data: null, error: e.message }); });
    return () => { live = false; };
  }, []);

  const { loading, data, error } = state;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: '#f4f6f4', padding: '40px 16px', fontFamily: font.body ?? 'system-ui, sans-serif',
    }}>
      <div style={{
        width: '100%', maxWidth: 380, background: '#fff', borderRadius: 16,
        border: '1px solid #e2e6e1', padding: 28, textAlign: 'center',
      }}>
        {loading && <p style={{ color: '#6b756a' }}>Checking…</p>}

        {!loading && error && (
          <>
            <div style={{ fontSize: 34, marginBottom: 8 }}>⚠️</div>
            <h1 style={{ fontSize: 17, margin: '0 0 6px' }}>Could not verify this ID</h1>
            <p style={{ fontSize: 13.5, color: '#6b756a', margin: 0 }}>{error}</p>
          </>
        )}

        {!loading && data && (
          <>
            {data.photoData
              ? <img src={data.photoData} alt={data.name} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 14px' }} />
              : (
                <div style={{
                  width: 96, height: 96, borderRadius: '50%', margin: '0 auto 14px',
                  background: '#eef2ee', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 30, fontWeight: 600, color: '#6b756a',
                }}>
                  {data.name?.trim()?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
            <h1 style={{ fontSize: 19, margin: '0 0 2px' }}>{data.name}</h1>
            <p style={{ fontSize: 13.5, color: '#6b756a', margin: '0 0 18px', textTransform: 'capitalize' }}>
              {data.role} at {data.companyName}
            </p>
            <div style={{
              padding: '10px 14px', borderRadius: 10, fontSize: 14, fontWeight: 600,
              background: data.active ? '#e7f5ef' : '#fdf1ec',
              color: data.active ? '#1c7a4d' : '#a13d1f',
            }}>
              {data.active
                ? `✓ Active employee at ${data.companyName}`
                : `This person no longer works at ${data.companyName}`}
            </div>
            <p style={{ fontSize: 11.5, color: '#9aa298', marginTop: 18 }}>
              Verified against {data.companyName}'s own staff records.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
