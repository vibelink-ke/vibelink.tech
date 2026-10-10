import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { color, font, radius, kes, cur } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Empty, Field, Input, KV, Modal, RowAction, RowActions, Screen, Select, Tabs } from '../ui/primitives';
import ClientOnu from './clients/ClientOnu';
import { Signal, StatusBadge } from './SmartOlt';
import { downloadInvoice } from '../lib/export';
import { useInvoicePay } from '../ui/invoicePay';
import { useInvoiceEditor } from './clients/invoiceEditor';
import { useInvoiceActions } from './clients/ClientInvoices';
import Troubleshoot from './clients/Troubleshoot';

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(v / 1024)} KB`;
};

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
  // Starts at 2, not 1: .1 is the gateway address every router in this pool
  // gets (see planNetwork/poolFromCidr on the backend) — offering it here
  // let an operator hand a subscriber the router's own address, which the
  // backend's own allocator has never done (it starts its search at the
  // same offset) but this dropdown did, silently, for anyone using it.
  for (let i = 2; i < scanLimit && out.length < max; i++) {
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
  { id: 'fibre', label: 'Fibre (ONU)' },
  { id: 'activity', label: 'Activity log' },
];

// online/last_seen already come back from GET /api/subscribers (see its own
// comment on the backend) — this just turns them into something readable.
// Hotspot has no equivalent connected/disconnected concept per voucher, so
// this is PPPoE-only, same as Live data above.
const connectionStatus = (line) => {
  if (line.service !== 'pppoe') return null;
  if (line.online && line.line_state === 'unreachable') return { text: 'Online, but not answering (no internet?)', dot: color.amberInk };
  if (line.online) return { text: 'Online now', dot: color.green };
  if (!line.last_seen) return { text: 'Never connected', dot: color.muted };
  const when = new Date(line.last_seen).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return { text: `Offline · last seen ${when}`, dot: color.rust };
};

// A filled area under a rolling series of Kbps samples, scaled to the chart's
// own current peak (not a fixed ceiling) so a quiet line still shows visible
// movement instead of a flat sliver at the bottom of the graph.
const areaPath = (values, w, h, max) => {
  if (values.length < 2 || !max) return '';
  const stepX = w / (values.length - 1);
  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');
  return `${line} L${w},${h} L0,${h} Z`;
};

export default function ClientDetail() {
  const store = useStore();
  const pay = useInvoicePay(store);
  const [openInvoiceEditor, invoiceEditor] = useInvoiceEditor();
  const invoiceActions = useInvoiceActions();
  const [troubleshooting, setTroubleshooting] = useState(null);   // the service line being checked
  const [diag, setDiag] = useState(null);   // { busy } | { error } | the /diagnose result
  const canEditInvoices = !!store.session?.perms?.['clients.invoices'];
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

  /**
   * A customer record and its first line are still the same database row
   * (subscribers) — creating a customer with no service picked yet still
   * makes one, just with plan/router/credentials all unset. Showing that as
   * a real "Primary line" in the Services list looked like a service
   * existed (an "active" status, a real expiry) when nobody had chosen one
   * yet. Filtered out of what's displayed/counted here rather than out of
   * the database — every place that bills, matches payments, or syncs
   * RADIUS off this row still needs it exactly as it is; only this list
   * pretends it isn't there yet, and "+ Add service" (below) fills it in
   * rather than creating a second row next to it.
   */
  const isEmptyLine = (l) => !l.plan_id && !l.router_id && !l.pppoe_user && !l.pppoe_pass && !l.static_ip;
  const emptyLine = siblings.find(isEmptyLine);
  const visibleSiblings = siblings.filter((l) => !isEmptyLine(l));

  // Each line is its own ONU in SmartOLT (client_id there is a line id, not an
  // account), so a two-service account can have a fibre signal on one line and
  // not the other — fetched once per account and looked up per line below,
  // same source Clients.jsx's list SIGNAL column and the Fibre tab both use.
  const soOn = !!store.session?.features?.smartolt && !!store.session?.perms?.['smartolt.view'];
  const [onuByLine, setOnuByLine] = useState(() => new Map());
  useEffect(() => {
    if (!soOn) return undefined;
    const load = () => api.smartoltOnus()
      .then((rows) => setOnuByLine(new Map(rows.filter((r) => r.client_id).map((r) => [r.client_id, r]))))
      .catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(t);
  }, [soOn]);

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
  // Access points drawn on the map, for choosing which radio serves this customer (needs map access; silent without).
  const [aps, setAps] = useState([]);
  useEffect(() => { api.network().then((n) => setAps((n.nodes ?? []).filter((x) => x.kind === 'ap'))).catch(() => {}); }, []);
  const [tagDraft, setTagDraft] = useState('');
  const [portalPassword, setPortalPassword] = useState(undefined);   // undefined = not fetched yet

  // Separate from the Edit-client modal's plain "Wallet balance" field
  // (which overwrites the number outright) — this adds or subtracts a
  // deliberate amount with a reason attached, for the cases that actually
  // need an audit trail: a refund, a correction, a deduction.
  // Changing the account number (the paybill account / portal login) — moves the whole account.
  const [acctChange, setAcctChange] = useState(null);   // { value } while the dialog is open
  const [acctBusy, setAcctBusy] = useState(false);
  const submitAccountChange = async () => {
    setAcctBusy(true);
    try {
      const r = await api.changeAccountCode(client.id, acctChange.value.trim());
      store.setCollection('clients', (cs) => cs.map((c) => (c.account_code === r.old ? { ...c, account_code: r.accountCode } : c)));
      store.toast(`Account number is now ${r.accountCode}`);
      setAcctChange(null);
    } catch (e) {
      store.toast(e.message);
    } finally {
      setAcctBusy(false);
    }
  };
  const [walletAdjust, setWalletAdjust] = useState(null);   // { amount: '', reason: '' } while the modal is open
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');

  async function submitWalletAdjust() {
    // The wallet becomes exactly what is typed — 0 clears it, 100 makes it 100.
    const balance = Number(walletAdjust.amount);
    if (walletAdjust.amount === '' || !Number.isFinite(balance)) {
      setWalletError('Enter the balance the wallet should have.');
      return;
    }
    if (!walletAdjust.reason.trim()) {
      setWalletError('A reason is required.');
      return;
    }
    setWalletBusy(true);
    setWalletError('');
    try {
      const { wallet_balance } = await api.adjustWallet(client.id, { balance, reason: walletAdjust.reason.trim() });
      // Same sibling-refresh every line on this account_code needs after any
      // wallet change — mirrors saveEdit's own refresh elsewhere in this file.
      store.setCollection('clients', (cs) => cs.map((c) => (
        c.account_code === client.account_code ? { ...c, wallet_balance } : c)));
      store.toast(`Wallet set to ${cur()} ${balance.toLocaleString('en-KE')}`);
      setWalletAdjust(null);
    } catch (e) {
      setWalletError(e.message || 'Could not adjust the wallet.');
    } finally {
      setWalletBusy(false);
    }
  }

  useEffect(() => {
    if (!client) { setInfoForm(null); return; }
    const [firstName = '', ...rest] = (client.name ?? '').trim().split(/\s+/);
    setInfoForm({
      firstName, lastName: rest.join(' '),
      phone: client.phone ?? '', phoneAlt: client.phone_alt ?? '',
      location: client.location ?? '',
      lat: client.lat ?? '', lng: client.lng ?? '',
      email: client.email ?? '',
      category: client.category ?? '', identification: client.identification ?? '',
      billingType: client.billing_type ?? '', tags: client.tags ?? [],
      customerRef: client.customer_ref ?? '',
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
        category: infoForm.category || null,
        identification: infoForm.identification || null,
        billing_type: infoForm.billingType || null,
        tags: infoForm.tags,
        customer_ref: infoForm.customerRef.trim() || null,
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
    Promise.all(siblings.map((s) => api.subscriberCommunications(s.id).catch(() => [])))
      .then((lists) => {
        // Lines on one account often share a phone, so the same message turns up once per line: keep one.
        const seen = new Set();
        setThread(lists.flat().filter((m) => { const k = `${m.channel}|${m.at}|${m.body}`; if (seen.has(k)) return false; seen.add(k); return true; })
          .sort((a, b) => new Date(b.at) - new Date(a.at)));
      });
  }, [siblings.map((s) => s.id).join(',')]);

  // Usage and activity are per-line (a customer's second connection has its
  // own traffic and its own history), fetched only once that tab is opened
  // rather than for every line up front.
  const [usage, setUsage] = useState(null);          // { days: [{ day, down, up, approx }], trackedSince }
  const [openMonth, setOpenMonth] = useState(null);   // 'YYYY-MM' expanded on the Statistics tab
  useEffect(() => {
    if (tab !== 'statistics' || !client) return;
    setUsage(null);
    setOpenMonth(null);
    api.subscriberUsageHistory(client.id).then(setUsage).catch(() => setUsage({ days: [], trackedSince: null }));
  }, [tab, client?.id]);

  const [activity, setActivity] = useState(null);
  useEffect(() => {
    if (tab !== 'activity' || !client) return;
    setActivity(null);
    api.subscriberActivity(client.id).then(setActivity).catch(() => setActivity([]));
  }, [tab, client?.id]);

  // Polled only while the tab is actually open — same 5s cadence as the
  // per-router Traffic dialog (Routers.jsx), 2s, not 5s: a bandwidth graph
  // reads as "live" only if it visibly moves while you watch it — samples
  // keeps a rolling 60s window (30 points) for the chart, reset whenever the
  // tab is reopened or the line changes. Deliberately just the current rate,
  // not a running total of bytes-transferred-while-watching — that grew
  // forever the whole time the tab stayed open and read as "how much has
  // this customer used", which it never was: it reset to zero on every
  // reopen and had nothing to do with their actual usage. down/up here are
  // already correctly mapped to the customer's own point of view by
  // subscriberTraffic (routeros.js) — RouterOS itself reports the opposite
  // (rx/tx from the router's side), and a previous version of this read
  // those fields directly, which showed every download as "upload".
  const [liveTraffic, setLiveTraffic] = useState(null);   // { downKbps, upKbps, at, error }
  const [liveSamples, setLiveSamples] = useState([]);     // [{ downKbps, upKbps }], oldest first
  useEffect(() => {
    if (tab !== 'live' || !client) return undefined;
    let live = true;
    setLiveTraffic(null);
    setLiveSamples([]);
    const tick = async () => {
      try {
        const out = await api.subscriberLiveTraffic(client.id);
        if (!live) return;
        setLiveTraffic({ downKbps: out.downKbps, upKbps: out.upKbps, at: out.at, uptimeSec: out.uptimeSec, downBytes: out.downBytes, upBytes: out.upBytes, error: null });
        setLiveSamples((s) => [...s, { downKbps: out.downKbps, upKbps: out.upKbps }].slice(-30));
      } catch (e) {
        if (live) setLiveTraffic({ downKbps: null, upKbps: null, at: null, error: e.message });
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { live = false; clearInterval(id); };
  }, [tab, client?.id]);

  // Each online PPPoE service's session, read from its router while the Services tab is open: how long it has been up
  // and what it has moved since. Straight from the router, so it works even when RADIUS accounting is not reporting.
  const [lineSessions, setLineSessions] = useState({});
  useEffect(() => {
    if (tab !== 'services') return undefined;
    let live = true;
    const read = async () => {
      for (const l of siblings) {
        if (l.service !== 'pppoe' || !l.online) continue;
        try {
          const out = await api.subscriberLiveTraffic(l.id);
          if (live) setLineSessions((m) => ({ ...m, [l.id]: { uptimeSec: out.uptimeSec, downBytes: out.downBytes, upBytes: out.upBytes } }));
        } catch (e) {
          if (live) setLineSessions((m) => ({ ...m, [l.id]: { error: true } }));
        }
      }
    };
    read();
    const id = setInterval(read, 30000);
    return () => { live = false; clearInterval(id); };
  }, [tab, siblings]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [addingService, setAddingService] = useState(null);
  const [serviceForm, setServiceForm] = useState({ lineLabel: '', planId: '', routerId: '', staticIp: '', pppoeUser: '', pppoePass: '', location: '', lat: '', lng: '' });
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
    setServiceForm({ lineLabel: '', planId: '', routerId: '', staticIp: '', pppoeUser: '', pppoePass: '', location: '', lat: '', lng: '' });
    setAddingService(client);
    try {
      const { account, password } = await api.newSubscriberCredentials();
      setServiceForm((s) => ({ ...s, pppoeUser: account, pppoePass: password }));
    } catch { /* Generate button covers a retry */ }
  };

  const submitAddService = async () => {
    if (!addingService) return;
    // Filling in the still-empty line a plain customer creation always
    // leaves behind (see isEmptyLine above) rather than creating a second
    // row next to it — that one has no tag of its own and needs none, it's
    // the account's only line until a real second one is added.
    if (emptyLine) {
      setServiceBusy(true);
      try {
        const updated = await api.updateSubscriber(emptyLine.id, {
          plan_id: serviceForm.planId || null,
          router_id: serviceForm.routerId || null,
          pppoe_user: serviceForm.pppoeUser || null,
          pppoe_pass: serviceForm.pppoePass || null,
          static_ip: serviceForm.staticIp || null,
          location: serviceForm.location || null,
          lat: serviceForm.lat === '' ? null : Number(serviceForm.lat),
          lng: serviceForm.lng === '' ? null : Number(serviceForm.lng),
        });
        store.setCollection('clients', (cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
        store.toast(`Service added to ${addingService.account_code}`);
        setAddingService(null);
      } catch (e) {
        store.toast(`Could not add service: ${e.message}`);
      } finally {
        setServiceBusy(false);
      }
      return;
    }
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
        location: serviceForm.location || null,
        lat: serviceForm.lat === '' ? null : Number(serviceForm.lat),
        lng: serviceForm.lng === '' ? null : Number(serviceForm.lng),
        allowDuplicatePhone: true,
      });
      let shown = created;
      if (serviceForm.connectionType) {
        shown = await api.updateSubscriber(created.id, { connection_type: serviceForm.connectionType }).catch(() => created);
      }
      store.setCollection('clients', (cs) => [shown, ...cs]);
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

  // { client, date } while the calendar modal is open — date is a plain
  // "YYYY-MM-DD" from the native date input, day-count typing (window.prompt)
  // replaced with picking the actual day this line should stay active
  // through. Clients.jsx's own bulk "outage credit" flow still uses a
  // relative day-count on purpose — one uniform number of days makes sense
  // applied across many customers with different current expiries, where a
  // single target date would not.
  const [extending, setExtending] = useState(null);

  const openExtend = (c) => {
    const current = c.expires_at ? new Date(c.expires_at) : null;
    // Pre-fills to the day after whatever's later of "already active until"
    // or "today" — a customer mid-plan sees their own expiry nudged
    // forward, not reset backward to tomorrow.
    const base = current && current > new Date() ? current : new Date();
    const next = new Date(base.getTime() + 86400000);
    setExtending({ client: c, date: next.toISOString().slice(0, 10) });
  };

  const submitExtend = async () => {
    if (!extending) return;
    const { client, date } = extending;
    if (!date) return store.toast('Pick a date');
    try {
      // "Active through <date>" lands on the same Nairobi-midnight boundary
      // every other PPPoE expiry already uses (ceilToMidnight, apply.js) —
      // the instant that reads as 00:00 the FOLLOWING day in Nairobi (fixed
      // UTC+3, no DST), so the picked day itself is fully included.
      const expiresAt = new Date(new Date(`${date}T00:00:00+03:00`).getTime() + 86400000).toISOString();
      const updated = await api.updateSubscriber(client.id, { expires_at: expiresAt });
      store.setCollection('clients', (cs) => cs.map((x) => (x.id === client.id ? updated : x)));
      store.toast(`${client.line_label || client.name} active through ${new Date(`${date}T00:00:00+03:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`);
      setExtending(null);
    } catch (e) {
      store.toast(`Could not extend: ${e.message}`);
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
      store.toast(`Sent — ${cur()} ${res.amount} to ${res.phone}`);
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

  const [switching, setSwitching] = useState(null);   // { line, planId, price } while the dialog is open
  const saveSwitch = async () => {
    const price = String(switching.price ?? '').trim();
    if (price !== '' && !(Number(price) >= 0)) return store.toast('Price must be a number, zero or more');
    try {
      const updated = await api.updateSubscriber(switching.line.id, {
        plan_id: switching.planId || null,
        custom_price: price === '' ? null : Number(price),
      });
      store.setCollection('clients', (cs) => cs.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      store.toast('Service changed');
      setSwitching(null);
    } catch (e) {
      store.toast(`Could not change service: ${e.message}`);
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
      // Each service line is its own place: its own pin, separate from the account's other lines.
      lat: editing.lat === '' || editing.lat == null ? null : Number(editing.lat),
      lng: editing.lng === '' || editing.lng == null ? null : Number(editing.lng),
    };
    // Sent only when changed: any credential change drops the customer's live
    // session, so an untouched Save must not do that.
    if (editing.service === 'pppoe') {
      const orig = clients.find((c) => c.id === editing.id) ?? {};
      const user = (editing.pppoe_user ?? '').trim();
      const pass = (editing.pppoe_pass ?? '').trim();
      if (user !== (orig.pppoe_user ?? '')) {
        if (!/^[A-Za-z0-9]{2,12}$/.test(user)) return store.toast('PPPoE username must be 2-12 letters/digits');
        patch.pppoe_user = user;
      }
      if (pass !== (orig.pppoe_pass ?? '')) {
        if (!/^[A-Za-z0-9]{2,12}$/.test(pass)) return store.toast('PPPoE password must be 2-12 letters/digits');
        patch.pppoe_pass = pass;
      }
      const price = String(editing.custom_price ?? '').trim();
      if (price !== '' && !(Number(price) >= 0)) return store.toast('Price must be a number, zero or more');
      const nextPrice = price === '' ? null : Number(price);
      const wasPrice = orig.custom_price == null ? null : Number(orig.custom_price);
      if (nextPrice !== wasPrice) patch.custom_price = nextPrice;
    }
    {
      // How this one service is reached — per service, since an account can have a fibre line and a wireless one.
      const orig = clients.find((c) => c.id === editing.id) ?? {};
      if ((editing.connection_type || null) !== (orig.connection_type ?? null)) patch.connection_type = editing.connection_type || null;
      if ((editing.ap_node_id || null) !== (orig.ap_node_id ?? null)) patch.ap_node_id = editing.ap_node_id || null;
    }
    try {
      const updated = await api.updateSubscriber(editing.id, patch);
      // Wallet is pooled per account_code — every sibling line sharing this
      // account needs its cached wallet_balance refreshed too, not just the
      // one row just edited, or the others keep showing a stale number until
      // the next full reload.
      store.setCollection('clients', (cs) => cs.map((c) => {
        if (c.id === updated.id) return updated;
        if (c.account_code === updated.account_code) return { ...c, wallet_balance: updated.wallet_balance };
        return c;
      }));
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
          {/* wallet_balance is money actually sitting on the whole account —
              pooled across every line under this account_code, not just this
              one — an overpayment carried forward, spendable against any of
              them. net_balance (wallet minus what this line owes) is the
              different question of whether they're paid up, and stays on
              Billing rather than the header. */}
          Wallet{' '}
          <span style={{ fontWeight: 700, color: color.ink }}>
            {cur()} {kes(client.wallet_balance)}
          </span>{' '}
          {(() => {
            // Unpaid invoices across the whole account make the balance negative.
            const lines = (store.clients ?? []).filter((c) => c.account_code === client.account_code);
            const wallet = Number(client.wallet_balance ?? 0);
            const owed = (lines.length ? lines : [client]).reduce((a, l) => a + (wallet - Number(l.net_balance ?? wallet)), 0);
            return owed - wallet > 0.5
              ? <span style={{ color: color.rust, fontWeight: 700 }} title="Unpaid invoices outstanding">· Balance -{cur()} {kes(owed - wallet)}</span>
              : null;
          })()}{' '}
          <a
            onClick={() => { setWalletAdjust({ amount: String(Number(client.wallet_balance ?? 0)), reason: '' }); setWalletError(''); }}
            style={{ fontSize: 12, fontWeight: 600, color: color.green, cursor: 'pointer' }}
          >
            Adjust
          </a>
        </span>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={TABS.filter((t) => t.id !== 'fibre' || store.session?.features?.smartolt)} />

      {tab === 'services' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Services ({visibleSiblings.length})</span>
            <Button variant="primary" onClick={openAddService}>+ Add service</Button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {!visibleSiblings.length && <Empty>No service configured yet — press "+ Add service" to set up a plan, router and credentials.</Empty>}
            {visibleSiblings.map((line) => {
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
                      {connectionStatus(line) && (
                        <span
                          title={connectionStatus(line).text}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: connectionStatus(line).dot }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: radius.pill, background: connectionStatus(line).dot }} />
                          {line.online ? 'online' : 'offline'}
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12.5, color: color.muted }}>
                      <span>{p?.title ?? 'No plan'}</span>
                      <span style={{ fontFamily: font.mono }}>{line.static_ip ?? line.current_ip ?? 'no IP'}</span>
                      <span style={{ fontWeight: 600, color: color.ink }} title={line.custom_price != null ? `Custom price — the plan's own is ${cur()} ${kes(p?.price)}` : undefined}>
                        {cur()} {kes(line.custom_price ?? p?.price)}{line.custom_price != null && <span style={{ fontSize: 10.5, fontWeight: 600, color: color.amberInk, marginLeft: 4 }}>custom</span>}
                      </span>
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
                      <KV
                        k="Location"
                        v={
                          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span>{line.location || (line.lat != null ? 'Pinned on the map' : 'Not set')}</span>
                            {line.lat != null && line.lng != null && (
                              <a href={`https://www.google.com/maps?q=${line.lat},${line.lng}`} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 600, color: color.green }}>Open map</a>
                            )}
                          </span>
                        }
                      />
                      {soOn && onuByLine.get(line.id) && (
                        <KV
                          k="Signal"
                          v={(() => {
                            const onu = onuByLine.get(line.id);
                            return onu.status !== 'online' ? <StatusBadge status={onu.status} /> : <Signal dbm={onu.signal_dbm} cls={onu.signal_class} />;
                          })()}
                        />
                      )}
                      {store.session?.perms?.['tr069.view'] && (
                        <KV
                          k="TR-069 serial"
                          v={
                            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontFamily: font.mono }}>{line.tr069_serial ?? 'not watched for'}</span>
                              {store.session?.perms?.['clients.edit'] && (
                                <span
                                  onClick={async () => {
                                    const v = window.prompt('Serial number to watch for (the device’s own label), or leave blank to stop watching:', line.tr069_serial ?? '');
                                    if (v === null) return;
                                    try {
                                      await api.setTr069Serial(line.id, v.trim());
                                      store.toast(v.trim() ? 'Saved — it will link once the device calls in' : 'Cleared');
                                      await store.reload({ quiet: true });
                                    } catch (e) {
                                      store.toast(e.message);
                                    }
                                  }}
                                  style={{ fontSize: 11.5, fontWeight: 600, color: color.green, cursor: 'pointer' }}
                                >
                                  Set
                                </span>
                              )}
                            </span>
                          }
                        />
                      )}
                      {connectionStatus(line) && (
                        <KV k="Connection" v={<span style={{ color: connectionStatus(line).dot }}>{connectionStatus(line).text}</span>} />
                      )}
                      {line.service === 'pppoe' && line.online && (
                        <KV
                          k="This session"
                          v={(() => {
                            // The router's own reading first; the accounting record as a fallback.
                            const rs = lineSessions[line.id];
                            const secs = rs?.uptimeSec != null ? rs.uptimeSec
                              : line.session_started ? Math.max(0, Math.floor((Date.now() - new Date(line.session_started).getTime()) / 1000)) : null;
                            const down = rs?.downBytes ?? line.session_down_bytes;
                            const upB = rs?.upBytes ?? line.session_up_bytes;
                            if (secs == null && down == null) {
                              return <span style={{ color: color.muted }}>{rs?.error ? 'The router did not answer' : 'Reading from the router…'}</span>;
                            }
                            const d = Math.floor((secs ?? 0) / 86400);
                            const h = Math.floor(((secs ?? 0) % 86400) / 3600);
                            const m = Math.floor(((secs ?? 0) % 3600) / 60);
                            const up = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
                            return (
                              <span title="Time connected, and data moved since it connected (read from the router, refreshed every 30 seconds)">
                                {secs != null && <>Online {up}</>}
                                {down != null && (
                                  <span style={{ color: color.muted }}>{secs != null ? ' · ' : ''}↓ {fmtBytes(down)} · ↑ {fmtBytes(upB)}</span>
                                )}
                              </span>
                            );
                          })()}
                        />
                      )}
                      <RowActions>
                        {line.id !== client.id && (
                          <RowAction onClick={() => navigate(`/clients/${line.id}`)} title="Open this line's own page — including its own Live data tab">
                            View this line
                          </RowAction>
                        )}
                        <RowAction tone={color.amberInk} onClick={() => setAccess(line, line.status === 'active' ? 'pause' : 'resume')}>
                          {line.status === 'active' ? 'Pause' : 'Resume'}
                        </RowAction>
                        {store.isAdmin && line.status !== 'suspended' && (
                          <RowAction tone={color.rust} onClick={() => setAccess(line, 'suspend')} title="Block this line — a payment clears it">
                            Suspend
                          </RowAction>
                        )}
                        <RowAction tone={color.green} onClick={() => openExtend(line)} title="Outage credit or a grace period">Extend</RowAction>
                        {line.service === 'pppoe' && (
                          <RowAction tone={color.amberInk} onClick={() => setTroubleshooting(line)} title="Online but no internet? Ask the router what is wrong with this line">
                            Troubleshoot
                          </RowAction>
                        )}
                        {line.service === 'pppoe' && line.phone && (
                          <RowAction onClick={() => stkPush(line)} title="Send an M-Pesa STK prompt to their phone">Send STK</RowAction>
                        )}
                        {line.service === 'pppoe' && line.locked_mac && (
                          <RowAction onClick={() => clearMacLock(line)}>Clear MAC lock</RowAction>
                        )}
                        {line.service === 'pppoe' && (
                          <RowAction
                            tone={color.green}
                            onClick={() => setSwitching({ line, planId: line.plan_id ?? '', price: line.custom_price == null ? '' : String(Number(line.custom_price)) })}
                            title="Move this line to a different package, and set its price"
                          >
                            Change service
                          </RowAction>
                        )}
                        <RowAction tone={color.green} onClick={() => setEditing({ ...line, credit: line.wallet_balance ?? 0 })}>Edit</RowAction>
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
              <Field label="Portal login [ Account number ]" hint="The number the customer types as the paybill account and to sign in to their portal">
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input value={client.account_code} disabled style={{ fontFamily: font.mono }} />
                  {store.session?.perms?.['clients.edit'] && (
                    <Button onClick={() => setAcctChange({ value: client.account_code })}>Change</Button>
                  )}
                </div>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Identification" hint="Optional — ID or passport number">
                  <Input value={infoForm.identification} onChange={(e) => setInfoForm((s) => ({ ...s, identification: e.target.value }))} />
                </Field>
                <Field label="Billing type">
                  <Select
                    value={infoForm.billingType}
                    onChange={(e) => setInfoForm((s) => ({ ...s, billingType: e.target.value }))}
                    options={['', 'Monthly (prepaid)', 'Monthly (postpaid)', 'Weekly', 'Daily']}
                  />
                </Field>
              </div>
              <Field
                label="Linked-accounts reference"
                hint="Optional — give two separate accounts (different billing IDs, e.g. a landlord's flats or a business's branches) the same reference to see them together below"
              >
                <Input value={infoForm.customerRef} onChange={(e) => setInfoForm((s) => ({ ...s, customerRef: e.target.value }))} placeholder="e.g. KAMAU-PROPERTIES" />
              </Field>
              <Field label="Tags" hint="Type a tag and press Enter — group clients by estate, sales rep, anything useful to filter by later">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', border: `1px solid ${color.line}`, borderRadius: radius.md, padding: 6 }}>
                  {infoForm.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px',
                        borderRadius: radius.pill, background: color.tileBg, fontSize: 12, fontWeight: 600,
                      }}
                    >
                      {t}
                      <span
                        onClick={() => setInfoForm((s) => ({ ...s, tags: s.tags.filter((x) => x !== t) }))}
                        style={{ cursor: 'pointer', color: color.muted }}
                      >
                        ×
                      </span>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || !tagDraft.trim()) return;
                      e.preventDefault();
                      const t = tagDraft.trim();
                      setInfoForm((s) => (s.tags.includes(t) ? s : { ...s, tags: [...s.tags, t] }));
                      setTagDraft('');
                    }}
                    placeholder="Add a tag…"
                    style={{ border: 'none', outline: 'none', flex: 1, minWidth: 90, fontSize: 13, fontFamily: 'inherit' }}
                  />
                </div>
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
            {client.service === 'pppoe' && client.pay_prefix && (
              <KV k="Account to enter" v={`${client.pay_prefix}${client.account_code ?? ''}`} />
            )}
          </div>

          {/* Splynx's "linked accounts" — one customer, several separate
              billing IDs (a landlord's flats, a business's branches), each
              on its own account_code rather than lines sharing one, grouped
              purely by an operator-chosen reference for a combined view. */}
          {client.customer_ref && (() => {
            const linked = clients.filter((c) => c.customer_ref === client.customer_ref && c.account_code !== client.account_code);
            if (!linked.length) return null;
            const byAccount = new Map();
            for (const c of linked) {
              if (!byAccount.has(c.account_code)) byAccount.set(c.account_code, []);
              byAccount.get(c.account_code).push(c);
            }
            return (
              <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 16px', gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 10px' }}>
                  Linked accounts ({byAccount.size}) — "{client.customer_ref}"
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {[...byAccount.entries()].map(([code, lines]) => {
                    const primary = lines.find((l) => !l.line_label) ?? lines[0];
                    // Pooled per account_code — every line under this other
                    // account already reports the same wallet_balance, so
                    // summing them would count the one shared balance once
                    // per line instead of once.
                    const wallet = Number(primary.wallet_balance ?? 0);
                    return (
                      <div
                        key={code}
                        onClick={() => navigate(`/clients/${primary.id}`)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '9px 11px', borderRadius: radius.md, border: `1px solid ${color.line}`, cursor: 'pointer',
                        }}
                      >
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{primary.name}</span>
                          <span style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>
                            {code} · {lines.length} service{lines.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span style={{ fontSize: 12.5, color: color.muted }}>Wallet {cur()} {kes(wallet)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
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
                    <span style={{ fontWeight: 600 }}>{cur()} {kes(p.amount)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'invoices' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0 8px' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Invoices</span>
            {canEditInvoices && <Button size="sm" variant="primary" onClick={() => openInvoiceEditor(siblings)}>+ Create invoice</Button>}
          </div>
          {invoiceEditor}
          {(() => {
            const ids = new Set(siblings.map((s) => s.id));
            const invoices = (store.invoices ?? [])
              .filter((i) => ids.has(i.subscriber_id))
              .sort((a, b) => new Date(b.due_date) - new Date(a.due_date));
            if (!invoices.length) return <Empty>No invoices raised for this account.</Empty>;
            // Display-only tax breakdown (UISP's "Pricing Mode") — set under
            // Settings -> Preferences -> Tax. Doesn't change what's charged,
            // only how the amount is broken out on the line.
            const rate = Number(store.settings?.prefs?.taxRate) || 0;
            const inclusive = (store.settings?.prefs?.taxInclusive ?? 'Yes') !== 'No';
            const taxOf = (amount) => (rate <= 0 ? null
              : inclusive ? amount - amount / (1 + rate / 100)
              : amount * (rate / 100));
            return (
              <div style={{ display: 'grid', gap: 8 }}>
                {invoices.map((inv) => {
                  const tax = taxOf(Number(inv.amount));
                  const owner = siblings.find((s) => s.id === inv.subscriber_id) ?? client;
                  const link = `${window.location.origin}/invoice/${inv.id}`;
                  return (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, paddingBottom: 8, borderBottom: `1px solid ${color.line}` }}>
                      <span style={{ fontFamily: font.mono }}>{inv.number}</span>
                      <span style={{ color: color.muted }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : '—'}</span>
                      <span>
                        {cur()} {kes(inv.paid)} / {kes(inv.amount)}
                        {tax != null && (
                          <span style={{ color: color.muted }}> ({inclusive ? 'incl.' : 'excl.'} {cur()} {kes(tax)} tax)</span>
                        )}
                      </span>
                      <span style={{ fontWeight: 600, color: inv.status === 'paid' ? color.green : color.rust }}>{inv.status}</span>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <span
                          style={{ color: color.green, fontWeight: 600, cursor: 'pointer' }}
                          onClick={() => downloadInvoice(`Invoice ${inv.number}.pdf`, {
                            company: store.session?.company, number: inv.number, subscriberName: owner?.name,
                            accountCode: owner?.account_code, planTitle: planById[owner?.plan_id]?.title,
                            amount: inv.amount, paid: inv.paid,
                            dueDate: inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : '—',
                            status: inv.status, link,
                          })}
                        >
                          PDF
                        </span>
                        {['open', 'partial'].includes(inv.status) && Number(inv.amount) - Number(inv.paid) > 0 && (
                          <span
                            style={{ color: color.green, fontWeight: 600, cursor: 'pointer' }}
                            onClick={() => pay.open(inv)}
                          >
                            Click to pay
                          </span>
                        )}
                        <span style={{ color: color.green, fontWeight: 600, cursor: 'pointer' }} onClick={() => invoiceActions.view(inv)}>View</span>
                        {canEditInvoices && (
                          <span style={{ color: color.green, fontWeight: 600, cursor: 'pointer' }} onClick={() => openInvoiceEditor(siblings, inv)}>Edit</span>
                        )}
                        {canEditInvoices && (
                          <span style={{ color: color.rust, fontWeight: 600, cursor: 'pointer' }} onClick={() => invoiceActions.remove(inv)}>Delete</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'communication' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 2px' }}>Messages this customer has received</div>
          <div style={{ fontSize: 12, color: color.muted, paddingBottom: 8 }}>Every SMS and email the system sent them, automatic ones (receipts, reminders, expiry notices) included.</div>
          {thread === null ? (
            <span style={{ fontSize: 12.5, color: color.muted }}>Loading…</span>
          ) : thread.length === 0 ? (
            <Empty>Nothing has been sent to this customer yet.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {thread.map((m, i) => (
                <div key={`${m.channel}-${m.at}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5, paddingBottom: 8, borderBottom: `1px solid ${color.line}` }}>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
                  <span style={{ fontSize: 11, color: color.muted, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{m.channel === 'live_chat' ? 'chat' : m.channel}</span>
                    {m.direction === 'in' && <span>from the customer</span>}
                    {m.status && m.status !== 'sent' && <span style={{ color: color.rust, fontWeight: 600 }}>{m.status}</span>}
                    <span>{new Date(m.at).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'statistics' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 2px' }}>Data used, last 12 months</div>
          <div style={{ fontSize: 12, color: color.muted, paddingBottom: 10 }}>Click a month to see each day.</div>
          {usage === null ? (
            <span style={{ fontSize: 13, color: color.muted }}>Loading…</span>
          ) : (() => {
            const now = new Date();
            const keys = [];
            for (let i = 0; i < 12; i += 1) {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            }
            const byMonth = new Map(keys.map((k) => [k, { down: 0, up: 0, days: new Map() }]));
            for (const d of usage.days ?? []) {
              const e = byMonth.get(String(d.day).slice(0, 7));
              if (!e) continue;
              e.down += Number(d.down) || 0;
              e.up += Number(d.up) || 0;
              e.days.set(String(d.day), d);
            }
            const peak = Math.max(1, ...[...byMonth.values()].map((e) => e.down + e.up));
            const exact = (n) => (
              <span title={`${Math.round(Number(n) || 0).toLocaleString('en-KE')} bytes`}>{fmtBytes(n)}</span>
            );
            const anyData = [...byMonth.values()].some((e) => e.down + e.up > 0);
            if (!anyData) return <Empty>No data usage has been recorded for this line yet.</Empty>;
            return (
              <div style={{ display: 'grid', gap: 2 }}>
                {keys.map((k) => {
                  const e = byMonth.get(k);
                  const [y, mo] = k.split('-').map(Number);
                  const label = new Date(y, mo - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
                  const open = openMonth === k;
                  return (
                    <div key={k}>
                      <div
                        onClick={() => setOpenMonth(open ? null : k)}
                        style={{ display: 'grid', gridTemplateColumns: '20px 150px 1fr 110px 110px 110px', gap: 10, alignItems: 'center', padding: '9px 0', borderTop: `1px solid ${color.line}`, cursor: 'pointer', fontSize: 13 }}
                      >
                        <span style={{ color: color.muted }}>{open ? '▾' : '▸'}</span>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span style={{ height: 8, background: color.tileBg, borderRadius: 4, overflow: 'hidden' }}>
                          <span style={{ display: 'block', height: '100%', width: `${((e.down + e.up) / peak) * 100}%`, background: color.green }} />
                        </span>
                        <span style={{ textAlign: 'right', color: color.rust }}>↓ {exact(e.down)}</span>
                        <span style={{ textAlign: 'right', color: color.mint }}>↑ {exact(e.up)}</span>
                        <span style={{ textAlign: 'right', fontWeight: 700 }}>{exact(e.down + e.up)}</span>
                      </div>
                      {open && (() => {
                        const total = new Date(y, mo, 0).getDate();
                        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                        const rows = [];
                        for (let day = 1; day <= total; day += 1) {
                          const dk = `${k}-${String(day).padStart(2, '0')}`;
                          if (dk > todayKey) break;
                          rows.push({ dk, day, d: e.days.get(dk) });
                        }
                        return (
                          <div style={{ background: color.subtleBg ?? color.tileBg, borderRadius: 8, padding: '4px 12px', margin: '0 0 8px 30px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr', gap: 10, fontSize: 11.5, color: color.muted, padding: '6px 0' }}>
                              <span>Day</span><span style={{ textAlign: 'right' }}>Downloaded</span><span style={{ textAlign: 'right' }}>Uploaded</span><span style={{ textAlign: 'right' }}>Total</span>
                            </div>
                            {rows.map(({ dk, day, d }) => (
                              <div key={dk} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr', gap: 10, fontSize: 12.5, padding: '5px 0', borderTop: `1px solid ${color.line}`, color: d ? color.ink : color.muted }}>
                                <span>{new Date(y, mo - 1, day).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}{d?.approx ? ' *' : ''}</span>
                                <span style={{ textAlign: 'right' }}>{d ? exact(d.down) : '—'}</span>
                                <span style={{ textAlign: 'right' }}>{d ? exact(d.up) : '—'}</span>
                                <span style={{ textAlign: 'right', fontWeight: d ? 600 : 400 }}>{d ? exact(Number(d.down) + Number(d.up)) : '—'}</span>
                              </div>
                            ))}
                            {rows.some((r) => r.d?.approx) && (
                              <div style={{ fontSize: 11.5, color: color.muted, padding: '6px 0' }}>
                                * Before {usage.trackedSince ?? 'tracking began'} the figure is the whole connection counted on the day it started, so it can be off for connections that ran over several days.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
      {tab === 'fibre' && <ClientOnu client={client} />}
      {tab === 'live' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0 8px', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Live bandwidth</div>
            {liveTraffic && !liveTraffic.error && (
              <div style={{ display: 'flex', gap: 18, fontSize: 13, fontWeight: 600, flexWrap: 'wrap' }}>
                <span style={{ color: color.rust }}>↓ {(liveTraffic.downKbps / 1000).toFixed(2)} Mbps</span>
                <span style={{ color: color.mint }}>↑ {(liveTraffic.upKbps / 1000).toFixed(2)} Mbps</span>
              </div>
            )}
          </div>
          {client?.service === 'pppoe' && (
            <div style={{ borderBottom: `1px solid ${color.line}`, paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  disabled={!!diag?.busy}
                  onClick={async () => {
                    setDiag({ busy: true });
                    try { setDiag(await api.diagnoseLine(client.id)); } catch (e) { setDiag({ error: e.message }); }
                  }}
                >
                  {diag?.busy ? 'Checking the line…' : 'Online but no internet? Diagnose'}
                </Button>
                {diag?.at && <span style={{ fontSize: 11.5, color: color.muted }}>checked {new Date(diag.at).toLocaleTimeString('en-KE')}</span>}
              </div>
              {diag?.error && <div style={{ fontSize: 13, color: color.rust, paddingTop: 8 }}>{diag.error}</div>}
              {diag?.findings && (
                <div style={{ display: 'grid', gap: 8, paddingTop: 10 }}>
                  {diag.findings.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'flex-start' }}>
                      <span style={{
                        marginTop: 5, width: 9, height: 9, borderRadius: 99, flex: 'none',
                        background: f.level === 'bad' ? color.rust : f.level === 'warn' ? color.amberInk : color.green,
                      }} />
                      <span>{f.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {client?.service !== 'pppoe' ? (
            <Empty>Live data is only available for PPPoE lines right now.</Empty>
          ) : liveTraffic === null ? (
            <span style={{ fontSize: 13, color: color.muted }}>Checking…</span>
          ) : liveTraffic.error ? (
            <Empty>{liveTraffic.error}</Empty>
          ) : (() => {
            const downSeries = liveSamples.map((s) => s.downKbps);
            const upSeries = liveSamples.map((s) => s.upKbps);
            const peak = Math.max(1, ...downSeries, ...upSeries);
            return (
              <>
                <svg viewBox="0 0 600 160" preserveAspectRatio="none" style={{ width: '100%', height: 160, display: 'block' }}>
                  <path d={areaPath(downSeries, 600, 160, peak)} fill={color.rust} opacity={0.3} />
                  <path d={areaPath(downSeries, 600, 160, peak)} fill="none" stroke={color.rust} strokeWidth={1.5} />
                  <path d={areaPath(upSeries, 600, 160, peak)} fill={color.mint} opacity={0.3} />
                  <path d={areaPath(upSeries, 600, 160, peak)} fill="none" stroke={color.mint} strokeWidth={1.5} />
                </svg>
                {liveTraffic.uptimeSec != null && (
                  <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', padding: '14px 0 6px' }}>
                    <div>
                      <div style={{ fontSize: 11.5, color: color.muted }}>Online for</div>
                      <div style={{ fontSize: 17, fontWeight: 700 }}>
                        {(() => {
                          const s = liveTraffic.uptimeSec;
                          const d = Math.floor(s / 86400);
                          const h = Math.floor((s % 86400) / 3600);
                          const m = Math.floor((s % 3600) / 60);
                          return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
                        })()}
                      </div>
                      <div style={{ fontSize: 11.5, color: color.muted }}>this session</div>
                    </div>
                    {liveTraffic.downBytes != null && (
                      <>
                        <div>
                          <div style={{ fontSize: 11.5, color: color.muted }}>Downloaded</div>
                          <div style={{ fontSize: 17, fontWeight: 700, color: color.rust }}>{fmtBytes(liveTraffic.downBytes)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11.5, color: color.muted }}>Uploaded</div>
                          <div style={{ fontSize: 17, fontWeight: 700, color: color.mint }}>{fmtBytes(liveTraffic.upBytes)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11.5, color: color.muted }}>Total used</div>
                          <div style={{ fontSize: 17, fontWeight: 700 }}>{fmtBytes(liveTraffic.downBytes + liveTraffic.upBytes)}</div>
                          <div style={{ fontSize: 11.5, color: color.muted }}>since it connected</div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: color.muted, paddingTop: 4 }}>
                  Live from the router · updates every 2s · last read {new Date(liveTraffic.at).toLocaleTimeString('en-KE')}
                </div>
              </>
            );
          })()}
        </div>
      )}
      {tab === 'activity' && (
        <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, padding: '14px 0 8px' }}>Activity log</div>
          {activity === null ? (
            <span style={{ fontSize: 13, color: color.muted }}>Loading…</span>
          ) : activity.length === 0 ? (
            <Empty>Nothing recorded for this account yet.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, paddingBottom: 8, borderBottom: `1px solid ${color.line}` }}>
                  <span>
                    <span style={{ fontWeight: 600 }}>{a.action}</span>
                    {a.detail && <span style={{ color: color.muted }}> — {a.detail}</span>}
                  </span>
                  <span style={{ color: color.muted, whiteSpace: 'nowrap' }}>
                    {a.actor} · {new Date(a.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Troubleshoot open={!!troubleshooting} line={troubleshooting} onClose={() => setTroubleshooting(null)} />

      <Modal
        open={!!extending}
        title={`Extend — ${extending?.client?.line_label || extending?.client?.name || ''}`}
        onClose={() => setExtending(null)}
        footer={
          <>
            <Button onClick={() => setExtending(null)}>Cancel</Button>
            <Button variant="primary" onClick={submitExtend}>Extend</Button>
          </>
        }
      >
        {extending && (
          <Field label="Active through" hint="The line stays online through the end of this day">
            <Input
              type="date"
              value={extending.date}
              onChange={(e) => setExtending((s) => ({ ...s, date: e.target.value }))}
              autoFocus
            />
          </Field>
        )}
      </Modal>

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
            {/* No tag needed when this is filling in the account's own still-
                empty line (see emptyLine/isEmptyLine above) — there is only
                one line to tell apart from nothing yet. */}
            {!emptyLine && (
              <Field label="Line tag" span={2} hint={`Told apart from ${addingService.name}'s other line(s) — "Shop", "Flat 3"`}>
                <Input value={serviceForm.lineLabel} onChange={(e) => setServiceForm((s) => ({ ...s, lineLabel: e.target.value }))} autoFocus />
              </Field>
            )}
            <Field label="Connection" span={2} hint="How this service is reached (fibre, or a shared PMP / dedicated P2P wireless link)">
              <Select
                value={serviceForm.connectionType ?? ''}
                onChange={(e) => setServiceForm((s) => ({ ...s, connectionType: e.target.value }))}
                options={[{ value: '', label: 'Not set' }, { value: 'fibre', label: 'Fibre' }, { value: 'pmp', label: 'Wireless · PMP' }, { value: 'ptp', label: 'Wireless · P2P' }]}
              />
            </Field>
            <Field label="Location of this service" span={2} hint="Its own place — a second line is often a different building">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Input value={serviceForm.location} onChange={(e) => setServiceForm((s) => ({ ...s, location: e.target.value }))} placeholder="Kilimani, Block C" style={{ flex: '2 1 160px' }} />
                <Button
                  onClick={() => navigator.geolocation?.getCurrentPosition(
                    (g) => setServiceForm((s) => ({ ...s, lat: g.coords.latitude.toFixed(6), lng: g.coords.longitude.toFixed(6) })),
                    () => store.toast('Could not read this device\'s location'),
                    { enableHighAccuracy: true, timeout: 10000 },
                  )}
                >
                  {serviceForm.lat ? 'Pin set — redo' : 'Use my location'}
                </Button>
              </div>
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
            <Field label="PPPoE username" hint="What they dial in with — 2-12 letters/digits">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={serviceForm.pppoeUser}
                  onChange={(e) => setServiceForm((s) => ({ ...s, pppoeUser: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) }))}
                  style={{ fontFamily: font.mono }}
                />
                <Button onClick={genServiceCredentials}>Generate</Button>
              </div>
            </Field>
            <Field label="PPPoE password" hint="2-12 letters/digits">
              <Input
                value={serviceForm.pppoePass}
                onChange={(e) => setServiceForm((s) => ({ ...s, pppoePass: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) }))}
                style={{ fontFamily: font.mono }}
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!switching}
        title={`Change service — ${switching?.line?.line_label || switching?.line?.name || ''}`}
        onClose={() => setSwitching(null)}
        footer={
          <>
            <Button onClick={() => setSwitching(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveSwitch}>Save</Button>
          </>
        }
      >
        {switching && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Package" hint="The speed changes straight away; their expiry date stays as it is">
              <Select
                value={switching.planId}
                onChange={(e) => setSwitching((s) => ({ ...s, planId: e.target.value }))}
                options={[
                  { value: '', label: 'No plan' },
                  ...(store.plans ?? []).filter((p) => p.service === switching.line.service)
                    .map((p) => ({ value: p.id, label: `${p.title} · ${cur()} ${kes(p.price)}` })),
                ]}
              />
            </Field>
            <Field label={`Price (${cur()})`} hint={`Blank charges the package's price (${cur()} ${kes(planById[switching.planId]?.price)}). Applies from their next renewal or invoice.`}>
              <Input
                type="number" min="0"
                value={switching.price}
                onChange={(e) => setSwitching((s) => ({ ...s, price: e.target.value }))}
                placeholder={String(planById[switching.planId]?.price ?? '')}
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
            <Field label="Connection" hint="How this service is reached. Set per service, so one account can have a fibre line and a wireless one.">
              <Select
                value={editing.connection_type ?? ''}
                onChange={(e) => setEditing((v) => ({ ...v, connection_type: e.target.value }))}
                options={[{ value: '', label: 'Not set' }, { value: 'fibre', label: 'Fibre' }, { value: 'pmp', label: 'Wireless · PMP (shared radio / sector)' }, { value: 'ptp', label: 'Wireless · P2P (dedicated radio)' }]}
              />
            </Field>
            {(editing.connection_type === 'pmp' || editing.connection_type === 'ptp') && aps.length > 0 && (
              <Field label="Served by radio" hint="The access point or sector on the map this service connects to.">
                <Select
                  value={editing.ap_node_id ?? ''}
                  onChange={(e) => setEditing((v) => ({ ...v, ap_node_id: e.target.value }))}
                  options={[{ value: '', label: 'Not set' }, ...aps.map((a) => ({ value: a.id, label: a.name }))]}
                />
              </Field>
            )}
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
            <Field label="Location" hint="Where this service is — its own place, not the account's">
              <Input value={editing.location ?? ''} onChange={(e) => setEditing((s) => ({ ...s, location: e.target.value }))} placeholder="Kilimani, Block C" />
            </Field>
            <Field label="Pin on the map" span={2}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Input value={editing.lat ?? ''} onChange={(e) => setEditing((s) => ({ ...s, lat: e.target.value }))} placeholder="Latitude" style={{ flex: 1, minWidth: 120 }} />
                  <Input value={editing.lng ?? ''} onChange={(e) => setEditing((s) => ({ ...s, lng: e.target.value }))} placeholder="Longitude" style={{ flex: 1, minWidth: 120 }} />
                  <Button
                    onClick={() => navigator.geolocation?.getCurrentPosition(
                      (g) => setEditing((s) => ({ ...s, lat: g.coords.latitude.toFixed(6), lng: g.coords.longitude.toFixed(6) })),
                      () => store.toast('Could not read this device\'s location'),
                      { enableHighAccuracy: true, timeout: 10000 },
                    )}
                  >
                    Use my location
                  </Button>
                </div>
                <LocationMap
                  lat={editing.lat === '' || editing.lat == null ? null : Number(editing.lat)}
                  lng={editing.lng === '' || editing.lng == null ? null : Number(editing.lng)}
                  onChange={(la, lo) => setEditing((s) => ({ ...s, lat: la.toFixed(6), lng: lo.toFixed(6) }))}
                />
              </div>
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
            {editing.service === 'pppoe' && (
              <>
                <Field label="PPPoE username" hint="2-12 letters/digits">
                  <Input
                    value={editing.pppoe_user ?? ''}
                    onChange={(e) => setEditing((s) => ({ ...s, pppoe_user: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) }))}
                    style={{ fontFamily: font.mono }}
                  />
                </Field>
                <Field label="PPPoE password" hint="2-12 letters/digits">
                  <Input
                    value={editing.pppoe_pass ?? ''}
                    onChange={(e) => setEditing((s) => ({ ...s, pppoe_pass: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) }))}
                    style={{ fontFamily: font.mono }}
                  />
                </Field>
                <Field label={`Price (${cur()})`} hint={`Blank charges the plan's price (${cur()} ${kes(planById[editing.plan_id]?.price)})`}>
                  <Input
                    type="number" min="0"
                    value={editing.custom_price ?? ''}
                    onChange={(e) => setEditing((s) => ({ ...s, custom_price: e.target.value }))}
                    placeholder={String(planById[editing.plan_id]?.price ?? '')}
                  />
                </Field>
                {(() => {
                  const orig = clients.find((c) => c.id === editing.id) ?? {};
                  const changed = (editing.pppoe_user ?? '') !== (orig.pppoe_user ?? '') || (editing.pppoe_pass ?? '') !== (orig.pppoe_pass ?? '');
                  return changed ? (
                    <div style={{ gridColumn: 'span 2', fontSize: 12, color: color.amberInk }}>
                      Saving disconnects this customer now. Their router must be updated with the new details, or it will not reconnect.
                    </div>
                  ) : null;
                })()}
              </>
            )}
            <Field label={`Wallet balance (${cur()})`} hint="Shared across every line on this account, not just this one — positive credits it, negative is what they still owe">
              <Input type="number" value={editing.credit ?? 0} onChange={(e) => setEditing((s) => ({ ...s, credit: e.target.value }))} />
            </Field>
            <Field label="Expires" span={2} hint="When this line stops working without a payment">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Input
                  type="date"
                  value={editing.expires_at ? new Date(editing.expires_at).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) : ''}
                  onChange={(e) => setEditing((s) => ({ ...s, expires_at: e.target.value || null }))}
                  style={{ maxWidth: 170 }}
                />
                {[7, 30].map((days) => (
                  <Button key={days} size="sm" onClick={() => setEditing((s) => ({ ...s, expires_at: new Date(Date.now() + days * 864e5).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) }))}>
                    +{days}d from today
                  </Button>
                ))}
              </div>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!acctChange}
        title="Change account number"
        onClose={() => !acctBusy && setAcctChange(null)}
        footer={
          <>
            <Button onClick={() => setAcctChange(null)} disabled={acctBusy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={submitAccountChange}
              disabled={acctBusy || !acctChange || acctChange.value.trim() === client.account_code || !/^[A-Za-z0-9]{3,16}$/.test(acctChange.value.trim())}
            >
              {acctBusy ? 'Saving…' : 'Change it'}
            </Button>
          </>
        }
      >
        {acctChange && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="New account number" hint="3 to 16 letters or digits. Not used by any other client.">
              <Input
                value={acctChange.value}
                onChange={(e) => setAcctChange({ value: e.target.value })}
                style={{ fontFamily: font.mono }}
                autoFocus
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!walletAdjust}
        title="Adjust wallet"
        onClose={() => { if (!walletBusy) setWalletAdjust(null); }}
        footer={
          <>
            <Button onClick={() => setWalletAdjust(null)} disabled={walletBusy}>Cancel</Button>
            <Button variant="primary" onClick={submitWalletAdjust} disabled={walletBusy}>
              {walletBusy ? 'Saving…' : 'Set balance'}
            </Button>
          </>
        }
      >
        {walletAdjust && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label={`New wallet balance (${cur()})`} hint="The wallet becomes exactly this — 0 clears it, 100 makes it 100. Negative means they owe. Shared across every line on this account">
              <Input
                type="number"
                value={walletAdjust.amount}
                onChange={(e) => setWalletAdjust((w) => ({ ...w, amount: e.target.value }))}
                placeholder="e.g. 0 or 100"
                autoFocus
              />
            </Field>
            <Field label="Reason" hint="Recorded on the account's activity log">
              <Input
                value={walletAdjust.reason}
                onChange={(e) => setWalletAdjust((w) => ({ ...w, reason: e.target.value }))}
                placeholder="e.g. Goodwill refund for outage on 3 Sep"
              />
            </Field>
            {walletError && <div style={{ fontSize: 12.5, color: color.rust }}>{walletError}</div>}
          </div>
        )}
      </Modal>
      {pay.modal}
    </Screen>
  );
}
