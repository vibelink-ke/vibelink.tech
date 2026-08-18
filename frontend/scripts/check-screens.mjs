#!/usr/bin/env node
/**
 * Catch a screen that compiles and then crashes.
 *
 * `vite build` bundles a component that reads an identifier which does not
 * exist in its scope without complaint. At runtime that is a blank page with no
 * sidebar — the whole tree unmounts — while the build reports success in three
 * seconds. Live support shipped exactly that way: a block of code landed in a
 * presentational helper where `store` was not defined, and nothing caught it
 * until the page was opened.
 *
 * This walks each screen, splits it into top-level function components, and
 * checks that the few names which cause this in practice are declared where
 * they are used. Deliberately narrow — it is a tripwire, not a type checker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', 'src', 'screens');
const SUSPECT = ['store', 'navigate'];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.jsx')) files.push(full);
  }
}(ROOT));

let bad = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const parts = [...src.matchAll(/^(?:export default )?function (\w+)\s*\(/gm)];

  for (let i = 0; i < parts.length; i++) {
    const name = parts[i][1];
    const start = parts[i].index;
    const end = i + 1 < parts.length ? parts[i + 1].index : src.length;
    const body = src.slice(start, end);

    for (const ident of SUSPECT) {
      // String.raw, because `\b` in an ordinary template literal is a backspace
      // character, not a word boundary. Written without it, every pattern here
      // matched nothing and this script passed a file that was actively
      // crashing — a checker that cannot fail is worse than no checker.
      if (!new RegExp(String.raw`\b${ident}\.`).test(body)) continue;
      const declared = new RegExp(String.raw`(const|let|var)\s+${ident}\b`).test(body)
        || new RegExp(String.raw`\(\s*\{[^}]*\b${ident}\b[^}]*\}\s*\)`)
          .test(parts[i][0] + body.slice(0, 200));
      if (!declared) {
        console.error(`${path.relative(ROOT, file)} · ${name}() uses "${ident}" but never declares it`);
        bad++;
      }
    }
  }
}

if (bad) {
  console.error(`\n${bad} component(s) would crash at runtime. The build would not have told you.`);
  process.exit(1);
}
console.log(`checked ${files.length} screens — every component can see what it reads`);
