#!/usr/bin/env node
/**
 * One-off CLI wrapper around src/demo-tenant.js's resetDemoTenant() — the
 * same logic jobs.js now runs automatically every hour, exposed here for an
 * on-demand reseed (e.g. right before a scheduled sales call) without
 * waiting for the next scheduled tick.
 *
 *   node scripts/seed-demo-tenant.mjs
 *   DEMO_PASSWORD='...' node scripts/seed-demo-tenant.mjs
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { resetDemoTenant, DEMO_SUBDOMAIN } from '../src/demo-tenant.js';

try {
  const { password } = await resetDemoTenant();
  console.log('— demo ready —');
  console.log(`portal    https://${DEMO_SUBDOMAIN}.vibelink.tech`);
  console.log('login     demo@vibelink.tech (or username "demo")');
  console.log('password  ' + password);
  console.log('\nAlso resets automatically every hour — re-run this any time for an on-demand reseed.');
} catch (e) {
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
