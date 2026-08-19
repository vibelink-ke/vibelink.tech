import axios from 'axios';
import express from 'express';
import crypto from 'node:crypto';
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
export async function stkPush(tenantId, { phone, amount, planId, mac, service }) {
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
  await pool.query(
    `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
     values ($1,'kopokopo',$2,$3,$4,$5)`,
    [tenantId, checkoutId, phone, amount, { plan_id: planId, mac }]
  );
  return checkoutId;
}

export const router = express.Router();

router.post('/stk', async (req, res) => {
  const checkoutId = req.body?.data?.id;
  /**
   * KopoKopo signs with the tenant's own OAuth client secret, not a secret we
   * pick — "Kopo Kopo signs each webhook request with the api_key you got
   * when creating an oauth application. The signature ... is a SHA256 HMAC
   * hash of the request body with the key being your client secret."
   * (https://developers.kopokopo.com/guides/webhooks/validating-webhooks.html)
   *
   * This verified against a single KOPOKOPO_WEBHOOK_SECRET env var instead —
   * a value with no relationship to any tenant's real client secret, so the
   * computed HMAC could never match what KopoKopo actually sent. Every
   * callback failed closed and was rejected, silently, for every tenant:
   * paid, SMS'd or not depending on which gateway a stray earlier request
   * matched, but never turned into a voucher, because the one message that
   * would have done that never got past this check.
   *
   * The checkout's own stk_requests row says which tenant it belongs to —
   * looking that up before verifying (not after) means the signature is
   * checked against the secret that could actually have produced it, and a
   * forged checkout_id for someone else's tenant still fails verification
   * with that tenant's real secret.
   */
  const tenantId = checkoutId ? await tenantForCheckout(checkoutId) : null;
  if (!tenantId) {
    console.error(`kopokopo webhook: rejected — no stk_requests row for checkout_id ${JSON.stringify(checkoutId)} (from ${req.ip})`);
    return res.status(401).end();
  }
  const why = await verifyReason(req, tenantId);
  if (why) {
    console.error(`kopokopo webhook: rejected — ${why} — tenant ${tenantId}, checkout_id ${checkoutId}, from ${req.ip}`);
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

/**
 * Fails closed: a missing secret or unmatched signature rejects the request,
 * not silently trusts it. Returns null when the request is good, or a short
 * reason string when it isn't — "rejected, cause unknown" was exactly why
 * every KopoKopo payment on this tenant sat unexplained for days before the
 * client-secret mismatch was found by reading source, not logs.
 */
async function verifyReason(req, tenantId) {
  // rawBody is attacker-influenceable (it is the webhook body itself) and
  // must never be able to throw its way into an unhandled rejection — that
  // takes the whole process down for every tenant, not just this request.
  if (!Buffer.isBuffer(req.rawBody)) return 'rawBody was not captured (body-parser verify hook)';
  const cfg = await config(tenantId, 'kopokopo');
  const secret = cfg?.credentials?.client_secret;
  if (!secret) return 'tenant has no kopokopo client_secret on file';
  const sig = Buffer.from(crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex'));
  const given = Buffer.from(req.get('X-KopoKopo-Signature') ?? '');
  if (given.length === 0) return 'request carried no X-KopoKopo-Signature header';
  if (sig.length !== given.length) return `signature length mismatch (ours ${sig.length}, theirs ${given.length})`;
  return crypto.timingSafeEqual(sig, given) ? null : 'signature did not match';
}
