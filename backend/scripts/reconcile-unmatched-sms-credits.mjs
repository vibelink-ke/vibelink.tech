#!/usr/bin/env node
/**
 * One-off cleanup for the race-condition bug fixed in payments/daraja.js:
 * an SMS-credit (or hotspot) purchase whose C2B confirmation webhook won
 * the race against its own STK result callback landed as `payments.status
 * = 'unmatched'` with raw_account = 'SMSCREDIT'/'HOTSPOT', instead of being
 * applied — the tenant's SMS balance was never credited and no expense was
 * ever logged for it.
 *
 * Dry-run by default: prints exactly what it would do and touches nothing.
 * Only actually applies fixes when run with --apply.
 *
 *   node scripts/reconcile-unmatched-sms-credits.mjs            # dry run
 *   node scripts/reconcile-unmatched-sms-credits.mjs --apply    # fix for real
 *
 * Scope: SMS credits only. A mis-marked HOTSPOT purchase is reported but
 * never auto-fixed — retroactively granting hotspot access to a purchase
 * that old risks handing it to a customer who has since bought another
 * bundle or moved on, which needs a human looking at the specific case,
 * not a script guessing.
 */
import 'dotenv/config';
import { pool } from '../src/db.js';

const apply = process.argv.includes('--apply');

const { rows: candidates } = await pool.query(`
  select id, tenant_id, provider, provider_ref, amount, payer_phone, raw_account, received_at
    from payments
   where status = 'unmatched' and raw_account in ('SMSCREDIT', 'HOTSPOT')
   order by received_at`);

if (!candidates.length) {
  console.log('No mis-matched SMSCREDIT/HOTSPOT payments found — nothing to clean up.');
  await pool.end();
  process.exit(0);
}

console.log(`Found ${candidates.length} candidate row(s).${apply ? '' : ' (dry run — pass --apply to actually fix)'}\n`);

let fixed = 0, skipped = 0, reported = 0;

for (const pay of candidates) {
  if (pay.raw_account === 'HOTSPOT') {
    console.log(`[REVIEW NEEDED] payment ${pay.id} — HOTSPOT, KES ${pay.amount}, ${pay.payer_phone}, `
      + `received ${pay.received_at.toISOString()} — not auto-fixed, check by hand.`);
    reported++;
    continue;
  }

  // The stk_request that was actually meant to handle this transaction:
  // handleStkResult flips status to 'success' before ever reaching the
  // sms_credit branch, so a race-lost purchase still shows success here
  // even though its own insert into payments was silently discarded.
  //
  // Not matched by phone: confirmed live that Safaricom's C2B confirmation
  // sometimes sends a hashed/tokenized MSISDN instead of the real number
  // for some shortcode configurations (payload.MSISDN a 64-char hex string,
  // not a phone number) — stk_requests.phone holds the real one the tenant
  // actually typed, so the two can never be equal for those transactions.
  // Matched on tenant + provider + amount + closest timestamp instead, with
  // a 15-minute window: two unrelated purchases of the same amount from the
  // same tenant almost never land within 15 minutes of each other, and if
  // they do, this reports it as ambiguous rather than guessing.
  const { rows: matches } = await pool.query(
    `select id, purpose, created_at from stk_requests
      where tenant_id = $1 and provider = $2 and amount = $3
        and status = 'success' and purpose->>'type' = 'sms_credit'
        and abs(extract(epoch from (created_at - $4))) < 900
      order by abs(extract(epoch from (created_at - $4))) asc`,
    [pay.tenant_id, pay.provider, pay.amount, pay.received_at]);

  if (!matches.length) {
    console.log(`[NO MATCH] payment ${pay.id} — KES ${pay.amount}, ${pay.payer_phone}, `
      + `received ${pay.received_at.toISOString()} — no matching successful sms_credit stk_request within 15 min, skipping.`);
    skipped++;
    continue;
  }
  if (matches.length > 1) {
    console.log(`[AMBIGUOUS] payment ${pay.id} — KES ${pay.amount}, received ${pay.received_at.toISOString()} — `
      + `${matches.length} equally-plausible stk_requests within 15 minutes (${matches.map((m) => m.id).join(', ')}), `
      + 'skipping rather than guessing which one it was.');
    skipped++;
    continue;
  }

  const req = matches[0];
  const p = req.purpose;
  const forTenant = p.for_tenant ?? p.tenant_id;
  const quantity = Number(p.quantity) || 0;

  if (!forTenant || !quantity) {
    console.log(`[BAD PURPOSE] payment ${pay.id} — matched stk_request ${req.id} but its purpose `
      + `is missing tenant/quantity (${JSON.stringify(p)}), skipping.`);
    skipped++;
    continue;
  }

  console.log(`[${apply ? 'FIXING' : 'WOULD FIX'}] payment ${pay.id} → tenant ${forTenant}: `
    + `credit ${quantity} SMS credits, log KES ${pay.amount} expense, mark payment applied `
    + `(matched stk_request ${req.id}, created ${req.created_at.toISOString()})`);

  if (!apply) { fixed++; continue; }

  // A dedicated client, not pool.query() for begin/commit — the pool can
  // (and will) hand out a different connection per call, which makes
  // "begin" on one connection and the real work on others not actually be
  // one transaction at all.
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `update payments set status='applied', applied_at=now(),
              payload = coalesce(payload, '{}'::jsonb) || $2
        where id=$1`,
      [pay.id, { type: 'sms_credit', for_tenant: forTenant, quantity, reconciled: true }]);
    await c.query('update tenants set platform_sms_balance = platform_sms_balance + $2 where id=$1',
      [forTenant, quantity]);
    await c.query(
      `insert into expenses (tenant_id, category, description, amount, paid_to, status, paid_at)
       values ($1,'SMS',$2,$3,'Platform SMS gateway','paid',now())`,
      [forTenant, `${quantity} SMS credits (reconciled)`, Number(pay.amount)]);
    await c.query('commit');
    fixed++;
  } catch (e) {
    await c.query('rollback');
    console.error(`  failed to apply fix for payment ${pay.id}:`, e.message);
    skipped++;
  } finally {
    c.release();
  }
}

console.log(`\n${apply ? 'Fixed' : 'Would fix'}: ${fixed}   Skipped/no-match: ${skipped}   Needs manual review: ${reported}`);
if (!apply && fixed) console.log('Re-run with --apply to actually make these changes.');

await pool.end();
