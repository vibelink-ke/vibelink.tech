#!/usr/bin/env node
/**
 * Build backend/src/router-ouis.generated.json from the IEEE OUI registry.
 *
 *   node scripts/build-router-ouis.mjs path/to/oui.csv
 *
 * oui.csv is the registry's MA-L list (https://standards-oui.ieee.org/oui/oui.csv): "Registry,Assignment,Organization Name,Organization Address".
 * Only makers whose business is routers, access points and extenders are taken, because the prefix is then enough to say "this is a router".
 * Makers that also sell phones and laptops (Huawei, Xiaomi, ASUS, Samsung…) are deliberately left out: their prefix says nothing about what a
 * device is, and a customer's phone must never be taken for a router.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/build-router-ouis.mjs path/to/oui.csv'); process.exit(2); }

const ONU_MAKERS = [
  [/v-?sol/i, 'V-SOL'], [/fiberhome|fiber home/i, 'FiberHome'], [/bdcom/i, 'BDCOM'], [/shanghai bell/i, 'Nokia'],
  [/dasan zhone|\bdzs\b|zhone/i, 'DZS'], [/calix/i, 'Calix'], [/syrotech/i, 'Syrotech'],
];
const MAKERS = [
  [/tenda/i, 'Tenda'], [/tp-?link/i, 'TP-Link'], [/mercusys/i, 'Mercusys'], [/\bnetis\b/i, 'Netis'], [/totolink|zioncom/i, 'Totolink'],
  [/d-?link/i, 'D-Link'], [/cudy/i, 'Cudy'], [/ruijie/i, 'Ruijie'], [/wavlink/i, 'Wavlink'], [/comfast/i, 'Comfast'],
  [/keenetic|zyxel/i, 'Keenetic/Zyxel'], [/mikrotik|routerboard/i, 'MikroTik'], [/ubiquiti/i, 'Ubiquiti'], [/engenius/i, 'EnGenius'],
  [/linksys/i, 'Linksys'], [/netgear/i, 'Netgear'], [/edimax/i, 'Edimax'], [/tenbay/i, 'Tenbay'], [/lb-?link|shenzhen bilian/i, 'LB-Link'],
];

/** One CSV line, honouring double quotes. */
function cells(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const out = {}; const onu = {};
let seen = 0;
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const [registry, assignment, org] = cells(line);
  if (registry !== 'MA-L' || !/^[0-9A-F]{6}$/i.test(assignment)) continue;
  seen += 1;
  const hit = MAKERS.find(([re]) => re.test(org));
  if (hit) out[assignment.toUpperCase()] = hit[1];
  else {
    const o = ONU_MAKERS.find(([re]) => re.test(org));
    if (o) onu[assignment.toUpperCase()] = o[1];
  }
}
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'router-ouis.generated.json');
fs.writeFileSync(target, `${JSON.stringify({ router: out, onu }, null, 0)}\n`);
const byMaker = {};
for (const v of [...Object.values(out), ...Object.values(onu)]) byMaker[v] = (byMaker[v] ?? 0) + 1;
console.log(`${seen} MA-L assignments read: ${Object.keys(out).length} router prefixes, ${Object.keys(onu).length} optical-unit (ONU/ONT) prefixes:`, byMaker);
console.log('written to', target);
