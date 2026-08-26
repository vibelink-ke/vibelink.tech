#!/usr/bin/env node
/**
 * Render the WireGuard server config from wg_peers and reload it.
 *
 *   node scripts/wg-sync.mjs                 # write the file and reload
 *   node scripts/wg-sync.mjs --print         # show it, change nothing
 *   node scripts/wg-sync.mjs --init          # mint a server keypair and stop
 *
 * The database is the source of truth. server.js's wg-peer create/delete
 * routes already call wireguard.js's syncServer() themselves on every
 * change, so this is no longer required after the normal Onboard-via-
 * WireGuard flow — it exists for --print/--init, and as a manual fallback if
 * a sync ever needs re-running by hand (a server restart, a config restore).
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { keypair, renderServerConfig, syncServer, SERVER_IP } from '../src/wireguard.js';

const args = process.argv.slice(2);
const PORT = Number(process.env.WG_PORT ?? 51820);

if (args.includes('--init')) {
  const kp = keypair();
  console.log('Server keypair — put these in backend/.env:\n');
  console.log(`WG_SERVER_PRIVATE_KEY=${kp.privateKey}`);
  console.log(`WG_SERVER_PUBLIC_KEY=${kp.publicKey}`);
  console.log(`WG_ENDPOINT=your.public.hostname.or.ip`);
  console.log(`\nThe private key stays on the server. The public key is handed to routers.`);
  process.exit(0);
}

const priv = process.env.WG_SERVER_PRIVATE_KEY;
if (!priv) {
  console.error('WG_SERVER_PRIVATE_KEY is not set. Generate one with: node scripts/wg-sync.mjs --init');
  process.exit(1);
}

if (args.includes('--print')) {
  console.log(await renderServerConfig(priv, PORT));
  await pool.end();
  process.exit(0);
}

const result = await syncServer();
if (!result.written) {
  console.error(`did not write config: ${result.reason}`);
} else if (result.reloaded) {
  console.log(`wrote config and reloaded wg0 (server ${SERVER_IP})`);
} else {
  console.log(`wrote config (server ${SERVER_IP})`);
  console.log(`not reloaded from here — this runs in the api container, wg0 lives in the wireguard one. Apply it with:`);
  console.log(`  ${result.fallbackCmd}`);
}

await pool.end();
