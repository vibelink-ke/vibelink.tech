import axios from 'axios';
import express from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { handleStkResult } from './daraja.js';
import { COUNTRIES, normaliseMsisdn, tenantCountry } from '../phone.js';

/**
 * Mobile-money and card payments outside Kenya, through the aggregators that cover most of Africa. Each gateway a tenant
 * saves (Settings → Payment gateways) holds that tenant's own keys; money goes straight to them. A charge is "pushed" to
 * the customer's phone (or, where the provider needs it, a hosted page link) and the result comes back by webhook.
 *
 * Providers:
 *   flutterwave  mobile money in Uganda, Tanzania, Rwanda, Ghana, Zambia, Cameroon, Côte d'Ivoire, Senegal; Kenya M-Pesa
 *   paystack     mobile money in Ghana and Kenya; hosted checkout (card, bank transfer) in Nigeria, South Africa and the rest
 *   azampay      Tanzania: M-Pesa, Tigo Pesa, Airtel Money, Halopesa, Azampesa
 *   yopayments   Uganda: MTN Mobile Money and Airtel Money
 *
 * A payment is never credited because a webhook said so. Flutterwave and Paystack are asked directly (their verify
 * endpoints) before anything is applied; AzamPay and Yo! carry no checkable signature, so their callbacks are only
 * accepted on a URL holding the gateway's own secret, and the amount credited is always the one recorded when the charge
 * was started, never one the callback claims.
 */
export const AFRICA_PROVIDERS = ['flutterwave', 'paystack', 'azampay', 'yopayments'];

/** Credentials each provider needs, for the "test" button and for validation. */
export const REQUIRED = {
  flutterwave: ['secret_key'],
  paystack: ['secret_key'],
  azampay: ['app_name', 'client_id', 'client_secret', 'token_key'],
  yopayments: ['api_username', 'api_password'],
};

const http = axios.create({ timeout: 25000 });

const txRef = () => `vl-${crypto.randomBytes(9).toString('hex')}`;
const isSandbox = (c) => /^(1|true|yes|sandbox)$/i.test(String(c?.sandbox ?? ''));

/** Which network a number belongs to, by its first digits after the country code, where the aggregator needs to be told. */
const NETWORKS = {
  UG: [[/^256(77|78|76|39)/, 'MTN'], [/^256(70|75|74|20)/, 'AIRTEL']],
  TZ: [[/^255(74|75|76)/, 'VODACOM'], [/^255(71|65|67|77)/, 'TIGO'], [/^255(68|69|78)/, 'AIRTEL'], [/^255(61|62)/, 'HALOPESA']],
  GH: [[/^233(24|54|55|59|53)/, 'MTN'], [/^233(20|50)/, 'VODAFONE'], [/^233(26|56|27|57)/, 'TIGO']],
  RW: [[/^250(78|79)/, 'MTN'], [/^250(72|73)/, 'AIRTEL']],
  ZM: [[/^260(96|76)/, 'MTN'], [/^260(97|77)/, 'AIRTEL']],
};
function networkOf(country, msisdn, fallback) {
  for (const [re, name] of NETWORKS[country] ?? []) if (re.test(msisdn)) return name;
  return fallback || null;
}

/** The gateway to use for a tenant's charge, or null when none of these providers applies (the Kenyan paths carry on). */
export async function findGateway(tenantId, service = 'pppoe', provider = null) {
  const flag = service === 'hotspot' ? 'enabled_hotspot' : 'enabled_pppoe';
  const { rows } = await pool.query(
    `select * from tenant_payment_config
      where tenant_id=$1 and scope='tenant' and provider = any($2::text[]) and ${flag}
      order by is_default desc, id`, [tenantId, provider ? [provider] : AFRICA_PROVIDERS]);
  const gw = rows[0];
  if (!gw) return null;
  if (provider) return gw;
  // A Kenyan tenant with its own Daraja or KopoKopo gateway keeps it unless the new gateway was made the default.
  if ((await tenantCountry(tenantId)) === 'KE' && !gw.is_default) {
    const { rows: [k] } = await pool.query(
      "select 1 from tenant_payment_config where tenant_id=$1 and scope='tenant' and provider in ('daraja','kopokopo') and " + flag + ' limit 1', [tenantId]);
    if (k) return null;
  }
  return gw;
}

