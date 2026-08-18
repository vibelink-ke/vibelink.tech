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

/**
 * Send money out — the other direction from everything else here.
 *
 * This is what settles a tenant who collects on somebody else's shortcode: the
 * money lands centrally and has to be paid on to them. It is also the only way
 * to refund without someone walking to an agent.
 *
 * The initiator password is never sent. It is RSA-encrypted with Safaricom's
 * published certificate into a SecurityCredential, which is what the endpoint
 * expects; daraja-credential.js does that.
 *
 * Nothing here decides that a payout is owed. It performs one that has already
 * been decided, and records nothing itself — the caller owns the ledger, so a
 * retry after a timeout cannot invent a second payment.
 */
export async function b2c(tenantId, { phone, amount, remarks = 'Settlement', occasion = '' }) {
  const cfg = await config(tenantId, 'daraja');
  if (!cfg) throw new Error('No M-Pesa gateway is configured for this account.');

  const { initiator_name: initiator, initiator_password: initiatorPassword } = cfg.credentials ?? {};
  if (!initiator || !initiatorPassword) {
    throw new Error('Payouts need an initiator name and password from the M-Pesa portal. '
      + 'Add them under Settings → Payment gateways.');
  }

  const { securityCredential } = await import('./daraja-credential.js');
  const msisdn = normalise(phone);
  const value = Math.floor(Number(amount));
  if (!(value > 0)) throw new Error('A payout must be for a positive whole number of shillings.');

  const { data } = await axios.post(`${BASE}/mpesa/b2c/v1/paymentrequest`, {
    InitiatorName: initiator,
    SecurityCredential: securityCredential(initiatorPassword),
    // BusinessPayment: a settlement, not a promotion or salary. The choice
    // changes the message the recipient sees and how Safaricom reports it.
    CommandID: 'BusinessPayment',
    Amount: value,
    PartyA: cfg.shortcode,
    PartyB: msisdn,
    Remarks: String(remarks).slice(0, 100),
    QueueTimeOutURL: `${process.env.BASE_URL}/webhooks/daraja/b2c-timeout`,
    ResultURL: `${process.env.BASE_URL}/webhooks/daraja/b2c-result`,
    Occasion: String(occasion).slice(0, 100),
  }, { headers: { Authorization: `Bearer ${await token(cfg)}` } });

  if (data.ResponseCode && data.ResponseCode !== '0') {
    throw new Error(data.ResponseDescription ?? data.errorMessage ?? 'M-Pesa refused the payout.');
  }
  return { conversationId: data.ConversationID, originatorId: data.OriginatorConversationID, raw: data };
}

export const router = express.Router();

/**
 * Where a payout ends up.
 *
 * Safaricom answers the b2c call immediately with "queued" and reports the real
 * outcome here, minutes later. Logged rather than acted on: only the caller
 * knows what the payout was for, and guessing would be worse than a record
 * somebody can read.
 */
router.post('/b2c-result', express.json(), async (req, res) => {
  const r = req.body?.Result ?? {};
  console.log('daraja b2c result', r.ResultCode, r.ResultDesc, r.OriginatorConversationID ?? '');
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// A timeout is not a failure: the payout may still have gone through, and
// treating it as failed is how money gets sent twice.
router.post('/b2c-timeout', express.json(), async (req, res) => {
  console.warn('daraja b2c timed out — the payout may still complete', JSON.stringify(req.body ?? {}));
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

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

  /**
   * A thrown applyPayment must never leave this row saying "success" with
   * nothing behind it.
   *
   * That is exactly the shape a stale or malformed `purpose` produced here
   * once — Safaricom had been paid, this row said status='success', and there
   * was no payments row and no voucher, because issueVoucherAccess rejected
   * a plan id that turned out to be undefined. The caller of this function
   * only ever does `.catch(console.error)`, so the guest's own poll of
   * /hotspot/buy/:checkoutId kept reading a status its page does not treat
   * as either finished or failed — it sat on "check your phone" forever,
   * silently, for money already taken, with nothing an operator could see
   * short of reading a container log nobody was watching.
   *
   * Whatever caused it, that failure belongs on this row where the guest's
   * own poll and an operator looking at stk_requests can both see it, not
   * only in a log. The guest's page already handles status='failed' with a
   * message; this is what gives it one.
   */
  try {
    await applyPayment(req.tenant_id, {
      provider, ref: tx.ref, amount: Number(tx.amount), phone: tx.phone, name: null,
      rawAccount: null, payload: { checkoutId },
      target: p.subscriber_id ? { type: 'subscriber', id: p.subscriber_id }
                              : { type: 'hotspot', planId: p.plan_id, mac: p.mac }
    });
  } catch (e) {
    await pool.query(
      "update stk_requests set status='failed', result_desc=$2 where id=$1",
      [req.id, `paid, but could not be applied: ${String(e.message ?? e).slice(0, 200)}`]);
    throw e;
  }
}

export const normalise = (m) => String(m).replace(/^\+?(?:254)?0?/, '254');
