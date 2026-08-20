import React, { useCallback, useEffect, useState } from 'react';
import { font } from '../theme/tokens';

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
  recover: (phone) => api.call('POST', '/portal/recover', { phone }),
  changePassword: (currentPassword, newPassword) =>
    api.call('POST', '/portal/change-password', { currentPassword, newPassword }),
  usage: () => api.call('GET', '/portal/usage'),
  pay: (phone) => api.call('POST', '/portal/pay', { phone }),
  payStatus: (checkoutId) => api.call('GET', `/portal/status/${checkoutId}`),
};

/**
 * A palette of its own, deliberately not the admin app's green — a customer
 * here shares nothing with the admin app but a hostname, and reusing its
 * exact branding made this page look like an unfinished corner of the admin
 * tool rather than something built for the person actually using it.
 */
const pc = {
  bg0: '#f2f0ff',
  bg1: '#eef4ff',
  ink: '#211f3d',
  muted: '#6d6a95',
  line: 'rgba(91, 75, 255, .14)',
  card: '#ffffff',
  accent: '#5b4bff',
  accentDark: '#4636dd',
  teal: '#0fb8a3',
  amber: '#dd9a1f',
  rust: '#e0475a',
};

const page = {
  minHeight: '100vh',
  background: `linear-gradient(160deg, ${pc.bg0} 0%, ${pc.bg1} 55%, #ffffff 100%)`,
  fontFamily: font.sans,
  color: pc.ink,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '0 16px 40px',
};

const card = {
  boxSizing: 'border-box',
  background: pc.card,
  border: `1px solid ${pc.line}`,
  borderRadius: 18,
  padding: 20,
  width: '100%',
  maxWidth: 460,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 8px 24px rgba(91, 75, 255, .07)',
};

const input = {
  padding: '10px 12px',
  border: `1px solid ${pc.line}`,
  borderRadius: 12,
  fontSize: 15,
  fontFamily: font.mono,
  width: '100%',
  boxSizing: 'border-box',
  background: '#fbfaff',
  color: pc.ink,
};

const button = (primary) => ({
  padding: '10px 16px',
  border: primary ? 'none' : `1px solid ${pc.line}`,
  borderRadius: 12,
  background: primary ? `linear-gradient(135deg, ${pc.accent}, ${pc.accentDark})` : '#fff',
  color: primary ? '#fff' : pc.ink,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
});