// ── Flutterwave ─────────────────────────────────────────────────────────────
const FLW_TYPE = {
  UG: 'mobile_money_uganda', TZ: 'mobile_money_tanzania', RW: 'mobile_money_rwanda', GH: 'mobile_money_ghana',
  ZM: 'mobile_money_zambia', CM: 'mobile_money_franco', CI: 'mobile_money_franco', SN: 'mobile_money_franco', KE: 'mpesa',
};
const flw = {
  async charge(creds, c) {
    const type = FLW_TYPE[c.country];
    if (!type) throw new Error(`Flutterwave mobile money is not offered for ${COUNTRIES[c.country]?.name ?? c.country} here. Use Paystack for cards.`);
    const body = {
      tx_ref: c.txRef, amount: c.amount, currency: c.currency, email: c.email, phone_number: c.msisdn,
      fullname: c.name || 'Customer',
    };
    const net = networkOf(c.country, c.msisdn, creds.default_network);
    if (net && c.country !== 'KE') body.network = net;
    if (c.country === 'UG' && !body.network) throw new Error('Could not tell whether that number is MTN or Airtel. Check the number.');
    const { data } = await http.post(`https://api.flutterwave.com/v3/charges?type=${type}`, body,
      { headers: { Authorization: `Bearer ${creds.secret_key}` } });
    if (data?.status !== 'success') throw new Error(data?.message ?? 'Flutterwave did not accept the charge');
    const redirect = data?.meta?.authorization?.redirect ?? null;
    return { redirectUrl: redirect, note: redirect ? 'Open the link to approve the payment' : 'Approve the payment on your phone' };
  },
  async verify(creds, stk) {
    const { data } = await http.get('https://api.flutterwave.com/v3/transactions/verify_by_reference',
      { params: { tx_ref: stk.checkout_id }, headers: { Authorization: `Bearer ${creds.secret_key}` } });
    const d = data?.data;
    if (data?.status !== 'success' || !d) return { state: 'pending' };
    if (d.status === 'successful') {
      if (Number(d.amount) + 0.001 < Number(stk.amount)) return { state: 'failed', desc: 'Amount paid is less than expected' };
      return { state: 'success', ref: d.flw_ref ?? String(d.id ?? stk.checkout_id) };
    }
    return d.status === 'failed' ? { state: 'failed', desc: d.processor_response ?? 'Payment failed' } : { state: 'pending' };
  },
  parse: (req) => ({ checkoutId: req.body?.data?.tx_ref ?? req.body?.txRef ?? null, claimed: String(req.body?.data?.status ?? req.body?.status ?? '').toLowerCase() }),
  async test(creds) {
    await http.get('https://api.flutterwave.com/v3/balances', { headers: { Authorization: `Bearer ${creds.secret_key}` } });
  },
};

