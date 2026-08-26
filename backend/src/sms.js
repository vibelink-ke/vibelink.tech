import axios from 'axios';
import { pool } from './db.js';

/**
 * SMS gateways. Each tenant picks a primary in Settings -> SMS; the rest act as failover
 * in the order they are configured. Credentials live in tenant_sms_config.credentials.
 */
const PROVIDERS = {
  // HostPinnacle Kenya — https://smsportal.hostpinnacle.co.ke
  hostpinnacle: async (c, to, msg) => axios.post(
    'https://smsportal.hostpinnacle.co.ke/SMSApi/send',
    new URLSearchParams({
      userid: c.userid, password: c.password, senderid: c.sender_id,
      mobile: to, msg, msgType: 'text', duplicatecheck: 'true',
      output: 'json', sendMethod: 'quick'
    }),
    { headers: { apikey: c.api_key, 'Content-Type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' } }
  ),

  africastalking: async (c, to, msg) => axios.post(
    'https://api.africastalking.com/version1/messaging',
    new URLSearchParams({ username: c.username, to: '+' + to, message: msg, from: c.sender_id }),
    { headers: { apiKey: c.api_key, Accept: 'application/json' } }
  ),

  textsms: async (c, to, msg) => axios.post('https://sms.textsms.co.ke/api/services/sendsms/', {
    apikey: c.api_key, partnerID: c.partner_id, shortcode: c.sender_id, mobile: to, message: msg
  }),

  ujumbe: async (c, to, msg) => axios.post('https://ujumbesms.co.ke/api/messaging',
    { data: [{ message_bag: { numbers: to, message: msg, sender: c.sender_id } }] },
    { headers: { 'X-Authorization': c.api_key, email: c.email } }),

  mobitech: async (c, to, msg) => axios.post('https://api.mobitechtechnologies.com/sms/sendsms',
    { mobile: to, response_type: 'json', sender_name: c.sender_id, service_id: 0, message: msg },
    { headers: { 'h_api_key': c.api_key } }),

  twilio: async (c, to, msg) => axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}/Messages.json`,
    new URLSearchParams({ To: '+' + to, From: c.from, Body: msg }),
    { auth: { username: c.account_sid, password: c.auth_token } }),

  // Same API as plain Twilio SMS — only the whatsapp: prefix on both numbers
  // differs. The operator's "from" field is just their WhatsApp-enabled
  // number (Twilio's own sandbox number while testing, or an approved
  // WhatsApp Business sender in production); the prefix is added here so
  // it never has to be typed or remembered.
  twilio_whatsapp: async (c, to, msg) => axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}/Messages.json`,
    new URLSearchParams({ To: `whatsapp:+${to}`, From: `whatsapp:${c.from}`, Body: msg }),
    { auth: { username: c.account_sid, password: c.auth_token } }),

  custom: async (c, to, msg) => axios.post(c.url,
    JSON.parse(String(c.body_template ?? '{}').replace('{to}', to).replace('{message}', msg)),
    { headers: c.headers ?? {} })
};

/**
 * Did the provider actually accept the message?
 *
 * Most of these APIs answer HTTP 200 and put the real outcome in the body, so
 * `axios` not throwing proves nothing. Without these checks a rejected message is
 * logged as "sent" and failover never happens — the message just disappears.
 * Anything we have no rule for falls back to the HTTP status.
 */
