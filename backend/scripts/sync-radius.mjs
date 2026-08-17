#!/usr/bin/env node
/**
 * Push every subscriber's PPPoE credentials into RADIUS.
 *
 *   node scripts/sync-radius.mjs            report what is missing, change nothing
 *   node scripts/sync-radius.mjs --apply    write the missing rows
 *
 * Why this exists: until c04cd58, creating a client wrote pppoe_user and
 * pppoe_pass to the subscribers table and nothing to radcheck, so FreeRADIUS had
 * never heard of them and every one of them failed to dial in. New clients are
 * synced on creation now; this is the one-off for everyone created before that.
 *
 * Safe to re-run. The upsert means an already-correct subscriber is rewritten to
 * the same value, and a subscriber whose password was changed in the UI is
 * corrected rather than duplicated.
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { syncSubscriberCredentials } from '../src/radius.js';

const apply = process.argv.includes('--apply');

const { rows } = await pool.query(
  `select s.id, s.tenant_id, s.name, s.pppoe_user,
          r.value as radius_password, s.pppoe_pass
     from subscribers s
     left join radcheck r on r.username = s.pppoe_user
                         and r.attribute = 'Cleartext-Password'
    where s.pppoe_user is not null and s.pppoe_pass is not null
    order by s.created_at`);

const missing  = rows.filter((r) => r.radius_password == null);
const mismatch = rows.filter((r) => r.radius_password != null && r.radius_password !== r.pppoe_pass);

console.log(`${rows.length} subscriber(s) with PPPoE credentials`);
console.log(`  ${missing.length} missing from RADIUS entirely — these cannot connect`);
console.log(`  ${mismatch.length} present but with a different password`);

// Names, not just a count: an operator needs to know who to call back.
for (const r of missing)  console.log(`  missing   ${r.pppoe_user}  ${r.name}`);
for (const r of mismatch) console.log(`  mismatch  ${r.pppoe_user}  ${r.name}`);

if (!apply) {
  if (missing.length || mismatch.length) console.log('\nRe-run with --apply to write these.');
  await pool.end();
  process.exit(0);
}

let done = 0;
let failed = 0;
for (const r of [...missing, ...mismatch]) {
  try {
    // Per subscriber rather than one transaction: one bad row should not undo
    // the rest, and every row written is a customer who can get online again.
    if (await syncSubscriberCredentials(pool, r.tenant_id, r.id)) done++;
  } catch (e) {
    failed++;
    console.error(`  FAILED ${r.pppoe_user} (${r.name}): ${e.message}`);
  }
}

console.log(`\nsynced ${done}${failed ? `, ${failed} failed` : ''}`);
await pool.end();
