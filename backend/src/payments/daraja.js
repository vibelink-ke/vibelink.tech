import axios from 'axios';
import express from 'express';
import crypto from 'node:crypto';
import { config, tenantByShortcode } from '../db.js';
import { applyPayment, accrueSettlement } from './apply.js';

const BASE = process.env.DARAJA_ENV === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';

/**
 * Safaricom does not sign Daraja callbacks, so the only thing standing
 * between "a real payment happened" and "anyone on the internet POSTed a
 * fake one" is a secret baked into the callback URL itself. Without this,
 * /webhooks/daraja/confirm and /stk would credit any amount to any account,
 * or mint a hotspot voucher, for whoever asked.
 *
 * Fails closed, not open: if this is unset, the webhook endpoints reject
 * every request rather than accepting unsigned ones. That is "payments
 * stop working" — loud, immediately visible, fixed by setting one env var —
 * instead of "payments are free," which is silent and only found by
 * reading the ledger after the fact.
 */
const WEBHOOK_SECRET = process.env.DARAJA_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.error('DARAJA_WEBHOOK_SECRET is not set — /webhooks/daraja/* will reject all '
    + 'requests until it is. Set it to a long random value, the same one on every deploy.');
}

const withSecret = (url) => WEBHOOK_SECRET ? `${url}?k=${WEBHOOK_SECRET}` : url;

function verifyWebhook(req, res, next) {
  const given = Buffer.from(String(req.query.k ?? ''));
  const expected = Buffer.from(WEBHOOK_SECRET ?? '');
  if (!WEBHOOK_SECRET || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    // Distinct from applyPayment failures below: this is a request that never
    // proved it came from Safaricom at all. Before this existed, a forged
    // webhook and a real one that happened to fail downstream looked
    // identical in the logs — this line is what makes "someone tried to
    // forge a payment" a thing an operator can actually go find.
    console.error(`daraja webhook: rejected unsigned/invalid request to ${req.path} from ${req.ip}`);
    return res.status(401).end();
  }
  next();
}

async function token(cfg) {
  const key = Buffer.from(`${cfg.credentials.consumer_key}:${cfg.credentials.consumer_secret}`).toString('base64');
  const { data } = await axios.get(`${BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${key}` } });
  return data.access_token;
}

const stamp = () => new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);

/**
 * Confirms the consumer key/secret actually work, without spending anything —
 * an OAuth token request is free and does not touch a real customer, unlike
 * an STK push. This is what the "Test" button on payment gateways is missing:
 * it only checks that the fields are filled in, never that Safaricom accepts
 * them, so credentials that were always wrong looked "complete" right up
 * until someone tried Register URLs and hit "Invalid Access Token" with no
 * earlier warning.
 */
export async function testAuth(tenantId) {
  const cfg = await config(tenantId, 'daraja');
  try {
    await token(cfg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.errorMessage ?? e?.response?.data ?? e.message };
  }
}

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
    CallBackURL: withSecret(`${process.env.BASE_URL}/webhooks/daraja/stk`),
    AccountReference: accountRef, TransactionDesc: description ?? 'Internet'
  }, { headers: { Authorization: `Bearer ${await token(cfg)}` } });
  return data;   // CheckoutRequestID -> store in stk_requests
}

/**
 * One-time: point Safaricom at our C2B URLs.
 *
 * v2, not v1. Safaricom's v1 registerurl endpoint rejects production
 * shortcodes with "Invalid Access Token" — a message that reads exactly
 * like a bad Consumer Key/Secret, even though the same token authenticates
 * every other call (STK push, a plain OAuth check) just fine. The
 * credentials were never the problem; only v2 accepts a production
 * shortcode's registration. Confirmed against this project's own gateway:
 * Test (a bare OAuth check) passed, Register URLs failed on v1 with this
 * exact error, and the product list on Safaricom's portal already showed
 * "C2B V2" enabled — the token was good, the endpoint version was not.
 * https://github.com/safaricom/mpesa-node-library/issues/56
 */