const ACCEPTED = {
  /**
   * HostPinnacle answers in more than one shape.
   *
   * Sometimes a word — "success" — and sometimes a numeric gateway code, where
   * 1701 means the message was accepted. The check only recognised the words,
   * so a perfectly delivered message came back as "rejected" while the balance
   * went down: the operator sees a failure, the customer gets the text, and
   * nobody can reconcile the two.
   *
   * Accepting on the absence of an error rather than the presence of one exact
   * word, since the failure shapes are far better signposted than the successes.
   */
  hostpinnacle: (d) => {
    const raw = d?.response ?? d ?? {};
    const status = String(raw.status ?? raw.code ?? raw.statusCode ?? '').toLowerCase();
    const message = String(raw.message ?? raw.description ?? '').toLowerCase();

    // Their documented success codes, plus the plain words.
    const SUCCESS_CODES = ['1701', '200', '0', '100'];
    if (SUCCESS_CODES.includes(status)) return true;
    if (/success|queued|sent|submitted|accepted/.test(status)) return true;
    if (/success|queued|sent|submitted|accepted/.test(message)) return true;

    // Anything that names itself an error is a rejection.
    if (raw.errorCode || raw.error || /fail|error|invalid|insufficient|denied/.test(status + ' ' + message)) {
      return false;
    }
    // No verdict either way: treat as sent. A message that arrived and was
    // logged as rejected is worse than the reverse — it hides a working
    // gateway and sends the operator looking for a fault that is not there.
    return true;
  },
  africastalking: (d) => {
    const r = d?.SMSMessageData?.Recipients ?? [];
    return r.length > 0 && r.some((x) => /success/i.test(String(x.status ?? '')));
  },
  textsms: (d) => {
    const r = Array.isArray(d?.responses) ? d.responses : [d];
    return r.some((x) => Number(x?.['respose-code'] ?? x?.['response-code'] ?? x?.code) === 200);
  },
  ujumbe: (d) => !/error/i.test(String(d?.status ?? d?.message ?? '')),
  mobitech: (d) => {
    const r = Array.isArray(d) ? d[0] : d;
    return String(r?.status_code ?? r?.status ?? '') === '1000' || /success/i.test(String(r?.message ?? ''));
  },
  twilio: (d) => !['failed', 'undelivered'].includes(String(d?.status ?? '').toLowerCase()),
  twilio_whatsapp: (d) => !['failed', 'undelivered'].includes(String(d?.status ?? '').toLowerCase()),
  custom: () => true,   // whatever the operator pointed us at
};

const accepted = (provider, res) => {
  if (res?.status && (res.status < 200 || res.status >= 300)) return false;
  const check = ACCEPTED[provider];
  return check ? check(res?.data) : true;
};

export const DEFAULTS = {
  receipt:  'Thank you. KES {amount} received, ref {code}. Active until {expires}.',
  voucher:  'Your code is {code}. Valid until {expires}. Tap {link} to connect.',
  reminder: 'Hi {name}, your internet expires {expires}. Pay Paybill {paybill} acc {account}.',
  partial:  'Received KES {amount}. Balance KES {balance}. You have {days} day(s) of service.',
  outage:   'Outage at {site}. Engineers are on it, ETA {eta}. Sorry for the trouble.',
  brief:    'Today: KES {collected} collected, {subs} new clients, {down} router(s) down.',
  // Free-text sends (POST /api/messages, POST /api/sms/bulk) pass the body through
  // the same renderer, so {name}/{account}/{expires} still interpolate per recipient.
  custom:   '{body}',
  welcome:  'Welcome to {company}, {first_name}. Your account number is {account} — quote it when '
          + 'you pay. Paybill {paybill}. Plan: {plan} at KES {price}. Help: {support_phone} {support_email}',
};

const render = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

/**
 * Fill the tags in a message an operator wrote.
 *
 * Separate from `render`, and used before it, because the two run at different
 * moments and conflating them is what sent customers the literal text
 * "{name}{account}{phone}...".
 *
 * The custom template is `{body}`, and render makes a single pass: it replaced
 * {body} with whatever was typed and stopped. Every tag inside that text
 * survived untouched and went out over the wire exactly as written. The tags
 * were listed in the composer, insertable by clicking, documented — and never
 * substituted by anything.
 *
 * So the operator's text is expanded here first, against that recipient's own
 * values, and the finished sentence is what {body} then receives. Doing it in
 * this order also means a customer whose name happens to contain braces cannot
 * have it expanded as though it were a tag of ours.
 */
