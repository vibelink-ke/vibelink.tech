// Stamps a fresh build id into public/version.json before every build, so it
// rides along into dist/ untouched (Vite copies public/ verbatim). The
// deployed frontend polls this file — see app/UpdateAvailableBanner.jsx — to
// notice when a newer build has replaced the one a tab already loaded. A
// plain timestamp is enough: nothing compares it to anything but the value
// this same tab captured on its own first load.
import { writeFileSync } from 'node:fs';

const version = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
writeFileSync(new URL('../public/version.json', import.meta.url), JSON.stringify({ version }));
console.log(`wrote public/version.json — ${version}`);
