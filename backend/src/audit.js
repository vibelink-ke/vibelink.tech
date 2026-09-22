import { pool, tenantByHost } from './db.js';

/**
 * The audit log: who did what, and when.
 *
 * Every change made through the API by a signed-in person is written down, with the sign-ins (and failed
 * sign-ins) beside it — one middleware for the lot rather than a call at every route, so a new feature is
 * covered without anyone remembering to add it. Reads are not logged. What is kept per entry: who (name and
 * role), which ISP, what (a plain-English label), the result (the HTTP status: below 400 worked), the address
 * it came from, and a trimmed copy of what was sent and what came back — with anything that looks like a
 * password, key, token or secret masked before it is stored.
 *
 * Failing to write an entry must never fail the action itself, so errors here are only logged.
 */

// Not actions: heartbeats and polling, and the log's own screens.
const SKIP = [/^\/api\/presence\//, /^\/api\/auth\/session/, /^\/api\/auth\/logout/, /^\/api\/live-chats/, /^\/api\/chat/, /^\/api\/audit/, /^\/api\/issues/];
const REDACT = /pass|secret|token|key|credential|pin$|otp|authorization|cookie/i;

/** [method, path pattern, what to call it] — first match wins; anything else gets a generic label. */
const LABELS = [
  ['POST', /^\/api\/auth\/login$/, 'Sign-in'],
  ['POST', /^\/api\/subscribers$/, 'Client added'],
  ['PATCH', /^\/api\/subscribers\/[^/]+$/, 'Client edited'],
  ['DELETE', /^\/api\/subscribers\/[^/]+$/, 'Client deleted'],
  ['POST', /^\/api\/subscribers\/[^/]+\/wallet-adjustment$/, 'Wallet adjusted'],
  ['POST', /^\/api\/subscribers\/[^/]+\/account-code$/, 'Account number changed'],
  ['POST', /^\/api\/subscribers\/compensate$/, 'Clients given free days'],
  ['POST', /^\/api\/subscribers\/[^/]+\/stk$/, 'M-Pesa prompt sent to a client'],
  ['POST', /^\/api\/vouchers$/, 'Vouchers generated'],
  ['POST', /^\/api\/vouchers\/delete$/, 'Vouchers deleted'],
  ['PUT', /^\/api\/loyalty\/settings$/, 'Loyalty rules changed'],
  ['POST', /^\/api\/loyalty\/rewards$/, 'Loyalty reward added'],
  ['DELETE', /^\/api\/loyalty\/rewards\//, 'Loyalty reward removed'],
  ['POST', /^\/api\/loyalty\/redeem$/, 'Loyalty points redeemed'],
  ['POST', /^\/api\/loyalty\/adjust$/, 'Loyalty points adjusted'],
  ['POST', /^\/api\/vouchers\/compensate$/, 'Vouchers given extra time'],
  ['POST', /^\/api\/vouchers\/purge-expired$/, 'Expired vouchers purged'],
  ['POST', /^\/api\/staff$/, 'Staff added'],
  ['PUT', /^\/api\/staff\/[^/]+$/, 'Staff edited'],
  ['POST', /^\/api\/staff\/[^/]+\/password$/, 'Staff password reset'],
  ['DELETE', /^\/api\/staff\/[^/]+$/, 'Staff removed'],
  ['PUT', /^\/api\/permissions$/, 'Roles and permissions changed'],
  ['POST', /^\/api\/payments\/[^/]+\/match$/, 'Unmatched payment matched to a client'],
  ['POST', /^\/api\/payments\/manual$/, 'Payment recorded by hand'],
  ['POST', /^\/api\/payments\/stk$/, 'M-Pesa prompt sent'],
  ['POST', /^\/api\/payments\/reconcile$/, 'Statement reconciled'],
  ['POST', /^\/api\/settlements\/payout$/, 'Payout requested'],
  ['POST', /^\/api\/settlements\/[^/]+\/cancel$/, 'Payout cancelled'],
  ['PATCH', /^\/api\/settings\/settlement-/, 'Payout settings changed'],
  ['PUT', /^\/api\/settings\/mpesa-validation$/, 'M-Pesa validation switched'],
  ['POST', /^\/api\/routers$/, 'Router added'],
  ['PUT', /^\/api\/routers\/[^/]+$/, 'Router edited'],
  ['DELETE', /^\/api\/routers\/[^/]+$/, 'Router deleted'],
  ['POST', /^\/api\/routers\/[^/]+\/autoconfig$/, 'Router configured'],
  ['POST', /^\/api\/routers\/[^/]+\/cleanup-apply$/, 'Old router rules cleaned up'],
  ['POST', /^\/api\/plans$/, 'Package added'],
  ['PUT', /^\/api\/plans\/[^/]+$/, 'Package edited'],
  ['DELETE', /^\/api\/plans\/[^/]+$/, 'Package deleted'],
  ['POST', /^\/api\/invoices$/, 'Invoice created'],
  ['DELETE', /^\/api\/invoices\/[^/]+$/, 'Invoice deleted'],
  ['POST', /^\/api\/expenses\/[^/]+\/approve$/, 'Expense approved'],
  ['POST', /^\/api\/expenses\/[^/]+\/mark-paid$/, 'Expense marked paid'],
  ['POST', /^\/api\/payroll\/runs\/[^/]+\/approve$/, 'Payroll approved'],
  ['POST', /^\/api\/payroll\/runs\/[^/]+\/disburse$/, 'Payroll paid out'],
  ['PATCH', /^\/api\/payroll\/runs\/[^/]+\/items\/[^/]+$/, 'Payroll line edited'],
  ['DELETE', /^\/api\/payroll\/runs\/[^/]+\/items\/[^/]+$/, 'Payroll line deleted'],
  ['PATCH', /^\/api\/payroll\/runs\/[^/]+$/, 'Payroll run period changed'],
  ['DELETE', /^\/api\/payroll\/runs\/[^/]+$/, 'Payroll run deleted'],
  ['POST', /^\/api\/sms\/bulk$/, 'Bulk SMS sent'],
  ['POST', /^\/api\/sms\/send$/, 'SMS sent'],
  ['PUT', /^\/api\/sms\/gateways\//, 'SMS gateway changed'],
  ['POST', /^\/api\/smartolt\/onus\/[^/]+\/action$/, 'ONU action (reboot / enable / disable)'],
  ['POST', /^\/api\/smartolt\/authorize$/, 'ONU authorised'],
  ['POST', /^\/api\/smartolt\/match$/, 'ONUs matched to clients'],
  ['PUT', /^\/api\/smartolt\/config$/, 'SmartOLT connection changed'],
  ['DELETE', /^\/api\/smartolt\/config$/, 'SmartOLT disconnected'],
  // platform owner
  ['POST', /^\/api\/tenants$/, 'Tenant created'],
  ['PATCH', /^\/api\/tenants\/[^/]+$/, 'Tenant edited'],
  ['POST', /^\/api\/tenants\/bulk-rate$/, 'Rates changed for all tenants'],
  ['POST', /^\/api\/tenants\/[^/]+\/remove$/, 'Tenant removed'],
  ['POST', /^\/api\/tenants\/[^/]+\/restore$/, 'Tenant restored'],
  ['POST', /^\/api\/tenants\/[^/]+\/purge$/, 'Tenant deleted permanently'],
  ['POST', /^\/api\/tenants\/[^/]+\/activate$/, 'Tenant activated'],
  ['POST', /^\/api\/tenants\/[^/]+\/instance-key$/, 'Licence key generated'],
  ['POST', /^\/api\/platform\/settlements\/[^/]+\/cancel$/, 'Payout cancelled (platform owner)'],
  ['POST', /^\/api\/platform\/settlements\/[^/]+\/mark-paid$/, 'Payout marked paid (platform owner)'],
];
const VERB = { POST: 'Added', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Removed' };

const labelFor = (method, path) => {
  const hit = LABELS.find(([m, re]) => m === method && re.test(path));
  if (hit) return hit[2];
  const resource = path.split('/').filter(Boolean)[1] ?? 'something';
  return `${VERB[method] ?? method} ${resource.replace(/[-_]/g, ' ')}`;
};

/** Trim and mask a value before it is stored. */
function scrub(v, depth = 0) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  if (typeof v !== 'object') return v;
  if (depth >= 3) return '…';
  if (Array.isArray(v)) {
    const head = v.slice(0, 5).map((x) => scrub(x, depth + 1));
    return v.length > 5 ? [...head, `+${v.length - 5} more`] : head;
  }
  return Object.fromEntries(Object.entries(v).slice(0, 25).map(([k, val]) => [k, REDACT.test(k) ? '••••' : scrub(val, depth + 1)]));
}

async function record(req, res, path, payload) {
  const isLogin = path === '/api/auth/login';
  const s = req.session;
  let actor = s?.name ?? null;
  const role = s?.role ?? null;
  let tenant = req.tenant ?? null;

  if (isLogin) {
    actor = String(req.body?.username ?? req.body?.email ?? '').slice(0, 80) || 'unknown';
    if (!tenant) tenant = await tenantByHost(req.hostname).catch(() => null);
  }
  // A call with nobody signed in (a hotspot purchase, a webhook) is not anybody's action.
  if (!actor) return;

  const ok = res.statusCode < 400;
  const action = isLogin ? (ok ? 'Signed in' : 'Sign-in failed') : labelFor(req.method, path);
  const platform = /^\/api\/(tenants|platform)\b/.test(path);
  const body = isLogin ? { username: actor } : scrub(req.body);
  let detail = JSON.stringify({ body, response: isLogin ? undefined : scrub(payload) });
  if (detail.length > 2500) detail = JSON.stringify({ body });

  const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim() || null;
  await pool.query(
    `insert into audit_log (tenant_id, tenant_name, actor_id, actor, role, platform, method, path, action, status, ip, detail)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [tenant?.id ?? null, tenant?.name ?? null, s?.staff_id ?? null, actor, role, platform, req.method,
      path.slice(0, 200), action, res.statusCode, ip, detail]);
}

/** Mounted once, early: watches every change made through /api and writes it down when the response is sent. */
export function auditTap(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const path = String(req.originalUrl ?? req.url).split('?')[0];
  if (SKIP.some((re) => re.test(path))) return next();

  let payload;
  const json = res.json.bind(res);
  res.json = (b) => { payload = b; return json(b); };
  res.on('finish', () => {
    record(req, res, path, payload).catch((e) => console.warn('audit:', e.message));
  });
  next();
}

/**
 * Everything that has gone wrong lately for one ISP, in one list: payments that did not match, M-Pesa prompts that
 * failed, messages that did not send, routers that are down or could not be set up, SmartOLT trouble, and failed
 * sign-ins. The platform owner also sees background jobs that failed. Newest first.
 */
export async function issuesFor(tenantId, { superAdmin = false, days = 14 } = {}) {
  const since = `now() - interval '${Math.max(1, Math.min(90, Number(days) || 14))} days'`;
  const rows = [];
  const add = async (sql, params, map) => {
    try { for (const r of (await pool.query(sql, params)).rows) rows.push(map(r)); } catch (e) { console.warn('issues:', e.message); }
  };

  await add(`select received_at as at, amount, payer_name, payer_phone, raw_account, provider from payments
              where tenant_id=$1 and status='unmatched' and received_at > ${since} order by received_at desc limit 100`, [tenantId],
    (r) => ({ at: r.at, kind: 'payment', title: `Unmatched payment of KES ${Number(r.amount).toLocaleString('en-KE')}`,
      detail: [r.payer_name, r.payer_phone, r.raw_account ? `typed “${r.raw_account}”` : null].filter(Boolean).join(' · '), link: '/payments' }));

  await add(`select created_at as at, amount, phone, status, result_desc from stk_requests
              where tenant_id=$1 and status in ('failed','timeout') and created_at > ${since} order by created_at desc limit 100`, [tenantId],
    (r) => ({ at: r.at, kind: 'stk', title: `M-Pesa prompt ${r.status === 'timeout' ? 'timed out' : 'failed'} — KES ${Number(r.amount).toLocaleString('en-KE')} to ${r.phone}`,
      detail: r.result_desc ?? '', link: '/payments' }));

  await add(`select at, phone, provider, status, detail from sms_log
              where tenant_id=$1 and status in ('failed','rejected') and at > ${since} order by at desc limit 100`, [tenantId],
    (r) => ({ at: r.at, kind: 'sms', title: `SMS ${r.status} to ${r.phone}`, detail: [r.provider, r.detail].filter(Boolean).join(' · '), link: '/messaging' }));

  try {
    const { rows: rs } = await pool.query(
      'select name, status, offline_since, autoconfig_last_ok, autoconfig_last_at, autoconfig_last_error from routers where tenant_id=$1', [tenantId]);
    for (const r of rs) {
      if (r.status === 'down') rows.push({ at: r.offline_since ?? new Date(), kind: 'router', title: `Router ${r.name} is offline`, detail: 'Not answering', link: '/routers' });
      if (r.autoconfig_last_ok === false) rows.push({ at: r.autoconfig_last_at ?? new Date(), kind: 'router', title: `Router ${r.name}: automatic setup failed`, detail: r.autoconfig_last_error ?? '', link: '/routers' });
    }
  } catch (e) { console.warn('issues:', e.message); }

  await add('select last_error, last_error_at from smartolt_config where tenant_id=$1 and last_error is not null', [tenantId],
    (r) => ({ at: r.last_error_at ?? new Date(), kind: 'smartolt', title: 'SmartOLT problem', detail: r.last_error, link: '/smartolt' }));

  await add(`select at, actor, ip from audit_log where tenant_id=$1 and action='Sign-in failed' and at > ${since} order by at desc limit 100`, [tenantId],
    (r) => ({ at: r.at, kind: 'login', title: `Failed sign-in as “${r.actor}”`, detail: r.ip ?? '', link: '/audit' }));

  if (superAdmin) {
    await add(`select ran_at as at, job, error from job_runs where ok = false and ran_at > now() - interval '3 days' order by ran_at desc limit 50`, [],
      (r) => ({ at: r.at, kind: 'job', title: `Background job “${r.job}” failed`, detail: r.error ?? '', link: '/automation' }));
  }

  return rows.filter((r) => r && r.kind).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 400);
}
