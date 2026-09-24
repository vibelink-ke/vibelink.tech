import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { color, font } from '../../theme/tokens';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import Toast from '../../app/Toast';
import FieldJob from './FieldJob';
import { FieldContext, useField } from './fieldContext';
import { FieldCustomers, FieldCustomer } from './FieldCustomers';
import { Btn, Chip, Dot, distanceKm, page, panel, prettyKm, timeAgo } from './fieldKit';
import { cachedGet, queueRemove, retryItem, useQueue } from './offline';

/**
 * The technician app: the same site, installed on a phone (its own manifest, /manifest-field.json),
 * with a separate narrow API (/api/field) that carries service facts and never money.
 *
 * Location is shared only while a shift is open, from this page being open on the phone: a web app
 * cannot track in the background, so the phone screen stays on (a wake lock asks it to) while on shift.
 */
const SEND_EVERY_MS = 45000;

export default function FieldApp() {
  const store = useStore();
  const [me, setMe] = useState(null);
  const [pos, setPos] = useState(null);
  const [geoError, setGeoError] = useState('');
  const [lastSent, setLastSent] = useState(null);
  const ticketRef = useRef(null);
  const setTicketId = useCallback((id) => { ticketRef.current = id; }, []);

  const loadMe = useCallback(() => api.fieldMe().then(setMe).catch(() => {}), []);
  useEffect(() => { loadMe(); }, [loadMe]);

  // Installing from this page adds the Field app, not the office one.
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    const prev = link?.getAttribute('href');
    link?.setAttribute('href', '/manifest-field.json');
    const prevTitle = document.title;
    document.title = 'Field · Vibelink';
    return () => { if (link && prev) link.setAttribute('href', prev); document.title = prevTitle; };
  }, []);

  const shiftActive = !!me?.shift?.active;

  useEffect(() => {
    if (!shiftActive) return undefined;
    if (!navigator.geolocation) { setGeoError('This phone cannot share its location.'); return undefined; }
    let last = 0;
    const onPos = (p) => {
      const here = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      setPos(here);
      setGeoError('');
      const now = Date.now();
      if (now - last < SEND_EVERY_MS) return;
      last = now;
      api.fieldLocation({ ...here, ticketId: ticketRef.current }).then(() => setLastSent(new Date().toISOString())).catch((e) => {
        // The shift was ended somewhere else (the office, another tab): stop showing it as running.
        if (/shift/i.test(e.message ?? '')) loadMe();
      });
    };
    const id = navigator.geolocation.watchPosition(onPos, (e) => setGeoError(e.message || 'Location is off — switch it on to share it.'), {
      enableHighAccuracy: true, maximumAge: 15000, timeout: 30000,
    });
    // Ask the phone not to lock the screen: a locked page stops reporting.
    let lock = null;
    const hold = () => navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    hold();
    const again = () => { if (document.visibilityState === 'visible') hold(); };
    document.addEventListener('visibilitychange', again);
    return () => {
      navigator.geolocation.clearWatch(id);
      document.removeEventListener('visibilitychange', again);
      lock?.release?.().catch(() => {});
    };
  }, [shiftActive, loadMe]);

  const value = useMemo(() => ({ me, loadMe, pos, geoError, lastSent, setTicketId, shiftActive }),
    [me, loadMe, pos, geoError, lastSent, setTicketId, shiftActive]);

  const tab = ({ isActive }) => ({
    flex: 1, textAlign: 'center', padding: '10px 0 12px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
    color: isActive ? color.green : color.muted, borderTop: `2px solid ${isActive ? color.green : 'transparent'}`,
  });

  return (
    <FieldContext.Provider value={value}>
      <div style={{ minHeight: '100vh', background: '#f4f5f2', fontFamily: font.sans, color: color.ink }}>
        <header style={{
          position: 'sticky', top: 0, zIndex: 5, background: '#fff', borderBottom: `1px solid ${color.line}`,
          padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{me?.company ?? 'Field'}</div>
          <Chip tone={shiftActive ? 'green' : 'neutral'}>{shiftActive ? 'On shift' : 'Off shift'}</Chip>
        </header>

        <SyncBanner />

        <Routes>
          <Route path="/field" element={<Jobs />} />
          <Route path="/field/job/:id" element={<FieldJob />} />
          <Route path="/field/customers" element={<FieldCustomers />} />
          <Route path="/field/customers/:id" element={<FieldCustomer />} />
          <Route path="/field/me" element={<Me />} />
          <Route path="*" element={<Navigate to="/field" replace />} />
        </Routes>

        <nav style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', background: '#fff',
          borderTop: `1px solid ${color.line}`, zIndex: 5, paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          <NavLink to="/field" end style={tab}>Jobs</NavLink>
          <NavLink to="/field/customers" style={tab}>Customers</NavLink>
          <NavLink to="/field/me" style={tab}>Me</NavLink>
        </nav>
      </div>
      <Toast />
    </FieldContext.Provider>
  );
}

const PRIORITY = { critical: 'red', high: 'amber', medium: 'neutral', low: 'neutral' };

function Jobs() {
  const { pos } = useField();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');

  const [stale, setStale] = useState(false);
  const { items: queued } = useQueue();
  const load = useCallback(() => cachedGet('jobs', () => api.fieldJobs())
    .then(({ value, stale: s }) => { setJobs(value); setStale(s); setError(''); })
    .catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 45000);
    return () => clearInterval(id);
  }, [load]);

  // A job whose closing is waiting to send is done as far as this phone is concerned.
  const closing = new Set(queued.filter((q) => q.type === 'close').map((q) => q.payload.jobId));
  const live = (jobs ?? []).filter((j) => !closing.has(j.id));
  const mine = live.filter((j) => j.mine);
  const open = live.filter((j) => !j.mine);

  const card = (j) => {
    const km = distanceKm(pos, j.customer_lat != null ? { lat: Number(j.customer_lat), lng: Number(j.customer_lng) } : null);
    return (
      <div key={j.id} onClick={() => navigate(`/field/job/${j.id}`)} style={{ ...panel, cursor: 'pointer', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip tone={j.kind === 'install' ? 'blue' : 'neutral'}>{j.kind === 'install' ? 'Install' : 'Repair'}</Chip>
          <Chip tone={PRIORITY[j.priority] ?? 'neutral'}>{j.priority}</Chip>
          {j.status === 'in_progress' && <Chip tone="green">In progress</Chip>}
          {km != null && <span style={{ fontSize: 12, color: color.muted, marginLeft: 'auto' }}>{prettyKm(km)} away</span>}
        </div>
        <div style={{ fontWeight: 600, fontSize: 15.5 }}>{j.subject}</div>
        {j.customer_name && (
          <div style={{ fontSize: 13.5, color: '#4a524c' }}>
            <Dot on={j.customer_online} />{j.customer_name}{j.customer_location ? ` · ${j.customer_location}` : ''}
          </div>
        )}
        <div style={{ fontSize: 12, color: color.muted }}>{j.number} · {timeAgo(j.created_at)}</div>
      </div>
    );
  };

  return (
    <div style={page}>
      <h2 style={{ margin: 0, fontSize: 20 }}>My jobs</h2>
      {stale && <div style={{ ...panel, background: '#fbf0d9', borderColor: '#e9d29a', color: color.amberInk, fontSize: 13.5 }}>No signal — showing the jobs last saved on this phone.</div>}
      {error && <div style={{ ...panel, color: color.rust }}>{error}</div>}
      {jobs === null && !error && <div style={{ color: color.muted }}>Loading…</div>}
      {jobs && !mine.length && <div style={{ ...panel, color: color.muted }}>Nothing is assigned to you right now.</div>}
      {mine.map(card)}
      {open.length > 0 && (
        <>
          <h3 style={{ margin: '10px 0 0', fontSize: 15, color: '#4a524c' }}>Unassigned — take one</h3>
          {open.map(card)}
        </>
      )}
    </div>
  );
}

function Me() {
  const store = useStore();
  const { me, loadMe, pos, geoError, lastSent, shiftActive } = useField();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      if (!shiftActive && navigator.geolocation) {
        // Ask now, while a person is looking at the phone, rather than in the middle of a job.
        await new Promise((resolve) => navigator.geolocation.getCurrentPosition(resolve, resolve, { timeout: 8000 }));
      }
      await api.fieldShift(shiftActive ? 'end' : 'start');
      await loadMe();
      store.toast(shiftActive ? 'Shift ended — your location is no longer shared' : 'Shift started — keep this app open');
    } catch (e) {
      store.toast(`Could not change shift: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={page}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{me?.name ?? 'Me'}</h2>
      <div style={panel}>
        <div style={{ fontWeight: 600 }}>{shiftActive ? 'You are on shift' : 'You are off shift'}</div>
        <div style={{ fontSize: 13.5, color: '#4a524c', lineHeight: 1.5 }}>
          {shiftActive
            ? 'Your position is shared with the office while you are on shift. Keep this app open with the screen on; it cannot report from the background.'
            : 'Start your shift when you begin work. Your location is shared with the office only while a shift is running, and never outside it.'}
        </div>
        <Btn onClick={toggle} busy={busy} tone={shiftActive ? 'danger' : 'primary'}>{shiftActive ? 'End shift' : 'Start shift'}</Btn>
        {shiftActive && (
          <div style={{ fontSize: 12.5, color: color.muted }}>
            {pos ? `Location on · accuracy about ${Math.round(pos.accuracy ?? 0)} m` : 'Waiting for a location…'}
            {lastSent ? ` · last sent ${timeAgo(lastSent)}` : ''}
            {geoError ? <div style={{ color: color.rust, marginTop: 4 }}>{geoError}</div> : null}
          </div>
        )}
      </div>
      <div style={panel}>
        <div style={{ fontWeight: 600 }}>Install this app</div>
        <div style={{ fontSize: 13.5, color: '#4a524c', lineHeight: 1.5 }}>
          In Chrome, open the menu and choose <b>Add to Home screen</b>. It then opens like any other app.
        </div>
      </div>
      <WaitingList />
      {me?.role !== 'technician' && <Btn tone="quiet" href="/">Back to the office</Btn>}
      <Btn tone="quiet" onClick={() => store.signOut()}>Sign out</Btn>
    </div>
  );
}

/** Offline, or work waiting to be sent: always visible, so nobody wonders whether it went through. */
function SyncBanner() {
  const { online, waiting, failed } = useQueue();
  if (online && !waiting && !failed.length) return null;
  const text = !online
    ? `No signal — ${waiting ? `${waiting} item${waiting === 1 ? '' : 's'} waiting to send` : 'what you do is saved on the phone and sent later'}`
    : failed.length ? `${failed.length} item${failed.length === 1 ? '' : 's'} could not be sent — see Me` : `Sending ${waiting} item${waiting === 1 ? '' : 's'}…`;
  return (
    <div style={{ background: failed.length ? '#f9e4df' : '#fbf0d9', color: failed.length ? color.rust : color.amberInk, fontSize: 13, fontWeight: 600, padding: '8px 14px', textAlign: 'center' }}>
      {text}
    </div>
  );
}

const LABEL = { start: 'Start job', note: 'Note', photo: 'Photo', equipment: 'Equipment', close: 'Close job' };

function WaitingList() {
  const { items, refresh } = useQueue();
  if (!items.length) return null;
  return (
    <div style={panel}>
      <div style={{ fontWeight: 600 }}>Waiting to send</div>
      {items.map((i) => (
        <div key={i.id} style={{ fontSize: 13.5, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>
            {LABEL[i.type] ?? i.type} · {timeAgo(new Date(i.at).toISOString())}
            {i.error && <div style={{ color: color.rust, fontSize: 12.5 }}>Refused: {i.error}</div>}
          </span>
          {i.error && (
            <span style={{ display: 'flex', gap: 10, whiteSpace: 'nowrap' }}>
              <span onClick={() => retryItem(i).then(refresh)} style={{ color: color.green, fontWeight: 600, cursor: 'pointer' }}>Retry</span>
              <span onClick={() => { if (window.confirm('Throw this away? It will not be sent.')) queueRemove(i.id).then(refresh); }} style={{ color: color.rust, fontWeight: 600, cursor: 'pointer' }}>Discard</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
