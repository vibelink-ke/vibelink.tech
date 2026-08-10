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
  hostpinnacle: (d) => {
    const status = String(d?.response?.status ?? d?.status ?? '').toLowerCase();
    if (status) return status === 'success' || status === 'queued' || status === 'sent';
    return !d?.errorCode && !d?.error;
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
  custom: () => true,   // whatever the operator pointed us at
};

const accepted = (provider, res) => {
  if (res?.status && (res.status < 200 || res.status >= 300)) return false;
  const check = ACCEPTED[provider];
  return check ? check(res?.data) : true;
};

const DEFAULTS = {
  receipt:  'Thank you. KES {amount} received, ref {code}. Active until {expires}.',
  voucher:  'Your code is {code}. Valid until {expires}. Connect to {ssid} and enter it.',
  reminder: 'Hi {name}, your internet expires {expires}. Pay Paybill {paybill} acc {account}.',
  partial:  'Received KES {amount}. Balance KES {balance}. You have {days} day(s) of service.',
  outage:   'Outage at {site}. Engineers are on it, ETA {eta}. Sorry for the trouble.',
  brief:    'Today: KES {collected} collected, {subs} new clients, {down} router(s) down.',
  // Free-text sends (POST /api/messages, POST /api/sms/bulk) pass the body through
  // the same renderer, so {name}/{account}/{expires} still interpolate per recipient.
  custom:   '{body}'
};

const render = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

/** Send with automatic failover down the tenant's configured gateway list. */
export async function send(tenantId, phone, template, vars = {}) {
  if (!phone) return;
  const { rows: gateways } = await pool.query(
    'select provider, credentials, templates from tenant_sms_config where tenant_id=$1 and enabled order by priority',
    [tenantId]);
  if (!gateways.length) return console.warn('no sms gateway for tenant', tenantId);

  const body = render(gateways[0].templates?.[template] ?? DEFAULTS[template], vars);
  const to = String(phone).replace(/^\+?(?:254)?0?/, '254');

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
      await log(tenantId, g.provider, to, body, 'sent', res.status);
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

export const providerNames = Object.keys(PROVIDERS);
