#!/usr/bin/env node
/**
 * Is every scheduled job on the Automation screen, and vice versa?
 *
 * Ten jobs were running and eight were listed. The two missing ones were added
 * to jobs.js months after AUTOMATION_JOBS was written, and nothing connected
 * the two lists, so work went on that an operator could neither see nor switch
 * off. When the list later looked shorter than remembered, it read as though
 * automation had been removed.
 *
 * The reverse is worse: a job listed with a switch that runs nowhere gives an
 * operator a control that does nothing, and a promise the system does not keep.
 *
 * Static — it reads both files and compares. No database, no server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, '..', 'src', f), 'utf8');

// cron.schedule('...', safely('name', fn))
const scheduled = [...src('jobs.js').matchAll(/safely\('(\w+)'/g)].map((m) => m[1]);
// { job: 'name', name: 'Label', ... } in AUTOMATION_JOBS
const listed = [...src('server.js').matchAll(/\{ job: '(\w+)', name:/g)].map((m) => m[1]);

const hidden = scheduled.filter((j) => !listed.includes(j));
const phantom = listed.filter((j) => !scheduled.includes(j));

console.log(`${scheduled.length} scheduled, ${listed.length} listed on the Automation screen`);

if (!hidden.length && !phantom.length) {
  console.log('every job that runs is listed, and every job listed runs');
  process.exit(0);
}

if (hidden.length) {
  console.log('\nRunning but not shown — the operator cannot see or stop these:');
  for (const j of hidden) console.log(`  ${j}`);
}
if (phantom.length) {
  console.log('\nShown but never scheduled — the switch controls nothing:');
  for (const j of phantom) console.log(`  ${j}`);
}
process.exit(1);
