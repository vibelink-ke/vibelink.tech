#!/usr/bin/env node
/**
 * Give every tenant that doesn't already have one a hidden `platform_admin`
 * staff login, for maintenance access. Run once after deploying the
 * platform_admin support in server.js/schema.sql; safe to re-run — tenants
 * that already have one are skipped.
 *
 *   node scripts/seed-platform-admins.mjs
 *
 * Prints the generated username/password for each tenant it creates one for.
 * These are shown once; if lost, reset them from the Tenants → Staff logins
 * screen instead of re-running this script.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const c = await pool.connect();
try {
  const { rows: tenants } = await c.query(
    `select t.id, t.subdomain from tenants t
     where not exists (select 1 from staff s where s.tenant_id = t.id and s.role = 'platform_admin')`);

  if (!tenants.length) {
    console.log('every tenant already has a platform_admin login — nothing to do');
  }

  for (const t of tenants) {
    const password = crypto.randomBytes(6).toString('base64url');
    const username = `admin-${t.subdomain}`;
    await c.query(
      `insert into staff (tenant_id, name, phone, role, username, password_hash)
       values ($1, 'Vibelink support', 'platform-admin', 'platform_admin', $2, $3)`,
      [t.id, username, await hashPassword(password)]);
    console.log(`${t.subdomain.padEnd(24)} username: ${username.padEnd(24)} password: ${password}`);
  }
} catch (e) {
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