function Row({ k, v, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
      <span style={{ color: pc.muted }}>{k}</span>
      <span style={{ fontWeight: 600, color: tone, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

/** Data used, in whichever unit reads naturally at that size. */
function formatUsage(mb) {
  const n = Number(mb) || 0;
  return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`;
}

const IDLE_LOGOUT_MS = 15 * 60 * 1000;

const INVOICE_TONE = { paid: pc.teal, open: pc.amber, partial: pc.amber, void: pc.muted };
const TICKET_TONE = { resolved: pc.teal, in_progress: pc.amber, open: pc.rust };

function Badge({ text, tone }) {
  return (
    <span
      style={{
        fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em',
        padding: '3px 9px', borderRadius: 999, color: '#fff', background: tone ?? pc.muted,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

/** A tile in the stats grid — the wallet, usage, plan price, at a glance. */
function Stat({ label, value, sub }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        background: pc.card, border: `1px solid ${pc.line}`, borderRadius: 16,
        padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 3,
        boxShadow: '0 6px 18px rgba(91, 75, 255, .06)',
      }}
    >
      <span style={{ fontSize: 11.5, fontWeight: 700, color: pc.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </span>
      <span style={{ fontSize: 19, fontWeight: 700, color: pc.ink }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: pc.muted }}>{sub}</span>}
    </div>
  );
}

export default function CustomerPortal() {
  const [me, setMe] = useState(undefined);   // undefined = still checking
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // "Get my login details": a customer who forgot both the account number
  // and the password has nothing else to sign in with, so this asks for the
  // one thing they still have — the phone the account is registered on.
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverPhone, setRecoverPhone] = useState('');
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState('');

  /**
   * Live chat, on the same endpoints the hotspot portal uses.
   *
   * A customer here has signed in, but the chat still runs on its own token
   * rather than the portal cookie: it is the same conversation a hotspot guest
   * starts, support reads it in the same queue, and giving it a second
   * authentication path would mean two of everything for one feature.
   */
  const [chat, setChat] = useState(null);   // { id, token, messages, note }
  const [chatDraft, setChatDraft] = useState('');

  // Changing the portal password, once signed in — separate state from the
  // signed-out "forgot it" flow above, and separate columns server-side from
  // pppoe_pass, which this can never touch.
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [usage, setUsage] = useState(null);   // [{ day, mb }], fetched once signed in

  // Self-service STK — a customer pushes their own prompt instead of typing
  // the paybill and account number into the M-Pesa menu by hand.
  const [payOpen, setPayOpen] = useState(false);
  const [payPhone, setPayPhone] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState('');
  const payPoll = React.useRef(null);
  useEffect(() => () => clearInterval(payPoll.current), []);

  const load = useCallback(async () => {
    try { setMe(await api.me()); } catch { setMe(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /**
   * Moved here from after the signed-out early return below, where it broke
   * the Rules of Hooks: a customer who already holds a valid portal session
   * skips the signed-out render entirely and lands straight on the signed-in
   * one, calling one more hook than that first render did. React requires
   * the same hooks in the same order every render regardless of branch, and
   * violating it doesn't degrade gracefully — it throws (minified error
   * #310) and the whole component renders nothing, with no error boundary
   * catching it, which reads as a blank page. The `if (!chat?.id)` guard
   * inside already made this hook a safe no-op before chat exists, so
   * calling it unconditionally changes nothing for the signed-out case.
   */
  useEffect(() => {
    if (!chat?.id) return undefined;
    let live = true;
    const pull = async () => {
      try {
        const res = await fetch(`/chat/${chat.id}?token=${encodeURIComponent(chat.token)}&since=0`);
        const d = await res.json();
        if (!live || !d.messages) return;
        setChat((c) => (c?.id === chat.id
          ? { ...c, messages: d.messages, note: d.status === 'closed' ? 'Support closed this chat.' : c.note }
          : c));
      } catch { /* keep trying; a dropped poll is not a failure */ }
    };
    pull();
    const id = setInterval(pull, 3000);
    return () => { live = false; clearInterval(id); };
  }, [chat?.id, chat?.token]);

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

  const requestRecovery = async (e) => {
    e.preventDefault();
    setRecoverBusy(true);
    try {
      const res = await api.recover(recoverPhone.trim());
      setRecoverMsg(res.message);
    } catch (err) {
      // The endpoint itself never returns an error for "not found" — only a
      // real failure (network, rate limit) reaches here.
      setRecoverMsg(err.message);
    } finally {
      setRecoverBusy(false);
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

  // Fetched once a real session exists — a no-op every render before that,
  // same shape as every other effect here that only matters once signed in.
  useEffect(() => {
    if (!me) return;
    api.usage().then(setUsage).catch(() => setUsage([]));
  }, [me]);

  // Pre-filled from the number on file, in the 254xxxxxxxxx form Daraja
  // wants — 07xx.../+254.../254... all normalise to the same thing, but
  // showing it any other way here just invites someone to "correct" it back.
  useEffect(() => {
    if (me?.phone) setPayPhone(String(me.phone).replace(/[^0-9+]/g, '').replace(/^\+?(?:254)?0?/, '254'));
  }, [me]);

  /**
   * Signs a customer out after a stretch of inactivity — this page shows a
   * wallet balance and a "Pay now" button, and stays signed in for 30 days
   * (PORTAL_DAYS in server.js) unless something ends the session sooner. On
   * a shared or public device that's a balance left open for whoever uses it
   * next; on the customer's own device it's harmless, since any real activity
   * resets the clock.
   */
  useEffect(() => {
    if (!me) return undefined;
    let timer;
    const idleLogout = () => {
      api.logout().catch(() => {});
      setMe(null);
      setNote('Signed out after 15 minutes of inactivity.');
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(idleLogout, IDLE_LOGOUT_MS);
    };
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [me]);

  const payNow = async () => {
    setPayBusy(true);
    setPayMsg('');
    try {
      const r = await api.pay(payPhone);
      setPayMsg('Check your phone and enter your M-Pesa PIN.');
      clearInterval(payPoll.current);
      let elapsed = 0;
      payPoll.current = setInterval(async () => {
        elapsed += 3;
        try {
          const s = await api.payStatus(r.checkoutId);
          if (s.status === 'success') {
            clearInterval(payPoll.current);
            setPayMsg('Paid — thank you.');
            setPayBusy(false);
            load();
          } else if (s.status === 'failed') {
            clearInterval(payPoll.current);
            setPayMsg(s.result_desc || 'The payment did not go through.');
            setPayBusy(false);
          } else if (elapsed >= 90) {
            clearInterval(payPoll.current);
            setPayMsg('Still waiting — if you paid, it will reflect shortly.');
            setPayBusy(false);
          }
        } catch { /* keep polling; a dropped check is not a failure */ }
      }, 3000);
    } catch (err) {
      setPayMsg(err.message);
      setPayBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwBusy(true);
    setPwMsg('');
    try {
      await api.changePassword(currentPw, newPw);
      setPwMsg('Password changed.');
      setCurrentPw('');
      setNewPw('');
    } catch (err) {
      setPwMsg(err.message);
    } finally {
      setPwBusy(false);
    }
  };

  /**
   * Parses the same way api.call() above does — text first, JSON.parse only
   * if there is a body — instead of res.json() directly. res.json() on an
   * empty or non-JSON body (a proxy timeout, a 204, a network hiccup) throws
   * "Unexpected end of JSON input", which is a real error but a useless one
   * to show a customer trying to reach support; this turns that into
   * whatever text actually came back, or a plain "try again."
   */
  const safeJson = async (res) => {
    const text = await res.text();
    if (!text) return { error: `Support did not respond (${res.status}). Try again in a moment.` };
    try { return JSON.parse(text); } catch { return { error: 'Support did not respond. Try again in a moment.' }; }
  };

  /**
   * Usable signed out as well as signed in — a visitor who can't sign in at
   * all still needs a way to reach a person, which is the point of putting
   * this on the sign-in page too. `me` is null there, so name/phone fall
   * back to something support can still work with.
   */
  const startChat = async () => {
    setChat({ id: null, token: null, messages: [], note: 'Connecting…' });
    try {
      const res = await fetch('/chat/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: me?.name ?? 'Guest', phone: me?.account ?? account }),
      });
      const d = await safeJson(res);
      if (!d.chatId) throw new Error(d.error ?? 'Support is not available');
      setChat({ id: d.chatId, token: d.token, messages: [], note: 'Someone will reply here.' });
    } catch (e) {
      setChat({ id: null, token: null, messages: [], note: e.message });
    }
  };

  const sendChat = async () => {
    const body = chatDraft.trim();
    if (!body || !chat?.id) return;
    setChatDraft('');
    try {
      await fetch(`/chat/${chat.id}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: chat.token, body }),
      });
    } catch {
      setChat((c) => ({ ...c, note: 'That message did not send.' }));
    }
  };

  if (me === undefined) return <div style={page} />;

  if (me === null) {
    return (
      <div style={page}>
        <div style={{ marginTop: '8vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, width: '100%' }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 16, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 24,
              background: `linear-gradient(135deg, ${pc.accent}, ${pc.teal})`,
              boxShadow: '0 10px 24px rgba(91, 75, 255, .28)',
            }}
          >
            📶
          </div>
          <form style={card} onSubmit={signIn}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>My account</h1>
            <p style={{ margin: 0, fontSize: 13.5, color: pc.muted }}>
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
            {note && <span style={{ fontSize: 13, color: pc.rust }}>{note}</span>}
            <button type="submit" style={button(true)} disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>

            {!recoverOpen ? (
              <span
                onClick={() => setRecoverOpen(true)}
                style={{ fontSize: 12, color: pc.accent, cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
              >
                Forgot your account number or password? Get your login details
              </span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4, borderTop: `1px solid ${pc.line}` }}>
                <span style={{ fontSize: 12.5, color: pc.muted }}>
                  Enter the phone number registered on your account. We will text and email your
                  account number and a new password to it.
                </span>
                <input
                  style={input}
                  value={recoverPhone}
                  onChange={(e) => setRecoverPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && requestRecovery(e)}
                  inputMode="tel"
                  placeholder="07xx xxx xxx"
                  aria-label="Registered phone number"
                />
                {recoverMsg && <span style={{ fontSize: 12.5, color: pc.ink }}>{recoverMsg}</span>}
                <button
                  type="button"
                  onClick={requestRecovery}
                  style={button(false)}
                  disabled={recoverBusy || !recoverPhone.trim()}
                >
                  {recoverBusy ? 'Sending…' : 'Send my login details'}
                </button>
              </div>
            )}
          </form>

          {/* Chat, reachable without signing in — for a visitor who can't get in at
              all and needs a person rather than another self-service form. */}
          <div style={card}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Still stuck?</span>
            {!chat && (
              <button style={button(false)} onClick={startChat}>Chat with support to request your login</button>
            )}
            {chat && (
              <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
                <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {chat.messages.map((m) => (
                    <span
                      key={m.id}
                      style={{
                        alignSelf: m.sender === 'staff' ? 'flex-start' : 'flex-end',
                        maxWidth: '85%', padding: '7px 10px', borderRadius: 9, fontSize: 13.5,
                        background: m.sender === 'staff' ? '#fff' : pc.accent,
                        color: m.sender === 'staff' ? pc.ink : '#fff',
                        border: m.sender === 'staff' ? `1px solid ${pc.line}` : 'none',
                      }}
                    >
                      {m.body}
                    </span>
                  ))}
                </div>
                <input
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                  placeholder="Type your message"
                  style={input}
                />
                <button style={button(true)} onClick={sendChat}>Send</button>
              </div>
            )}
            {chat?.note && <span style={{ fontSize: 12.5, color: pc.muted }}>{chat.note}</span>}
          </div>
        </div>
      </div>
    );
  }

  const expired = me.status !== 'active';

  return (
    <div style={page}>
      <div style={{ width: '100%', maxWidth: 480, display: 'grid', gap: 14, paddingTop: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 16,
                background: `linear-gradient(135deg, ${pc.accent}, ${pc.teal})`,
              }}
            >
              📶
            </div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{me.company}</h1>
          </div>
          <span
            onClick={async () => { await api.logout(); setMe(null); }}
            style={{ fontSize: 13, color: pc.muted, cursor: 'pointer', fontWeight: 600 }}
          >
            Sign out
          </span>
        </div>

        {/* A live outage on their own router, shown before anything else — this is
            the one thing that answers "why is my internet down" without a call. */}
        {me.outages?.length > 0 && (
          <div
            style={{
              boxSizing: 'border-box',
              background: `linear-gradient(135deg, ${pc.rust}, #ff7a59)`, color: '#fff',
              borderRadius: 16, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>⚠ Outage affecting your site — {me.outages[0].site}</span>
            <span style={{ fontSize: 12.5, opacity: 0.92 }}>
              {me.outages[0].cause ?? 'Engineers are aware and working on it.'}
              {me.outages[0].eta ? ` ETA: ${me.outages[0].eta}.` : ''}
            </span>
          </div>
        )}

        {/* Hero: status, gradient, front and centre — the one thing every visit is really for. */}
        <div
          style={{
            boxSizing: 'border-box',
            background: `linear-gradient(135deg, ${pc.accent} 0%, ${pc.accentDark} 100%)`,
            borderRadius: 20, padding: 22, color: '#fff', display: 'flex', flexDirection: 'column', gap: 6,
            boxShadow: '0 14px 30px rgba(91, 75, 255, .25)',
          }}
        >
          <span style={{ fontSize: 13, opacity: 0.85 }}>{me.name} · {me.account}</span>
          <span style={{ fontSize: 28, fontWeight: 800, color: expired ? '#ffd7d7' : '#fff' }}>
            {expired ? me.status : `${me.daysLeft} day${me.daysLeft === 1 ? '' : 's'} left`}
          </span>
          {me.expiresAt && (
            <span style={{ fontSize: 13, opacity: 0.85 }}>
              {expired ? 'Ended' : 'Runs until'}{' '}
              {new Date(me.expiresAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
          {me.plan && (
            <span style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              {me.plan.title}{me.plan.speed ? ` · ${me.plan.speed}` : ''} · KES {me.plan.price}/mo
            </span>
          )}
        </div>

        {/* Stat tiles: the wallet and usage a customer actually checks in on. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Stat
            label="Wallet balance"
            value={`KES ${me.balance}`}
            sub={me.balance < 0 ? 'You owe this much' : 'Credit on file'}
          />
          <Stat label="Data used" value={formatUsage(me.usageMb)} sub="This billing cycle" />
        </div>

        {usage?.length > 0 && (
          <div style={card}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Data used, last 30 days</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 70, overflowX: 'auto' }}>
              {(() => {
                const max = Math.max(1, ...usage.map((u) => u.mb));
                return usage.map((u) => (
                  <div
                    key={u.day}
                    title={`${new Date(u.day).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}: ${formatUsage(u.mb)}`}
                    style={{
                      flex: '0 0 8px', height: `${Math.max(3, (u.mb / max) * 100)}%`,
                      background: `linear-gradient(180deg, ${pc.accent}, ${pc.teal})`, borderRadius: 3,
                    }}
                  />
                ));
              })()}
            </div>
            <span style={{ fontSize: 11.5, color: pc.muted }}>
              Bars are days — taller means more data that day. Hover a bar for the exact figure.
            </span>
          </div>
        )}

        {me.invoices?.length > 0 && (
          <div style={card}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Invoices</span>
            {me.invoices.map((inv) => (
              <div key={inv.number} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{inv.number}</span>
                  <span style={{ fontSize: 12, color: pc.muted }}>
                    Due {new Date(inv.due_date).toLocaleDateString('en-KE')} · KES {inv.amount}
                    {Number(inv.paid) > 0 ? ` (KES ${inv.paid} paid)` : ''}
                  </span>
                </div>
                <Badge text={inv.status} tone={INVOICE_TONE[inv.status]} />
              </div>
            ))}
          </div>
        )}

        {me.tickets?.length > 0 && (
          <div style={card}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Your support tickets</span>
            {me.tickets.map((t) => (
              <div key={t.number} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.subject}
                  </span>
                  <span style={{ fontSize: 12, color: pc.muted }}>
                    {t.number} · {new Date(t.created_at).toLocaleDateString('en-KE')}
                  </span>
                </div>
                <Badge text={t.status.replace('_', ' ')} tone={TICKET_TONE[t.status]} />
              </div>
            ))}
          </div>
        )}

        <div style={card}>
          {me.paybill && <Row k="Pay to paybill" v={me.paybill} />}
          <Row k="Your account number" v={me.account} />
          {/* Typing the paybill and account number by hand is where most
              support calls about payment start — a wrong digit sends money
              nowhere findable. Pushing a prompt to the number on file skips
              that step entirely for anyone who would rather not risk it. */}
          {me.service === 'pppoe' && (!payOpen ? (
            <button style={{ ...button(true), marginTop: 4 }} onClick={() => { setPayOpen(true); setPayMsg(''); }}>
              Pay now via M-Pesa
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <label style={{ fontSize: 13, color: pc.muted }}>M-Pesa number to pay from</label>
              <input
                style={input}
                type="tel"
                inputMode="tel"
                value={payPhone}
                onChange={(e) => setPayPhone(e.target.value)}
                placeholder="254712345678"
                disabled={payBusy}
              />
              <button style={button(true)} onClick={payNow} disabled={payBusy || !payPhone}>
                {payBusy ? 'Waiting…' : `Send prompt for KES ${me.plan?.price ?? ''}`}
              </button>
              {payMsg && <span style={{ fontSize: 13, color: pc.muted }}>{payMsg}</span>}
            </div>
          ))}
        </div>

        <div style={card}>
          {/* Portal password only — never pppoe_pass, which is what the router
              actually authenticates a line with and has no path from here. */}
          <span style={{ fontSize: 14, fontWeight: 700 }}>Change your password</span>
          {!pwOpen ? (
            <button style={button(false)} onClick={() => setPwOpen(true)}>Change password</button>
          ) : (
            <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                style={input} type="password" value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                inputMode="numeric" placeholder="Current password" aria-label="Current password"
              />
              <input
                style={input} type="password" value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                inputMode="numeric" placeholder="New password (6-12 digits)" aria-label="New password"
              />
              {pwMsg && <span style={{ fontSize: 12.5, color: pwMsg === 'Password changed.' ? pc.teal : pc.rust }}>{pwMsg}</span>}
              <button type="submit" style={button(true)} disabled={pwBusy || !currentPw || !newPw}>
                {pwBusy ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          )}
        </div>

        <div style={card}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Recent payments</span>
          {me.payments.length === 0 ? (
            <span style={{ fontSize: 13, color: pc.muted }}>Nothing yet.</span>
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
          <span style={{ fontSize: 14, fontWeight: 700 }}>Need help?</span>
          {me.supportPhone && (
            <a href={`tel:${me.supportPhone}`} style={{ ...button(false), textAlign: 'center', textDecoration: 'none' }}>
              Call {me.supportPhone}
            </a>
          )}
          <button style={button(false)} onClick={raise}>Report a problem</button>
          {!chat && (
            <button style={button(false)} onClick={startChat}>Chat with support</button>
          )}
          {note && <span style={{ fontSize: 13, color: pc.teal }}>{note}</span>}

          {chat && (
            <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
              <div style={{
                maxHeight: 180, overflowY: 'auto', display: 'flex',
                flexDirection: 'column', gap: 6,
              }}>
                {chat.messages.map((m) => (
                  <span
                    key={m.id}
                    style={{
                      alignSelf: m.sender === 'staff' ? 'flex-start' : 'flex-end',
                      maxWidth: '85%', padding: '7px 10px', borderRadius: 9, fontSize: 13.5,
                      background: m.sender === 'staff' ? '#fff' : pc.accent,
                      color: m.sender === 'staff' ? pc.ink : '#fff',
                      border: m.sender === 'staff' ? `1px solid ${pc.line}` : 'none',
                    }}
                  >
                    {m.body}
                  </span>
                ))}
              </div>
              <input
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="Type your message"
                style={{
                  padding: '10px 12px', fontSize: 15, borderRadius: 9,
                  border: `1px solid ${pc.line}`, outline: 'none',
                }}
              />
              <button style={button(true)} onClick={sendChat}>Send</button>
              {chat.note && <span style={{ fontSize: 12.5, color: pc.muted }}>{chat.note}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
