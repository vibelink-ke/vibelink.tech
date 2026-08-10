import express from 'express';
import { pool } from '../db.js';
import { applyPayment } from './apply.js';

/**
 * Till / paybill WITHOUT API access.
 * The ISP installs the companion Android app on the SIM that receives M-Pesa SMS.
 * It POSTs every message here; we parse, de-duplicate on the M-Pesa code, and apply.
 * Anything ambiguous lands in payments.status='unmatched' for the Payments screen.
 */
export const router = express.Router();

router.post('/sms', async (req, res) => {
  const { tenantId, body, deviceKey } = req.body;
  if (deviceKey !== process.env.FORWARDER_KEY) return res.status(401).end();
  res.json({ ok: true });

  const { rows: [row] } = await pool.query(
    'insert into sms_inbox (tenant_id, body) values ($1,$2) returning id', [tenantId, body]);

  const tx = parseMpesaSms(body);
  if (!tx) return;
  const out = await applyPayment(tenantId, { ...tx, provider: 'manual_till', payload: { sms: body } });
  await pool.query('update sms_inbox set parsed=true, payment_id=$2 where id=$1', [row.id, out.paymentId ?? null]);
});

/** Paste a statement / type a code by hand from the dashboard. */
router.post('/manual-entry', async (req, res) => {
  const { tenantId, code, amount, phone, name, account } = req.body;
  const out = await applyPayment(tenantId, {
    provider: 'manual_till', ref: code, amount: Number(amount),
    phone, name, rawAccount: account, payload: { source: 'manual' }
  });
  res.json(out);
});

const MONEY = String.raw`Ksh([\d,]+\.\d{2})`;

/**
 * Handles both shapes Safaricom sends to a till/paybill owner:
 *   "SJ71M4PL8Q Confirmed. You have received Ksh2,500.00 from JOHN M NJUGUNA 0722118340 on 1/8/26..."
 *   "...for account ZN-1042..."
 */
export function parseMpesaSms(body) {
  const code = body.match(/^([A-Z0-9]{10})\s+Confirmed/i)?.[1];
  const amount = body.match(new RegExp(MONEY))?.[1];
  if (!code || !amount) return null;
  const from = body.match(/from\s+([A-Z' ]+?)\s+(\d{9,12})/i);
  const account = body.match(/(?:for account|acc(?:ount)?\.?)\s*([A-Za-z0-9\- ]{3,20})/i)?.[1];
  return {
    ref: code,
    amount: Number(amount.replace(/,/g, '')),
    name: from?.[1]?.trim() ?? null,
    phone: from?.[2] ? from[2].replace(/^0/, '254') : null,
    rawAccount: account?.trim() ?? null
  };
}
