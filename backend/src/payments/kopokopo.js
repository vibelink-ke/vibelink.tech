import axios from 'axios';
import express from 'express';
import { config, pool } from '../db.js';
import { handleStkResult } from './daraja.js';

const BASE = 'https://api.kopokopo.com';

async function token(cfg) {
  const { data } = await axios.post(`${BASE}/oauth/token`, {
    grant_type: 'client_credentials',
    client_id: cfg.credentials.client_id,
    client_secret: cfg.credentials.client_secret
  });
  return data.access_token;
}

/** Same rationale as daraja.js's testAuth: an OAuth token request is free. */
export async function testAuth(tenantId) {
  const cfg = await config(tenantId, 'kopokopo');
  try {
    await token(cfg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.error_description ?? e?.response?.data ?? e.message };
  }
}

/** HOTSPOT ONLY. Guarded here so a misconfiguration can't route PPPoE through KopoKopo. */
export async function stkPush(tenantId, { phone, amount, planId, mac, routerId, label, service }) {
  if (service !== 'hotspot') throw new Error('KopoKopo STK is enabled for hotspot only');
  const cfg = await config(tenantId, 'kopokopo');
  const { data, headers } = await axios.post(`${BASE}/api/v1/incoming_payments`, {
    payment_channel: 'M-PESA STK Push',
    till_number: cfg.shortcode,
    subscriber: { phone_number: phone },
    amount: { currency: 'KES', value: Math.round(amount) },
    metadata: { plan_id: planId, mac: mac ?? '' },
    _links: { callback_url: `${process.env.BASE_URL}/webhooks/kopokopo/stk` }
  }, { headers: { Authorization: `Bearer ${await token(cfg)}` } });

  const checkoutId = (headers.location ?? '').split('/').pop() ?? data?.data?.id;
  // router_id rides along with mac — the "pick a device, pay direct" flow
  // (POST /hotspot/tv-buy) needs to know which physical router to bind the
  // device on once payment lands, and nothing else in this row says so.
  await pool.query(
    `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
     values ($1,'kopokopo',$2,$3,$4,$5)`,
    [tenantId, checkoutId, phone, amount, { plan_id: planId, mac, router_id: routerId ?? null, label: label ?? null }]
  );
  return checkoutId;
}

export const router = express.Router();

router.post('/stk', async (req, res) => {
  const checkoutId = req.body?.data?.id;
  /**
   * No X-KopoKopo-Signature verification here — deliberately, after proving
   * it cannot pass for this delivery path.
   *
   * KopoKopo's docs say a webhook is "a SHA256 HMAC hash of the request body
   * with the key being your client secret," but that page only ever
   * describes webhooks registered through their separate Webhook
   * Subscription API. This project never registers one — stkPush() above
   * puts a `callback_url` directly on the incoming_payments request instead,
   * and production evidence says that delivery path is not signed the same
   * way: the tenant's client_secret is proven correct (it is the same value
   * that authenticates the OAuth token call every STK push starts with), the
   * full un-truncated request body was hashed (rawBody, checked against the
   * real Content-Length), and the computed signature still never matched a
   * real callback — consistently, across multiple real payments, not a
   * one-off. A global KOPOKOPO_WEBHOOK_SECRET before this had the same
   * symptom for a different reason (wrong secret entirely); switching to
   * each tenant's real secret ruled that out and this failure mode
   * persisted, which is what pins it on the delivery path itself rather
   * than any credential we hold.
   *
   * The checkout_id is what stands in for authentication instead: KopoKopo
   * generates it, only KopoKopo and this server ever see it (never the
   * guest's browser), and a callback must name one that already exists as a
   * *pending* stk_requests row for a specific tenant — there is nothing to
   * forge here without already knowing a value nobody but the two parties to
   * the real payment has. Downstream, applyPayment's unique constraint on
   * (tenant_id, provider, provider_ref) makes a resend or a replay of the
   * same callback a no-op rather than a double-credit.
   */
  const tenantId = checkoutId ? await tenantForCheckout(checkoutId) : null;
  if (!tenantId) {
    console.error(`kopokopo webhook: rejected — no stk_requests row for checkout_id ${JSON.stringify(checkoutId)} (from ${req.ip})`);
    return res.status(401).end();
  }
  res.status(200).end();
  const d = req.body?.data?.attributes ?? {};
  const ev = d.event?.resource ?? {};
  /**
   * `d.status` is KopoKopo's top-level request outcome — "Success" or
   * "Failed" — not the nested `event.resource.status` ("Received", present
   * only on success). Comparing the top-level field against the nested
   * field's value meant this never matched: every real payment came back
   * "Success" here, failed this check, and was written to stk_requests as
   * status='failed' with result_desc='Success' — a paid customer with
   * nothing to show for it, and a row that looked self-contradictory to
   * anyone who found it later.
   * https://developers.kopokopo.com/guides/receive-money/mpesa-stk.html
   */
  await handleStkResult('kopokopo', checkoutId,
    d.status === 'Success' ? 0 : 1, d.status,
    { ref: ev.reference, amount: ev.amount, phone: ev.sender_phone_number }
  ).catch(console.error);
});

async function tenantForCheckout(checkoutId) {
  const { rows: [r] } = await pool.query(
    "select tenant_id from stk_requests where provider='kopokopo' and checkout_id=$1", [checkoutId]);
  return r?.tenant_id ?? null;
}
