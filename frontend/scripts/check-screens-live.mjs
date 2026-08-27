#!/usr/bin/env node
/**
 * Open every screen the way a browser does, with realistic data, and report
 * the ones that break.
 *
 * The two faults that reached production were both invisible to the checks
 * that existed:
 *
 *   Hotspot   — a blank page with no message at all
 *   Messaging — React #31, an object handed to React as a child, because the
 *               API sends {token, desc} and the screen read .key
 *
 * Neither shows up against an empty store, and neither shows up under
 * server-side rendering either: the data came from the screen's own fetch in a
 * useEffect, and effects do not run there. An earlier version of this file did
 * exactly that and passed the Messaging bug with a clean bill of health, which
 * is worse than having no check — so it renders in jsdom now, with effects
 * running and fetch answering the way the API does.
 *
 * The fixtures below are the contract. When a route changes shape, change them
 * here too: a fixture that has drifted reports success on a screen that is
 * broken in production, which is the failure this file exists to prevent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const screensDir = path.join(here, '..', 'src', 'screens');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://vibelink.vibelink.tech/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// node exposes navigator as a getter-only global, so jsdom's is left where it
// is — window.navigator, which is what the DOM code reads anyway.
globalThis.HTMLElement = dom.window.HTMLElement;
// Leaflet reaches for the bare globals rather than window.*, and the store
// reads localStorage the same way.
globalThis.Element = dom.window.Element;
globalThis.SVGElement = dom.window.SVGElement;
globalThis.localStorage = dom.window.localStorage;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();

/** One subscriber, carrying every field the list, drawer and calendar read. */
const client = {
  id: 'c1', tenant_id: 't1', account_code: '44013', name: 'Peter Kandie',
  phone: '0723295762', phone_alt: null, service: 'pppoe', status: 'active',
  plan_id: 'p1', plan_title: 'FTTH_10Mbps', plan_price: 1500,
  router_id: 'r1', router_name: 'Main 1', pppoe_user: '44013',
  static_ip: '172.16.0.2', current_ip: '172.16.0.2', online: true,
  online_from_router: true, expires_at: iso(3), last_seen: iso(0),
  session_started: iso(-0.02), balance: 0, auto_pay: false,
  lat: -1.2921, lng: 36.8219, location: 'Nairobi', created_at: iso(-30),
};

