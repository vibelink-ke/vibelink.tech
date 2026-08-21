import axios from 'axios';
import express from 'express';
import crypto from 'node:crypto';
import { config, pool } from '../db.js';
import { handleStkResult } from './daraja.js';

/**
 * Bank STK push. Equity Jenga shown; Co-op and KCB Buni expose the same
 * "push to phone, callback on completion" shape, so they share this adapter.
 */
const ENDPOINTS = {
  equity: 'https://api.jengahq.io/transaction/v2/stkpush',
  coop:   'https://openapi.co-opbank.co.ke/stk/v1/push',
  kcb:    'https://api.buni.kcbgroup.com/mm/api/request/stkpush'
};

/**
 * Same problem as daraja.js's webhook secret, and this endpoint had no
 * answer to it at all: none of these three banks sign their callbacks, so
 * without a secret in the URL, POST /webhooks/bank/<bank> would accept a
 * forged request from anyone on the internet who could guess or learn a
 * pending transaction id — crediting whatever amount the request claimed,
 * to whichever subscriber it named. Fails closed: unset means every request
 * is rejected, loudly, rather than every request being accepted.
 */
const WEBHOOK_SECRET = process.env.BANKSTK_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.error('BANKSTK_WEBHOOK_SECRET is not set — /webhooks/bank/* will reject all '
    + 'requests until it is. Set it to a long random value, the same one on every deploy.');
}

function verifyWebhook(req, res, next) {
  const given = Buffer.from(String(req.query.k ?? ''));
  const expected = Buffer.from(WEBHOOK_SECRET ?? '');
  if (!WEBHOOK_SECRET || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    console.error(`bankstk webhook: rejected unsigned/invalid request to ${req.path} from ${req.ip}`);
    return res.status(401).end();
  }
  next();
}

export async function stkPush(tenantId, { bank, phone, amount, accountRef, subscriberId }) {
  const cfg = await config(tenantId, 'bankstk');
  const creds = cfg.credentials[bank];
  if (!creds) throw new Error(`bank ${bank} not connected for this tenant`);

  const callbackUrl = `${process.env.BASE_URL}/webhooks/bank/${bank}`
    + (WEBHOOK_SECRET ? `?k=${WEBHOOK_SECRET}` : '');
  const { data } = await axios.post(ENDPOINTS[bank], {
    merchantAccount: creds.account,
    amount: Math.round(amount),
    msisdn: phone,
    reference: accountRef,
    callbackUrl
  }, { headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' } });

  const checkoutId = data.transactionId ?? data.reference;
  await pool.query(
    `insert into stk_requests (tenant_id, provider, checkout_id, phone, amount, purpose)
     values ($1,'bankstk',$2,$3,$4,$5)`,
    [tenantId, checkoutId, phone, amount, { subscriber_id: subscriberId, bank }]
  );
  return checkoutId;
}

export const router = express.Router();

router.post('/:bank', verifyWebhook, async (req, res) => {
  res.status(200).json({ status: 'ok' });
  const b = req.body;
  // amount is deliberately not read from the callback — handleStkResult uses
  // the amount recorded in stk_requests at push time, which the caller of
  // this callback cannot influence. See daraja.js's handleStkResult.
  await handleStkResult('bankstk', b.transactionId ?? b.reference,
    b.status === 'SUCCESS' ? 0 : 1, b.statusDescription ?? b.status,
    { ref: b.bankReference ?? b.transactionId, phone: b.msisdn }
  ).catch(console.error);
});