export const fill = (text, vars) => render(text ?? '', vars);

/**
 * Every token a template may use, for the UI to list.
 *
 * The point is that one written message reaches each customer with their own
 * details in it — a bulk send addressed to "Dear customer" is the thing this
 * exists to avoid. Unknown tokens render as empty rather than being left on
 * screen as literal braces.
 */
export const PLACEHOLDERS = [
  { token: 'name',          desc: 'Full name' },
  { token: 'first_name',    desc: 'First name only' },
  { token: 'account',       desc: 'Account number they quote when paying' },
  { token: 'phone',         desc: 'Their primary number' },
  { token: 'plan',          desc: 'Plan name' },
  { token: 'price',         desc: 'Plan price' },
  { token: 'speed',         desc: 'Plan speed, e.g. 10/5 Mbps' },
  { token: 'expires',       desc: 'When their service runs out' },
  { token: 'days_left',     desc: 'Days until expiry' },
  { token: 'status',        desc: 'active, expired, paused …' },
  { token: 'balance',       desc: 'Outstanding balance' },
  { token: 'company',       desc: 'Your company name' },
  { token: 'support_phone', desc: 'Your customer care number' },
  { token: 'support_email', desc: 'Your support email' },
  { token: 'paybill',       desc: 'Your default paybill or till' },
  { token: 'router',        desc: 'Router they are connected to' },
  { token: 'portal',        desc: 'Link to their customer portal sign-in page' },
];

/** The joins a row needs before subscriberVars can fill every token. */
export const SUBSCRIBER_VARS_SQL = `
  s.*, p.title as plan_title, p.price as plan_price,
  p.rate_down, p.rate_up, r.name as router_name`;

/** Build the token map for one subscriber. `org` is per-tenant and looked up once. */
export function subscriberVars(s, org = {}) {
  const days = s.expires_at
    ? Math.ceil((new Date(s.expires_at) - Date.now()) / 86400000)
    : null;
  const mbps = (k) => (k ? Math.round(k / 1000) : 0);
  return {
    name: s.name ?? '',
    first_name: (s.name ?? '').trim().split(/\s+/)[0] ?? '',
    account: s.account_code ?? '',
    phone: s.phone ?? '',
    plan: s.plan_title ?? '',
    price: s.plan_price == null ? '' : String(Number(s.plan_price)),
    speed: s.rate_down ? `${mbps(s.rate_down)}/${mbps(s.rate_up)} Mbps` : '',
    expires: s.expires_at ? new Date(s.expires_at).toLocaleDateString('en-KE') : '',
    days_left: days == null ? '' : String(Math.max(0, days)),
    status: s.status ?? '',
    balance: s.credit == null ? '' : String(Number(s.credit)),
    router: s.router_name ?? '',
    company: org.company ?? '',
    support_phone: org.supportPhone ?? '',
    support_email: org.supportEmail ?? '',
    paybill: org.paybill ?? '',
    portal: org.portal ?? '',
  };
}

/** The tenant-wide half of the token map. One query, reused for a whole bulk run. */
export async function orgVars(tenantId) {
  const { rows: [t] } = await pool.query(
    'select name, support_phone, subdomain from tenants where id=$1', [tenantId]);
  const { rows: [gw] } = await pool.query(
    `select shortcode from tenant_payment_config
      where tenant_id=$1 and shortcode is not null
      order by is_default desc nulls last limit 1`, [tenantId]).catch(() => ({ rows: [] }));
  // app_settings is one row per tenant with jsonb blobs, not key/value pairs.
  const { rows: [cfg] } = await pool.query(
    "select prefs->>'supportEmail' as email, smtp->>'from' as smtp_from from app_settings where tenant_id=$1",
    [tenantId]).catch(() => ({ rows: [] }));
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  return {
    company: t?.name ?? '',
    supportPhone: t?.support_phone ?? '',
    // Falls back to whatever address the mail gateway sends as, which is the
    // address customers would reply to anyway.
    supportEmail: cfg?.email ?? cfg?.smtp_from ?? '',
    paybill: gw?.shortcode ?? '',
    // {portal} in a welcome message or reminder — a link a new customer can
    // tap straight to sign-in, instead of typing the subdomain from memory.
    portal: t?.subdomain ? `https://${t.subdomain}.${root}/customer` : '',
  };
}