const COLLECTIONS = {
  clients: [client, { ...client, id: 'c2', account_code: '44014', name: 'Mary W', online: false, status: 'expired', expires_at: iso(-2), lat: null, lng: null }],
  routers: [{ id: 'r1', name: 'Main 1', host: '10.50.2.2', api_port: 8728, role: 'both', status: 'up', last_seen: iso(0), onboarded: 'manual', autoconfig_last_ok: true, autoconfig_last_at: iso(0), autoconfig_last_error: null, ros_version: '7.21.5', lat: -1.29, lng: 36.82, pppoe_pool: '172.16.0.0/24' }],
  plans: [{ id: 'p1', service: 'pppoe', title: 'FTTH_10Mbps', price: 1500, duration_min: 43200, devices: 1, rate_down: 10000, rate_up: 5000, data_cap_mb: null, active: true }],
  hsPlans: [{ id: 'hp1', service: 'hotspot', title: '1 Hour', price: 20, duration_min: 60, devices: 1, rate_down: 3000, rate_up: 1000, data_cap_mb: null, active: true }],
  tariffs: [{ id: 'tf1', title: 'Gold', price: 3000, speed_down: 20, speed_up: 10, fair_use: 100, active: true }],
  invoices: [{ id: 'i1', number: 'INV-1', subscriber_id: 'c1', plan_id: 'p1', amount: 1500, paid: 0, status: 'open', due_date: iso(2), issued_at: iso(-5) }],
  mpesaTx: [{ id: 'pay1', subscriber_id: 'c1', voucher_id: null, amount: 1500, number: '0723295762', code: 'SLJ4XK9', status: 'applied', method: 'mpesa', received_at: iso(-1) }],
  vouchers: [{ id: 'v1', code: '974547', plan_id: 'hp1', status: 'unused', phone: null, mac: null, batch: 'b1', expires_at: iso(1), created_at: iso(0) }],
  tickets: [{ id: 'tk1', subject: 'No internet', status: 'open', priority: 'high', subscriber_id: 'c1', created_at: iso(-1), sla_policy_id: 'sla1', notes: [] }],
  leads: [{ id: 'l1', name: 'New estate', phone: '0700000000', status: 'new', source: 'walk-in', created_at: iso(-2) }],
  staff: [{ id: 's1', name: 'Administrator', email: 'admin@example.com', role: 'owner', created_at: iso(-90) }],
  outages: [{ id: 'o1', title: 'Fibre cut', status: 'open', started_at: iso(-0.1), area: 'Kilimani', affected: 12 }],
  slaPolicies: [{ id: 'sla1', name: 'Standard', respond_mins: 30, resolve_mins: 240, priority: 'high' }],
  fupPolicies: [{ id: 'f1', name: 'Fair use', applies_to: 'all', plan_id: null, data_cap_gb: 100, window_period: 'monthly', throttle_down: 1000, throttle_up: 512 }],
  articles: [{ id: 'a1', title: 'Router lights', body: 'Green means ready.', category: 'Troubleshooting', created_at: iso(-10) }],
  tenants: [{ id: 't1', subdomain: 'vibelink', name: 'Vibelink ISP', status: 'active', licence_ends: iso(30), tunnel_subnet: '10.50.2.0/24', created_at: iso(-100) }],
  settlements: [{ id: 'st1', tenant_id: 't1', amount: 5000, period: '2026-08', status: 'due' }],
  smsHistory: [{ id: 'sm1', provider: 'hostpinnacle', to: '254723295762', body: 'Hi Peter', status: 'sent', at: iso(-0.5), detail: 'HTTP 200' }],
  siteProfiles: [{ id: 'sp1', site: 'Kilimani', shortcode: '4109865', is_default: true }],
  technicians: [{ id: 'tech1', name: 'John', phone: '0711111111' }],
  salesReps: [{ id: 'rep1', name: 'Grace', phone: '0722222222' }],
  ovpnClients: [{ id: 'ov1', username: 'router-2-2', assigned_ip: '10.50.2.2', connected_at: iso(0), created_at: iso(-1), connectedNow: true }],
  ipPools: [{ id: 'pool1', name: 'PPPoE', cidr: '172.16.0.0/24', service: 'pppoe', router_id: 'r1' }],
  liveQueue: [{ id: 'lc1', display_name: 'Guest', visitor_ref: 'v1', status: 'waiting', started_at: iso(-0.01) }],
  referrers: [
    { id: 'ref1', staff_id: null, name: 'Grace Wanjiru', phone: '0722222222', commission_type: 'percent', commission_rate: 10, notes: null, created_at: iso(-30), clients_referred: 2, owed: 150, paid: 300 },
    { id: 'ref2', staff_id: 's1', name: 'Administrator', phone: null, commission_type: 'fixed', commission_rate: 500, notes: 'Front-desk sign-ups', created_at: iso(-10), clients_referred: 0, owed: 0, paid: 0 },
  ],
};

/**
 * What the API answers, in the shapes server.js really returns.
 *
 * Ordered: the first pattern that matches wins, so specific paths come before
 * the collection fallbacks.
 */