// ── Paystack ────────────────────────────────────────────────────────────────
const PAYSTACK_MM = { GH: { MTN: 'mtn', VODAFONE: 'vod', TIGO: 'tgo' }, KE: { DEFAULT: 'mpesa' } };
const paystack = {
  async charge(creds, c) {
    const headers = { Authorization: `Bearer ${creds.secret_key}` };
    const subunit = Math.round(c.amount * 100);
    const mm = PAYSTACK_MM[c.country];
    if (mm) {
      const provider = c.country === 'KE' ? mm.DEFAULT : mm[networkOf('GH', c.msisdn, creds.default_network)];
      if (!provider) throw new Error('Could not tell which mobile money network that number is on.');
      const { data } = await http.post('https://api.paystack.co/charge', {
        email: c.email, amount: subunit, currency: c.currency, reference: c.txRef,
        mobile_money: { phone: `+${c.msisdn}`, provider },
      }, { headers });
      if (!data?.status) throw new Error(data?.message ?? 'Paystack did not accept the charge');
      const st = data?.data?.status;
      if (st === 'send_otp' || st === 'send_pin') throw new Error('This number needs an OTP to approve; use a different payment method for it.');
      return { redirectUrl: null, note: data?.data?.display_text ?? 'Approve the payment on your phone' };
    }
    // Everywhere else: a hosted checkout page (card, bank transfer, USSD) the customer opens.
    const { data } = await http.post('https://api.paystack.co/transaction/initialize', {
      email: c.email, amount: subunit, currency: c.currency, reference: c.txRef,
    }, { headers });
    if (!data?.status) throw new Error(data?.message ?? 'Paystack did not accept the charge');
    return { redirectUrl: data.data.authorization_url, note: 'Open the link to pay' };
  },
  async verify(creds, stk) {
    const { data } = await http.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(stk.checkout_id)}`,
      { headers: { Authorization: `Bearer ${creds.secret_key}` } });
    const d = data?.data;
    if (!d) return { state: 'pending' };
    if (d.status === 'success') {
      if (Number(d.amount) + 1 < Math.round(Number(stk.amount) * 100)) return { state: 'failed', desc: 'Amount paid is less than expected' };
      return { state: 'success', ref: String(d.id ?? d.reference ?? stk.checkout_id) };
    }
    return d.status === 'failed' || d.status === 'abandoned' ? { state: 'failed', desc: d.gateway_response ?? 'Payment failed' } : { state: 'pending' };
  },
  parse: (req) => ({ checkoutId: req.body?.data?.reference ?? null, claimed: String(req.body?.event ?? '') }),
  async test(creds) {
    await http.get('https://api.paystack.co/balance', { headers: { Authorization: `Bearer ${creds.secret_key}` } });
  },
};

// ── AzamPay (Tanzania) ──────────────────────────────────────────────────────
const azamTokens = new Map();   // gateway id -> { token, exp }
async function azamToken(gwId, creds) {
  const hit = azamTokens.get(gwId);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const base = isSandbox(creds) ? 'https://authenticator-sandbox.azampay.co.tz' : 'https://authenticator.azampay.co.tz';
  const { data } = await http.post(`${base}/AppRegistration/GenerateToken`,
    { appName: creds.app_name, clientId: creds.client_id, clientSecret: creds.client_secret });
  const token = data?.data?.accessToken;
  if (!token) throw new Error(data?.message ?? 'AzamPay refused the credentials');
  azamTokens.set(gwId, { token, exp: Date.parse(data?.data?.expire ?? '') || Date.now() + 50 * 60000 });
  return token;
}
const AZAM_PROVIDER = [[/^255(74|75|76)/, 'Mpesa'], [/^255(71|65|67|77)/, 'Tigo'], [/^255(68|69|78)/, 'Airtel'], [/^255(61|62)/, 'Halopesa']];
const azampay = {
  async charge(creds, c, gwId) {
    const token = await azamToken(gwId, creds);
    const provider = (AZAM_PROVIDER.find(([re]) => re.test(c.msisdn)) ?? [])[1];
    if (!provider) throw new Error('Could not tell which mobile money network that number is on.');
    const base = isSandbox(creds) ? 'https://sandbox.azampay.co.tz' : 'https://checkout.azampay.co.tz';
    const { data } = await http.post(`${base}/azampay/mno/checkout`, {
      accountNumber: c.msisdn, additionalProperties: {}, amount: String(Math.round(c.amount)), currency: c.currency,
      externalId: c.txRef, provider,
    }, { headers: { Authorization: `Bearer ${token}`, 'X-API-Key': creds.token_key } });
    if (data?.success === false) throw new Error(data?.message ?? 'AzamPay did not accept the charge');
    return { redirectUrl: null, note: 'Approve the payment on your phone', providerRef: data?.transactionId ?? null };
  },
  // No verify endpoint we can rely on: the callback is accepted only on the gateway's secret URL (see the webhook below).
  parse: (req) => {
    const b = req.body ?? {};
    return { checkoutId: b.utilityref ?? b.externalId ?? b.externalreference ?? null, claimed: String(b.transactionstatus ?? b.status ?? '').toLowerCase(), ref: b.reference ?? b.transid ?? b.mnoreference ?? null, phone: b.msisdn ?? null };
  },
  async test(creds, gwId) { await azamToken(gwId, creds); },
};

// ── Yo! Payments (Uganda) ───────────────────────────────────────────────────
const yoUrl = (c) => (isSandbox(c) ? 'https://sandbox.yo.co.ug/services/yopaymentsdev/task.php' : 'https://paymentsapi1.yo.co.ug/ybs/task.php');
const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlField = (body, tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(body)?.[1]?.trim() ?? null;
const yopayments = {
  async charge(creds, c) {
    const base = process.env.BASE_URL ?? '';
    const ok = `${base}/webhooks/africa/yopayments/${c.gatewayId}/ok?k=${encodeURIComponent(creds.webhook_key)}`;
    const fail = `${base}/webhooks/africa/yopayments/${c.gatewayId}/fail?k=${encodeURIComponent(creds.webhook_key)}`;
    const body = '<?xml version="1.0" encoding="UTF-8"?><AutoCreate><Request>'
      + `<APIUsername>${xml(creds.api_username)}</APIUsername><APIPassword>${xml(creds.api_password)}</APIPassword>`
      + `<Method>acdepositfunds</Method><NonBlocking>TRUE</NonBlocking><Amount>${Math.round(c.amount)}</Amount>`
      + `<Account>${xml(c.msisdn)}</Account><Narrative>${xml(c.description || 'Internet payment')}</Narrative>`
      + `<ExternalReference>${xml(c.txRef)}</ExternalReference>`
      + `<InstantNotificationUrl>${xml(encodeURIComponent(ok))}</InstantNotificationUrl>`
      + `<FailureNotificationUrl>${xml(encodeURIComponent(fail))}</FailureNotificationUrl>`
      + '</Request></AutoCreate>';
    const { data } = await http.post(yoUrl(creds), body, { headers: { 'Content-Type': 'text/xml', 'Content-transfer-encoding': 'text' }, responseType: 'text' });
    const status = xmlField(data, 'Status');
    if (status !== 'OK') throw new Error(xmlField(data, 'StatusMessage') ?? xmlField(data, 'ErrorMessage') ?? 'Yo! Payments did not accept the charge');
    return { redirectUrl: null, note: 'Approve the payment on your phone', providerRef: xmlField(data, 'TransactionReference') };
  },
  parse: (req) => {
    const b = { ...(req.query ?? {}), ...(req.body ?? {}) };
    const outcome = String(req.params.outcome ?? '');
    return { checkoutId: b.external_ref ?? b.ExternalReference ?? null, providerRef: b.failed_transaction_reference ?? null,
      claimed: outcome === 'ok' ? 'success' : 'failed', ref: b.network_ref ?? null, phone: b.msisdn ?? null };
  },
  async test() { /* no read-only call to check the credentials with; the fields being present is all that can be said */ },
};

const ADAPTERS = { flutterwave: flw, paystack, azampay, yopayments };

/** "Is this credential set accepted by the provider?" — null when fine, otherwise the problem in words. */
export async function testCredentials(provider, gwId, creds) {
  try { await ADAPTERS[provider]?.test(creds, gwId); return null; } catch (e) { return e.response?.data?.message ?? e.message; }
}

/**
 * Start a payment from the customer's phone: normalise the number for the tenant's country, ask the provider to charge
 * it, and record the attempt in stk_requests (the same table every other gateway uses, so the status polling, the
 * hotspot voucher and the PPPoE renewal all work unchanged).
 */
export async function africaStk(tenantId, gw, { phone, amount, accountRef, description, email, name, purpose, forTenantId }) {
  const adapter = ADAPTERS[gw.provider];
  if (!adapter) throw new Error(`Unknown payment provider ${gw.provider}`);
  const creds = { ...(gw.credentials ?? {}) };
  const country = await tenantCountry(tenantId);
  const { rows: [t] } = await pool.query('select currency, subdomain from tenants where id=$1', [tenantId]);
  // A tenant outside Kenya who never changed the currency still on the default KES is charged in their country's own.
  let currency = String(t?.currency ?? 'KES').trim();
  if (country !== 'KE' && currency === 'KES') currency = COUNTRIES[country]?.currency ?? currency;
  // Whole units only for currencies without cents; the amount recorded is the amount charged.
  const ZERO_DECIMAL = new Set(['UGX', 'TZS', 'RWF', 'XAF', 'XOF']);
  const charged = ZERO_DECIMAL.has(currency) ? Math.round(Number(amount)) : Math.round(Number(amount) * 100) / 100;
  const msisdn = normaliseMsisdn(phone, country);
  if (!msisdn) throw Object.assign(new Error(`That does not look like a ${COUNTRIES[country]?.name ?? ''} mobile number`), { status: 400 });

  // The webhook secret rides in the callback URL; made once and kept on the gateway.
  if (!creds.webhook_key) {
    creds.webhook_key = crypto.randomBytes(16).toString('hex');
    await pool.query('update tenant_payment_config set credentials = credentials || $2::jsonb where id=$1', [gw.id, JSON.stringify({ webhook_key: creds.webhook_key })]);
  }
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
  const ref = txRef();
  const ctx = {
    gatewayId: gw.id, txRef: ref, amount: charged, currency, country, msisdn, description, name,
    email: email || `${String(accountRef ?? 'customer').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'customer'}@${t?.subdomain ?? 'pay'}.${root}`,
  };
  const out = await adapter.charge(creds, ctx, gw.id);
  await pool.query(
    `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
     values ($1,$2,$3,$4,$5,$6)`,
    [tenantId, gw.provider, ref, msisdn, charged, { ...(purpose ?? {}), gateway_id: gw.id, provider_ref: out.providerRef ?? null, country, currency }]);
  return { checkoutId: ref, redirectUrl: out.redirectUrl ?? null, note: out.note ?? null };
}

/** The URL a tenant pastes into the provider's dashboard so confirmations reach us. */
export async function webhookUrl(gw) {
  const creds = gw.credentials ?? {};
  let key = creds.webhook_key;
  if (!key) {
    key = crypto.randomBytes(16).toString('hex');
    await pool.query('update tenant_payment_config set credentials = credentials || $2::jsonb where id=$1', [gw.id, JSON.stringify({ webhook_key: key })]);
  }
  const base = process.env.BASE_URL ?? '';
  return `${base}/webhooks/africa/${gw.provider}/${gw.id}?k=${key}`;
}

// ── confirmations ───────────────────────────────────────────────────────────
export const router = express.Router();
router.use(express.urlencoded({ extended: false }));

const sameKey = (given, expected) => {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

async function confirm(req) {
  const { provider, gatewayId } = req.params;
  const adapter = ADAPTERS[provider];
  if (!adapter) return;
  const { rows: [gw] } = await pool.query('select * from tenant_payment_config where id=$1 and provider=$2', [gatewayId, provider]);
  if (!gw || !sameKey(req.query.k, gw.credentials?.webhook_key)) {
    console.error(`africa webhook: rejected request to ${provider}/${gatewayId} from ${req.ip}`);
    return;
  }
  const info = adapter.parse(req);
  let { rows: [stk] } = info.checkoutId
    ? await pool.query('select * from stk_requests where tenant_id=$1 and provider=$2 and checkout_id=$3', [gw.tenant_id, provider, info.checkoutId])
    : { rows: [] };
  if (!stk && info.providerRef) {
    ({ rows: [stk] } = await pool.query(
      "select * from stk_requests where tenant_id=$1 and provider=$2 and purpose->>'provider_ref' = $3", [gw.tenant_id, provider, info.providerRef]));
  }
  if (!stk) { console.error(`africa webhook: no pending request for ${provider} ${info.checkoutId ?? info.providerRef}`); return; }
  await pool.query('update tenant_payment_config set last_callback_at = now() where id=$1', [gw.id]);

  let result;
  if (adapter.verify) {
    result = await adapter.verify(gw.credentials, stk);   // asked of the provider, whatever the callback claimed
  } else {
    const ok = /success|succeed|complete|paid|ok/.test(info.claimed) && !/fail|error|cancel/.test(info.claimed);
    result = ok ? { state: 'success', ref: info.ref ?? stk.checkout_id } : { state: 'failed', desc: 'The payment was not completed' };
  }
  if (result.state === 'pending') return;
  await handleStkResult(provider, stk.checkout_id, result.state === 'success' ? 0 : 1, result.desc ?? result.state,
    { ref: result.ref ?? stk.checkout_id, phone: info.phone ?? stk.phone });
}

router.all(['/:provider/:gatewayId', '/:provider/:gatewayId/:outcome'], (req, res) => {
  res.status(200).json({ ok: true });   // acknowledge at once; the work happens after
  confirm(req).catch((e) => console.error('africa webhook:', e.message));
});