/**
 * Send with automatic failover down the tenant's configured SMS gateway
 * list, and — separately, always, in parallel — over WhatsApp if that is
 * configured too. WhatsApp is not one more entry in the failover chain: a
 * customer with both set up gets both messages, every time, rather than
 * WhatsApp only ever firing when the SMS gateway happened to fail. It has
 * its own settings section (Settings -> WhatsApp) for exactly this reason —
 * mixing it into the ordered SMS gateway list would make "which one fired"
 * a priority-number guessing game instead of "always both."
 */
export async function send(tenantId, phone, template, vars = {}) {
  if (!phone) return;
  const to = String(phone).replace(/^\+?(?:254)?0?/, '254');

  const [smsResult] = await Promise.all([
    sendSms(tenantId, to, template, vars),
    sendWhatsApp(tenantId, to, template, vars),
  ]);
  return smsResult;
}

async function sendSms(tenantId, to, template, vars) {
  const { rows: gateways } = await pool.query(
    "select provider, credentials, templates from tenant_sms_config where tenant_id=$1 and enabled and provider <> 'twilio_whatsapp' order by priority",
    [tenantId]);
  if (!gateways.length) return console.warn('no sms gateway for tenant', tenantId);

  const body = render(gateways[0].templates?.[template] ?? DEFAULTS[template], vars);

  let tried = 0;
  for (const g of gateways) {
    // A half-filled gateway would fail on every message and, being first in
    // priority order, would shadow a working one behind it.
    if (!credentialsComplete(g.provider, g.credentials)) {
      await log(tenantId, g.provider, to, body, 'skipped',
        `missing ${missingCredentials(g.provider, g.credentials).join(', ')}`);
      continue;
    }
    tried++;
    try {
      const res = await PROVIDERS[g.provider](g.credentials, to, body);
      if (!accepted(g.provider, res)) {
        // HTTP was fine but the provider rejected it — keep going down the list.
        await log(tenantId, g.provider, to, body, 'rejected',
          JSON.stringify(res?.data ?? '').slice(0, 300));
        continue;
      }
      await log(tenantId, g.provider, to, body, 'sent',
        `HTTP ${res.status} ${JSON.stringify(res?.data ?? '').slice(0, 200)}`);
      // A credit has just been spent, so the cached balance is now wrong. Dropping
      // it here means the dashboard can poll cheaply and still see the change
      // immediately, without asking the provider every few seconds.
      invalidateBalance(tenantId);
      return { ok: true, provider: g.provider };
    } catch (e) {
      await log(tenantId, g.provider, to, body, 'failed', e.message);
    }
  }
  if (!tried) console.warn('no usable sms gateway for tenant', tenantId);
  return { ok: false };
}

/** Its own row (provider='twilio_whatsapp'), read directly rather than through the failover list above. */
async function sendWhatsApp(tenantId, to, template, vars) {
  const { rows: [g] } = await pool.query(
    "select credentials, templates from tenant_sms_config where tenant_id=$1 and provider='twilio_whatsapp' and enabled",
    [tenantId]);
  if (!g || !credentialsComplete('twilio_whatsapp', g.credentials)) return;

  const body = render(g.templates?.[template] ?? DEFAULTS[template], vars);
  try {
    const res = await PROVIDERS.twilio_whatsapp(g.credentials, to, body);
    if (!accepted('twilio_whatsapp', res)) {
      await log(tenantId, 'twilio_whatsapp', to, body, 'rejected', JSON.stringify(res?.data ?? '').slice(0, 300));
      return;
    }
    await log(tenantId, 'twilio_whatsapp', to, body, 'sent',
      `HTTP ${res.status} ${JSON.stringify(res?.data ?? '').slice(0, 200)}`);
  } catch (e) {
    await log(tenantId, 'twilio_whatsapp', to, body, 'failed', e.message);
  }
}