export async function registerC2B(tenantId) {
  const cfg = await config(tenantId, 'daraja');
  const { data } = await axios.post(`${BASE}/mpesa/c2b/v2/registerurl`, {
    ShortCode: cfg.shortcode,
    ResponseType: 'Completed',
    ConfirmationURL: withSecret(`${process.env.BASE_URL}/webhooks/daraja/confirm`),
    ValidationURL: withSecret(`${process.env.BASE_URL}/webhooks/daraja/validate`)
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
  console.log('daraja b2c result', r.ResultCode, r.ResultDesc, r.ConversationID ?? '');
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });      // ack first, work after

  // Matched by conversation_id, which settleTenants (jobs.js) records the
  // moment it queues the payout — this is the only place that actually
  // knows whether the money moved; the initiating call only ever gets
  // "queued" back from Safaricom.
  if (!r.ConversationID) return;
  const { pool } = await import('../db.js');
  const { rows: [row] } = await pool.query(
    "select id from settlements where conversation_id=$1 and status='processing'", [r.ConversationID]);
  if (!row) return;

  if (Number(r.ResultCode) === 0) {
    const items = Object.fromEntries(
      (r.ResultParameters?.ResultParameter ?? []).map((p) => [p.Key, p.Value]));
    await pool.query(
      "update settlements set status='paid', settled_at=now(), reference=$2 where id=$1",
      [row.id, String(items.TransactionReceipt ?? r.ConversationID)]);
  } else {
    // Back to 'pending', not 'failed' — the next settleTenants run picks it
    // straight back up rather than this needing a human to notice and
    // re-trigger it. A payout that fails the same way every night is still
    // visible in this log, which is the point of logging it either way.
    console.error('daraja b2c failed', r.ResultCode, r.ResultDesc, 'settlement', row.id);
    await pool.query("update settlements set status='pending', conversation_id=null where id=$1", [row.id]);
  }
});