const ROUTES = [
  [/\/api\/(auth\/)?session$/, { id: 's1', name: 'Administrator', email: 'admin@example.com', role: 'owner', company: 'Vibelink ISP', superAdmin: true }],
  [/\/api\/platform\/sms-config$/, { provider: null, credentialKeys: [], fields: { hostpinnacle: [], africastalking: [] } }],
  [/\/api\/platform\/sms-balance$/, { configured: false, provider: null, credits: 0 }],
  [/\/api\/leads\/sales-performance$/, [
    { id: 'st1', name: 'Amina W', leads_assigned: 12, leads_won: 5, won_this_month: 2, earned_this_month: 3500, earned_total: 9200 },
    { id: 'st2', name: 'Brian K', leads_assigned: 8, leads_won: 3, won_this_month: 1, earned_this_month: 1200, earned_total: 4100 },
  ]],
  [/\/api\/routers\/wg-peers$/, [
    { id: 'wg1', name: 'Main 1', router_name: 'Main 1', assigned_ip: '10.90.0.2/24', last_handshake: iso(0), rx_bytes: 128000, tx_bytes: 64000, enabled: true },
    { id: 'wg2', name: 'Branch 2', router_name: null, assigned_ip: '10.90.0.3/24', last_handshake: null, rx_bytes: 0, tx_bytes: 0, enabled: true },
  ]],
  [/\/api\/licence$/, { status: 'active', readOnly: false, licenceEnds: iso(30), daysLeft: 30, expiringSoon: false }],
  // The shape behind the Messaging crash: token/desc, not key/describes.
  [/\/api\/sms\/templates$/, {
    defaults: { reminder: 'Hi {name}, your internet expires {expires}.' },
    templates: {},
    placeholders: [
      { token: 'name', desc: 'Full name' },
      { token: 'account', desc: 'Account number they quote when paying' },
      { token: 'expires', desc: 'When their service runs out' },
    ],
  }],
  [/\/api\/sms\/placeholders$/, [{ token: 'name', desc: 'Full name' }]],
  [/\/api\/sms\/balance/, { credits: 1675, configured: true, provider: 'hostpinnacle' }],
  [/\/api\/sms\/gateways$/, { available: ['hostpinnacle', 'africastalking'], configured: [{ provider: 'hostpinnacle', enabled: true, priority: 1, credentialKeys: ['user', 'password'] }] }],
  [/\/api\/email\/gateway$/, { config: { host: 'smtp.example.com', port: 587, secure: true, username: 'u', from_name: 'Vibelink', from_email: 'no-reply@vibelink.co.ke', enabled: true }, fields: [{ key: 'host', label: 'Host' }, { key: 'password', label: 'Password', secret: true }] }],
  [/\/api\/automation\/runs$/, { since: '24 hours', total: 42, failures: 0, jobs: [{ job: 'watchdog', runs: 24, failures: 0, last_run: iso(0), avg_ms: 120 }] }],
  [/\/api\/automation\/recent$/, [
    { job: 'watchdog', ok: true, error: null, ms: 118, ran_at: iso(-0.001) },
    { job: 'expireAndSuspend', ok: false, error: 'connect ETIMEDOUT', ms: 20000, ran_at: iso(-0.01) },
  ]],
  [/\/api\/automation$/, [{ job: 'watchdog', label: 'Router watchdog', enabled: true, updated_at: iso(-1) }]],
  [/\/api\/fup-usage$/, [{ subscriberId: 'c1', name: 'Peter Kandie', policy: 'Fair use', windowPeriod: 'monthly', usedMb: 51200, capMb: 102400, pct: 50, throttled: false, warned: false, throttleDown: 1000 }]],
  // A bare array — the route is `res.json(rows)`. An object here reported a
  // crash in PlatformMonitor that only this file had caused.
  [/\/api\/platform\/overview$/, [{ id: 't1', subdomain: 'vibelink', name: 'Vibelink ISP', status: 'active', subscribers: 2, routers: 1, routers_up: 1, online: 1, down: 0, collected: 4500, router_last_seen: iso(0), licence_ends: iso(30) }]],
  [/\/api\/platform\/health$/, {
    hostUptimeSeconds: 86400,
    load: { one: 0.2, five: 0.3, fifteen: 0.25, cores: 2 },
    memory: { totalBytes: 4e9, freeBytes: 2e9, processBytes: 2e8 },
    disk: { totalBytes: 8e10, freeBytes: 4e10 },
    db: { ok: true, ms: 3, error: null },
    tunnels: 1,
    services: { openvpn: { ok: true, detail: 'status file 4s old' }, radius: { ok: true, detail: 'last request 20s ago' } },
  }],
  [/\/api\/payment-gateways$/, [{ id: 'g1', provider: 'daraja', label: 'Main paybill', shortcode: '4109865', is_default: true, enabled_pppoe: true, enabled_hotspot: true, last_callback_at: iso(-0.1), credentialKeys: ['consumer_key', 'consumer_secret'] }]],
  [/\/api\/payment-methods$/, [{ provider: 'daraja', enabled: true, shortcode: '4109865', is_default: true }]],
  [/\/api\/payments\/unmatched$/, [{ id: 'pay2', amount: 500, number: '0799999999', code: 'SLJ9ZZ1', received_at: iso(-0.2), status: 'unmatched' }]],
  [/\/api\/hotspot\/settings$/, { walled_garden: ['*.safaricom.co.ke'], hotspot_network: '10.5.50.0/24', multi_device: false, idle_timeout_min: 10, bind_mac: true, template: 'sleek', tv_mode: false, voucher_expiry: 'login' }],
  [/\/api\/settings$/, { org: { name: 'Vibelink ISP', support_phone: '0700111222', support_email: 'support@vibelink.co.ke' }, smtp: {}, prefs: { currency: 'KES' } }],
  // tunnels, rejected and stale — all three, because the screen reads all three.
  [/\/api\/routers\/tunnels$/, { tunnels: [{ address: '10.50.2.2', username: 'router-2-2', since: iso(-0.2), router: { id: 'r1', name: 'Main 1' } }], rejected: [], stale: [] }],
  [/\/api\/routers\/tunnel-info$/, { serverHost: 'vibelink.tech', detected: false, port: 1194, serverIp: '10.50.0.1', supernet: '10.50.0.0/16' }],
  [/\/api\/live-chats\/[^/]+\/messages/, { chat: { id: 'lc1', display_name: 'Guest', visitor_ref: 'v1', status: 'open', started_at: iso(-0.01) }, messages: [{ id: 'm1', sender: 'visitor', body: 'Hello?', created_at: iso(-0.005) }] }],
  [/\/api\/live-chats$/, COLLECTIONS.liveQueue],
  [/\/api\/subscribers\/[^/]+\/credentials$/, { pppoe_user: '44013', pppoe_pass: 'secret', portal_password_set: true }],
  [/\/api\/referrers\/[^/]+\/commissions$/, [
    { id: 'rc1', referrer_id: 'ref1', subscriber_id: 'c1', payment_id: 'pay1', basis_amount: 1500, amount: 150, status: 'owed', paid_at: null, created_at: iso(-5), subscriber_name: 'Peter Kandie', account_code: '44013' },
    { id: 'rc2', referrer_id: 'ref1', subscriber_id: 'c2', payment_id: 'pay2', basis_amount: 1500, amount: 150, status: 'paid', paid_at: iso(-2), created_at: iso(-8), subscriber_name: 'Mary W', account_code: '44014' },
  ]],
  [/\/api\/me$/, { id: 's1', name: 'Administrator', email: 'admin@example.com', role: 'owner' }],
];