async function log(tenantId, provider, to, body, status, detail) {
  await pool.query(
    'insert into sms_log (tenant_id, provider, phone, body, status, detail) values ($1,$2,$3,$4,$5,$6)',
    [tenantId, provider, to, body, status, String(detail)]
  ).catch(() => {});
}


/**
 * Live credit balance per provider. Returns null when credentials are missing so the
 * dashboard can show 0 / "not connected" rather than a stale cached figure.
 */
const BALANCE = {
  hostpinnacle: async (c) => {
    const { data } = await axios.get('https://smsportal.hostpinnacle.co.ke/SMSApi/account/readstatus', {
      params: { userid: c.userid, password: c.password, output: 'json' },
      headers: { apikey: c.api_key }
    });
    return Number(data?.response?.account?.smsBalance ?? data?.smsBalance ?? 0);
  },

  africastalking: async (c) => {
    const { data } = await axios.get('https://api.africastalking.com/version1/user', {
      params: { username: c.username },
      headers: { apiKey: c.api_key, Accept: 'application/json' }
    });
    // "KES 1234.5000" -> credits are the shilling balance for AT
    const raw = String(data?.UserData?.balance ?? '0').replace(/[^0-9.]/g, '');
    return Math.floor(Number(raw));
  },

  textsms: async (c) => {
    const { data } = await axios.post('https://sms.textsms.co.ke/api/services/getbalance/', {
      apikey: c.api_key, partnerID: c.partner_id
    });
    return Number(data?.credit ?? data?.balance ?? 0);
  },

  ujumbe: async (c) => {
    const { data } = await axios.get('https://ujumbesms.co.ke/api/balance', {
      headers: { 'X-Authorization': c.api_key, email: c.email }
    });
    return Number(data?.balance ?? 0);
  },

  mobitech: async (c) => {
    const { data } = await axios.get('https://api.mobitechtechnologies.com/sms/getbalance', {
      headers: { h_api_key: c.api_key }
    });
    return Number(data?.balance ?? 0);
  },

  twilio: async (c) => {
    const { data } = await axios.get(
      `https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}/Balance.json`,
      { auth: { username: c.account_sid, password: c.auth_token } });
    return Math.floor(Number(data?.balance ?? 0));
  },

  // Same account, same balance — WhatsApp and SMS both spend from one
  // Twilio account, there's nothing separate to read here.
  twilio_whatsapp: async (c) => {
    const { data } = await axios.get(
      `https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}/Balance.json`,
      { auth: { username: c.account_sid, password: c.auth_token } });
    return Math.floor(Number(data?.balance ?? 0));
  },

  custom: async (c) => {
    if (!c.balance_url) return null;
    const { data } = await axios.get(c.balance_url, { headers: c.headers ?? {} });
    return Number(data?.balance ?? 0);
  }
};

/**
 * What each gateway needs, and how to label it in the UI.
 *
 * Single source of truth: `credentialsComplete()` derives from this and the
 * Settings screen renders from it, so the form and the validation cannot drift.
 * Every field the PROVIDERS function above actually reads must appear here —
 * a missing entry means a half-configured gateway passes as complete, gets tried
 * first, and silently shadows a working one.
 */