// A timeout is not a failure: the payout may still have gone through, and
// treating it as failed is how money gets sent twice.
router.post('/b2c-timeout', express.json(), async (req, res) => {
  console.warn('daraja b2c timed out — the payout may still complete', JSON.stringify(req.body ?? {}));
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// Validation: accept anything we can plausibly place; Safaricom needs a fast 200.
router.post('/validate', verifyWebhook, (_req, res) => res.json({ ResultCode: 0, ResultDesc: 'Accepted' }));

router.post('/confirm', verifyWebhook, async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });      // ack first, work after
  const b = req.body;

  /**
   * A walk-in payment for a platform-collected tenant: BillRefNumber
   * carries "subdomain-accountcode" (see stkPushForSubscriber in
   * server.js), not a bare account code, since it landed on the platform
   * owner's own shortcode rather than that tenant's. Checked by subdomain
   * match rather than assuming BusinessShortCode is the owner's — a
   * customer could in principle type the platform paybill's own account
   * format into any paybill's menu, and only a real match should ever
   * route money to a tenant that never actually received it.
   */
  const billRef = String(b.BillRefNumber ?? '');
  const dash = billRef.indexOf('-');
  if (dash > 0) {
    const { pool } = await import('../db.js');
    const { rows: [t] } = await pool.query(
      'select id, platform_collect_enabled, settlement_commission_pct from tenants where subdomain=$1',
      [billRef.slice(0, dash)]);
    if (t?.platform_collect_enabled) {
      await applyPayment(t.id, {
        provider: 'daraja', ref: b.TransID, amount: Number(b.TransAmount), phone: normalise(b.MSISDN),
        name: [b.FirstName, b.MiddleName, b.LastName].filter(Boolean).join(' '),
        rawAccount: billRef.slice(dash + 1), payload: b,
      }).catch(console.error);
      await accrueSettlement(t.id, Number(b.TransAmount) * (1 - Number(t.settlement_commission_pct ?? 5) / 100))
        .catch(console.error);
      return;
    }
  }

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

router.post('/stk', verifyWebhook, async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const cb = req.body?.Body?.stkCallback;
  if (!cb) return;
  const items = Object.fromEntries((cb.CallbackMetadata?.Item ?? []).map(i => [i.Name, i.Value]));
  // stk_requests row carries tenant + purpose; a callback that never
  // arrives at all (as opposed to arriving with a failure code, handled
  // right here) is caught instead by jobs.js's expireStuckStkRequests.
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
    /**
     * A tenant buying platform SMS credit — charged to the platform owner's
     * own tenant (req.tenant_id here, since that owns the Daraja
     * credentials the STK push actually went out on), crediting a
     * *different* tenant's platform_sms_balance (p.tenant_id, whoever
     * actually requested the purchase). Recorded as its own payments row
     * for the payout tenant rather than folded into applyPayment/
     * settleSubscriber below, which only know how to credit a subscriber
     * or issue a voucher — neither applies to buying SMS credit.
     */
    /**
     * A tenant with no Daraja paybill of their own — the STK push actually
     * went out on the platform owner's account (req.tenant_id), same as
     * sms_credit above, but the money is this subscriber's payment, not a
     * purchase of anything. Applied to the real tenant (p.tenant_id), then
     * the net (minus the commission stkPushForSubscriber recorded) accrues
     * to that tenant's settlement balance for the next payout run.
     */
    if (p.type === 'platform_collect') {
      await applyPayment(p.tenant_id, {
        provider, ref: tx.ref, amount: Number(req.amount), phone: tx.phone, name: null,
        rawAccount: null, payload: { checkoutId },
        target: { type: 'subscriber', id: p.subscriber_id, invoiceId: p.invoice_id ?? null },
      });
      const commissionPct = Number(p.commissionPct ?? 5);
      await accrueSettlement(p.tenant_id, Number(req.amount) * (1 - commissionPct / 100));
      return;
    }

    if (p.type === 'sms_credit') {
      const ins = await pool.query(
        `insert into payments (tenant_id, provider, provider_ref, amount, payer_phone, status, applied_at, payload)
         values ($1,$2,$3,$4,$5,'applied',now(),$6)
         on conflict (tenant_id, provider, provider_ref) do nothing
         returning id`,
        [req.tenant_id, provider, tx.ref, Number(req.amount), tx.phone, { type: 'sms_credit', for_tenant: p.tenant_id, quantity: p.quantity }]);
      // Only on the row actually being new — a replayed webhook (Safaricom
      // retries a slow-to-acknowledge callback) must not credit twice for
      // one payment.
      if (ins.rows[0]) {
        await pool.query('update tenants set platform_sms_balance = platform_sms_balance + $2 where id=$1',
          [p.tenant_id, Number(p.quantity) || 0]);
      }
      return;
    }

    /**
     * The amount credited is what we asked the gateway to charge, recorded
     * in stk_requests when the push went out — never tx.amount, whatever
     * the callback claims. bankstk.js's webhook had no signature at all
     * until this was found, which meant amount was, in effect, however
     * much anyone who could reach the URL cared to name; even signed
     * callbacks (daraja, kopokopo) have no reason to trust a number the
     * far end supplies when the correct one is already sitting in this row.
     */
    await applyPayment(req.tenant_id, {
      provider, ref: tx.ref, amount: Number(req.amount), phone: tx.phone, name: null,
      rawAccount: null, payload: { checkoutId },
      target: p.subscriber_id ? { type: 'subscriber', id: p.subscriber_id, invoiceId: p.invoice_id ?? null }
                              : { type: 'hotspot', planId: p.plan_id, mac: p.mac, routerId: p.router_id, label: p.label }
    });
  } catch (e) {
    await pool.query(
      "update stk_requests set status='failed', result_desc=$2 where id=$1",
      [req.id, `paid, but could not be applied: ${String(e.message ?? e).slice(0, 200)}`]);
    throw e;
  }
}

export const normalise = (m) => String(m).replace(/^\+?(?:254)?0?/, '254');
