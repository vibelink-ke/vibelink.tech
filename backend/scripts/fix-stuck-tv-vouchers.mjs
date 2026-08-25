#!/usr/bin/env node
/**
 * One-time repair for TVs/consoles bought before issueVoucherAccess started
 * forcing mac-bound vouchers onto "expire from creation" regardless of the
 * tenant's own preference. For any tenant with "expire from login" set, a
 * mac-bound voucher was written with status='unused' and expires_at=null
 * and stayed that way forever — nothing about binding the device via
 * router-side ip bypass was ever going to be the RADIUS login that
 * "expire from login" is waiting for, so the clock never started and the
 * device never technically expired at all.
 *
 * For each one still stuck like that, this starts its clock right now (the
 * best available answer to "when did it actually start" — the real answer,
 * whenever the device was bound, isn't recorded anywhere) and lets the
 * ordinary expireAndSuspend job take it from there exactly like any other
 * voucher.
 *
 *   node scripts/fix-stuck-tv-vouchers.mjs
 *
 * Safe to re-run — a voucher this has already fixed no longer matches the
 * "stuck" query (status is no longer 'unused').
 */
import 'dotenv/config';
import { pool } from '../src/db.js';

const c = await pool.connect();
try {
  const { rows: stuck } = await c.query(`
    select v.id, v.code, v.tenant_id, p.duration_min
      from vouchers v
      join plans p on p.id = v.plan_id
     where v.mac is not null and v.status = 'unused' and v.expires_at is null`);

  if (!stuck.length) {
    console.log('no stuck TV/device vouchers found');
    process.exit(0);
  }

  console.log(`${stuck.length} voucher(s) stuck with a bound device and no expiry — starting their clock now`);
  for (const v of stuck) {
    const expires = new Date(Date.now() + v.duration_min * 60000);
    await c.query(
      `update vouchers set status='in_use', starts_at=now(), expires_at=$2 where id=$1`,
      [v.id, expires]);
    console.log(`  ${v.code} — now expires ${expires.toISOString()}`);
  }
  console.log(`\n${stuck.length} fixed. The next expireAndSuspend run (every 5 minutes) will `
    + 'unbind any of these that have already run out.');
} catch (e) {
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
