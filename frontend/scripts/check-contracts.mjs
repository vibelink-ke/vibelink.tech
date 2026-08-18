#!/usr/bin/env node
/**
 * Does every call the app makes reach a route that exists?
 *
 * A mismatch is invisible until somebody opens the screen: the request 404s,
 * the catch turns it into an empty list or a toast, and the page looks merely
 * empty rather than broken. Screens have gone quiet that way, and clicking
 * through them one at a time to find out is neither reliable nor repeatable.
 *
 * Static on purpose — no server, no database, no browser — so it can run on
 * every build the way check-screens does. It reads the call table in
 * src/api/client.js and the route table in backend/src/server.js and compares
 * them.
 *
 * What it cannot see is whether the *shape* of a reply matches what a screen
 * expects. That is the other half of the same problem — the {token, desc}
 * crash was exactly that — and it needs the screens rendered, not parsed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = fs.readFileSync(path.join(here, '..', 'src', 'api', 'client.js'), 'utf8');
const server = fs.readFileSync(path.join(here, '..', '..', 'backend', 'src', 'server.js'), 'utf8');

/**
 * Reduce both sides to one shape. `/api/routers/${id}/traffic` on the calling
 * side and `/api/routers/:id/traffic` on the serving side both become
 * `/api/routers/:x/traffic`.
 *
 * Named parameters must be flattened too. Comparing `:x` against `:id` reports
 * every parameterised route as missing, which was this script's own first
 * result — sixty false alarms.
 */
const normalise = (p) => p
  .replace(/:[A-Za-z_]\w*/g, ':x')
  .replace(/\?.*$/, '')
  .replace(/\/+$/, '') || '/';

/**
 * The literal path a template produces.
 *
 * Two kinds of expression appear in these calls and they mean different things:
 * `${id}` is a path parameter, while `${force ? '?force=1' : ''}` is an
 * optional query string that routing ignores. Substituting the first and
 * dropping the second leaves the route that will actually be matched.
 */
const literalPath = (raw) => {
  const done = raw.replace(/\$\{[^{}]*\}/g, (expr) => (expr.includes('?') ? '' : ':x'));
  /*
   * A template literal nested inside an expression — `?service=${service}`
   * within `${service ? ... : ''}` — ends the outer capture at its own
   * backtick, leaving a `${` with no closing brace. Everything from there on is
   * an expression, and an expression cannot be part of the path that routing
   * matches, so the text before it is the whole route.
   */
  const dangling = done.indexOf('${');
  return dangling === -1 ? done : done.slice(0, dangling);
};

// Backticked strings are matched as their own alternative: a template literal
// can contain quotes of its own, and a character class that stops at the first
// quote truncates the path halfway through the expression.
const CALL = /(?:^|[^A-Za-z])(get|post|put|patch|del)\(\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/g;
const ROUTE = /\bapp\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|[`'"][^`'"]+[`'"])/g;
const STRING_IN = /[`'"]([^`'"]+)[`'"]/g;
const MOUNT = /\bapp\.use\(\s*[`'"]([^`'"]+)[`'"]/g;

const calls = [];
for (const m of client.matchAll(CALL)) {
  const raw = m[2] ?? m[3] ?? m[4] ?? '';
  if (!raw.startsWith('/')) continue;          // not a path — some other get(...)
  calls.push({
    method: m[1] === 'del' ? 'delete' : m[1],
    path: normalise(literalPath(raw)),
    raw,
  });
}

const routes = new Set();
for (const m of server.matchAll(ROUTE)) {
  for (const lit of m[2].matchAll(STRING_IN)) {
    routes.add(`${m[1]} ${normalise(lit[1])}`);
  }
}

// Routers mounted with app.use (payments/*.js) define their paths in another
// file this script does not read. Their prefixes count as satisfied rather than
// being reported as breaks in routes that plainly work in production.
const mounted = [...server.matchAll(MOUNT)].map((m) => normalise(m[1]));

const missing = calls.filter((c) =>
  !routes.has(`${c.method} ${c.path}`) && !mounted.some((prefix) => c.path.startsWith(prefix)));

console.log(`${calls.length} calls in api/client.js, ${routes.size} routes in server.js`);

if (missing.length) {
  console.log('');
  console.log('Calls with no matching route — these fail whenever the screen is opened:');
  for (const m of missing) console.log(`  ${m.method.toUpperCase().padEnd(6)} ${m.raw}`);
  process.exit(1);
}

console.log('every call reaches a route that exists');
