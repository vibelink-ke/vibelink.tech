#!/usr/bin/env node
/**
 * One-off backfill for subscribers whose radreply row is missing
 * Framed-IP-Address entirely — the router has nothing to hand the PPP
 * session, falls back to whatever local address it can generate on its
 * own, and immediately terminates the connection: "authenticated" /
 * "could not determine remote address, using X" / "connected" /
 * "terminating..." on a loop, forever, on every redial.
 *
 * syncSubscriberCredentials only runs in response to a specific app action
 * (a payment, a staff edit, a status change) — never on a plain PPPoE
 * reconnect, which just reads whatever is already stored. A subscriber
 * whose Framed-IP-Address was wiped by some earlier bug (the EMINING
 * dual-pool ordering bug fixed earlier, or any other cause) stays stuck
 * with no address forever, even after the underlying bug is fixed in
 * code, because nothing ever re-runs the assignment for them on its own.
 * Confirmed live (2026-09-09): re-invoking syncSubscriberCredentials by
 * hand for one affected subscriber (EMM1, EMINING) immediately produced
 * the correct address from the router-specific pool — the code was
 * already right, the stored data just never caught up.
 *
 * This finds every subscriber with a pppoe_user but no Framed-IP-Address
 * radreply row for it, and re-runs the same sync for each — safe to run
 * repeatedly, and a no-op for anyone who already has an address.
 *
 * Dry-run by default: prints who would be touched and does nothing.
 *
 *   node scripts/backfill-missing-framed-ip.mjs            # dry run
 *   node scripts/backfill-missing-framed-ip.mjs --apply    # fix for real
 */
import 'dotenv/config';
import { pool, withTenant } from '../src/db.js';
import { syncSubscriberCredentials } from '../src/radius.js';

const apply = process.argv.includes('--apply');

const { rows: candidates } = await pool.query(`
  select s.id, s.tenant_id, s.pppoe_user, s.name, s.status, r.name as router_name
    from subscribers s
    left join routers r on r.id = s.router_id
   where s.pppoe_user is not null
     and not exists (
       select 1 from radreply rr
        where rr.tenant_id = s.tenant_id and rr.username = s.pppoe_user
          and rr.attribute = 'Framed-IP-Address')
   order by s.tenant_id, s.pppoe_user`);

if (!candidates.length) {
  console.log('No subscribers missing Framed-IP-Address — nothing to backfill.');
  await pool.end();
  process.exit(0);
}

console.log(`Found ${candidates.length} subscriber(s) missing Framed-IP-Address.`
  + `${apply ? '' : ' (dry run — pass --apply to actually fix)'}\n`);

let fixed = 0, stillMissing = 0, failed = 0;

for (const s of candidates) {
  const label = `${s.pppoe_user} (${s.name}, ${s.status}, router=${s.router_name ?? 'none'})`;
  if (!apply) {
    console.log(`[WOULD FIX] ${label}`);
    continue;
  }
  try {
    await withTenant(s.tenant_id, (c) => syncSubscriberCredentials(c, s.tenant_id, s.id));
    const { rows: [row] } = await pool.query(
      `select value from radreply where tenant_id=$1 and username=$2 and attribute='Framed-IP-Address'`,
      [s.tenant_id, s.pppoe_user]);
    if (row) { console.log(`[OK] ${label} -> ${row.value}`); fixed++; }
    else { console.log(`[STILL MISSING] ${label} — no pool available for this router/tenant/purpose`); stillMissing++; }
  } catch (e) {
    console.error(`[FAILED] ${label} — ${e.message}`);
    failed++;
  }
}

console.log(`\n${apply ? 'Fixed' : 'Would check'}: ${apply ? fixed : candidates.length}  `
  + `Still missing (no pool matched): ${stillMissing}  Failed: ${failed}`);
await pool.end();
