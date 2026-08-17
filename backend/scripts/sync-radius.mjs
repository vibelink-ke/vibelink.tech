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

/**
 * Everything that has to line up for a PPPoE login to succeed, checked in the
 * order it fails. Diagnosing this by reading the FreeRADIUS log took days more
 * than once, and every cause below produces the same symptom on the router:
 * "authentication failed", with correct-looking credentials on screen.
 */
async function preflight() {
  const problems = [];

  // Credentials the tenant-scoped query cannot see. Since RADIUS now matches on
  // (tenant_id, username), a row with a null tenant matches no router at all --
  // so a customer whose credentials look perfect is rejected every time.
  const { rows: [orphan] } = await pool.query(
    `select count(*)::int n from radcheck where tenant_id is null`);
  if (orphan.n) {
    problems.push(`${orphan.n} radcheck row(s) have no tenant. The tenant-scoped `
      + `lookup cannot match these, so those customers cannot authenticate.`);
  }

  // A router whose address is not in the tenant's tunnel range never resolves to
  // a tenant, so every request from it authenticates nobody.
  const { rows: bad } = await pool.query(
    `select r.name, host(r.host) ip, t.subdomain, t.tunnel_subnet
       from routers r join tenants t on t.id = r.tenant_id
      where t.tunnel_subnet is null or not (r.host << t.tunnel_subnet)`);
  for (const r of bad) {
    problems.push(`router "${r.name}" is at ${r.ip}, outside ${r.subdomain}'s tunnel `
      + `range ${r.tunnel_subnet ?? '(none allocated)'} — RADIUS requests from it match no tenant.`);
  }

  if (problems.length) {
    console.log('');
    console.log('Problems that stop logins regardless of credentials:');
    for (const p of problems) console.log(`  ! ${p}`);
  }
  return problems.length;
}

const { rows } = await pool.query(
  `select s.id, s.tenant_id, s.name, s.pppoe_user,
          r.value as radius_password, s.pppoe_pass
     from subscribers s
     left join radcheck r on r.username = s.pppoe_user
                         and r.attribute = 'Cleartext-Password'
                         and r.tenant_id = s.tenant_id
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

const blockers = await preflight();

if (!apply) {
  if (missing.length || mismatch.length || blockers) {
    console.log('\nRe-run with --apply to write these.');
  }
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

// Adopt rows written before tenant scoping existed. Without an owner they match
// no router, so the customer is rejected however correct their password is —
// and that is invisible from the UI, which shows the credentials just fine.
// Drop orphans the sync above has already replaced with a correctly-scoped row.
// Adopting those would collide with the (tenant_id, username, attribute) unique
// index and abort the whole run; the scoped row is the current one, so the
// unowned duplicate is simply stale.
const { rowCount: staleCheck } = await pool.query(
  `delete from radcheck orphan
    where orphan.tenant_id is null
      and exists (select 1 from radcheck owned
                   where owned.tenant_id is not null
                     and owned.username = orphan.username
                     and owned.attribute = orphan.attribute)`);
const { rowCount: staleReply } = await pool.query(
  `delete from radreply orphan
    where orphan.tenant_id is null
      and exists (select 1 from radreply owned
                   where owned.tenant_id is not null
                     and owned.username = orphan.username
                     and owned.attribute = orphan.attribute)`);
if (staleCheck || staleReply) {
  console.log(`removed ${staleCheck + staleReply} unowned duplicate row(s) already replaced`);
}

const { rowCount: adoptedCheck } = await pool.query(
  `update radcheck rc set tenant_id = s.tenant_id
     from subscribers s
    where s.pppoe_user = rc.username and rc.tenant_id is null`);
const { rowCount: adoptedReply } = await pool.query(
  `update radreply rr set tenant_id = s.tenant_id
     from subscribers s
    where s.pppoe_user = rr.username and rr.tenant_id is null`);
const { rowCount: adoptedVoucher } = await pool.query(
  `update radcheck rc set tenant_id = v.tenant_id
     from vouchers v
    where v.code = rc.username and rc.tenant_id is null`);

if (adoptedCheck || adoptedReply || adoptedVoucher) {
  console.log(`adopted ${adoptedCheck + adoptedVoucher} radcheck and ${adoptedReply} radreply `
    + 'row(s) into their tenant');
}

// Anything still unowned belongs to no subscriber or voucher we know of. Say so
// rather than deleting it: it may be a hand-added credential someone relies on.
const { rows: [left] } = await pool.query(
  'select count(*)::int n from radcheck where tenant_id is null');
if (left.n) {
  console.log(`${left.n} radcheck row(s) still have no tenant — they match no subscriber `
    + 'or voucher. These cannot authenticate; remove them or attach them by hand.');
}

console.log(`\nsynced ${done}${failed ? `, ${failed} failed` : ''}`);
await pool.end();
