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

router.post('/stk', express.json({ verify: keepRaw }), async (req, res) => {
  if (!verify(req)) {
    console.error(`kopokopo webhook: rejected unsigned/invalid request from ${req.ip}`);
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
  await handleStkResult('kopokopo', req.body?.data?.id,
    d.status === 'Success' ? 0 : 1, d.status,
    { ref: ev.reference, amount: ev.amount, phone: ev.sender_phone_number }
  ).catch(console.error);
});

function keepRaw(req, _res, buf) { req.rawBody = buf; }

let warnedNoSecret = false;

// Fails closed: no secret configured means every callback is rejected, not
// silently trusted. An unset secret used to make this return true
// unconditionally, which is indistinguishable from "no verification at all."
function verify(req) {
  const secret = process.env.KOPOKOPO_WEBHOOK_SECRET;
  if (!secret) {
    if (!warnedNoSecret) {
      console.error('KOPOKOPO_WEBHOOK_SECRET is not set — /webhooks/kopokopo/stk will reject '
        + 'all requests until it is.');
      warnedNoSecret = true;
    }
    return false;
  }
  const sig = Buffer.from(crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex'));
  const given = Buffer.from(req.get('X-KopoKopo-Signature') ?? '');
  return sig.length === given.length && crypto.timingSafeEqual(sig, given);
}
