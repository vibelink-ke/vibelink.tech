import net from 'node:net';
import { pool } from './db.js';

/**
 * Winbox without a VPN client: a router's Winbox, reachable on a public port of this server for a few hours at a time.
 *
 * The API shares the network namespace of the tunnels (network_mode: service:net), so it can reach a router at its tunnel address
 * directly, and `net` publishes the port range below. Each router gets a fixed port from the range; the listener for it exists only
 * while the router is open (routers.winbox_until in the future), and the forward is plain TCP: the Winbox login itself still
 * happens, encrypted, between the laptop and the router.
 */
export const PORT_BASE = Number(process.env.WINBOX_PORT_BASE ?? 18300);
export const PORT_COUNT = Number(process.env.WINBOX_PORT_COUNT ?? 100);
const WINBOX_PORT = 8291;
const MAX_CONNECTIONS = 6;          // per router
const IDLE_MS = 15 * 60 * 1000;     // a session that sends nothing this long is dropped
const CONNECT_MS = 8000;

const listeners = new Map();        // port -> { server, routerId, conns:Set }

async function routerHost(routerId) {
  const { rows: [r] } = await pool.query('select host from routers where id=$1', [routerId]);
  return r ? String(r.host).split('/')[0] : null;
}

function listen(port, routerId) {
  return new Promise((resolve, reject) => {
    const conns = new Set();
    const server = net.createServer(async (client) => {
      if (conns.size >= MAX_CONNECTIONS) return client.destroy();
      client.pause();
      conns.add(client);
      client.once('close', () => conns.delete(client));
      client.on('error', () => {});
      client.setTimeout(IDLE_MS, () => client.destroy());
      let host;
      try { host = await routerHost(routerId); } catch { host = null; }
      if (!host) return client.destroy();
      console.log(`winbox-proxy: ${client.remoteAddress} -> router ${routerId} (${host}) on :${port}`);
      const up = net.connect({ host, port: WINBOX_PORT });
      up.setTimeout(CONNECT_MS, () => { if (up.connecting) up.destroy(); });
      up.on('error', () => client.destroy());
      up.once('close', () => client.destroy());
      client.once('close', () => up.destroy());
      up.once('connect', () => { up.setTimeout(0); client.pipe(up); up.pipe(client); });
    });
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => { server.removeAllListeners('error'); server.on('error', () => {}); resolve({ server, routerId, conns }); });
  });
}

function closeListener(port) {
  const l = listeners.get(port);
  if (!l) return;
  listeners.delete(port);
  l.server.close();
  for (const c of l.conns) c.destroy();
}

/** Make the open listeners match the database: open for every router whose window is running, close the rest. */
let queue = Promise.resolve();
export const reconcile = () => (queue = queue.then(doReconcile, doReconcile));

async function doReconcile() {
  const { rows } = await pool.query(
    'select id, winbox_port from routers where winbox_port is not null and winbox_until > now()');
  const want = new Map(rows.map((r) => [r.winbox_port, r.id]));
  for (const [port, l] of [...listeners]) {
    if (want.get(port) !== l.routerId) closeListener(port);
  }
  for (const [port, routerId] of want) {
    if (listeners.has(port)) continue;
    listeners.set(port, await listen(port, routerId));
  }
}

/** The router's fixed port, picking the lowest free one in the range the first time. */
async function portFor(routerId) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select pg_advisory_xact_lock(417)');
    const { rows: [r] } = await c.query('select winbox_port from routers where id=$1', [routerId]);
    if (!r) { await c.query('rollback'); return null; }
    if (r.winbox_port) { await c.query('commit'); return r.winbox_port; }
    const { rows: used } = await c.query('select winbox_port from routers where winbox_port is not null');
    const taken = new Set(used.map((u) => u.winbox_port));
    let port = null;
    for (let p = PORT_BASE; p < PORT_BASE + PORT_COUNT; p++) if (!taken.has(p)) { port = p; break; }
    if (!port) { await c.query('rollback'); throw new Error(`All ${PORT_COUNT} Winbox ports are in use. Close routers you are not using, or widen WINBOX_PORT_COUNT.`); }
    await c.query('update routers set winbox_port=$2 where id=$1', [routerId, port]);
    await c.query('commit');
    return port;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Open a router's Winbox port for `hours`. Returns { port, until }, or null when there is no such router. */
export async function openWinbox(routerId, hours) {
  const port = await portFor(routerId);
  if (!port) return null;
  const h = Math.min(Math.max(Number(hours) || 4, 1), 24);
  const { rows: [r] } = await pool.query(
    "update routers set winbox_until = now() + ($2 || ' hours')::interval where id=$1 returning winbox_until", [routerId, String(h)]);
  try {
    await reconcile();
  } catch (e) {
    await pool.query('update routers set winbox_until=null where id=$1', [routerId]);
    throw new Error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use on the server.` : `Could not open port ${port}: ${e.message}`);
  }
  return { port, until: r.winbox_until };
}

export async function closeWinbox(routerId) {
  await pool.query('update routers set winbox_until=null where id=$1', [routerId]);
  await reconcile();
}

export async function winboxState(routerId) {
  const { rows: [r] } = await pool.query(
    'select winbox_port, winbox_until, (winbox_until > now()) as open from routers where id=$1', [routerId]);
  if (!r) return null;
  return { port: r.winbox_port, until: r.open ? r.winbox_until : null, open: !!r.open, connections: listeners.get(r.winbox_port)?.conns.size ?? 0 };
}

/** Called once at start-up: reopen what was open before a restart, and close each window when it runs out. */
export function startWinboxProxy() {
  const tick = () => reconcile().catch((e) => console.error('winbox-proxy:', e.message));
  tick();
  setInterval(tick, 30000).unref();
}
