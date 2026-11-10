// Renders the app icon and splash sources that @capacitor/assets reads, from the same mark as the web favicon.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../assets/', import.meta.url));
mkdirSync(dir, { recursive: true });

// The favicon's wifi mark (drawn on a 24x24 grid), centred on a 1024 canvas at the given scale.
const mark = (scale) => `
  <g transform="translate(${512 - 12 * scale} ${512 - 12 * scale}) scale(${scale})">
    <path d="M4 8.5C9.5 3.5 14.5 3.5 20 8.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity="0.55" fill="none"/>
    <path d="M6.8 12.3C10.5 9 13.5 9 17.2 12.3" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity="0.8" fill="none"/>
    <path d="M9.7 16C11.3 14.6 12.7 14.6 14.3 16" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <circle cx="12" cy="19.3" r="1.4" fill="#fff"/>
  </g>`;
const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>`);

await sharp(svg(`<rect width="1024" height="1024" fill="#0f7a5f"/>${mark(34)}`)).png().toFile(`${dir}icon-only.png`);
await sharp(svg(mark(24))).png().toFile(`${dir}icon-foreground.png`);          // adaptive icon: the mark inside the safe zone
await sharp(svg('<rect width="1024" height="1024" fill="#0f7a5f"/>')).png().toFile(`${dir}icon-background.png`);

const badge = await sharp(svg(`<rect x="312" y="312" width="400" height="400" rx="100" fill="#0f7a5f"/>${mark(13)}`)).png().toBuffer();
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#0b0f0d' } })
  .composite([{ input: badge, gravity: 'centre' }]).png().toFile(`${dir}splash.png`);
await sharp(`${dir}splash.png`).toFile(`${dir}splash-dark.png`);
console.log('icons written to', dir);
