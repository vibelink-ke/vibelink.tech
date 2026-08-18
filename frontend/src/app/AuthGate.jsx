import React, { useState } from 'react';
import { color, font } from '../theme/tokens';
import { api } from '../api/client';

/**
 * Sign-in / create-ISP-account gate.
 * Ported from BILLING.SYSTEM.dc.html lines 27–96 (`sc-if value="{{ auth.needed }}"`).
 *
 * The mockup kept accounts in component state and compared passwords in plain
 * text. Here both forms post to the backend, which stores a scrypt hash and
 * returns an httpOnly session cookie — the password never lands in app state
 * beyond the keystroke, and is cleared on success.
 */

const BLANK = {
  identifier: '', email: '', username: '', password: '', password2: '',
  company: '', subdomain: '', name: '', phone: '', remember: true, terms: false,
};

const label = { fontSize: 12.5, fontWeight: 600, color: '#4a524c' };

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

/** `span` makes the field occupy the full width of the two-column signup grid. */
function Field({ children, hint, text, span }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: span ? '1 / -1' : undefined, minWidth: 0 }}>
      <span style={label}>{text}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: color.muted }}>{hint}</span>}
    </div>
  );
}

function Check({ on, onClick, children, style }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12.5,
        color: '#4a524c',
        cursor: 'pointer',
        lineHeight: 1.5,
        ...style,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          flex: '0 0 16px',
          borderRadius: 5,
          border: `1px solid ${on ? color.green : '#d5dad3'}`,
          background: on ? color.green : '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 10,
        }}
      >
        {on ? '✓' : ''}
      </span>
      {children}
    </span>
  );
}

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

