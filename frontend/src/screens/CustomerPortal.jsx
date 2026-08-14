import React, { useCallback, useEffect, useState } from 'react';
import { color, font, radius } from '../theme/tokens';

/**
 * The customer's own page, at /customer.
 *
 * Deliberately not the admin app with things hidden. It renders outside the
 * admin shell — no sidebar, no store, no staff session — because the two
 * audiences share nothing but a hostname. A subscriber signing in here holds a
 * portal cookie that the admin routes do not accept, and vice versa.
 */
const api = {
  async call(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.error ?? `${res.status}`);
    return data;
  },
  me: () => api.call('GET', '/portal/me'),
  login: (account, password) => api.call('POST', '/portal/login', { account, password }),
  logout: () => api.call('POST', '/portal/logout', {}),
  support: (subject) => api.call('POST', '/portal/support', { subject }),
};

const page = {
  minHeight: '100vh',
  background: '#f4f6f3',
  fontFamily: font.sans,
  color: color.ink,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '32px 16px',
};

const card = {
  background: '#fff',
  border: `1px solid ${color.line}`,
  borderRadius: radius.lg,
  padding: 22,
  width: '100%',
  maxWidth: 460,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const input = {
  padding: '10px 12px',
  border: `1px solid ${color.line}`,
  borderRadius: radius.md,
  fontSize: 15,
  fontFamily: font.mono,
  width: '100%',
  boxSizing: 'border-box',
};

const button = (primary) => ({
  padding: '10px 16px',
  border: primary ? 'none' : `1px solid ${color.line}`,
  borderRadius: radius.md,
  background: primary ? color.green : '#fff',
  color: primary ? '#fff' : color.ink,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
});

function Row({ k, v, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
      <span style={{ color: color.muted }}>{k}</span>
      <span style={{ fontWeight: 600, color: tone, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

export default function CustomerPortal() {
  const [me, setMe] = useState(undefined);   // undefined = still checking
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try { setMe(await api.me()); } catch { setMe(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const signIn = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNote('');
    try {
      await api.login(account.trim(), password);
      await load();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  const raise = async () => {
    const subject = window.prompt('What is wrong? Support will see this.');
    if (!subject?.trim()) return;
    try {
      const { ticket } = await api.support(subject);
      setNote(`Logged as ${ticket}. Support will be in touch.`);
    } catch (err) {
      setNote(err.message);
    }
  };

  if (me === undefined) return <div style={page} />;

  if (me === null) {
    return (
      <div style={page}>
        <form style={{ ...card, marginTop: '8vh' }} onSubmit={signIn}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>My account</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: color.muted }}>
            Sign in with your account number — the one you quote when you pay — and the password
            your provider sent you.
          </p>
          <input
            style={input}
            value={account}
            onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric"
            placeholder="Account number"
            aria-label="Account number"
          />
          <input
            style={input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            inputMode="numeric"
            placeholder="Password"
            aria-label="Password"
          />
          {note && <span style={{ fontSize: 13, color: color.rust }}>{note}</span>}
          <button type="submit" style={button(true)} disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <span style={{ fontSize: 12, color: color.muted }}>
            Lost your password? Ask your provider to send a new one — they can generate it for you.
          </span>
        </form>
      </div>
    );
  }

  const expired = me.status !== 'active';
  return (
    <div style={page}>
      <div style={{ width: '100%', maxWidth: 460, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{me.company}</h1>
          <span
            onClick={async () => { await api.logout(); setMe(null); }}
            style={{ fontSize: 13, color: color.muted, cursor: 'pointer' }}
          >
            Sign out
          </span>
        </div>

        <div style={card}>
          <span style={{ fontSize: 13, color: color.muted }}>{me.name} · {me.account}</span>
          <span
            style={{
              fontSize: 26, fontWeight: 600,
              color: expired ? color.rust : color.green,
            }}
          >
            {expired ? me.status : `${me.daysLeft} day${me.daysLeft === 1 ? '' : 's'} left`}
          </span>
          {me.expiresAt && (
            <span style={{ fontSize: 13, color: color.muted }}>
              {expired ? 'Ended' : 'Runs until'}{' '}
              {new Date(me.expiresAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
        </div>

        <div style={card}>
          {me.plan && <Row k="Plan" v={`${me.plan.title}${me.plan.speed ? ` · ${me.plan.speed}` : ''}`} />}
          {me.plan && <Row k="Price" v={`KES ${me.plan.price}`} />}
          <Row k="Balance" v={`KES ${me.balance}`} tone={me.balance < 0 ? color.rust : undefined} />
          {me.paybill && <Row k="Pay to paybill" v={me.paybill} />}
          <Row k="Your account number" v={me.account} />
        </div>

        <div style={card}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Recent payments</span>
          {me.payments.length === 0 ? (
            <span style={{ fontSize: 13, color: color.muted }}>Nothing yet.</span>
          ) : (
            me.payments.map((p) => (
              <Row
                key={p.provider_ref ?? p.received_at}
                k={new Date(p.received_at).toLocaleDateString('en-KE')}
                v={`KES ${p.amount}`}
              />
            ))
          )}
        </div>

        <div style={card}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Need help?</span>
          {me.supportPhone && (
            <a href={`tel:${me.supportPhone}`} style={{ ...button(false), textAlign: 'center', textDecoration: 'none' }}>
              Call {me.supportPhone}
            </a>
          )}
          <button style={button(false)} onClick={raise}>Report a problem</button>
          {note && <span style={{ fontSize: 13, color: color.green }}>{note}</span>}
        </div>
      </div>
    </div>
  );
}
