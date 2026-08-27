import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { color, font, radius, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Empty, Field, Input, KV, Modal, RowAction, RowActions, Screen, Select, Tabs } from '../ui/primitives';

/** A draggable pin — click or drag to set the exact spot, same Leaflet
 * pattern the Map screen already uses (no react-leaflet dependency). */
function LocationMap({ lat, lng, onChange }) {
  const holder = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);

  useEffect(() => {
    if (!holder.current || map.current) return;
    const center = [lat ?? -1.2921, lng ?? 36.8219];
    map.current = L.map(holder.current, { scrollWheelZoom: false }).setView(center, lat != null ? 15 : 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map.current);
    marker.current = L.marker(center, { draggable: true }).addTo(map.current);
    marker.current.on('dragend', () => {
      const p = marker.current.getLatLng();
      onChange(p.lat, p.lng);
    });
    map.current.on('click', (e) => {
      marker.current.setLatLng(e.latlng);
      onChange(e.latlng.lat, e.latlng.lng);
    });
    return () => { map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typing lat/lng by hand moves the pin too, without fighting the drag handler.
  useEffect(() => {
    if (map.current && marker.current && lat != null && lng != null) {
      marker.current.setLatLng([lat, lng]);
    }
  }, [lat, lng]);

  return <div ref={holder} style={{ height: 240, borderRadius: radius.md, overflow: 'hidden', border: `1px solid ${color.line}` }} />;
}

const AUTOPAY_OPTIONS = [
  { value: '', label: 'Off' },
  { value: 'daraja', label: 'M-Pesa Paybill (Daraja)' },
  { value: 'bankstk', label: 'Bank STK push' },
];

const STATUS_DOT = {
  active: color.mint,
  grace: color.amber,
  expired: '#c05a2e',
  paused: color.amberInk,
  suspended: color.rust,
};

function hostsInCidr(cidr, max = 254) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(cidr ?? '').trim());
  if (!m) return [];
  const [, a, b, c, d, bits] = m.map(Number);
  const base = (a << 24) | (b << 16) | (c << 8) | d;
  const size = 2 ** (32 - bits);
  if (size < 2) return [];
  const scanLimit = Math.min(size - 1, 65536);
  const out = [];
  for (let i = 1; i < scanLimit && out.length < max; i++) {
    const ip = (base + i) >>> 0;
    out.push([(ip >>> 24) & 255, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.'));
  }
  return out;
}

const TABS = [
  { id: 'services', label: 'Services' },
  { id: 'info', label: 'Client info' },
  { id: 'billing', label: 'Billing' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'communication', label: 'Communication' },
  { id: 'statistics', label: 'Statistics' },
  { id: 'live', label: 'Live data' },
  { id: 'activity', label: 'Activity log' },
];

const Soon = ({ label }) => (
  <div style={{
    padding: '40px 16px', textAlign: 'center', color: color.muted, fontSize: 13,
    background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg,
  }}>
    {label} — coming soon.
  </div>
);

export default function ClientDetail() {
  const store = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'services';
  const setTab = (t) => setParams({ tab: t });

  const clients = store.clients ?? [];
  const client = clients.find((c) => c.id === id);

  const planById = useMemo(() => Object.fromEntries((store.plans ?? []).map((p) => [p.id, p])), [store.plans]);
  const routerById = useMemo(() => Object.fromEntries((store.routers ?? []).map((r) => [r.id, r])), [store.routers]);

  // Every line under this account, this one included — a customer with two
  // connections is one person on one account number, not two customers who
  // happen to share it.
  const siblings = useMemo(
    () => (client
      ? clients.filter((c) => c.account_code === client.account_code).sort((a, b) => (a.line_label ?? '').localeCompare(b.line_label ?? ''))
      : []),
    [clients, client]
  );

  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(client ? [client.id] : []));
  const toggleExpanded = (lineId) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(lineId) ? n.delete(lineId) : n.add(lineId);
      return n;
    });
  const [revealed, setRevealed] = useState(() => new Set());

  // Client info as an editable form rather than a read-only KV list —
  // first/last name split from the one name column we actually store, plus
  // location/coordinates, which the map below can also set by dragging.
  const [infoForm, setInfoForm] = useState(null);
  const [infoBusy, setInfoBusy] = useState(false);
  const [portalPassword, setPortalPassword] = useState(undefined);   // undefined = not fetched yet

  useEffect(() => {
    if (!client) { setInfoForm(null); return; }
    const [firstName = '', ...rest] = (client.name ?? '').trim().split(/\s+/);
    setInfoForm({
      firstName, lastName: rest.join(' '),
      phone: client.phone ?? '', phoneAlt: client.phone_alt ?? '',
      location: client.location ?? '',
      lat: client.lat ?? '', lng: client.lng ?? '',
      email: client.email ?? '', birthday: client.birthday ? String(client.birthday).slice(0, 10) : '',
      category: client.category ?? '', identification: client.identification ?? '',
    });
    // A different line's password must not inherit the last one's revealed value.
    setPortalPassword(undefined);
  }, [client?.id]);

  const saveInfo = async () => {
    if (!infoForm) return;
    const name = `${infoForm.firstName} ${infoForm.lastName}`.trim();
    if (!name) return store.toast('Give the client a name first');
    setInfoBusy(true);
    try {
      const updated = await api.updateSubscriber(client.id, {
        name, phone: infoForm.phone, phone_alt: infoForm.phoneAlt || null,
        location: infoForm.location || null,
        lat: infoForm.lat === '' ? null : Number(infoForm.lat),
        lng: infoForm.lng === '' ? null : Number(infoForm.lng),
        email: infoForm.email || null,
        birthday: infoForm.birthday || null,
        category: infoForm.category || null,
        identification: infoForm.identification || null,
      });
      store.setCollection('clients', (cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
      store.toast('Client info saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setInfoBusy(false);
    }
  };

  const [portalBusy, setPortalBusy] = useState(false);
  // Not the hash — a separately-stored, reversible copy the credentials
  // route decrypts, the same one the old drawer's "Show credentials" used.
  // A password set before that reversible copy existed has no decrypted
  // form at all, so this can genuinely come back empty even on success.
  const showPortalPassword = async () => {
    setPortalBusy(true);
    try {
      const v = await api.subscriberCredentials(client.id);
      setPortalPassword(v.portalPassword ?? (v.portalPasswordSet ? null : ''));
    } catch (e) {
      store.toast(`Could not read: ${e.message}`);
    } finally {
      setPortalBusy(false);
    }
  };
  const genPortalPassword = async () => {
    setPortalBusy(true);
    try {
      const v = await api.generatePortalPassword(client.id);
      setPortalPassword(v.password ?? '');
      store.toast(`New portal password for ${client.name}, sent by SMS`);
    } catch (e) {
      store.toast(`Could not generate: ${e.message}`);
    } finally {
      setPortalBusy(false);
    }
  };

  // Communication and Billing are account-wide — every line's own messages
  // and payments, not just whichever line happens to be first.
  const [thread, setThread] = useState(null);
  useEffect(() => {
    if (!siblings.length) { setThread(null); return; }
    setThread(null);
    Promise.all(siblings.map((s) => api.messages(s.id).catch(() => [])))
      .then((lists) => setThread(lists.flat().sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))));
  }, [siblings.map((s) => s.id).join(',')]);

  const [addingService, setAddingService] = useState(null);
  const [serviceForm, setServiceForm] = useState({ lineLabel: '', planId: '', routerId: '', staticIp: '', pppoeUser: '', pppoePass: '' });
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceFreeIps, setServiceFreeIps] = useState({ addresses: [], pools: [], loading: false });
  useEffect(() => {
    if (!serviceForm.routerId) return setServiceFreeIps({ addresses: [], pools: [], loading: false });
    let live = true;
    setServiceFreeIps((s) => ({ ...s, loading: true }));
    api.routerFreeIps(serviceForm.routerId)
      .then((r) => live && setServiceFreeIps({ addresses: r.addresses ?? [], pools: r.pools ?? [], loading: false }))
      .catch(() => live && setServiceFreeIps({ addresses: [], pools: [], loading: false }));
    return () => { live = false; };
  }, [serviceForm.routerId]);

  const genServiceCredentials = async () => {
    try {
      const { account, password } = await api.newSubscriberCredentials();
      setServiceForm((s) => ({ ...s, pppoeUser: account, pppoePass: password }));
    } catch (e) {
      store.toast(`Could not generate: ${e.message}`);
    }
  };

  const openAddService = async () => {
    setServiceForm({ lineLabel: '', planId: '', routerId: '', staticIp: '', pppoeUser: '', pppoePass: '' });
    setAddingService(client);
    try {
      const { account, password } = await api.newSubscriberCredentials();
      setServiceForm((s) => ({ ...s, pppoeUser: account, pppoePass: password }));
    } catch { /* Generate button covers a retry */ }
  };

  const submitAddService = async () => {
    if (!addingService) return;
    if (!serviceForm.lineLabel.trim()) return store.toast('Give this line a tag — "Shop", "Flat 3" — to tell it apart from the others');
    setServiceBusy(true);
    try {
      const created = await api.createSubscriber({
        accountCode: addingService.account_code,
        name: addingService.name,
        phone: addingService.phone,
        phoneAlt: addingService.phone_alt,
        service: 'pppoe',
        planId: serviceForm.planId || null,
        routerId: serviceForm.routerId || null,
        pppoeUser: serviceForm.pppoeUser || null,
        pppoePass: serviceForm.pppoePass || null,
        staticIp: serviceForm.staticIp || null,
        lineLabel: serviceForm.lineLabel.trim(),
        allowDuplicatePhone: true,
      });
      store.setCollection('clients', (cs) => [created, ...cs]);
      store.toast(`${serviceForm.lineLabel.trim()} added to ${addingService.account_code}`);
      setAddingService(null);
    } catch (e) {
      store.toast(`Could not add service: ${e.message}`);
    } finally {
      setServiceBusy(false);
    }
  };

  const setAccess = async (c, action) => {
    try {
      const updated = await api.setSubscriberAccess(c.id, action);
      store.setCollection('clients', (cs) => cs.map((x) => (x.id === c.id ? updated : x)));
      store.toast(`${c.name} ${{ pause: 'paused', suspend: 'suspended', resume: 'resumed' }[action]}`);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    }
  };

  const giveDays = async (c) => {
    const raw = window.prompt(`Free days to add for ${c.line_label || c.name} — outage credit or a grace period:`, '1');
    if (raw === null) return;
    const days = Number(raw);
    if (!Number.isFinite(days) || days <= 0) return store.toast('Enter a positive number of days');
    try {
      const out = await api.compensateSubscribers([c.id], days);
      const hit = out.rows?.[0];
      if (hit) store.setCollection('clients', (cs) => cs.map((x) => (x.id === c.id ? { ...x, expires_at: hit.expires_at } : x)));
      store.toast(`Added ${out.days} day(s) for ${c.name}`);
    } catch (e) {
      store.toast(`Could not add days: ${e.message}`);
    }
  };

  const clearMacLock = async (c) => {
    if (!window.confirm(`Clear the MAC lock for ${c.line_label || c.name}? Whichever router dials in next will be the new locked one.`)) return;
    try {
      await api.clearMacLock(c.id);
      store.setCollection('clients', (cs) => cs.map((x) => (x.id === c.id ? { ...x, locked_mac: null } : x)));
      store.toast('MAC lock cleared');
    } catch (e) {
      store.toast(`Could not clear the lock: ${e.message}`);
    }
  };

  const stkPush = async (c) => {
    const ask = window.prompt(`Send an M-Pesa prompt to ${c.phone}?\nAmount (KES), or leave blank for their plan price:`, '');
    if (ask === null) return;
    try {
      const res = await api.stkPushSubscriber(c.id, ask.trim() ? Number(ask) : null);
      store.toast(`Sent — KES ${res.amount} to ${res.phone}`);
    } catch (e) {
      store.toast(`Could not send: ${e.message}`);
    }
  };

  const removeClient = async (c) => {
    try {
      await api.deleteSubscriber(c.id);
      store.setCollection('clients', (cs) => cs.filter((x) => x.id !== c.id));
      store.toast(`${c.name} deleted`);
      if (siblings.length <= 1) navigate('/clients');
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const saveEdit = async () => {
    const patch = {
      name: editing.name,
      phone: editing.phone,
      static_ip: editing.static_ip || null,
      plan_id: editing.plan_id || null,
      status: editing.status,
      router_id: editing.router_id || null,
      credit: editing.credit === '' || editing.credit == null ? 0 : Number(editing.credit),
      expires_at: editing.expires_at || null,
      autopay: editing.autopay || null,
      location: editing.location || null,
    };
    try {
      const updated = await api.updateSubscriber(editing.id, patch);
      store.setCollection('clients', (cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
      store.toast(`${updated.name} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
  };

  if (!client) {
    return (
      <Screen title="Client" subtitle="">
        <Empty action={<Button onClick={() => navigate('/clients')}>Back to clients</Button>}>
          {clients.length ? 'No such client' : 'Loading…'}
        </Empty>
      </Screen>
    );
  }

  const router = routerById[client.router_id];
  const lat = client.lat ?? router?.lat;
  const lng = client.lng ?? router?.lng;

  return (
    <Screen
      title={client.name}
      subtitle={`${client.account_code} · ${client.phone ?? '—'}`}
      actions={
        <>
          <Button onClick={() => navigate('/clients')}>Back</Button>
          {lat != null && lng != null && (
            <a
              href={`https://www.google.com/maps?q=${lat},${lng}`}
              target="_blank"
              rel="noreferrer"
              style={{ alignSelf: 'center', fontSize: 13, fontWeight: 600, color: color.green }}
            >
              Get directions
            </a>
          )}
          <Badge tone={client.status}>{client.status}</Badge>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5, color: color.muted }}>
        <span>Created {client.created_at ? new Date(client.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
        <span>Location {client.location ?? router?.name ?? '—'}</span>
        <span>Phone {client.phone ?? '—'}{client.phone_alt ? ` · ${client.phone_alt}` : ''}</span>
        <span>
          {/* credit is money actually sitting on the account — an
              overpayment carried forward, spendable against the next
              invoice — which is what "wallet" means. net_balance (credit
              minus what's owed) is the different question of whether they're
              paid up, and stays on Billing rather than the header. */}
          Wallet{' '}
          <span style={{ fontWeight: 700, color: color.ink }}>
            KES {kes(client.credit)}
          </span>
        </span>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={TABS} />

      {tab === 'services' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Services ({siblings.length})</span>
            <Button variant="primary" onClick={openAddService}>+ Add service</Button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {siblings.map((line) => {
              const p = planById[line.plan_id];
              const isOpen = expanded.has(line.id);
              const showPass = revealed.has(line.id);
              const lineRouter = routerById[line.router_id];
              return (
                <div key={line.id} style={{ border: `1px solid ${color.line}`, borderRadius: radius.md, overflow: 'hidden' }}>
                  <div
                    onClick={() => toggleExpanded(line.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      padding: '10px 12px', cursor: 'pointer', background: isOpen ? color.subtleBg : 'transparent',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
                        color: STATUS_DOT[line.status] ?? color.muted,
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: radius.pill, background: STATUS_DOT[line.status] ?? color.muted }} />
                        {line.status}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {line.line_label || lineRouter?.name || 'Primary line'}
                      </span>
                      <span style={{ fontSize: 12, color: color.muted }}>{line.service}</span>
                    </span>
                    <span style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12.5, color: color.muted }}>
                      <span>{p?.title ?? 'No plan'}</span>
                      <span style={{ fontFamily: font.mono }}>{line.static_ip ?? line.current_ip ?? 'no IP'}</span>
                      <span style={{ fontWeight: 600, color: color.ink }}>KES {kes(p?.price)}</span>
                      <span>{isOpen ? '−' : '+'}</span>
                    </span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '12px 14px', borderTop: `1px solid ${color.line}`, display: 'grid', gap: 8 }}>
                      <KV k="MAC address" v={line.locked_mac ?? 'Not locked yet — sets on first dial-in'} />
                      <KV k="Username" v={line.pppoe_user ?? '—'} />
                      <KV
                        k="Password"
                        v={
                          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontFamily: font.mono }}>
                              {line.pppoe_pass ? (showPass ? line.pppoe_pass : '•'.repeat(line.pppoe_pass.length)) : '—'}
                            </span>
                            {line.pppoe_pass && (
                              <span
                                onClick={() => setRevealed((s) => { const n = new Set(s); n.has(line.id) ? n.delete(line.id) : n.add(line.id); return n; })}
                                style={{ fontSize: 11.5, fontWeight: 600, color: color.green, cursor: 'pointer' }}
                              >
                                {showPass ? 'Hide' : 'Show'}
                              </span>
                            )}
                          </span>
                        }
                      />
                      <KV k="Expiry" v={line.expires_at ? new Date(line.expires_at).toLocaleString('en-KE') : '—'} />
                      <KV k="Router" v={lineRouter?.name ?? '—'} />
                      <RowActions>
                        <RowAction tone={color.amberInk} onClick={() => setAccess(line, line.status === 'active' ? 'pause' : 'resume')}>
                          {line.status === 'active' ? 'Pause' : 'Resume'}
                        </RowAction>
                        {store.isAdmin && line.status !== 'suspended' && (
                          <RowAction tone={color.rust} onClick={() => setAccess(line, 'suspend')} title="Block this line — a payment clears it">
                            Suspend
                          </RowAction>
                        )}
                        <RowAction tone={color.green} onClick={() => giveDays(line)} title="Outage credit or a grace period">Extend</RowAction>
                        {line.service === 'pppoe' && line.phone && (
                          <RowAction onClick={() => stkPush(line)} title="Send an M-Pesa STK prompt to their phone">Send STK</RowAction>
                        )}
                        {line.service === 'pppoe' && line.locked_mac && (
                          <RowAction onClick={() => clearMacLock(line)}>Clear MAC lock</RowAction>
                        )}
                        <RowAction tone={color.green} onClick={() => setEditing({ ...line })}>Edit</RowAction>
                        <RowAction
                          tone={color.rust}
                          onClick={() => {
                            if (window.confirm(`Delete ${line.line_label || 'this line'} on account ${line.account_code}? This cannot be undone.`)) removeClient(line);
                          }}
                        >
                          Delete
                        </RowAction>
                      </RowActions>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'info' && infoForm && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }}>
          <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 10px' }}>Basic info</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Portal login [ Account number ]" hint="Fixed once created — a customer's account number">
                <Input value={client.account_code} disabled style={{ fontFamily: font.mono }} />
              </Field>
              <Field label="Date registered">
                <Input
                  value={client.created_at ? new Date(client.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  disabled
                />
              </Field>
              <Field
                label="Portal password"
                hint={
                  portalPassword === null
                    ? 'Set before passwords could be shown — generate a new one to see it'
                    : portalPassword
                      ? undefined
                      : 'Stored as a hash — Show reads back the decrypted copy if there is one'
                }
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {portalPassword ? (
                    <Input value={portalPassword} disabled style={{ fontFamily: font.mono }} />
                  ) : (
                    <Button onClick={showPortalPassword} disabled={portalBusy}>{portalBusy ? 'Reading…' : 'Show'}</Button>
                  )}
                  <Button onClick={genPortalPassword} disabled={portalBusy}>{portalBusy ? 'Generating…' : 'Generate new'}</Button>
                </div>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="First name">
                  <Input value={infoForm.firstName} onChange={(e) => setInfoForm((s) => ({ ...s, firstName: e.target.value }))} />
                </Field>
                <Field label="Last name">
                  <Input value={infoForm.lastName} onChange={(e) => setInfoForm((s) => ({ ...s, lastName: e.target.value }))} />
                </Field>
              </div>
              <Field label="Phone" hint="Used for M-Pesa matching">
                <Input value={infoForm.phone} onChange={(e) => setInfoForm((s) => ({ ...s, phone: e.target.value }))} />
              </Field>
              <Field label="Second number" hint="Optional — also receives every notification">
                <Input value={infoForm.phoneAlt} onChange={(e) => setInfoForm((s) => ({ ...s, phoneAlt: e.target.value }))} />
              </Field>
              <Field label="Email" hint="Optional">
                <Input type="email" value={infoForm.email} onChange={(e) => setInfoForm((s) => ({ ...s, email: e.target.value }))} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Birthday" hint="Optional">
                  <Input type="date" value={infoForm.birthday} onChange={(e) => setInfoForm((s) => ({ ...s, birthday: e.target.value }))} />
                </Field>
                <Field label="Category">
                  <Select
                    value={infoForm.category}
                    onChange={(e) => setInfoForm((s) => ({ ...s, category: e.target.value }))}
                    options={['', 'Individual Monthly', 'Individual Prepaid', 'Business Monthly', 'Business Contract']}
                  />
                </Field>
              </div>
              <Field label="Identification" hint="Optional — ID or passport number">
                <Input value={infoForm.identification} onChange={(e) => setInfoForm((s) => ({ ...s, identification: e.target.value }))} />
              </Field>
              <Button variant="primary" onClick={saveInfo} disabled={infoBusy} style={{ alignSelf: 'flex-start' }}>
                {infoBusy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>

          <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 10px' }}>Location data</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Location / building">
                <Input value={infoForm.location} onChange={(e) => setInfoForm((s) => ({ ...s, location: e.target.value }))} placeholder="Eldama Ravine" />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Latitude">
                  <Input value={infoForm.lat} onChange={(e) => setInfoForm((s) => ({ ...s, lat: e.target.value }))} />
                </Field>
                <Field label="Longitude">
                  <Input value={infoForm.lng} onChange={(e) => setInfoForm((s) => ({ ...s, lng: e.target.value }))} />
                </Field>
              </div>
              <span style={{ fontSize: 11.5, color: color.muted, letterSpacing: '.03em' }}>MOVE THE MAP MARKER FOR A PRECISE LOCATION</span>
              <LocationMap
                lat={infoForm.lat === '' ? null : Number(infoForm.lat)}
                lng={infoForm.lng === '' ? null : Number(infoForm.lng)}
                onChange={(la, lo) => setInfoForm((s) => ({ ...s, lat: la.toFixed(6), lng: lo.toFixed(6) }))}
              />
            </div>
          </div>

          <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 16px', gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 10px' }}>Other</div>
            <KV k="Auto-pay" v={client.autopay ?? 'Off'} />
            {client.service === 'pppoe' && (
              <KV k="Pay to paybill" v={client.paybill ?? 'Not configured — see Settings → Payment gateways'} />
            )}
          </div>
        </div>
      )}

      {tab === 'billing' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 8px' }}>Payment history</div>
          {(() => {
            const ids = new Set(siblings.map((s) => s.id));
            const history = (store.mpesaTx ?? [])
              .filter((p) => ids.has(p.subscriber_id))
              .sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
            if (!history.length) return <Empty>No payments recorded for this account yet.</Empty>;
            return (
              <div style={{ display: 'grid', gap: 8 }}>
                {history.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12.5, paddingBottom: 8, borderBottom: `1px solid ${color.line}` }}>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontFamily: font.mono }}>{p.provider_ref}</span>
                      <span style={{ color: color.muted, fontSize: 11 }}>
                        {p.provider} · {new Date(p.received_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                    <span style={{ fontWeight: 600 }}>KES {kes(p.amount)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'invoices' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 8px' }}>Invoices</div>
          {(() => {
            const ids = new Set(siblings.map((s) => s.id));
            const invoices = (store.invoices ?? [])
              .filter((i) => ids.has(i.subscriber_id))
              .sort((a, b) => new Date(b.due_date) - new Date(a.due_date));
            if (!invoices.length) return <Empty>No invoices raised for this account.</Empty>;
            return (
              <div style={{ display: 'grid', gap: 8 }}>
                {invoices.map((inv) => (
                  <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, paddingBottom: 8, borderBottom: `1px solid ${color.line}` }}>
                    <span style={{ fontFamily: font.mono }}>{inv.number}</span>
                    <span style={{ color: color.muted }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : '—'}</span>
                    <span>KES {kes(inv.paid)} / {kes(inv.amount)}</span>
                    <span style={{ fontWeight: 600, color: inv.status === 'paid' ? color.green : color.rust }}>{inv.status}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'communication' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 8px' }}>Messages sent to this customer</div>
          {thread === null ? (
            <span style={{ fontSize: 12.5, color: color.muted }}>Loading…</span>
          ) : thread.filter((m) => m.direction === 'out').length === 0 ? (
            <Empty>Nothing sent to this customer yet.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {thread.filter((m) => m.direction === 'out').map((m) => (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12.5, paddingBottom: 8, borderBottom: `1px solid ${color.line}` }}>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
                  <span style={{ fontSize: 11, color: color.muted }}>
                    {m.channel} · {new Date(m.sent_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'statistics' && <Soon label="Usage statistics" />}
      {tab === 'live' && <Soon label="Live session data" />}
      {tab === 'activity' && <Soon label="Activity log" />}

      <Modal
        open={!!addingService}
        title={`Add a service — account ${addingService?.account_code ?? ''}`}
        onClose={() => { if (!serviceBusy) setAddingService(null); }}
        footer={
          <>
            <Button onClick={() => setAddingService(null)} disabled={serviceBusy}>Cancel</Button>
            <Button variant="primary" onClick={submitAddService} disabled={serviceBusy}>
              {serviceBusy ? 'Adding…' : 'Add service'}
            </Button>
          </>
        }
      >
        {addingService && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Line tag" span={2} hint={`Told apart from ${addingService.name}'s other line(s) — "Shop", "Flat 3"`}>
              <Input value={serviceForm.lineLabel} onChange={(e) => setServiceForm((s) => ({ ...s, lineLabel: e.target.value }))} autoFocus />
            </Field>
            <Field label="Plan">
              <Select
                value={serviceForm.planId}
                onChange={(e) => setServiceForm((s) => ({ ...s, planId: e.target.value }))}
                options={[{ value: '', label: 'No plan yet' }, ...(store.plans ?? []).filter((p) => p.service === 'pppoe').map((p) => ({ value: p.id, label: p.title }))]}
              />
            </Field>
            <Field label="Router">
              <Select
                value={serviceForm.routerId}
                onChange={(e) => setServiceForm((s) => ({ ...s, routerId: e.target.value, staticIp: '' }))}
                options={[{ value: '', label: 'Not assigned yet' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
              />
            </Field>
            <Field
              label="Static IP"
              span={2}
              hint={
                !serviceForm.routerId ? 'Pick a router first — or leave on "Next free address" for a dynamic one'
                  : serviceFreeIps.loading ? 'Reading the pool…'
                  : serviceFreeIps.addresses.length ? `${serviceFreeIps.addresses.length} free in ${serviceFreeIps.pools.join(', ')}`
                  : 'No pool on this router — add one under Networks'
              }
            >
              <Select
                value={serviceForm.staticIp}
                onChange={(e) => setServiceForm((s) => ({ ...s, staticIp: e.target.value }))}
                options={[{ value: '', label: 'Next free address' }, ...serviceFreeIps.addresses.map((ip) => ({ value: ip, label: ip }))]}
              />
            </Field>
            <Field label="PPPoE username" hint="What they dial in with">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={serviceForm.pppoeUser}
                  onChange={(e) => setServiceForm((s) => ({ ...s, pppoeUser: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                  inputMode="numeric"
                  style={{ fontFamily: font.mono }}
                />
                <Button onClick={genServiceCredentials}>Generate</Button>
              </div>
            </Field>
            <Field label="PPPoE password" hint="7 digits">
              <Input
                value={serviceForm.pppoePass}
                onChange={(e) => setServiceForm((s) => ({ ...s, pppoePass: e.target.value.replace(/\D/g, '').slice(0, 7) }))}
                inputMode="numeric"
                style={{ fontFamily: font.mono }}
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editing}
        title={`Edit ${editing?.line_label || editing?.name || ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>Save changes</Button>
          </>
        }
      >
        {editing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" span={2}>
              <Input value={editing.name ?? ''} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} />
            </Field>
            <Field label="Phone">
              <Input value={editing.phone ?? ''} onChange={(e) => setEditing((s) => ({ ...s, phone: e.target.value }))} />
            </Field>
            <Field label="Router" hint="Which tower this line is on">
              <Select
                value={editing.router_id ?? ''}
                onChange={(e) => setEditing((v) => ({ ...v, router_id: e.target.value }))}
                options={[{ value: '', label: 'Not assigned' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
              />
            </Field>
            <Field label="Static IP" hint={editing.router_id ? undefined : 'Pick a router first for a pool to choose from'}>
              {(() => {
                const pool = (store.ipPools ?? []).find((p) => p.router_id === editing.router_id && p.service !== 'hotspot' && p.purpose !== 'expired');
                const taken = new Set(clients.filter((c) => c.id !== editing.id && c.static_ip).map((c) => c.static_ip));
                const free = pool ? hostsInCidr(pool.cidr).filter((ip) => !taken.has(ip)) : [];
                if (!pool) {
                  return <Input value={editing.static_ip ?? ''} onChange={(e) => setEditing((s) => ({ ...s, static_ip: e.target.value }))} placeholder="10.10.0.5" />;
                }
                return (
                  <Select
                    value={editing.static_ip ?? ''}
                    onChange={(e) => setEditing((s) => ({ ...s, static_ip: e.target.value }))}
                    options={[
                      { value: '', label: 'No static IP' },
                      ...(editing.static_ip && !free.includes(editing.static_ip) ? [{ value: editing.static_ip, label: `${editing.static_ip} (current)` }] : []),
                      ...free.map((ip) => ({ value: ip, label: ip })),
                    ]}
                  />
                );
              })()}
            </Field>
            <Field label="Location">
              <Input value={editing.location ?? ''} onChange={(e) => setEditing((s) => ({ ...s, location: e.target.value }))} placeholder="Kilimani, Block C" />
            </Field>
            <Field label="Auto-pay" hint="Charge this gateway automatically before expiry">
              <Select value={editing.autopay ?? ''} onChange={(e) => setEditing((s) => ({ ...s, autopay: e.target.value }))} options={AUTOPAY_OPTIONS} />
            </Field>
            <Field label="Plan">
              <Select
                value={editing.plan_id ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, plan_id: e.target.value }))}
                options={[{ value: '', label: 'No plan' }, ...(store.plans ?? []).filter((p) => p.service === editing.service).map((p) => ({ value: p.id, label: p.title }))]}
              />
            </Field>
            <Field label="Status">
              <Select value={editing.status ?? 'active'} onChange={(e) => setEditing((s) => ({ ...s, status: e.target.value }))} options={['active', 'grace', 'expired', 'suspended']} />
            </Field>
            <Field label="Balance (KES)" hint="Positive credits the account; negative is what they still owe">
              <Input type="number" value={editing.credit ?? 0} onChange={(e) => setEditing((s) => ({ ...s, credit: e.target.value }))} />
            </Field>
            <Field label="Expires" span={2} hint="When this line stops working without a payment">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Input
                  type="date"
                  value={editing.expires_at ? new Date(editing.expires_at).toISOString().slice(0, 10) : ''}
                  onChange={(e) => setEditing((s) => ({ ...s, expires_at: e.target.value || null }))}
                  style={{ maxWidth: 170 }}
                />
                {[7, 30].map((days) => (
                  <Button key={days} size="sm" onClick={() => setEditing((s) => ({ ...s, expires_at: new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) }))}>
                    +{days}d from today
                  </Button>
                ))}
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
