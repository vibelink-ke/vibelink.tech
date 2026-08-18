#!/usr/bin/env node
/**
 * Render the WireGuard server config from wg_peers and reload it.
 *
 *   node scripts/wg-sync.mjs                 # write the file and reload
 *   node scripts/wg-sync.mjs --print         # show it, change nothing
 *   node scripts/wg-sync.mjs --init          # mint a server keypair and stop
 *
 * The database is the source of truth. Adding a router in the UI creates a peer
 * row; running this makes the running server aware of it. Nothing here reaches
 * out to a router, so it is safe to run whenever.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pool } from '../src/db.js';
import { keypair, renderServerConfig, SERVER_IP } from '../src/wireguard.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const CONFIG = process.env.WG_CONFIG_PATH ?? '/config/wg_confs/wg0.conf';
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

const conf = await renderServerConfig(priv, PORT);

if (args.includes('--print')) {
  console.log(conf);
  await pool.end();
  process.exit(0);
}

fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
fs.writeFileSync(CONFIG, conf, { mode: 0o600 });
console.log(`wrote ${CONFIG} (${conf.split('[Peer]').length - 1} peer(s), server ${SERVER_IP})`);

// `syncconf` applies changes without dropping established tunnels; `up` would.
try {
  await run('wg', ['syncconf', 'wg0', CONFIG]);
  console.log('reloaded wg0');
} catch (e) {
  /*
   * Expected under Docker, and not a failure.
   *
   * This runs in the API container, which is where the database is. wg lives
   * in the wireguard container, which owns the interface. The file has been
   * written to the directory they share, so all that is left is asking the
   * other side to read it, and printing the command that does that is more
   * use than reporting that this one could not.
   */
  const why = String(e.message ?? '').trim().slice(0, 120);
  console.log(`not reloaded from here (${why})`);
  console.log('The config is written. Apply it with:');
  console.log(`  docker compose -f docker-compose.prod.yml exec wireguard wg syncconf wg0 ${CONFIG}`);
}

await pool.end();
