// Stamps a fresh build id into public/version.json before every build, so it
// rides along into dist/ untouched (Vite copies public/ verbatim). The
// deployed frontend polls this file — see app/UpdateAvailableBanner.jsx — to
// notice when a newer build has replaced the one a tab already loaded. A
// plain timestamp is enough: nothing compares it to anything but the value
// this same tab captured on its own first load.
//
// `latest` rides along too — the most recent entry in changelog.json, which
// is maintained by hand alongside whatever shipped — so the update banner
// can show what actually changed instead of just "a new version exists."
import { readFileSync, writeFileSync } from 'node:fs';

const version = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
let latest = null;
try {
  const entries = JSON.parse(readFileSync(new URL('../public/changelog.json', import.meta.url)));
  latest = entries[entries.length - 1] ?? null;
} catch {
  // No changelog yet, or it failed to parse — the banner still works, just
  // without a "what's new" list, same as before this existed.
}
writeFileSync(new URL('../public/version.json', import.meta.url), JSON.stringify({ version, latest }));
console.log(`wrote public/version.json — ${version}`);