// `$` alone misses `/api/staff?limit=50`, and a fixture that quietly misses
// is how a screen ends up tested against an empty list it never sees in
// production. Every collection pattern therefore ends at a query or the end.
const COLLECTION_ROUTES = [
  [/\/api\/subscribers$/, COLLECTIONS.clients],
  [/\/api\/routers$/, COLLECTIONS.routers],
  [/\/api\/plans/, COLLECTIONS.plans.concat(COLLECTIONS.hsPlans)],
  [/\/api\/tariffs$/, COLLECTIONS.tariffs],
  [/\/api\/invoices$/, COLLECTIONS.invoices],
  [/\/api\/payments$/, COLLECTIONS.mpesaTx],
  [/\/api\/vouchers$/, COLLECTIONS.vouchers],
  [/\/api\/tickets$/, COLLECTIONS.tickets],
  [/\/api\/leads$/, COLLECTIONS.leads],
  // Technicians and sales reps are the staff list filtered by role, so they are
  // matched before it — and the pattern allows the query string, which `$`
  // alone rejected. That silence is the failure mode this note exists to show:
  // both lists were answering [] and the screens looked merely empty.
  [/\/api\/staff\?role=technician/, COLLECTIONS.technicians],
  [/\/api\/staff\?role=sales/, COLLECTIONS.salesReps],
  [/\/api\/staff(\?|$)/, COLLECTIONS.staff],
  [/\/api\/outages$/, COLLECTIONS.outages],
  [/\/api\/sla-policies$/, COLLECTIONS.slaPolicies],
  [/\/api\/fup-policies$/, COLLECTIONS.fupPolicies],
  [/\/api\/kb-articles$/, COLLECTIONS.articles],
  [/\/api\/tenants$/, COLLECTIONS.tenants],
  [/\/api\/settlements$/, COLLECTIONS.settlements],
  [/\/api\/sms\/history$/, COLLECTIONS.smsHistory],
  [/\/api\/site-profiles$/, COLLECTIONS.siteProfiles],
  [/\/api\/technicians$/, COLLECTIONS.technicians],
  [/\/api\/sales-reps$/, COLLECTIONS.salesReps],
  [/\/api\/ovpn-clients$/, COLLECTIONS.ovpnClients],
  [/\/api\/ip-pools$/, COLLECTIONS.ipPools],
  [/\/api\/referrers$/, COLLECTIONS.referrers],
];

