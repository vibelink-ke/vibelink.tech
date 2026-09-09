#!/usr/bin/env node
/**
 * One-off push of the corrected billing-failover script/scheduler to every
 * already-onboarded router — for the staleAfter fix in wireguard.js
 * (90s -> 240s): WireGuard's own handshake-renewal cadence naturally
 * exceeds 90s even on a healthy tunnel, so every router was flapping
 * between WireGuard and OVPN roughly every other scheduled check, and a
 * PPPoE customer dialling in during the ~10s window that leaves is briefly
 * unreachable from FreeRADIUS — "could not determine remote address" on
 * the router's own PPP log, indistinguishable from a pool-assignment bug.
 *
 * Only touches routers that already have a billing-ovpn interface (i.e.
 * were onboarded with failover in the first place — routeros.js's
 * pushFailoverScript skips anything else on its own, this script just
 * reports that as "skipped" rather than treating it as a failure). Does
 * not touch WireGuard/OVPN keys at all.
 *
 * Dry-run by default: connects and checks, prints what it would do, and
 * touches nothing.
 *
 *   node scripts/repush-failover-script.mjs            # dry run
 *   node scripts/repush-failover-script.mjs --apply    # push for real
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import * as ros from '../src/routeros.js';
import * as secrets from '../src/secrets.js';

const apply = process.argv.includes('--apply');

const { rows: routers } = await pool.query(
  `select id, tenant_id, name, host, api_port, service_user, service_password_enc
     from routers
    where service_user is not null and service_password_enc is not null
    order by name`);

if (!routers.length) {
  console.log('No onboarded routers found.');
  await pool.end();
  process.exit(0);
}

console.log(`Checking ${routers.length} router(s).${apply ? '' : ' (dry run — pass --apply to actually push)'}\n`);

let updated = 0, skipped = 0, failed = 0;

for (const r of routers) {
  const host = String(r.host).split('/')[0];
  let conn;
  try {
    const password = secrets.decrypt(r.service_password_enc);
    if (!password) { console.log(`[SKIP] ${r.name} — no stored service password`); skipped++; continue; }

    conn = await ros.connect({ host, port: r.api_port ?? 8728, user: r.service_user, password, timeoutSec: 10 });

    if (!apply) {
      const ovpn = await conn.write('/interface/ovpn-client/print', ['?name=billing-ovpn']);
      if (!ovpn.length) { console.log(`[SKIP] ${r.name} (${host}) — no billing-ovpn, failover not set up here`); skipped++; }
      else { console.log(`[WOULD PUSH] ${r.name} (${host})`); }
      continue;
    }

    const result = await ros.pushFailoverScript(conn);
    if (result.skipped) { console.log(`[SKIP] ${r.name} (${host}) — ${result.skipped}`); skipped++; }
    else { console.log(`[OK] ${r.name} (${host}) — failover script updated`); updated++; }
  } catch (e) {
    console.error(`[FAILED] ${r.name} (${host}) — ${e.message}`);
    failed++;
  } finally {
    if (conn) ros.close(conn);
  }
}

console.log(`\n${apply ? 'Updated' : 'Would update'}: ${updated || '(dry run)'}  Skipped: ${skipped}  Failed: ${failed}`);
await pool.end();
