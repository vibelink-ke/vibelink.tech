/**
 * Confirming an M-Pesa code with Safaricom before it is applied.
 *
 * A code typed in from a customer's message, or pasted from a statement, is only somebody's word that money arrived. Daraja's Transaction
 * Status query answers from Safaricom's own records: whether that code exists, how much it was, who paid, and which paybill received it.
 * A code is applied only when Safaricom says it is completed AND that it was paid to this account's own paybill, and the amount applied is
 * Safaricom's, never the one that was typed.
 *
 * The answer does not arrive with the request. Safaricom replies "queued" and calls back a moment later, so every question is a row in
 * mpesa_confirmations: asked, then resolved by the callback. That row is also what stands between a real answer and a forged one: a
 * callback is acted on only when it names a conversation that this server opened and that is still waiting.
 *
 * What Safaricom does NOT tell us is the account number the customer typed. So the customer comes from the line that was pasted (an
 * account number beside the code) or, failing that, from the payer's phone; a payment that matches nobody is kept as unmatched for a
 * person to assign, exactly like one that arrives the normal way.
 *
 * Needs the gateway's initiator name and password (Settings > Payment gateways), and that initiator must hold the "Transaction Status
 * query" role on the M-Pesa portal.
 */
import axios from 'axios';
import express from 'express';
import { pool, config, platformCollectConfig } from '../db.js';
import { applyPayment, accrueSettlement } from './apply.js';
import { darajaToken, DARAJA_BASE, withSecret, verifyWebhook } from './daraja.js';

const CODE = /^[A-Z0-9]{10}$/;

/** The paybills a code could have been paid to: this account's own, then the platform's if payments are collected there. Only those that can be asked. */
async function gateways(tenantId) {
  const out = [];
  const add = (cfg, platform) => {
    if (!cfg?.shortcode || out.some((g) => String(g.cfg.shortcode) === String(cfg.shortcode))) return;
    if (!cfg.credentials?.initiator_name || !cfg.credentials?.initiator_password) return;
    out.push({ cfg, platform });
  };
  add(await config(tenantId, 'daraja').catch(() => null), false);
  add(await platformCollectConfig(tenantId, 'daraja').catch(() => null), true);
  return out;
}