const unmatchedUrls = new Set();
globalThis.fetch = async (url) => {
  const u = String(url);
  const hit = [...ROUTES, ...COLLECTION_ROUTES].find(([re]) => re.test(u));
  if (!hit) unmatchedUrls.add(u);
  const body = hit ? hit[1] : [];
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
};

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { StoreProvider } = await import('../src/state/store.jsx');

/** Records what a screen threw instead of letting it take the run down. */
class Catcher extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { this.props.onError(error); }
  render() { return this.state.error ? null : this.props.children; }
}

const files = [];
const walk = (dir, prefix = '') => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
    else if (entry.name.endsWith('.jsx')) files.push(`${prefix}${entry.name}`);
  }
};
walk(screensDir);

// CustomerPortal runs before any staff session, against its own store and its
// own cookie. Rendering it inside the admin store tests a context it never has.
const SKIP = new Set(['CustomerPortal.jsx']);

const failures = [];
for (const file of files.sort()) {
  if (SKIP.has(file)) continue;
  const name = file.replace(/\.jsx$/, '');

  let Screen;
  try {
    Screen = (await import(pathToFileURL(path.join(screensDir, file)).href)).default;
  } catch (e) {
    failures.push([name, `import failed: ${e.message.split('\n')[0]}`]);
    continue;
  }
  if (typeof Screen !== 'function') continue;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const errors = [];
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(MemoryRouter, { initialEntries: ['/'] },
          React.createElement(StoreProvider, null,
            React.createElement(Catcher, { onError: (e) => errors.push(e) },
              React.createElement(Screen, { onRegister() {} })))));
    });
    // Let the mount fetches resolve and re-render with what came back — the
    // moment the Messaging bug happened, and the moment SSR could never reach.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  } catch (e) {
    errors.push(e);
  }

  const html = container.innerHTML;
  if (errors.length) failures.push([name, errors[0].message.split('\n')[0]]);
  else if (html.includes('[object Object]')) {
    failures.push([name, 'rendered "[object Object]" — an object used where text belongs']);
  }

  await act(async () => { root.unmount(); });
  container.remove();
}

const checked = files.filter((f) => !SKIP.has(f)).length;

if (unmatchedUrls.size) {
  // Not a failure: plenty of calls happen on a click rather than on mount. It
  // is worth printing so a screen quietly relying on an unfixtured endpoint is
  // visible rather than silently receiving [].
  console.log(`note: ${unmatchedUrls.size} endpoint(s) had no fixture and answered []:`);
  for (const u of [...unmatchedUrls].sort()) console.log(`  ${u}`);
  console.log('');
}

if (!failures.length) {
  console.log(`opened ${checked} screens with data and effects running — none broke`);
  process.exit(0);
}

console.log(`opened ${checked} screens, ${failures.length} broken:\n`);
for (const [name, why] of failures) console.log(`  ${name}\n    ${why}`);
process.exit(1);