// Before sign-in there is no tenant, so this is the platform's own brand. Once
// signed in the sidebar switches to the tenant's company name.
export default function AuthGate({ onSignedIn, brandName = 'Vibelink', only = null }) {
  // `only` pins the card to one purpose: sign-in on a tenant's own subdomain,
  // registration on the platform domain. Offering both on a tenant portal
  // invites an operator to register a second time and split their customers
  // across two portals they then have to reconcile by hand.
  const [mode, setMode] = useState(only ?? 'login');
  const [f, setF] = useState(BLANK);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Mirror the server's normalisation as you type, so the field always shows what
  // will actually be stored rather than silently rewriting it on submit.
  const NORMALISE = {
    subdomain: (v) => v.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    username: (v) => v.toLowerCase().replace(/[^a-z0-9._-]/g, ''),
  };

  // Typing clears the error banner, matching setAuthField() in the mockup.
  const set = (k) => (e) => {
    const value = (NORMALISE[k] ?? ((v) => v))(e.target.value);
    setF((s) => ({ ...s, [k]: value }));
    setError('');
  };

  const toggle = (k) => () => setF((s) => ({ ...s, [k]: !s[k] }));
  const tab = (m) => () => {
    setMode(m);
    setError('');
  };

  const clearSecrets = () => setF((s) => ({ ...s, password: '', password2: '' }));

  const login = async () => {
    if (!f.identifier || !f.password) return setError('Enter your email or username and password.');
    setBusy(true);
    setError('');
    try {
      const session = await api.login({ identifier: f.identifier, password: f.password, remember: f.remember });
      clearSecrets();
      onSignedIn(session, `Signed in as ${session.company}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const signup = async () => {
    if (!f.company) return setError('Enter your ISP name.');
    if (!f.subdomain) return setError('Choose a portal subdomain.');
    if (!f.name) return setError('Enter your full name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return setError('Enter a valid work email.');
    if ((f.password || '').length < 8) return setError('Password must be at least 8 characters.');
    if (f.password !== f.password2) return setError('The two passwords do not match.');
    if (!f.terms) return setError('Accept the terms to continue.');
    setBusy(true);
    setError('');
    try {
      const session = await api.signup(f);
      clearSecrets();

      // Their portal lives at their own subdomain, and every screen resolves its
      // tenant from the hostname — so staying here would show them whoever owns
      // the apex. The URL carries a one-use ticket that the subdomain trades for
      // its own cookie, which is why they do not have to sign in again.
      if (session.redirectTo) {
        window.location.assign(session.redirectTo);
        return;   // leave the spinner up; the page is on its way out
      }

      onSignedIn(
        session,
        `${session.company} created at ${session.subdomain}.vibelink.tech — credentials emailed, first month free`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter') (mode === 'login' ? login : signup)();
  };

  const subdomainNote = !f.subdomain
    ? 'Your customers reach the portal here.'
    : `${f.subdomain}.vibelink.tech`;

  const tabStyle = (on) => ({
    position: 'relative',
    flex: 1,
    padding: '9px 12px',
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center',
    background: on ? '#fff' : 'transparent',
    boxShadow: on ? '0 1px 3px rgba(18,23,21,.1)' : 'none',
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: color.pageBg,
        fontFamily: font.sans,
        color: color.ink,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 20,
        overflowY: 'auto',
      }}
    >
      {/* The shell widens for signup so its fields can sit two-up; `margin:auto`
          still centres the card vertically when it is shorter than the viewport. */}
      <div
        style={{
          width: '100%',
          maxWidth: mode === 'signup' ? 620 : 430,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          margin: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, justifyContent: 'center' }}>
          <div
            style={{
              width: 34,
              height: 34,
              flex: '0 0 34px',
              borderRadius: 9,
              background: color.green,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {brandName.charAt(0).toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em' }}>{brandName}</span>
            <span style={{ fontSize: 11, fontFamily: font.mono, color: color.muted }}>vibelink.tech</span>
          </div>
        </div>

        {/* Capped to the viewport so a long signup form scrolls inside the card
            rather than pushing the submit button off-screen. */}
        <div
          style={{
            background: '#fff',
            border: `1px solid ${color.line}`,
            borderRadius: 14,
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            boxSizing: 'border-box',
            maxHeight: 'calc(100vh - 122px)',
            minHeight: 0,
          }}
        >
          {/* The switch only appears where both make sense. */}
          {!only && (
            <div style={{ display: 'flex', gap: 2, background: color.tileBg, borderRadius: 9, padding: 4 }}>
              <div onClick={tab('login')} style={tabStyle(mode === 'login')}>
                Sign in
              </div>
              <div onClick={tab('signup')} style={tabStyle(mode === 'signup')}>
                Create ISP account
              </div>
            </div>
          )}

          {mode === 'login' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-.01em' }}>Sign in to your portal</span>
                <span style={{ fontSize: 12.5, color: color.neutralInk }}>
                  Use the credentials emailed to you at registration.
                </span>
              </div>

              <Field text="Work email or username">
                <input
                  value={f.identifier}
                  onChange={set('identifier')}
                  onKeyDown={onKey}
                  placeholder="you@yourisp.co.ke or your username"
                  autoComplete="username"
                  style={input}
                />
              </Field>
              <Field text="Password">
                <input
                  type="password"
                  value={f.password}
                  onChange={set('password')}
                  onKeyDown={onKey}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  style={input}
                />
              </Field>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <Check on={f.remember} onClick={toggle('remember')}>
                  Keep me signed in
                </Check>
                <span
                  onClick={() =>
                    setError(
                      f.identifier
                        ? `Reset link sent to the address on file for ${f.identifier}`
                        : 'Enter your email or username first'
                    )
                  }
                  style={{ fontSize: 12.5, fontWeight: 600, color: color.green, cursor: 'pointer' }}
                >
                  Forgot password?
                </span>
              </div>

              {error && (
                <div
                  style={{
                    background: '#fdf1ec',
                    border: '1px solid #f0d8ce',
                    borderRadius: 9,
                    padding: '11px 13px',
                    fontSize: 12.5,
                    color: color.rust,
                  }}
                >
                  {error}
                </div>
              )}

              <button type="button" onClick={login} disabled={busy} style={{ ...cta, opacity: busy ? 0.7 : 1 }}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '0 0 auto' }}>
                <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.01em' }}>Create your ISP account</span>
                <span style={{ fontSize: 12.5, color: color.neutralInk }}>
                  First month free. One-off setup fee of KES 550.
                </span>
              </div>

              {/* Only this grid scrolls, so the terms line and submit button stay put. */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '10px 14px',
                  overflowY: 'auto',
                  minHeight: 0,
                  flex: '1 1 auto',
                  paddingRight: 2,
                }}
              >
                <Field text="ISP / company name" span>
                  <input value={f.company} onChange={set('company')} placeholder="e.g. Skyline Networks" style={input} />
                </Field>

                <Field text="Portal subdomain" hint={subdomainNote} span>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      value={f.subdomain}
                      onChange={set('subdomain')}
                      placeholder="skyline"
                      style={{ ...input, fontFamily: font.mono, borderRadius: '9px 0 0 9px' }}
                    />
                    <span
                      style={{
                        padding: '11px 12px',
                        border: `1px solid ${color.line}`,
                        borderLeft: 'none',
                        borderRadius: '0 9px 9px 0',
                        background: color.subtleBg,
                        fontSize: 12.5,
                        fontFamily: font.mono,
                        color: color.neutralInk,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      .vibelink.tech
                    </span>
                  </div>
                </Field>

                <Field text="Full name">
                  <input value={f.name} onChange={set('name')} placeholder="Your name" style={input} />
                </Field>

                <Field text="Username" hint="Optional — sign in with this instead of your email.">
                  <input
                    value={f.username}
                    onChange={set('username')}
                    placeholder="asha"
                    autoComplete="off"
                    style={{ ...input, fontFamily: font.mono }}
                  />
                </Field>

                <Field text="Work email" hint="Login details are emailed here on registration.">
                  <input
                    value={f.email}
                    onChange={set('email')}
                    placeholder="you@yourisp.co.ke"
                    autoComplete="username"
                    style={input}
                  />
                </Field>

                <Field text="Phone">
                  <input
                    value={f.phone}
                    onChange={set('phone')}
                    placeholder="07xx xxx xxx"
                    style={{ ...input, fontFamily: font.mono }}
                  />
                </Field>

                <Field text="Password">
                  <input
                    type="password"
                    value={f.password}
                    onChange={set('password')}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    style={input}
                  />
                </Field>

                <Field text="Confirm password">
                  <input
                    type="password"
                    value={f.password2}
                    onChange={set('password2')}
                    onKeyDown={onKey}
                    placeholder="Repeat it"
                    autoComplete="new-password"
                    style={input}
                  />
                </Field>
              </div>

              <Check on={f.terms} onClick={toggle('terms')} style={{ fontSize: 12, lineHeight: 1.4, flex: '0 0 auto' }}>
                I accept the terms — KES 22 per active PPPoE client plus 3% of hotspot revenue.
              </Check>

              {error && (
                <div
                  style={{
                    background: '#fdf1ec',
                    border: '1px solid #f0d8ce',
                    borderRadius: 9,
                    padding: '11px 13px',
                    fontSize: 12.5,
                    color: color.rust,
                    flex: '0 0 auto',
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={signup}
                disabled={busy}
                style={{ ...cta, padding: 11, flex: '0 0 auto', opacity: busy ? 0.7 : 1 }}
              >
                {busy ? 'Creating…' : 'Create account'}
              </button>

              {/* No "sign in" here. Registration happens on the platform domain
                  and signing in happens on a tenant subdomain, so this link
                  offered a switch to a form that cannot authenticate anybody
                  from this hostname. Shown only where both are possible. */}
              {!only && (
                <span style={{ fontSize: 12, color: color.neutralInk, textAlign: 'center', flex: '0 0 auto' }}>
                  Already have an account?{' '}
                  <span onClick={tab('login')} style={{ fontWeight: 600, color: color.green, cursor: 'pointer' }}>
                    Sign in
                  </span>
                </span>
              )}
            </div>
          )}
        </div>

        <span style={{ fontSize: 11.5, color: color.muted, textAlign: 'center', lineHeight: 1.6 }}>
          Support: support@vibelink.co.ke
        </span>
      </div>
    </div>
  );
}
