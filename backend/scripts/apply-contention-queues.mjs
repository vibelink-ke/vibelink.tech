#!/usr/bin/env node
/**
 * Rolls out contention-ratio queues to subscribers already on a contended
 * tariff — activateSubscriber (radius.js) only provisions this on its own
 * trigger points (a payment, Suspend/Resume, subscriber creation), so a
 * tariff whose contention_ratio is edited from 1:1 to something shared
 * has no effect on anyone already on it until each of them happens to be
 * re-activated some other way. This finds every currently active
 * subscriber on a plan with contention_ratio > 1 and re-runs
 * applyContentionQueue for each, without touching their RADIUS
 * credentials/rate limit at all (those are already correct — this only
 * provisions/repairs the router-side queue).
 *
 * Also doubles as a general "resync contention queues" maintenance
 * script — safe to run any time, e.g. after changing a tariff's ratio.
 *
 * Dry-run by default: prints who would be touched and does nothing.
 *
 *   node scripts/apply-contention-queues.mjs            # dry run
 *   node scripts/apply-contention-queues.mjs --apply    # push for real
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { applyContentionQueue } from '../src/radius.js';

const apply = process.argv.includes('--apply');

const { rows: candidates } = await pool.query(`
  select s.pppoe_user, s.name, s.plan_id, s.router_id,
         p.rate_down, p.rate_up, p.contention_ratio, p.title as plan_title,
         r.host, r.api_port, r.service_user, r.service_password_enc, r.name as router_name
    from subscribers s
    join plans p on p.id = s.plan_id
    left join routers r on r.id = s.router_id
   where s.pppoe_user is not null and s.status = 'active'
     and p.contention_ratio > 1
   order by p.title, s.pppoe_user`);

if (!candidates.length) {
  console.log('No active subscribers on a contended tariff — nothing to do.');
  await pool.end();
  process.exit(0);
}

console.log(`Found ${candidates.length} subscriber(s) on a contended tariff.`
  + `${apply ? '' : ' (dry run — pass --apply to actually push)'}\n`);

let updated = 0, skipped = 0, failed = 0;

for (const s of candidates) {
  const label = `${s.pppoe_user} (${s.name}, ${s.plan_title} 1:${s.contention_ratio}, router=${s.router_name ?? 'none'})`;
  if (!s.router_id || !s.service_user || !s.service_password_enc) {
    console.log(`[SKIP] ${label} — no router configured for this subscriber`);
    skipped++;
    continue;
  }
  if (!apply) {
    console.log(`[WOULD PUSH] ${label}`);
    continue;
  }
  try {
    await applyContentionQueue(s);
    console.log(`[OK] ${label}`);
    updated++;
  } catch (e) {
    console.error(`[FAILED] ${label} — ${e.message}`);
    failed++;
  }
}

console.log(`\n${apply ? 'Updated' : 'Would update'}: ${apply ? updated : candidates.length - skipped}  `
  + `Skipped: ${skipped}  Failed: ${failed}`);
await pool.end();
