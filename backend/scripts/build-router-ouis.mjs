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
  [/v-?solution|\bv-?sol\b/i, 'V-SOL'], [/fiberhome/i, 'FiberHome'], [/^(nokia|alcatel-lucent) shanghai bell/i, 'Nokia'],
  [/zhone|dasan/i, 'DZS'], [/calix/i, 'Calix'], [/syrotech/i, 'Syrotech'], [/utstarcom/i, 'UTStarcom'], [/alphion|optilink/i, 'Alphion/Optilink'],
  [/hisense broadband/i, 'Hisense Broadband'],
];
// Makers whose business is routers, gateways, access points and extenders (consumer, ISP and WISP). Patterns are anchored where a looser one
// matches other companies (D-Link also matched BroadLink and AdLink, "arris" matched Harris, "ip-com" matched Clipcomm). Makers that also sell phones
// and laptops (Huawei, ZTE, Xiaomi, ASUS, Samsung, Lenovo…) are deliberately left out: their prefix says nothing about what a device is.
// Makers of most xPON routers that also sold phones (Huawei Technologies, ZTE): a prefix alone is not enough, so these are kept apart and the scan asks
// for more. Huawei Device Co. (the consumer-phone arm) is not here.
const MAYBE_MAKERS = [[/^huawei technologies/i, 'Huawei'], [/^zte corporation/i, 'ZTE']];
const MAKERS = [
  [/tenda/i, 'Tenda'], [/tp-?link/i, 'TP-Link'], [/mercusys/i, 'Mercusys'], [/\bnetis\b/i, 'Netis'], [/totolink|zioncom/i, 'Totolink'],
  [/\bd-link\b/i, 'D-Link'], [/cudy/i, 'Cudy'], [/ruijie/i, 'Ruijie'], [/wavlink/i, 'Wavlink'], [/comfast/i, 'Comfast'],
  [/keenetic|zyxel/i, 'Keenetic/Zyxel'], [/mikrotik|routerboard/i, 'MikroTik'], [/ubiquiti/i, 'Ubiquiti'], [/engenius/i, 'EnGenius'],
  [/linksys/i, 'Linksys'], [/netgear/i, 'Netgear'], [/edimax/i, 'Edimax'], [/tenbay/i, 'Tenbay'], [/lb-?link|shenzhen bilian/i, 'LB-Link'],
  [/buffalo/i, 'Buffalo'], [/belkin/i, 'Belkin'], [/draytek/i, 'DrayTek'], [/peplink|pepwave/i, 'Peplink'], [/cambium/i, 'Cambium'],
  [/mimosa/i, 'Mimosa'], [/ruckus/i, 'Ruckus'], [/cisco meraki/i, 'Meraki'], [/sagemcom/i, 'Sagemcom'], [/arcadyan/i, 'Arcadyan'],
  [/sercomm/i, 'Sercomm'], [/technicolor/i, 'Technicolor'], [/askey/i, 'Askey'], [/hitron/i, 'Hitron'], [/^ubee/i, 'Ubee'],
  [/^arris\b/i, 'Arris'], [/netcomm/i, 'NetComm'], [/billion electric/i, 'Billion'], [/trendnet/i, 'TRENDnet'], [/gl technologies/i, 'GL.iNet'],
  [/\bip-com\b/i, 'IP-COM'], [/shenzhen fast technologies|shenzhen mercury communication/i, 'Fast/Mercury'], [/phicomm/i, 'Phicomm'],
  [/amped wireless/i, 'Amped'], [/digisol/i, 'Digisol'], [/nexxt solutions/i, 'Nexxt'], [/^avm (gmbh|audiovisuelles)/i, 'AVM'],
  [/^lancom systems/i, 'LANCOM'], [/teltonika networks/i, 'Teltonika'], [/robustel/i, 'Robustel'], [/cradlepoint/i, 'Cradlepoint'],
  [/inhand/i, 'InHand'], [/actiontec/i, 'Actiontec'], [/gemtek/i, 'Gemtek'], [/green ?packet/i, 'Green Packet'],
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

const out = {}; const onu = {}; const maybe = {};
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
    else {
      const m = MAYBE_MAKERS.find(([re]) => re.test(org));
      if (m) maybe[assignment.toUpperCase()] = m[1];
    }
  }
}
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'router-ouis.generated.json');
fs.writeFileSync(target, `${JSON.stringify({ router: out, onu, maybe }, null, 0)}\n`);
const byMaker = {};
for (const v of [...Object.values(out), ...Object.values(onu), ...Object.values(maybe)]) byMaker[v] = (byMaker[v] ?? 0) + 1;
console.log(`${seen} MA-L assignments read: ${Object.keys(out).length} router prefixes, ${Object.keys(onu).length} optical-unit (ONU/ONT) prefixes, ${Object.keys(maybe).length} Huawei/ZTE prefixes (xPON routers, but also phones):`, byMaker);
console.log('written to', target);
