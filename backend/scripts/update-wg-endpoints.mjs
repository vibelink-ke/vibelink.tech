#!/usr/bin/env node
/**
 * One-off: repoint every WireGuard router's peer endpoint from a hardcoded
 * server IP to the hostname (vibelink.tech), so a future server migration
 * never needs this again — DNS alone then carries every router over.
 *
 * Existing routers were onboarded with WG_ENDPOINT baked in as a literal IP
 * (see wireguard.js's mikrotikScript) — changing our own .env's WG_ENDPOINT
 * only affects routers onboarded from now on. Already-connected routers keep
 * dialling the old IP forever unless told otherwise, which this does over
 * their existing, still-working tunnel.
 *
 * Safe to run before a migration's DNS cutover: the hostname still resolves
 * to the current (old) server at that point, so this changes nothing about
 * where traffic actually goes — it only removes the hardcoded IP so the
 * *next* DNS change (the actual cutover) reaches every router with zero
 * further action.
 *
 *   node scripts/update-wg-endpoints.mjs           # apply
 *   node scripts/update-wg-endpoints.mjs --dry-run # list routers only
 */
import 'dotenv/config';
import { pool } from '../src/db.js';

const DRY_RUN = process.argv.includes('--dry-run');
const HOSTNAME = process.env.ROOT_DOMAIN ?? 'vibelink.tech';

const { rows } = await pool.query(`
  select r.id, r.name, r.host, r.api_port, r.service_user, r.service_password_enc,
         t.name as tenant_name, t.subdomain
    from routers r
    join wg_peers w on w.router_id = r.id and w.enabled
    join tenants t on t.id = r.tenant_id
   group by r.id, t.name, t.subdomain
   order by t.name, r.name
`);

console.log(`${rows.length} WireGuard-connected router(s) found.\n`);

if (DRY_RUN) {
  for (const r of rows) console.log(`${r.tenant_name} / ${r.name} (${r.host})`);
  process.exit(0);
}

const ros = await import('../src/routeros.js');
const secrets = await import('../src/secrets.js');

let ok = 0;
const failed = [];

for (const r of rows) {
  const label = `${r.tenant_name} / ${r.name}`;
  if (!r.service_user || !r.service_password_enc) {
    console.warn(`SKIP  ${label} — never had "Configure" run, no API credentials stored`);
    failed.push({ label, reason: 'no service credentials' });
    continue;
  }

  let conn;
  try {
    const password = secrets.decrypt(r.service_password_enc);
    conn = await ros.connect({
      host: String(r.host).split('/')[0], port: r.api_port ?? 8728,
      user: r.service_user, password, timeoutSec: 8,
    });

    const peers = await conn.write('/interface/wireguard/peers/print', []);
    const peer = peers.find((p) => p.interface === 'billing-wg');
    if (!peer) {
      console.warn(`SKIP  ${label} — no billing-wg peer found on this router`);
      failed.push({ label, reason: 'no billing-wg peer' });
      continue;
    }

    await conn.write('/interface/wireguard/peers/set', [
      `=.id=${peer['.id']}`, `=endpoint-address=${HOSTNAME}`,
    ]);
    console.log(`OK    ${label} — endpoint now ${HOSTNAME}`);
    ok++;
  } catch (e) {
    console.error(`FAIL  ${label} — ${e.message}`);
    failed.push({ label, reason: e.message });
  } finally {
    if (conn) ros.close(conn);
  }
}

console.log(`\n${ok}/${rows.length} updated.`);
if (failed.length) {
  console.log(`${failed.length} need a manual check:`);
  for (const f of failed) console.log(`  - ${f.label}: ${f.reason}`);
}
process.exit(0);
