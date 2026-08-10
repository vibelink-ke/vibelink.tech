import axios from 'axios';
import express from 'express';
import { config, tenantByShortcode } from '../db.js';
import { applyPayment } from './apply.js';

const BASE = process.env.DARAJA_ENV === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';

async function token(cfg) {
  const key = Buffer.from(`${cfg.credentials.consumer_key}:${cfg.credentials.consumer_secret}`).toString('base64');
  const { data } = await axios.get(`${BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${key}` } });
  return data.access_token;
}

const stamp = () => new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);

/** STK push on a paybill — used for PPPoE auto-charge and portal payments. */
export async function stkPush(tenantId, { phone, amount, accountRef, description }) {
  const cfg = await config(tenantId, 'daraja');
  const ts = stamp();
  const password = Buffer.from(cfg.shortcode + cfg.credentials.passkey + ts).toString('base64');
  const { data } = await axios.post(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    BusinessShortCode: cfg.shortcode,
    Password: password, Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone, PartyB: cfg.shortcode, PhoneNumber: phone,
    CallBackURL: `${process.env.BASE_URL}/webhooks/daraja/stk`,
    AccountReference: accountRef, TransactionDesc: description ?? 'Internet'
  }, { headers: { Authorization: `Bearer ${await token(cfg)}` } });
  return data;   // CheckoutRequestID -> store in stk_requests
}

/** One-time: point Safaricom at our C2B URLs. */
export async function registerC2B(tenantId) {
  const cfg = await config(tenantId, 'daraja');
  const { data } = await axios.post(`${BASE}/mpesa/c2b/v1/registerurl`, {
    ShortCode: cfg.shortcode,
    ResponseType: 'Completed',
    ConfirmationURL: `${process.env.BASE_URL}/webhooks/daraja/confirm`,
    ValidationURL: `${process.env.BASE_URL}/webhooks/daraja/validate`
  }, { headers: { Authorization: `Bearer ${await token(cfg)}` } });
  return data;
}

export const router = express.Router();

// Validation: accept anything we can plausibly place; Safaricom needs a fast 200.
router.post('/validate', (_req, res) => res.json({ ResultCode: 0, ResultDesc: 'Accepted' }));

router.post('/confirm', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });      // ack first, work after
  const b = req.body;
  const tenantId = await tenantByShortcode('daraja', String(b.BusinessShortCode));
  if (!tenantId) return;
  await applyPayment(tenantId, {
    provider: 'daraja',
    ref: b.TransID,
    amount: Number(b.TransAmount),
    phone: normalise(b.MSISDN),
    name: [b.FirstName, b.MiddleName, b.LastName].filter(Boolean).join(' '),
    rawAccount: b.BillRefNumber,
    payload: b
  }).catch(console.error);
});

router.post('/stk', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const cb = req.body?.Body?.stkCallback;
  if (!cb) return;
  const items = Object.fromEntries((cb.CallbackMetadata?.Item ?? []).map(i => [i.Name, i.Value]));
  // stk_requests row carries tenant + purpose; failure path is handled by jobs.retryStk
  await handleStkResult('daraja', cb.CheckoutRequestID, cb.ResultCode, cb.ResultDesc, {
    ref: items.MpesaReceiptNumber, amount: items.Amount, phone: String(items.PhoneNumber ?? '')
  }).catch(console.error);
});

export async function handleStkResult(provider, checkoutId, code, desc, tx) {
  const { pool } = await import('../db.js');
  const { rows: [req] } = await pool.query(
    'select * from stk_requests where provider=$1 and checkout_id=$2', [provider, checkoutId]);
  if (!req) return;
  const ok = Number(code) === 0;
  await pool.query('update stk_requests set status=$2, result_code=$3, result_desc=$4 where id=$1',
    [req.id, ok ? 'success' : 'failed', String(code), desc]);
  if (!ok) return;
  const p = req.purpose;
  await applyPayment(req.tenant_id, {
    provider, ref: tx.ref, amount: Number(tx.amount), phone: tx.phone, name: null,
    rawAccount: null, payload: { checkoutId },
    target: p.subscriber_id ? { type: 'subscriber', id: p.subscriber_id }
                            : { type: 'hotspot', planId: p.plan_id, mac: p.mac }
  });
}

export const normalise = (m) => String(m).replace(/^\+?(?:254)?0?/, '254');
