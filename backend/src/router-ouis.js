/**
 * Which MAC prefixes belong to makers of routers and extenders.
 *
 * Every network device's MAC starts with a prefix the IEEE registered to its maker (an MA-L "OUI": 24 bits, the first three bytes; MA-M and MA-S
 * blocks are longer prefixes under an IEEE-owned OUI). A burned-in address has the "locally administered" bit (0x02 of the first byte) clear;
 * phones' private addresses set it. A router's own interfaces (LAN, WAN, the 2.4 GHz and 5 GHz radios) take consecutive addresses from one block,
 * a few apart (OpenWrt's per-device tables show LAN = WAN + 1, then the radios next, on devices from several makers), so a router seen by one of its
 * addresses is recognised by another of them: same prefix, last bytes within a few of each other.
 *
 * BASE below is what has been checked: Tenda's registered prefixes (IEEE registry as listed by maclookup.app). The rest of the makers come from
 * router-ouis.generated.json, built from the IEEE registry by scripts/build-router-ouis.mjs, and are read when it exists.
 */
import fs from 'node:fs';

const BASE = {
  C83A35: 'Tenda', '0840F3': 'Tenda', '0495E6': 'Tenda', '500FF5': 'Tenda', '502B73': 'Tenda',
  '58D9D5': 'Tenda', CC2D21: 'Tenda', D83214: 'Tenda', '809FE4': 'Tenda', '8C44BB': 'Tenda',
};

function readGenerated() {
  try { return JSON.parse(fs.readFileSync(new URL('./router-ouis.generated.json', import.meta.url), 'utf8')); } catch { return {}; }
}

export const ROUTER_OUIS = { ...readGenerated(), ...BASE };

const hex = (mac) => String(mac ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();

/** The maker of a router, from the prefix of its MAC, or null when the prefix is not one of a router maker's. */
export const vendorOf = (mac) => ROUTER_OUIS[hex(mac).slice(0, 6)] ?? null;

/** How far apart (in the last 24 bits) one router's own interfaces are. */
export const FAMILY_SPAN = 3;

/** Are these two MACs two interfaces of one device: the same prefix, and last bytes a few apart. A MAC is of course its own family. */
export function sameDevice(a, b) {
  const x = hex(a); const y = hex(b);
  if (x.length !== 12 || y.length !== 12 || x.slice(0, 6) !== y.slice(0, 6)) return false;
  return Math.abs(parseInt(x.slice(6), 16) - parseInt(y.slice(6), 16)) <= FAMILY_SPAN;
}