export const PROVIDER_FIELDS = {
  hostpinnacle: [
    { key: 'userid', label: 'Username', required: true },
    { key: 'password', label: 'Password', required: true, secret: true },
    { key: 'sender_id', label: 'Sender ID', required: true },
    { key: 'api_key', label: 'API key', required: true, secret: true },
  ],
  africastalking: [
    { key: 'username', label: 'Username', required: true },
    { key: 'api_key', label: 'API key', required: true, secret: true },
    { key: 'sender_id', label: 'Sender ID', required: true },
  ],
  textsms: [
    { key: 'api_key', label: 'API key', required: true, secret: true },
    { key: 'partner_id', label: 'Partner ID', required: true },
    { key: 'sender_id', label: 'Sender ID / shortcode', required: true },
  ],
  ujumbe: [
    { key: 'api_key', label: 'API key', required: true, secret: true },
    { key: 'email', label: 'Account email', required: true },
    { key: 'sender_id', label: 'Sender ID', required: true },
  ],
  mobitech: [
    { key: 'api_key', label: 'API key', required: true, secret: true },
    { key: 'sender_id', label: 'Sender name', required: true },
  ],
  twilio: [
    { key: 'account_sid', label: 'Account SID', required: true },
    { key: 'auth_token', label: 'Auth token', required: true, secret: true },
    { key: 'from', label: 'From number', required: true },
  ],
  twilio_whatsapp: [
    { key: 'account_sid', label: 'Account SID', required: true },
    { key: 'auth_token', label: 'Auth token', required: true, secret: true },
    { key: 'from', label: 'WhatsApp number (e.g. +14155238886 — no "whatsapp:" prefix)', required: true },
  ],
  custom: [
    { key: 'url', label: 'Send URL', required: true },
    { key: 'body_template', label: 'Body template', required: false },
    { key: 'balance_url', label: 'Balance URL', required: false },
  ],
};

/** True only when the tenant has a provider selected AND its required fields filled. */
export function credentialsComplete(provider, c = {}) {
  const fields = PROVIDER_FIELDS[provider];
  if (!fields) return false;
  return fields
    .filter((f) => f.required)
    .every((f) => String(c[f.key] ?? '').trim().length > 0);
}

/** Which required fields are still blank — drives the "missing X, Y" message. */
export function missingCredentials(provider, c = {}) {
  const fields = PROVIDER_FIELDS[provider] ?? [];
  return fields
    .filter((f) => f.required && !String(c[f.key] ?? '').trim())
    .map((f) => f.label);
}

/**
 * Balance for the tenant's primary gateway.
 * { configured:false, credits:0 } when nothing usable is set — the dashboard shows 0.
 * Cached for 5 minutes so a dashboard refresh does not hammer the provider.
 */
const cache = new Map();

/** Drop the cached balance so the next read goes to the provider. */
export const invalidateBalance = (tenantId) => cache.delete(tenantId);

export async function smsBalance(tenantId, { force = false } = {}) {
  const hit = cache.get(tenantId);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.value;

  const { rows: [g] } = await pool.query(
    'select provider, credentials from tenant_sms_config where tenant_id=$1 and enabled order by priority limit 1',
    [tenantId]);

  let value;
  if (!g || !credentialsComplete(g.provider, g.credentials)) {
    value = { configured: false, provider: g?.provider ?? null, credits: 0, checkedAt: new Date().toISOString() };
  } else {
    try {
      const credits = await BALANCE[g.provider](g.credentials);
      value = { configured: true, provider: g.provider, credits: credits ?? 0, checkedAt: new Date().toISOString() };
    } catch (e) {
      // Never fabricate a number: report the failure and let the UI show 0.
      value = { configured: true, provider: g.provider, credits: 0, error: e.message, checkedAt: new Date().toISOString() };
    }
  }

  cache.set(tenantId, { at: Date.now(), value });
  return value;
}

// twilio_whatsapp excluded: it has its own settings section and its own
// always-parallel send path (sendWhatsApp), not a slot in the ordered SMS
// failover list this drives the dropdown for.
export const providerNames = Object.keys(PROVIDERS).filter((p) => p !== 'twilio_whatsapp');
