#!/usr/bin/env node
/**
 * Apply schema.sql.
 *
 *   npm run migrate              apply, skipping objects that already exist
 *   npm run migrate -- --reset   drop the public schema first, then apply
 *   npm run migrate -- --strict  fail on the first error (no skipping)
 *
 * Uses the `pg` dependency rather than shelling out to psql, so it works the same
 * on Windows, macOS and Linux and needs nothing on PATH.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'schema.sql');
const reset = process.argv.includes('--reset');
const strict = process.argv.includes('--strict');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

/**
 * Split SQL into statements on top-level semicolons, respecting dollar-quoted
 * blocks ($$ … $$, $f$ … $f$), single quotes and line comments — schema.sql has
 * do-blocks whose bodies contain semicolons.
 */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let quote = null; // "'" or a dollar tag like "$f$"

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (!quote && rest.startsWith('--')) {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (!quote) {
      const tag = /^\$[A-Za-z_]*\$/.exec(rest);
      if (tag) { quote = tag[0]; buf += quote; i += quote.length; continue; }
      if (rest[0] === "'") { quote = "'"; buf += "'"; i++; continue; }
      if (rest[0] === ';') { out.push(buf.trim()); buf = ''; i++; continue; }
    } else if (quote === "'") {
      if (rest[0] === "'") { quote = null; buf += "'"; i++; continue; }
    } else if (rest.startsWith(quote)) {
      buf += quote; i += quote.length; quote = null; continue;
    }
    buf += sql[i];
    i++;
  }
  if (buf.trim()) out.push(buf.trim());

  // A statement carries the comment lines that preceded it. Strip those only to
  // decide whether anything real is left — dropping any chunk that merely *starts*
  // with "--" would silently discard the DDL sitting underneath the comment.
  return out.filter((s) => s.replace(/^[ \t]*--.*$/gm, '').trim().length > 0);
}

/** Errors that just mean "this object is already there". */
const ALREADY_EXISTS = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object (policy, constraint, extension)
  '42701', // duplicate_column
  '42P16', // invalid_table_definition, e.g. re-adding a constraint
]);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
} catch (e) {
  console.error(`cannot reach the database: ${e.message}`);
  console.error('is it up?  docker compose up -d');
  process.exit(1);
}

try {
  if (reset) {
    console.log('dropping public schema…');
    await client.query('drop schema public cascade; create schema public;');
  }

  const statements = splitStatements(fs.readFileSync(schemaPath, 'utf8'));
  let applied = 0;
  let skipped = 0;

  for (const stmt of statements) {
    try {
      await client.query(stmt);
      applied++;
    } catch (e) {
      const existing = ALREADY_EXISTS.has(e.code) || /already exists/i.test(e.message);
      if (existing && !strict) { skipped++; continue; }
      const head = stmt.replace(/\s+/g, ' ').slice(0, 90);
      throw new Error(`${e.message}\n  in: ${head}…`);
    }
  }

  const { rows: [{ count }] } = await client.query(
    "select count(*) from information_schema.tables where table_schema='public'");
  console.log(`schema applied — ${applied} statement(s) run, ${skipped} already present, ${count} tables in public`);
  if (!skipped) console.log('next: node scripts/create-account.mjs --email … --password … --super');
} catch (e) {
  console.error(`migration failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
