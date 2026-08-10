import axios from 'axios';
import express from 'express';
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

export async function stkPush(tenantId, { bank, phone, amount, accountRef, subscriberId }) {
  const cfg = await config(tenantId, 'bankstk');
  const creds = cfg.credentials[bank];
  if (!creds) throw new Error(`bank ${bank} not connected for this tenant`);

  const { data } = await axios.post(ENDPOINTS[bank], {
    merchantAccount: creds.account,
    amount: Math.round(amount),
    msisdn: phone,
    reference: accountRef,
    callbackUrl: `${process.env.BASE_URL}/webhooks/bank/${bank}`
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

router.post('/:bank', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  const b = req.body;
  await handleStkResult('bankstk', b.transactionId ?? b.reference,
    b.status === 'SUCCESS' ? 0 : 1, b.statusDescription ?? b.status,
    { ref: b.bankReference ?? b.transactionId, amount: b.amount, phone: b.msisdn }
  ).catch(console.error);
});
