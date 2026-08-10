#!/usr/bin/env node
/**
 * Create (or update) an admin portal account.
 *
 *   node scripts/create-account.mjs --email info@vibelink.tech --password '...' \
 *     --company 'Vibelink' --subdomain vibelink --name 'Vibelink Admin' \
 *     --username info --super
 *
 * Credentials are taken from the command line on purpose so no real password ends
 * up committed in a file. The password is scrypt-hashed before it touches the
 * database and is never logged.
 *
 * Re-running with the same email updates the password, name, username and
 * super-admin flag rather than failing — that is how you reset a forgotten
 * password from the server.
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const a = args(process.argv);
const email = a.email;
const password = a.password ?? process.env.SEED_PASSWORD;

if (!email || !password) {
  console.error('usage: node scripts/create-account.mjs --email <e> --password <p> ' +
    '[--company <c>] [--subdomain <s>] [--name <n>] [--username <u>] [--super]');
  console.error('       (or set SEED_PASSWORD in the environment instead of --password)');
  process.exit(1);
}
if (String(password).length < 8) {
  console.error('refusing: password must be at least 8 characters');
  process.exit(1);
}

const company   = a.company   ?? 'Vibelink';
const subdomain = String(a.subdomain ?? company).toLowerCase().replace(/[^a-z0-9-]/g, '');
const name      = a.name      ?? 'Administrator';
const username  = a.username ? String(a.username).toLowerCase().replace(/[^a-z0-9._-]/g, '') : null;
const isSuper   = !!a.super;
const phone     = a.phone ?? subdomain;

const c = await pool.connect();
try {
  await c.query('begin');

  // Tenant: reuse the subdomain if it already exists so re-runs are idempotent.
  let { rows: [tenant] } = await c.query('select * from tenants where subdomain=$1', [subdomain]);
  if (!tenant) {
    ({ rows: [tenant] } = await c.query(
      `insert into tenants (name, subdomain, status, support_phone)
       values ($1,$2,'active',$3) returning *`,
      [company, subdomain, phone]));
    console.log(`created tenant  ${tenant.name} (${tenant.subdomain})`);
  } else {
    console.log(`reusing tenant  ${tenant.name} (${tenant.subdomain})`);
  }

  await c.query('insert into hotspot_settings (tenant_id) values ($1) on conflict do nothing', [tenant.id]);

  const password_hash = await hashPassword(password);

  // Explicit upsert: the email index is partial, so ON CONFLICT cannot infer it,
  // and staff also carries a unique (tenant_id, phone) that could fire first.
  const { rows: [existing] } = await c.query(
    'select id from staff where lower(email) = lower($1)', [email.trim()]);

  let staff;
  if (existing) {
    ({ rows: [staff] } = await c.query(
      `update staff set name=$2, username=coalesce($3, username), password_hash=$4,
              is_super_admin=$5, role='owner'
       where id=$1
       returning id, name, email, username, role, is_super_admin`,
      [existing.id, name, username, password_hash, isSuper]));
    console.log('updated existing account (password reset)');
  } else {
    ({ rows: [staff] } = await c.query(
      `insert into staff (tenant_id, name, phone, email, username, role, password_hash, is_super_admin)
       values ($1,$2,$3,$4,$5,'owner',$6,$7)
       returning id, name, email, username, role, is_super_admin`,
      [tenant.id, name, phone, email.trim(), username, password_hash, isSuper]));
  }

  await c.query('commit');

  console.log(`account ready   ${staff.email}${staff.username ? ` (username: ${staff.username})` : ''}`);
  console.log(`role            ${staff.role}${staff.is_super_admin ? ' · platform super admin' : ''}`);
  console.log(`portal          https://${tenant.subdomain}.vibelink.tech`);
  console.log('\nsign in with either the email or the username; the password was hashed, not stored.');
} catch (e) {
  await c.query('rollback');
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
