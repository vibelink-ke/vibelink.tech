import React, { useEffect, useState } from 'react';
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
 * Landing spot for the link POST /api/staff now sends by SMS (and email, if
 * one was given) the moment someone is invited — previously nothing was
 * ever sent at all, so an invited staff member had no password, no
 * username, and no way to discover either fact short of being told by hand.
 * Reachable with no session, same as /reset-password, so App.jsx routes
 * here before the sign-in gate.
 */
export default function AcceptInvite() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [info, setInfo] = useState(undefined);   // undefined = loading, null = invalid, object = ok
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setInfo(null); return; }
    api.inviteInfo(token).then(setInfo).catch(() => setInfo(null));
  }, [token]);

  const submit = async () => {
    if (!username.trim()) return setError('Choose a username.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== password2) return setError('The two passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await api.acceptInvite(token, username.trim(), password);
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
        {info === undefined ? (
          <span style={{ fontSize: 13.5, color: color.neutralInk }}>Loading…</span>
        ) : info === null ? (
          <>
            <span style={{ fontSize: 17, fontWeight: 600 }}>This invite link is invalid or has expired</span>
            <span style={{ fontSize: 12.5, color: color.neutralInk }}>
              Ask whoever invited you to send a new one from Staff & roles.
            </span>
            <a href="/" style={{ ...cta, textDecoration: 'none', display: 'block', boxSizing: 'border-box' }}>
              Back to sign in
            </a>
          </>
        ) : done ? (
          <>
            <span style={{ fontSize: 17, fontWeight: 600 }}>You're all set</span>
            <span style={{ fontSize: 12.5, color: color.neutralInk }}>
              Sign in with the username and password you just chose.
            </span>
            <a href="/" style={{ ...cta, textDecoration: 'none', display: 'block', boxSizing: 'border-box' }}>
              Sign in
            </a>
          </>
        ) : (
          <>
            <span style={{ fontSize: 17, fontWeight: 600 }}>
              {info.name ? `Welcome, ${info.name.split(' ')[0]}` : 'Welcome'}
            </span>
            <span style={{ fontSize: 12.5, color: color.neutralInk }}>
              You've been added to {info.tenant}'s team. Choose a username and password to sign in.
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#4a524c' }}>Username</span>
              <input
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                onKeyDown={onKey}
                placeholder="e.g. your first name"
                autoComplete="username"
                style={{ ...input, fontFamily: font.mono }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#4a524c' }}>Password</span>
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
              {busy ? 'Setting up…' : 'Set up my account'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
