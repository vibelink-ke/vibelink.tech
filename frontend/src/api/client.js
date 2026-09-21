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
  if (!res.ok) {
    // The licence expired while the tab was open: tell the app so it can lock, rather
    // than waiting for the next sign-in to find out.
    if (res.status === 402 && parsed?.licenceExpired) window.dispatchEvent(new Event('vibelink:licence-expired'));
    throw new ApiError(res.status, parsed ?? text, path);
  }
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
  inviteInfo: (token) => get(`/api/auth/invite-info?token=${encodeURIComponent(token)}`),
  acceptInvite: (token, username, password) => post('/api/auth/accept-invite', { token, username, password }),
  requestMagicLink: (identifier) => post('/api/auth/magic-link', { identifier }),

  // ── subscribers ──
  subscribers: () => get('/api/subscribers'),
  createSubscriber: (s) => post('/api/subscribers', s),
  updateSubscriber: (id, patchBody) => patch(`/api/subscribers/${id}`, patchBody),
  adjustWallet: (id, body) => post(`/api/subscribers/${id}/wallet-adjustment`, body),
  deleteSubscriber: (id) => del(`/api/subscribers/${id}`),
  setSubscriberAccess: (id, action) => post(`/api/subscribers/${id}/access`, { action }),
  clearMacLock: (id) => post(`/api/subscribers/${id}/clear-mac-lock`, {}),
  stkPushSubscriber: (id, amount) => post(`/api/subscribers/${id}/stk`, amount ? { amount } : {}),
  newSubscriberCredentials: () => get('/api/subscribers/new-credentials'),
  generatePortalPassword: (id, password) => post(`/api/subscribers/${id}/portal-password`,
    password ? { password } : {}),
  subscriberCredentials: (id) => get(`/api/subscribers/${id}/credentials`),
  subscriberUsage: (id) => get(`/api/subscribers/${id}/usage`),
  subscriberLiveTraffic: (id) => get(`/api/subscribers/${id}/live-traffic`),
  subscriberActivity: (id) => get(`/api/subscribers/${id}/activity`),
  smsPlaceholders: () => get('/api/sms/placeholders'),
  smsTemplates: () => get('/api/sms/templates'),
  saveSmsTemplates: (templates) => put('/api/sms/templates', { templates }),
  changeAccountCode: (id, accountCode) => post(`/api/subscribers/${id}/account-code`, { accountCode }),
  compensateSubscribers: (ids, days) => post('/api/subscribers/compensate', { ids, days }),

  // ── money ──
  payments: () => get('/api/payments'),
  paymentsBySite: () => get('/api/payments/by-site'),
  hotspotRevenue: (period) => get(`/api/hotspot/revenue?period=${encodeURIComponent(period)}`),
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
  requestSettlementPayout: (amount) => post('/api/settlements/payout', amount != null ? { amount } : {}),
  cancelSettlement: (id) => post(`/api/settlements/${id}/cancel`, {}),
  inFlightSettlements: () => get('/api/platform/settlements/in-flight'),
  platformCancelSettlement: (id) => post(`/api/platform/settlements/${id}/cancel`, {}),
  platformMarkSettlementPaid: (id, receipt) => post(`/api/platform/settlements/${id}/mark-paid`, { receipt }),

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
  sendVoucherSms: (ids, phone) => post('/api/vouchers/send-sms', { ids, phone }),
  deleteVouchers: (ids) => post('/api/vouchers/delete', { ids }),
  compensateVouchers: (ids, hours) => post('/api/vouchers/compensate', { ids, hours }),
  purgeExpiredVouchers: () => post('/api/vouchers/purge-expired', {}),
  setAutoPurgeVouchers: (enabled) => patch('/api/hotspot/settings/auto-purge', { enabled }),

  // ── permanent hotspot access codes ("Lounge WiFi" etc.) ──
  hotspotAccessCodes: () => get('/api/hotspot/access-codes'),
  createAccessCode: (c) => post('/api/hotspot/access-codes', c),
  deleteAccessCode: (id) => del(`/api/hotspot/access-codes/${id}`),

  // ── hotspot ──
  hotspotSettings: () => get('/api/hotspot/settings'),
  saveHotspotSettings: (f) => put('/api/hotspot/settings', f),

  // ── payment channels ──
  paymentMethods: () => get('/api/payment-methods'),
  savePaymentMethod: (provider, cfg) => put(`/api/payment-methods/${provider}`, cfg),
  addPaymentMethod: (cfg) => post('/api/payment-methods', cfg),
  setDefaultPaymentMethod: (id) => post(`/api/payment-methods/${id}/default`, {}),
  deletePaymentMethod: (id) => del(`/api/payment-methods/${id}`),
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
  emailTemplates: () => get('/api/email/templates'),
  saveEmailTemplates: (templates) => put('/api/email/templates', { templates }),
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

  // ── expenses ──
  expenses: (status) => get(`/api/expenses${status ? `?status=${status}` : ''}`),
  createExpense: (e) => post('/api/expenses', e),
  updateExpense: (id, patchBody) => put(`/api/expenses/${id}`, patchBody),
  deleteExpense: (id) => del(`/api/expenses/${id}`),
  approveExpense: (id) => post(`/api/expenses/${id}/approve`, {}),
  markExpensePaid: (id) => post(`/api/expenses/${id}/mark-paid`, {}),
  uploadExpenseReceipt: (id, dataUrl) => put(`/api/expenses/${id}/receipt`, { dataUrl }),
  // ── suppliers and monthly bills ──
  suppliers: () => get('/api/suppliers'),
  createSupplier: (s) => post('/api/suppliers', s),
  updateSupplier: (id, s) => put(`/api/suppliers/${id}`, s),
  deleteSupplier: (id) => del(`/api/suppliers/${id}`),
  bills: () => get('/api/bills'),
  createBill: (b) => post('/api/bills', b),
  updateBill: (id, b) => put(`/api/bills/${id}`, b),
  deleteBill: (id) => del(`/api/bills/${id}`),
  profitLoss: (months) => get(`/api/reports/profit-loss?months=${months ?? 6}`),

  // ── HR & payroll ──
  hrProfiles: () => get('/api/hr/profiles'),
  saveHrProfile: (staffId, profile) => put(`/api/hr/profiles/${staffId}`, profile),
  newEmployeeNo: () => get('/api/hr/profiles/new-employee-no'),
  payrollRuns: () => get('/api/payroll/runs'),
  payrollRun: (id) => get(`/api/payroll/runs/${id}`),
  createPayrollRun: (r) => post('/api/payroll/runs', r),
  addPayrollItem: (runId, item) => post(`/api/payroll/runs/${runId}/items`, item),
  approvePayrollRun: (id) => post(`/api/payroll/runs/${id}/approve`, {}),
  disbursePayrollRun: (id, reference) => post(`/api/payroll/runs/${id}/disburse`, { reference }),

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
  updateSettlementMethod: (body) => patch('/api/settings/settlement-method', body),
  updateSettlementFrequency: (frequency) => patch('/api/settings/settlement-frequency', { frequency }),
  mpesaValidation: () => get('/api/settings/mpesa-validation'),
  setMpesaValidation: (enabled) => put('/api/settings/mpesa-validation', { enabled }),
  updateSettlementTime: (time) => patch('/api/settings/settlement-time', { time }),
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
  replaceInventoryItem: (id, body) => post(`/api/inventory/${id}/replace`, body),
  inventoryMovements: (id) => get(`/api/inventory/${id}/movements`),
  platformUpdates: () => get('/api/platform/updates'),
  createPlatformUpdate: (u) => post('/api/platform/updates', u),
  deletePlatformUpdate: (id) => del(`/api/platform/updates/${id}`),
  markUpdatesSeen: () => post('/api/updates/seen', {}),

  // ── automation ──
  automation: () => get('/api/automation'),
  automationRuns: () => get('/api/automation/runs'),
  usage24h: () => get('/api/usage/24h'),
  automationRecent: () => get('/api/automation/recent'),
  setAutomation: (job, enabled) => put(`/api/automation/${job}`, { enabled }),

  articles: () => get('/api/kb-articles'),
  createArticle: (a) => post('/api/kb-articles', a),
  updateArticle: (id, a) => put(`/api/kb-articles/${id}`, a),
  deleteArticle: (id) => del(`/api/kb-articles/${id}`),

  // ── network ──
  routers: () => get('/api/routers'),
  network: () => get('/api/network'),
  audit: (query) => get(`/api/audit?${query}`),
  issues: (days) => get(`/api/issues?days=${days ?? 14}`),
  smartoltStatus: () => get('/api/smartolt/status'),
  saveSmartoltConfig: (b) => put('/api/smartolt/config', b),
  deleteSmartoltConfig: () => del('/api/smartolt/config'),
  smartoltTest: (b) => post('/api/smartolt/test', b),
  smartoltSync: () => post('/api/smartolt/sync', {}),
  smartoltOverview: () => get('/api/smartolt/overview'),
  smartoltSummary: () => get('/api/smartolt/summary'),
  smartoltOnus: () => get('/api/smartolt/onus'),
  smartoltOnuFor: (id) => get(`/api/smartolt/onu-for/${id}`),
  smartoltOnuAction: (ext, action) => post(`/api/smartolt/onus/${encodeURIComponent(ext)}/action`, { action }),
  smartoltLinkOnu: (ext, subscriberId) => post(`/api/smartolt/onus/${encodeURIComponent(ext)}/link`, { subscriberId }),
  smartoltLinkSerial: (subscriberId, sn) => post('/api/smartolt/link-by-serial', { subscriberId, sn }),
  smartoltUnconfigured: () => get('/api/smartolt/unconfigured'),
  smartoltMatch: () => post('/api/smartolt/match', {}),
  smartoltLookup: (what) => get(`/api/smartolt/lookup/${what}`),
  smartoltAuthorize: (b) => post('/api/smartolt/authorize', b),
  smartoltMap: () => get('/api/smartolt/map'),
  mapConfig: () => get('/api/map-config'),
  createNetNode: (b) => post('/api/network/nodes', b),
  updateNetNode: (id, b) => patch(`/api/network/nodes/${id}`, b),
  deleteNetNode: (id) => del(`/api/network/nodes/${id}`),
  createNetLink: (b) => post('/api/network/links', b),
  updateNetLink: (id, b) => patch(`/api/network/links/${id}`, b),
  deleteNetLink: (id) => del(`/api/network/links/${id}`),
  createRouter: (r) => post('/api/routers', r),
  ovpnScript: (opts = {}) => post('/api/routers/ovpn-script', opts),
  vpnAccessList: () => get('/api/routers/vpn-access'),
  vpnAccessCreate: (opts = {}) => post('/api/routers/vpn-access', opts),
  vpnAccessRevoke: (id) => del(`/api/routers/vpn-access/${id}`),
  wgPeer: (opts = {}) => post('/api/routers/wg-peer', opts),
  failoverScript: (opts = {}) => post('/api/routers/failover-script', opts),
  reonboardTunnel: (routerId) => post(`/api/routers/${routerId}/reonboard-tunnel`, {}),
  wgPeers: () => get('/api/routers/wg-peers'),
  deleteWgPeer: (id) => del(`/api/routers/wg-peers/${id}`),
  tunnelInfo: () => get('/api/routers/tunnel-info'),
  licence: () => get('/api/licence'),
  billing: () => get('/api/billing'),
  billingPay: (body) => post('/api/billing/pay', body),
  billingPayStatus: (checkoutId) => get(`/api/billing/pay/${checkoutId}`),
  tenantLicence: (id, days) => post(`/api/tenants/${id}/licence`, { days }),
  tenantActivate: (id, days) => post(`/api/tenants/${id}/activate`, { days }),
  tenantInstanceKey: (id) => post(`/api/tenants/${id}/instance-key`, {}),
  updateRouter: (id, r) => put(`/api/routers/${id}`, r),
  detectRouterUpstream: (id) => post(`/api/routers/${id}/detect-upstream`, {}),
  autoconfigRouter: (id, opts = {}) => post(`/api/routers/${id}/autoconfig`, opts),
  routerInterfaces: (id, creds = {}) => post(`/api/routers/${id}/interfaces`, creds),
  radiusCheck: (id) => post(`/api/routers/${id}/radius-check`, {}),
  hotspotCheck: (id) => post(`/api/routers/${id}/hotspot-check`, {}),
  routerCleanupPreview: (id) => post(`/api/routers/${id}/cleanup-preview`, {}),
  routerCleanupApply: (id, keys) => post(`/api/routers/${id}/cleanup-apply`, { keys }),
  pushHotspot: (id, opts = {}) => post(`/api/routers/${id}/hotspot`, opts),
  routerTunnels: () => get('/api/routers/tunnels'),
  routerTraffic: (id) => post(`/api/routers/${id}/traffic`, {}),
  routerPing: (id) => post(`/api/routers/${id}/ping`, {}),
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
  updateStaff: (id, s) => put(`/api/staff/${id}`, s),
  resetStaffPassword: (id) => post(`/api/staff/${id}/password`, {}),
  staffIdCard: (id) => get(`/api/staff/${id}/id-card`),
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
  platformUpstreamBreakdown: () => get('/api/platform/upstream-breakdown'),
  platformHealth: () => get('/api/platform/health'),
  restartApi: () => post('/api/platform/restart', {}),
  platformSmsGateways: () => get('/api/platform/sms-gateways'),
  createPlatformSmsGateway: (body) => post('/api/platform/sms-gateways', body),
  savePlatformSmsGateway: (id, body) => put(`/api/platform/sms-gateways/${id}`, body),
  deletePlatformSmsGateway: (id) => del(`/api/platform/sms-gateways/${id}`),
  platformSmsGatewayBalance: (id, force) => get(`/api/platform/sms-gateways/${id}/balance${force ? '?force=1' : ''}`),
  setTenantSmsGateway: (id, gatewayId) => put(`/api/tenants/${id}/sms-gateway`, { gatewayId }),
  setRelaySourceSmsGateway: (source, gatewayId) => put(`/api/platform/sms-relay-sources/${source}`, { gatewayId }),
  setTenantSmsBalance: (id, body) => post(`/api/tenants/${id}/sms-balance`, body),
  createTenant: (t) => post('/api/tenants', t),
  updateTenant: (id, patchBody) => patch(`/api/tenants/${id}`, patchBody),
  tenantDeleteCheck: (id) => get(`/api/tenants/${id}/delete-check`),
  setAllRates: (body) => post('/api/tenants/bulk-rate', body),
  removeTenant: (id) => post(`/api/tenants/${id}/remove`, {}),
  restoreTenant: (id) => post(`/api/tenants/${id}/restore`, {}),
  purgeTenant: (id, body) => post(`/api/tenants/${id}/purge`, body),
  // what tenants owe the platform each month
  platformCharges: (month) => get(`/api/platform/charges${month ? `?month=${month}` : ''}`),
  generateCharges: (month) => post('/api/platform/charges/generate', { month }),
  setChargeStatus: (id, status) => post(`/api/platform/charges/${id}/status`, { status }),
  tenantStaff: (id) => get(`/api/tenants/${id}/staff`),
  resetTenantStaffLogin: (id, staffId, body) => post(`/api/tenants/${id}/staff/${staffId}`, body),
  refreshPresence: () => post('/api/presence/refresh', {}),
  heartbeat: () => post('/api/presence/heartbeat', {}),
};
