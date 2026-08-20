import React, { useState } from 'react';
import { color, font } from '../theme/tokens';
import { api } from '../api/client';

const input = {
  border: `1px solid ${color.line}`,
  borderRadius: 9,
  padding: '11px 13px',
  fontSize: 13.5,
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: font.sans,
  outline: 'none',
};

const cta = {
  padding: 12,
  borderRadius: 9,
  background: color.green,
  color: '#fff',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'center',
  border: 'none',
  width: '100%',
};

/**
 * Landing spot for the link /api/auth/forgot emails out. Reachable with no
 * session at all — that is the point of a password reset — so App.jsx routes
 * here before the sign-in gate rather than after it.
 */
export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== password2) return setError('The two passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter') submit(); };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: color.pageBg,
        fontFamily: font.sans, color: color.ink, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 400, background: '#fff', border: `1px solid ${color.line}`,
          borderRadius: 14, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        {!token ? (
          <>
            <span style={{ fontSize: 17, fontWeight: 600 }}>This reset link is missing its token</span>
            <span style={{ fontSize: 12.5, color: color.neutralInk }}>
              Use the link from the email exactly as it arrived, or request a new one from the sign-in page.
            </span>
            <a href="/" style={{ ...cta, textDecoration: 'none', display: 'block', boxSizing: 'border-box' }}>
              Back to sign in
            </a>
          </>
        ) : done ? (
          <>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Password updated</span>
            <span style={{ fontSize: 12.5, color: color.neutralInk }}>
              Sign in with your new password — every other device has been signed out.
            </span>
            <a href="/" style={{ ...cta, textDecoration: 'none', display: 'block', boxSizing: 'border-box' }}>
              Sign in
            </a>
          </>
        ) : (
          <>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Set a new password</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#4a524c' }}>New password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                onKeyDown={onKey}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                style={input}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#4a524c' }}>Confirm password</span>
              <input
                type="password"
                value={password2}
                onChange={(e) => { setPassword2(e.target.value); setError(''); }}
                onKeyDown={onKey}
                placeholder="Repeat it"
                autoComplete="new-password"
                style={input}
              />
            </div>
            {error && (
              <div style={{ background: '#fdf1ec', border: '1px solid #f0d8ce', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, color: color.rust }}>
                {error}
              </div>
            )}
            <button type="button" onClick={submit} disabled={busy} style={{ ...cta, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