/** Can this account ask Safaricom at all? Says why not, in words for the screen. */
export async function canConfirm(tenantId) {
  const any = (await config(tenantId, 'daraja').catch(() => null)) ?? (await platformCollectConfig(tenantId, 'daraja').catch(() => null));
  if (!any) return { ok: false, why: 'No M-Pesa (Daraja) paybill is set up for this account.' };
  if (!(await gateways(tenantId)).length)
    return { ok: false, why: 'Confirming a code needs the initiator name and password from the M-Pesa portal. Add them under Settings > Payment gateways. That initiator needs the "Transaction Status query" role.' };
  if (!/^https:\/\//.test(process.env.BASE_URL ?? '')) return { ok: false, why: 'BASE_URL is not a public https address, so M-Pesa cannot send its answer back to this server.' };
  return { ok: true };
}

async function ask(cfg, code) {
  const { securityCredential } = await import('./daraja-credential.js');
  const { data } = await axios.post(`${DARAJA_BASE}/mpesa/transactionstatus/v1/query`, {
    Initiator: cfg.credentials.initiator_name,
    SecurityCredential: securityCredential(cfg.credentials.initiator_password),
    CommandID: 'TransactionStatusQuery',
    TransactionID: code,
    PartyA: cfg.shortcode,
    IdentifierType: '4',
    ResultURL: withSecret(`${process.env.BASE_URL}/webhooks/daraja/txstatus-result`),
    QueueTimeOutURL: withSecret(`${process.env.BASE_URL}/webhooks/daraja/txstatus-timeout`),
    Remarks: 'Confirm payment',
    Occasion: 'Reconcile',
  }, { headers: { Authorization: `Bearer ${await darajaToken(cfg)}` }, timeout: 20000 });
  if (data.ResponseCode && data.ResponseCode !== '0') throw new Error(data.ResponseDescription ?? data.errorMessage ?? 'M-Pesa refused the question.');
  if (!data.ConversationID) throw new Error('M-Pesa did not open a conversation for the question.');
  return data.ConversationID;
}

const why = (e) => e?.response?.data?.errorMessage ?? e?.response?.data?.ResponseDescription ?? e?.message ?? String(e);

/** Ask the next paybill on the row's list. Marks the row failed when there is none left or Safaricom will not take the question. */
async function askNext(row, lastAnswer = null) {
  const all = await gateways(row.tenant_id);
  const left = [...(row.shortcodes ?? [])];
  while (left.length) {
    const shortcode = left.shift();
    const g = all.find((x) => String(x.cfg.shortcode) === String(shortcode));
    if (!g) continue;
    try {
      const conversationId = await ask(g.cfg, row.code);
      await pool.query('update mpesa_confirmations set shortcode=$2, shortcodes=$3, conversation_id=$4 where id=$1', [row.id, shortcode, left, conversationId]);
      return true;
    } catch (e) {
      lastAnswer = `M-Pesa would not take the question for paybill ${shortcode}: ${why(e)}`;
    }
  }
  await settle(row.id, lastAnswer && /not take the question/.test(lastAnswer) ? 'failed' : 'not_found', lastAnswer ?? 'M-Pesa has no such code on your paybill.');
  return false;
}

const settle = (id, status, detail, extra = {}) => pool.query(
  `update mpesa_confirmations set status=$2, detail=$3, amount=coalesce($4, amount), payer=coalesce($5, payer), result=coalesce($6::jsonb, result),
          resolved_at=now(), conversation_id=null where id=$1`,
  [id, status, String(detail ?? '').slice(0, 400), extra.amount ?? null, extra.payer ?? null, extra.result ? JSON.stringify(extra.result) : null]);

/**
 * Open a question about one code. Returns the row's id; the outcome lands on the row when Safaricom answers.
 * `account` is the customer's account number if the pasted line had one; `phone` the payer's if it had that.
 */
export async function requestConfirmation(tenantId, { code, account = null, phone = null, staffId = null }) {
  const ref = String(code ?? '').trim().toUpperCase();
  if (!CODE.test(ref)) throw new Error(`"${code}" is not an M-Pesa code`);
  const list = (await gateways(tenantId)).map((g) => String(g.cfg.shortcode));
  if (!list.length) throw new Error((await canConfirm(tenantId)).why ?? 'No paybill can be asked.');
  const { rows: [row] } = await pool.query(
    `insert into mpesa_confirmations (tenant_id, code, account, phone, shortcodes, requested_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [tenantId, ref, account ? String(account).trim().slice(0, 60) : null, phone ?? null, list, staffId]);
  await askNext(row);
  return row.id;
}

/** Safaricom's answer, checked and acted on. Everything that decides whether money is applied is here. */
async function resolve(row, result) {
  const p = Object.fromEntries((result?.ResultParameters?.ResultParameter ?? []).map((x) => [x.Key, x.Value]));
  const all = await gateways(row.tenant_id);
  const gateway = all.find((x) => String(x.cfg.shortcode) === String(row.shortcode));

  if (Number(result.ResultCode) !== 0) {
    // Not on this paybill (or not at all). Try the next paybill before saying so.
    return askNext(row, `M-Pesa: ${String(result.ResultDesc ?? 'no such transaction').slice(0, 200)}`);
  }
  const receipt = String(p.ReceiptNo ?? '').trim().toUpperCase();
  if (receipt && receipt !== row.code) return settle(row.id, 'failed', `M-Pesa answered about a different code (${receipt}).`, { result: p });

  const status = String(p.TransactionStatus ?? '').trim();
  if (!/^completed$/i.test(status)) return settle(row.id, 'failed', `M-Pesa says this transaction is "${status || 'unknown'}", not completed.`, { result: p });

  // "7924336 - VIBELINK TELECOMMUNICATIONS": the code must be money paid TO this paybill. A code where the paybill is the payer (a payout
  // it made) or that belongs to somebody else's business is real, and is not a customer's payment.
  const creditTo = String(p.CreditPartyName ?? '').split(' - ')[0].trim();
  if (creditTo !== String(row.shortcode)) {
    return settle(row.id, 'not_ours', `This code is a payment to ${String(p.CreditPartyName ?? 'another account').slice(0, 80)}, not to paybill ${row.shortcode}.`, { result: p });
  }
  const amount = Number(p.Amount);
  if (!(amount > 0)) return settle(row.id, 'failed', 'M-Pesa gave no amount for this code.', { result: p });

  const [who, ...nameParts] = String(p.DebitPartyName ?? '').split(' - ');
  const digits = who.replace(/[^0-9]/g, '');
  const payerPhone = /^\d{9,12}$/.test(who.trim().replace(/^\+/, '')) ? digits.replace(/^0/, '254') : null;   // sometimes masked: then there is no phone to match on
  const payer = nameParts.join(' - ').trim() || null;

  const { rows: [have] } = await pool.query('select 1 from payments where tenant_id=$1 and upper(provider_ref)=$2 limit 1', [row.tenant_id, row.code]);
  if (have) return settle(row.id, 'duplicate', 'Already recorded.', { amount, payer, result: p });

  const out = await applyPayment(row.tenant_id, {
    provider: 'daraja', ref: row.code, amount, phone: payerPhone ?? row.phone ?? null, name: payer, rawAccount: row.account ?? null,
    payload: { ...p, source: 'confirmed with M-Pesa', TransID: row.code, TransAmount: amount.toFixed(2), BusinessShortCode: String(row.shortcode), BillRefNumber: row.account ?? '' },
  });
  // Money that landed on the platform's paybill for another account is owed onward, the same as when it arrives by itself.
  if (gateway?.platform && out && !out.duplicate) await accrueSettlement(row.tenant_id, amount).catch((e) => console.error('confirm: settlement', row.code, e.message));

  if (out?.duplicate) return settle(row.id, 'duplicate', 'Already recorded.', { amount, payer, result: p });
  if (out?.unmatched) {
    return settle(row.id, 'unmatched', row.account
      ? `Confirmed by M-Pesa (KES ${amount}), but no customer has account ${row.account}. It is in the unmatched list for you to assign.`
      : `Confirmed by M-Pesa (KES ${amount}), but it could not be matched to a customer. It is in the unmatched list for you to assign.`, { amount, payer, result: p });
  }
  return settle(row.id, 'applied', `Confirmed by M-Pesa and applied: KES ${amount}${payer ? ` from ${payer}` : ''}.`, { amount, payer, result: p });
}

/** The row a callback is about. The answer can arrive before the row has its conversation id written, so a few short tries. */
async function waitingRow(conversationId) {
  for (let i = 0; i < 5; i += 1) {
    const { rows: [row] } = await pool.query("select * from mpesa_confirmations where conversation_id=$1 and status='pending'", [conversationId]);
    if (row) return row;
    await new Promise((ok) => setTimeout(ok, 800));
  }
  return null;
}

export const verifyRouter = express.Router();

verifyRouter.post('/txstatus-result', verifyWebhook, express.json(), async (req, res) => {
  const r = req.body?.Result ?? {};
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });       // ack first, work after
  if (!r.ConversationID) return;
  try {
    const row = await waitingRow(r.ConversationID);
    if (!row) return console.warn('daraja txstatus: an answer for a conversation nobody is waiting on', r.ConversationID);
    await resolve(row, r);
  } catch (e) {
    console.error('daraja txstatus:', e?.stack ?? e);
    await pool.query("update mpesa_confirmations set status='failed', detail=$2, resolved_at=now(), conversation_id=null where conversation_id=$1 and status='pending'",
      [r.ConversationID, `Could not be applied: ${String(e.message).slice(0, 300)}`]).catch(() => {});
  }
});

verifyRouter.post('/txstatus-timeout', verifyWebhook, express.json(), async (req, res) => {
  const r = req.body?.Result ?? {};
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  if (!r.ConversationID) return;
  await pool.query("update mpesa_confirmations set status='failed', detail='M-Pesa did not answer in time. Try this code again.', resolved_at=now(), conversation_id=null where conversation_id=$1 and status='pending'",
    [r.ConversationID]).catch(() => {});
});

/** Wait for a set of questions to be answered, up to a limit. Returns the rows as they stand, answered or still waiting. */
export async function awaitConfirmations(ids, ms = 30000) {
  const until = Date.now() + ms;
  for (;;) {
    const { rows } = await pool.query('select id, code, status, detail, amount, payer, account from mpesa_confirmations where id = any($1::uuid[])', [ids]);
    if (!rows.some((x) => x.status === 'pending') || Date.now() > until) return rows;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
}

/** A question nobody answered: after ten minutes it is closed, so the code can be asked again and the list does not show it waiting for ever. */
export async function expireConfirmations() {
  await pool.query("update mpesa_confirmations set status='failed', detail='M-Pesa never answered. Try this code again.', resolved_at=now(), conversation_id=null where status='pending' and created_at < now() - interval '10 minutes'");
}
