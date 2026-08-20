#!/usr/bin/env node
/**
 * One-time repair for the Expiration date-format bug: issueVoucherAccess and
 * markVoucherActiveOnFirstAuth (backend/src/radius.js) used to write
 * `date.toUTCString()` ("Wed, 19 Aug 2026 23:39:05 GMT") into radcheck's
 * Expiration attribute, which FreeRADIUS's date parser cannot read — every
 * login checked against one failed outright with "Error parsing value:
 * failed to parse time string", indistinguishable from a wrong password.
 * The code now writes the format FreeRADIUS actually accepts
 * ("Aug 19 2026 23:39:05 GMT"); this rewrites every row already sitting in
 * the old format so accounts that already have an expiry set start working
 * again without waiting for it to be rewritten some other way.
 *
 *   node scripts/fix-radius-expiration-dates.mjs
 *
 * Safe to re-run — rows already in the new format are left alone, and a row
 * that fails to parse is reported and skipped rather than aborting the rest.
 */
import 'dotenv/config';
import { pool } from '../src/db.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const radiusDate = (date) => {
  const d = new Date(date);
  return `${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())} ${d.getUTCFullYear()} `
    + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} GMT`;
};

const c = await pool.connect();
try {
  const { rows } = await c.query(
    "select id, value from radcheck where attribute='Expiration' and value like '%,%'");

  let fixed = 0;
  let failed = 0;
  for (const row of rows) {
    const parsed = new Date(row.value);
    if (Number.isNaN(parsed.getTime())) {
      console.error(`could not parse radcheck.id=${row.id}: "${row.value}"`);
      failed++;
      continue;
    }
    await c.query('update radcheck set value=$2 where id=$1', [row.id, radiusDate(parsed)]);
    fixed++;
  }

  console.log(`${fixed} row(s) fixed, ${failed} could not be parsed, `
    + `${rows.length ? rows.length - fixed - failed : 0} already in the new format or skipped`);
} catch (e) {
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
