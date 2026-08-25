#!/usr/bin/env node
/**
 * One-time repair for devices bound before the voucher_devices bookkeeping
 * fix landed: any voucher with a mac set (bought through "Adding a TV or
 * console?") but no matching voucher_devices row is invisible to both
 * jobs.js's expireAndSuspend (which only finds devices to unbind by joining
 * voucher_devices) and the Vouchers list's online indicator. In practice
 * that meant a device kept its router-side ip-binding forever, working
 * right through its voucher's expiry, with nothing in the app able to see
 * it was ever connected at all.
 *
 * For each orphaned voucher this finds which of the tenant's routers
 * actually has that MAC bound (a single ip-binding list per router, not one
 * lookup per voucher) and then:
 *   - voucher already expired  -> unbind it on the router right now
 *   - voucher still valid      -> just write the missing voucher_devices
 *                                 row, so the *next* expiry sweep catches it
 *                                 correctly on its own; nothing about a
 *                                 still-paying customer's access is touched
 *
 * A MAC not found bound on any of the tenant's routers is left alone and
 * reported — it may have been unbound by hand already, or the router is
 * unreachable right now.
 *
 *   node scripts/fix-orphaned-device-binds.mjs
 *
 * Safe to re-run — a voucher gets a voucher_devices row and drops out of
 * "orphaned" the moment this (or the ordinary purchase flow) writes one.
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import * as ros from '../src/routeros.js';
import * as secrets from '../src/secrets.js';

const c = await pool.connect();
try {
  const { rows: orphans } = await c.query(`
    select v.id, v.tenant_id, v.code, v.mac, v.status, v.expires_at
      from vouchers v
      left join voucher_devices d on d.voucher_id = v.id
     where v.mac is not null and d.id is null`);

  if (!orphans.length) {
    console.log('no orphaned device binds found');
    process.exit(0);
  }
  console.log(`${orphans.length} orphaned voucher(s) with a mac and no bookkeeping row`);

  const byTenant = new Map();
  for (const v of orphans) {
    if (!byTenant.has(v.tenant_id)) byTenant.set(v.tenant_id, []);
    byTenant.get(v.tenant_id).push(v);
  }

  let unbound = 0, backfilled = 0, notFound = 0;

  for (const [tenantId, vouchers] of byTenant) {
    const { rows: routers } = await c.query(
      `select id, name, host, api_port, service_user, service_password_enc from routers
        where tenant_id=$1 and role in ('hotspot','both') and service_user is not null`,
      [tenantId]);

    // mac -> routerId, built once per tenant from every router's own
    // managed ip-bindings, so each voucher is a map lookup rather than a
    // fresh router round trip.
    const macToRouter = new Map();
    const conns = new Map();
    for (const r of routers) {
      try {
        const password = secrets.decrypt(r.service_password_enc);
        const conn = await ros.connect({
          host: String(r.host).split('/')[0], port: r.api_port ?? 8728,
          user: r.service_user, password, timeoutSec: 8,
        });
        conns.set(r.id, conn);
        const bindings = await conn.write('/ip/hotspot/ip-binding/print', []);
        for (const b of bindings) {
          if (typeof b.comment === 'string' && b.comment.endsWith('(vibelink)') && b['mac-address']) {
            macToRouter.set(String(b['mac-address']).toUpperCase(), r.id);
          }
        }
      } catch (e) {
        console.warn(`could not read router ${r.name} (${r.id}): ${e.message}`);
      }
    }

    for (const v of vouchers) {
      const mac = String(v.mac).toUpperCase();
      const routerId = macToRouter.get(mac);
      if (!routerId) {
        console.log(`  ${v.code} (${mac}) — not currently bound on any router, skipped`);
        notFound++;
        continue;
      }

      const expired = v.status !== 'in_use' || (v.expires_at && new Date(v.expires_at) < new Date());
      if (expired) {
        try {
          await ros.unbindDeviceByMac(conns.get(routerId), { mac });
          console.log(`  ${v.code} (${mac}) — expired, unbound on router ${routerId}`);
          unbound++;
        } catch (e) {
          console.warn(`  ${v.code} (${mac}) — unbind failed: ${e.message}`);
        }
      } else {
        await c.query(
          `insert into voucher_devices (voucher_id, mac, router_id) values ($1,$2,$3)
           on conflict (voucher_id, mac) do nothing`,
          [v.id, mac, routerId]);
        console.log(`  ${v.code} (${mac}) — still valid, backfilled bookkeeping for router ${routerId}`);
        backfilled++;
      }
    }

    for (const conn of conns.values()) ros.close(conn);
  }

  console.log(`\n${unbound} unbound (expired), ${backfilled} backfilled (still valid), ${notFound} not found on any router`);
} catch (e) {
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
