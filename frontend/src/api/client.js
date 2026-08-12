/**
 * HTTP client for the Express backend in ../../backend.
 *
 * Every call below maps to a route that exists in backend/src/server.js.
 */

const BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(status, body, url) {
    super(typeof body === 'object' && body?.error ? body.error : `${status} on ${url}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, parsed ?? text, path);
  return parsed;
}

const safeJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const put = (p, b) => request('PUT', p, b);
const patch = (p, b) => request('PATCH', p, b);
const del = (p) => request('DELETE', p);

export const api = {
  // ── auth ──
  // The session lives in an httpOnly cookie; nothing sensitive is returned here.
  session: () => get('/api/auth/session'),
  login: (creds) => post('/api/auth/login', creds),
  signup: (form) => post('/api/auth/signup', form),
  logout: () => post('/api/auth/logout', {}),

  // ── subscribers ──
  subscribers: () => get('/api/subscribers'),
  createSubscriber: (s) => post('/api/subscribers', s),
  updateSubscriber: (id, patchBody) => patch(`/api/subscribers/${id}`, patchBody),
  deleteSubscriber: (id) => del(`/api/subscribers/${id}`),
  compensateSubscribers: (ids, days) => post('/api/subscribers/compensate', { ids, days }),

  // ── money ──
  payments: () => get('/api/payments'),
  unmatchedPayments: () => get('/api/payments/unmatched'),
  matchPayment: (id, subscriberId) => post(`/api/payments/${id}/match`, { subscriberId }),
  invoices: () => get('/api/invoices'),
  createInvoice: (i) => post('/api/invoices', i),
  recordPayment: (p) => post('/api/payments/manual', p),
  pushStk: (p) => post('/api/payments/stk', p),
  stkStatus: (checkoutId) => get(`/api/payments/stk/${checkoutId}`),
  reconcileStatement: (text) => post('/api/payments/reconcile', { text }),
  settlements: () => get('/api/settlements'),

  // ── catalogue ──
  tariffs: () => get('/api/tariffs'),
  createTariff: (t) => post('/api/tariffs', t),
  updateTariff: (id, t) => put(`/api/tariffs/${id}`, t),
  deleteTariff: (id) => del(`/api/tariffs/${id}`),
  plans: (service) => get(`/api/plans${service ? `?service=${service}` : ''}`),
  hotspotPlans: () => get('/api/plans?service=hotspot'),
  createPlan: (p) => post('/api/plans', p),
  deletePlan: (id) => del(`/api/plans/${id}`),
  portalPlans: () => get('/portal/plans'),

  // ── vouchers ──
  vouchers: () => get('/api/vouchers'),
  createVouchers: (v) => post('/api/vouchers', v),
  deleteVouchers: (ids) => post('/api/vouchers/delete', { ids }),
  purgeExpiredVouchers: () => post('/api/vouchers/purge-expired', {}),

  // ── hotspot ──
  hotspotSettings: () => get('/api/hotspot/settings'),
  saveHotspotSettings: (f) => put('/api/hotspot/settings', f),

  // ── payment channels ──
  paymentMethods: () => get('/api/payment-methods'),
  savePaymentMethod: (provider, cfg) => put(`/api/payment-methods/${provider}`, cfg),
  testPaymentMethod: (provider) => post(`/api/payment-methods/${provider}/test`, {}),

  // ── SMS ──
  smsGateways: () => get('/api/sms/gateways'),
  saveSmsGateway: (provider, cfg) => put(`/api/sms/gateways/${provider}`, cfg),
  deleteSmsGateway: (provider) => del(`/api/sms/gateways/${provider}`),
  smsBalance: (force) => get(`/api/sms/balance${force ? '?force=1' : ''}`),
  sendTestSms: (phone) => post('/api/sms/test', { phone }),
  smsHistory: () => get('/api/sms/history'),
  sendBulkSms: (payload) => post('/api/sms/bulk', payload),
  sendSms: (phone, body) => post('/api/sms/send', { phone, body }),

  // ── support ──
  tickets: () => get('/api/tickets'),
  createTicket: (t) => post('/api/tickets', t),
  ticket: (id) => get(`/api/tickets/${id}`),
  updateTicket: (id, patchBody) => patch(`/api/tickets/${id}`, patchBody),
  addTicketNote: (id, body, internal = true) => post(`/api/tickets/${id}/notes`, { body, internal }),
  deleteTicket: (id) => del(`/api/tickets/${id}`),

  leads: () => get('/api/leads'),
  createLead: (l) => post('/api/leads', l),
  updateLead: (id, patchBody) => patch(`/api/leads/${id}`, patchBody),

  messages: (subscriberId) => get(`/api/messages/${subscriberId}`),
  sendMessage: (m) => post('/api/messages', m),

  liveChats: () => get('/api/live-chats'),
  acceptChat: (id, staffId) => post(`/api/live-chats/${id}/accept`, { staffId }),

  outages: () => get('/api/outages'),
  createOutage: (o) => post('/api/outages', o),
  resolveOutage: (id) => patch(`/api/outages/${id}`, { status: 'resolved' }),

  slaPolicies: () => get('/api/sla-policies'),
  createSlaPolicy: (p) => post('/api/sla-policies', p),
  updateSlaPolicy: (id, p) => put(`/api/sla-policies/${id}`, p),
  deleteSlaPolicy: (id) => del(`/api/sla-policies/${id}`),

  // ── fair use ──
  fupPolicies: () => get('/api/fup-policies'),
  createFupPolicy: (p) => post('/api/fup-policies', p),
  updateFupPolicy: (id, p) => put(`/api/fup-policies/${id}`, p),
  deleteFupPolicy: (id) => del(`/api/fup-policies/${id}`),
  fupUsage: () => get('/api/fup-usage'),
  runFupEnforcement: () => post('/api/fup-enforce', {}),
  restoreFupSpeed: (subscriberId) => post(`/api/fup-usage/${subscriberId}/restore`, {}),

  // ── payment gateways (several per provider) ──
  paymentGateways: () => get('/api/payment-gateways'),
  createGateway: (g) => post('/api/payment-gateways', g),
  updateGateway: (id, g) => put(`/api/payment-gateways/${id}`, g),
  makeGatewayDefault: (id) => post(`/api/payment-gateways/${id}/default`, {}),
  deleteGateway: (id) => del(`/api/payment-gateways/${id}`),

  // ── automation ──
  automation: () => get('/api/automation'),
  setAutomation: (job, enabled) => put(`/api/automation/${job}`, { enabled }),

  articles: () => get('/api/kb-articles'),
  createArticle: (a) => post('/api/kb-articles', a),
  deleteArticle: (id) => del(`/api/kb-articles/${id}`),

  // ── network ──
  routers: () => get('/api/routers'),
  createRouter: (r) => post('/api/routers', r),
  ovpnScript: () => post('/api/routers/ovpn-script', {}),
  testCoa: (id) => post(`/api/routers/${id}/test-coa`, {}),
  ovpnClients: () => get('/api/ovpn-clients'),
  ipPools: () => get('/api/ip-pools'),
  createIpPool: (p) => post('/api/ip-pools', p),

  // ── org ──
  staff: () => get('/api/staff'),
  createStaff: (s) => post('/api/staff', s),
  deleteStaff: (id) => del(`/api/staff/${id}`),
  technicians: () => get('/api/staff?role=technician'),
  salesReps: () => get('/api/staff?role=sales'),

  siteProfiles: () => get('/api/site-profiles'),
  createSiteProfile: (p) => post('/api/site-profiles', p),
  deleteSiteProfile: (id) => del(`/api/site-profiles/${id}`),

  settings: () => get('/api/settings'),
  saveSettings: (s) => put('/api/settings', s),

  // ── platform owner ──
  tenants: () => get('/api/tenants'),
  createTenant: (t) => post('/api/tenants', t),
  updateTenant: (id, patchBody) => patch(`/api/tenants/${id}`, patchBody),
  deleteTenant: (id) => del(`/api/tenants/${id}`),
};
