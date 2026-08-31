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
  // Public, no session needed — just enough to brand the sign-in screen
  // itself, before there's anyone signed in to know a tenant from.
  publicBrand: () => get('/api/public/brand'),
  login: (creds) => post('/api/auth/login', creds),
  signup: (form) => post('/api/auth/signup', form),
  logout: () => post('/api/auth/logout', {}),
  forgotPassword: (identifier) => post('/api/auth/forgot', { identifier }),
  resetPassword: (token, password) => post('/api/auth/reset', { token, password }),
  requestMagicLink: (identifier) => post('/api/auth/magic-link', { identifier }),

  // ── subscribers ──
  subscribers: () => get('/api/subscribers'),
  createSubscriber: (s) => post('/api/subscribers', s),
  updateSubscriber: (id, patchBody) => patch(`/api/subscribers/${id}`, patchBody),
  deleteSubscriber: (id) => del(`/api/subscribers/${id}`),
  setSubscriberAccess: (id, action) => post(`/api/subscribers/${id}/access`, { action }),
  clearMacLock: (id) => post(`/api/subscribers/${id}/clear-mac-lock`, {}),
  stkPushSubscriber: (id, amount) => post(`/api/subscribers/${id}/stk`, amount ? { amount } : {}),
  newSubscriberCredentials: () => get('/api/subscribers/new-credentials'),
  generatePortalPassword: (id, password) => post(`/api/subscribers/${id}/portal-password`,
    password ? { password } : {}),
  subscriberCredentials: (id) => get(`/api/subscribers/${id}/credentials`),
  subscriberUsage: (id) => get(`/api/subscribers/${id}/usage`),
  subscriberActivity: (id) => get(`/api/subscribers/${id}/activity`),
  smsPlaceholders: () => get('/api/sms/placeholders'),
  smsTemplates: () => get('/api/sms/templates'),
  saveSmsTemplates: (templates) => put('/api/sms/templates', { templates }),
  compensateSubscribers: (ids, days) => post('/api/subscribers/compensate', { ids, days }),

  // ── money ──
  payments: () => get('/api/payments'),
  paymentsBySite: () => get('/api/payments/by-site'),
  unmatchedPayments: () => get('/api/payments/unmatched'),
  matchPayment: (id, subscriberId) => post(`/api/payments/${id}/match`, { subscriberId }),
  invoices: () => get('/api/invoices'),
  createInvoice: (i) => post('/api/invoices', i),
  updateInvoice: (id, i) => put(`/api/invoices/${id}`, i),
  deleteInvoice: (id) => del(`/api/invoices/${id}`),
  recordPayment: (p) => post('/api/payments/manual', p),
  pushStk: (p) => post('/api/payments/stk', p),
  stkStatus: (checkoutId) => get(`/api/payments/stk/${checkoutId}`),
  reconcileStatement: (text) => post('/api/payments/reconcile', { text }),
  settlements: () => get('/api/settlements'),
  requestSettlementPayout: () => post('/api/settlements/payout', {}),

  // ── catalogue ──
  tariffs: () => get('/api/tariffs'),
  createTariff: (t) => post('/api/tariffs', t),
  updateTariff: (id, t) => put(`/api/tariffs/${id}`, t),
  deleteTariff: (id) => del(`/api/tariffs/${id}`),
  plans: (service) => get(`/api/plans${service ? `?service=${service}` : ''}`),
  hotspotPlans: () => get('/api/plans?service=hotspot'),
  createPlan: (p) => post('/api/plans', p),
  updatePlan: (id, p) => put(`/api/plans/${id}`, p),
  deletePlan: (id) => del(`/api/plans/${id}`),
  portalPlans: () => get('/portal/plans'),

  // ── vouchers ──
  vouchers: () => get('/api/vouchers'),
  createVouchers: (v) => post('/api/vouchers', v),
  deleteVouchers: (ids) => post('/api/vouchers/delete', { ids }),
  purgeExpiredVouchers: () => post('/api/vouchers/purge-expired', {}),
  setAutoPurgeVouchers: (enabled) => patch('/api/hotspot/settings/auto-purge', { enabled }),

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
  vapidPublicKey: () => get('/api/push/vapid-public-key'),
  pushSubscribe: (subscription) => post('/api/push/subscribe', { subscription }),
  pushUnsubscribe: (endpoint) => post('/api/push/unsubscribe', { endpoint }),
  deleteSmsGateway: (provider) => del(`/api/sms/gateways/${provider}`),
  smsBalance: (force) => get(`/api/sms/balance${force ? '?force=1' : ''}`),
  sendTestSms: (phone) => post('/api/sms/test', { phone }),
  smsHistory: () => get('/api/sms/history'),
  sendBulkSms: (payload) => post('/api/sms/bulk', payload),
  sendSms: (phone, body) => post('/api/sms/send', { phone, body }),
  buySmsCredits: (quantity, phone) => post('/api/sms/buy-credits', { quantity, phone }),
  buySmsCreditsStatus: (checkoutId) => get(`/api/sms/buy-credits/${checkoutId}`),

  // ── email gateway ──
  emailGateway: () => get('/api/email/gateway'),
  saveEmailGateway: (cfg) => put('/api/email/gateway', cfg),
  deleteEmailGateway: () => del('/api/email/gateway'),
  sendTestEmail: (to) => post('/api/email/test', { to }),
  emailHistory: () => get('/api/email/history'),

  // ── support ──
  tickets: () => get('/api/tickets'),
  createTicket: (t) => post('/api/tickets', t),
  ticket: (id) => get(`/api/tickets/${id}`),
  updateTicket: (id, patchBody) => patch(`/api/tickets/${id}`, patchBody),
  approvePlanChange: (id) => post(`/api/tickets/${id}/approve-plan-change`, {}),
  addTicketNote: (id, body, internal = true) => post(`/api/tickets/${id}/notes`, { body, internal }),
  deleteTicket: (id) => del(`/api/tickets/${id}`),

  leads: () => get('/api/leads'),
  createLead: (l) => post('/api/leads', l),
  updateLead: (id, patchBody) => patch(`/api/leads/${id}`, patchBody),
  deleteLead: (id) => del(`/api/leads/${id}`),
  leadNotes: (id) => get(`/api/leads/${id}/notes`),
  addLeadNote: (id, body) => post(`/api/leads/${id}/notes`, { body }),

  referrers: () => get('/api/referrers'),
  createReferrer: (r) => post('/api/referrers', r),
  updateReferrer: (id, patchBody) => put(`/api/referrers/${id}`, patchBody),
  deleteReferrer: (id) => del(`/api/referrers/${id}`),
  referrerCommissions: (id) => get(`/api/referrers/${id}/commissions`),
  markCommissionPaid: (id) => post(`/api/referral-commissions/${id}/mark-paid`, {}),

  messages: (subscriberId) => get(`/api/messages/${subscriberId}`),
  sendMessage: (m) => post('/api/messages', m),

  liveChats: () => get('/api/live-chats'),
  acceptChat: (id, staffId) => post(`/api/live-chats/${id}/accept`, { staffId }),
  chatMessages: (id, since = 0) => get(`/api/live-chats/${id}/messages?since=${since}`),
  sendChatReply: (id, body) => post(`/api/live-chats/${id}/messages`, { body }),
  closeChat: (id) => post(`/api/live-chats/${id}/close`, {}),

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
  mrrAnalytics: () => get('/api/analytics/mrr'),
  runFupEnforcement: () => post('/api/fup-enforce', {}),
  restoreFupSpeed: (subscriberId) => post(`/api/fup-usage/${subscriberId}/restore`, {}),

  // ── payment gateways (several per provider) ──
  paymentGateways: () => get('/api/payment-gateways'),
  createGateway: (g) => post('/api/payment-gateways', g),
  updateGateway: (id, g) => put(`/api/payment-gateways/${id}`, g),
  makeGatewayDefault: (id) => post(`/api/payment-gateways/${id}/default`, {}),
  setGatewayPlatformCollect: (id, on) => post(`/api/payment-gateways/${id}/platform-collect`, { on }),
  getB2cFeeTiers: () => get('/api/platform/b2c-fee-tiers'),
  saveB2cFeeTiers: (tiers) => put('/api/platform/b2c-fee-tiers', { tiers }),
  gatewayCredentials: (id) => get(`/api/payment-gateways/${id}/credentials`),
  registerGatewayUrls: (id) => post(`/api/payment-gateways/${id}/register-urls`, {}),
  deleteGateway: (id) => del(`/api/payment-gateways/${id}`),
  inventory: () => get('/api/inventory'),
  createInventoryItem: (i) => post('/api/inventory', i),
  updateInventoryItem: (id, i) => put(`/api/inventory/${id}`, i),
  deleteInventoryItem: (id) => del(`/api/inventory/${id}`),
  adjustInventoryQuantity: (id, delta) => post(`/api/inventory/${id}/adjust-quantity`, { delta }),
  issueInventoryItem: (id, body) => post(`/api/inventory/${id}/issue`, body),
  returnInventoryItem: (id, note) => post(`/api/inventory/${id}/return`, { note }),
  inventoryMovements: (id) => get(`/api/inventory/${id}/movements`),
  platformUpdates: () => get('/api/platform/updates'),
  createPlatformUpdate: (u) => post('/api/platform/updates', u),
  deletePlatformUpdate: (id) => del(`/api/platform/updates/${id}`),
  markUpdatesSeen: () => post('/api/updates/seen', {}),

  // ── automation ──
  automation: () => get('/api/automation'),
  automationRuns: () => get('/api/automation/runs'),
  automationRecent: () => get('/api/automation/recent'),
  setAutomation: (job, enabled) => put(`/api/automation/${job}`, { enabled }),

  articles: () => get('/api/kb-articles'),
  createArticle: (a) => post('/api/kb-articles', a),
  updateArticle: (id, a) => put(`/api/kb-articles/${id}`, a),
  deleteArticle: (id) => del(`/api/kb-articles/${id}`),

  // ── network ──
  routers: () => get('/api/routers'),
  createRouter: (r) => post('/api/routers', r),
  ovpnScript: (opts = {}) => post('/api/routers/ovpn-script', opts),
  vpnAccessList: () => get('/api/routers/vpn-access'),
  vpnAccessCreate: (opts = {}) => post('/api/routers/vpn-access', opts),
  vpnAccessRevoke: (id) => del(`/api/routers/vpn-access/${id}`),
  wgPeer: (opts = {}) => post('/api/routers/wg-peer', opts),
  failoverScript: (opts = {}) => post('/api/routers/failover-script', opts),
  wgPeers: () => get('/api/routers/wg-peers'),
  deleteWgPeer: (id) => del(`/api/routers/wg-peers/${id}`),
  tunnelInfo: () => get('/api/routers/tunnel-info'),
  licence: () => get('/api/licence'),
  updateRouter: (id, r) => put(`/api/routers/${id}`, r),
  autoconfigRouter: (id, opts = {}) => post(`/api/routers/${id}/autoconfig`, opts),
  routerInterfaces: (id, creds = {}) => post(`/api/routers/${id}/interfaces`, creds),
  radiusCheck: (id) => post(`/api/routers/${id}/radius-check`, {}),
  hotspotCheck: (id) => post(`/api/routers/${id}/hotspot-check`, {}),
  pushHotspot: (id, opts = {}) => post(`/api/routers/${id}/hotspot`, opts),
  routerTunnels: () => get('/api/routers/tunnels'),
  routerTraffic: (id) => post(`/api/routers/${id}/traffic`, {}),
  routerDevices: (id) => get(`/api/routers/${id}/devices`),
  lockRouterDevice: (id, body) => post(`/api/routers/${id}/devices/lock`, body),
  unlockRouterDevice: (id, mac) => post(`/api/routers/${id}/devices/unlock`, { mac }),
  previewSecrets: (id) => post(`/api/routers/${id}/import-secrets`, {}),
  importSecrets: (id) => post(`/api/routers/${id}/import-secrets`, { apply: true }),
  revokeOvpnClient: (id) => del(`/api/ovpn-clients/${id}`),
  deleteRouter: (id, force = false) => del(`/api/routers/${id}${force ? '?force=1' : ''}`),
  testCoa: (id) => post(`/api/routers/${id}/test-coa`, {}),
  ovpnClients: () => get('/api/ovpn-clients'),
  ipPools: () => get('/api/ip-pools'),
  routerFreeIps: (id, limit = 300) => get(`/api/routers/${id}/free-ips?limit=${limit}`),
  createIpPool: (p) => post('/api/ip-pools', p),
  updateIpPool: (id, p) => put(`/api/ip-pools/${id}`, p),
  deleteIpPool: (id) => del(`/api/ip-pools/${id}`),
  ipPoolUsage: (id) => get(`/api/ip-pools/${id}/usage`),

  // ── org ──
  staff: () => get('/api/staff'),
  createStaff: (s) => post('/api/staff', s),
  permissions: () => get('/api/permissions'),
  savePermissions: (matrix) => put('/api/permissions', { matrix }),
  deleteStaff: (id) => del(`/api/staff/${id}`),
  technicians: () => get('/api/staff?role=technician'),
  salesReps: () => get('/api/staff?role=sales'),
  salesPerformance: () => get('/api/leads/sales-performance'),

  siteProfiles: () => get('/api/site-profiles'),
  createSiteProfile: (p) => post('/api/site-profiles', p),
  deleteSiteProfile: (id) => del(`/api/site-profiles/${id}`),

  settings: () => get('/api/settings'),
  updateMe: (me) => patch('/api/me', me),
  changePassword: (current, next) => post('/api/me/password', { current, next }),
  saveSettings: (s) => put('/api/settings', s),
  saveFavicon: (dataUrl) => put('/api/settings/favicon', { dataUrl }),
  deleteFavicon: () => del('/api/settings/favicon'),

  // ── platform owner ──
  tenants: () => get('/api/tenants'),
  platformOverview: () => get('/api/platform/overview'),
  platformHealth: () => get('/api/platform/health'),
  restartApi: () => post('/api/platform/restart', {}),
  platformSmsConfig: () => get('/api/platform/sms-config'),
  platformSmsBalance: (force) => get(`/api/platform/sms-balance${force ? '?force=1' : ''}`),
  savePlatformSmsConfig: (cfg) => put('/api/platform/sms-config', cfg),
  setTenantSmsBalance: (id, body) => post(`/api/tenants/${id}/sms-balance`, body),
  createTenant: (t) => post('/api/tenants', t),
  updateTenant: (id, patchBody) => patch(`/api/tenants/${id}`, patchBody),
  deleteTenant: (id) => del(`/api/tenants/${id}`),
  tenantStaff: (id) => get(`/api/tenants/${id}/staff`),
  resetTenantStaffLogin: (id, staffId, body) => post(`/api/tenants/${id}/staff/${staffId}`, body),
  refreshPresence: () => post('/api/presence/refresh', {}),
  heartbeat: () => post('/api/presence/heartbeat', {}),
};
