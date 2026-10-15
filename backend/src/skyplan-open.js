import crypto from 'node:crypto';
import express from 'express';
import { pool } from './db.js';
import { buildSkyPlanProject, importSkyPlanProject } from './skyplan-convert.js';
import { saveLeadCoverage } from './lead-coverage.js';

/**
 * The API SkyPlan uses to read and save this ISP's live network, with an API key instead of a sign-in (mounted at /api/open,
 * before the sign-in guard, so it never sees a session).
 *
 * A key belongs to one ISP and can only do what it was made for: read the network as a SkyPlan project and, if it was made
 * with write access, save a SkyPlan project back. It cannot reach customers' money, settings or anything else, and it never
 * deletes. Only a hash of the key is stored, so a key can be shown once and never again.
 */

export const KEY_PREFIX = 'vlk_';
export const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');

export function newKey() {
  const key = KEY_PREFIX + crypto.randomBytes(30).toString('base64url');
  return { key, hash: hashKey(key), last4: key.slice(-4) };
}

const NODE_KINDS = ['olt', 'splitter', 'closure', 'onu', 'ap', 'ptp', 'station', 'tower', 'pole', 'cabinet', 'power', 'switch'];
const NODE_COLS = 'id, kind, name, lat::float8 as lat, lng::float8 as lng, details';
const coord = (v, max) => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= max ? n : null; };
const details = (d) => {
  const out = {};
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    for (const [k, v] of Object.entries(d).slice(0, 12)) {
      if (typeof v === 'string' || typeof v === 'number') out[String(k).slice(0, 40)] = String(v).slice(0, 200);
    }
  }
  return out;
};
const pathOf = (p) => (Array.isArray(p) ? p.slice(0, 500) : [])
  .map((pt) => [coord(pt?.[0], 90), coord(pt?.[1], 180)]).filter(([a, b]) => a !== null && b !== null);

async function loadNetwork(tenantId) {
  const { rows: nodes } = await pool.query(`select ${NODE_COLS} from network_nodes where tenant_id=$1 order by created_at`, [tenantId]);
  const { rows: links } = await pool.query(
    'select id, kind, from_ref, to_ref, path, label, details from network_links where tenant_id=$1 order by created_at', [tenantId]);
  return { nodes, links };
}

/** The same store operations the Map screen's importer calls, done directly against this ISP's own rows. */
function storeFor(tenantId) {
  return {
    async createNetNode({ kind, name, lat, lng, details: d }) {
      if (!NODE_KINDS.includes(kind) || coord(lat, 90) === null || coord(lng, 180) === null) throw new Error(`cannot place ${name}`);
      const { rows: [n] } = await pool.query(
        `insert into network_nodes (tenant_id, kind, name, lat, lng, details) values ($1,$2,$3,$4,$5,$6) returning ${NODE_COLS}`,
        [tenantId, kind, String(name || kind).trim().slice(0, 120), lat, lng, details(d)]);
      return n;
    },
    async updateNetNode(id, { name, details: d, lat, lng }) {
      const sets = []; const vals = [];
      const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length + 2}`); };
      if (name !== undefined && String(name).trim()) add('name', String(name).trim().slice(0, 120));
      if (d !== undefined) add('details', details(d));
      if (lat !== undefined && coord(lat, 90) !== null && coord(lng, 180) !== null) { add('lat', lat); add('lng', lng); }
      if (!sets.length) return;
      await pool.query(`update network_nodes set ${sets.join(', ')} where tenant_id=$1 and id=$2`, [tenantId, id, ...vals]);
    },
    async createNetLink({ kind, from, to, path, label, details: d }) {
      const { rows: [l] } = await pool.query(
        `insert into network_links (tenant_id, kind, from_ref, to_ref, path, label, details) values ($1,$2,$3,$4,$5,$6,$7)
         returning id, kind, from_ref, to_ref, path, label, details`,
        [tenantId, kind, from, to, JSON.stringify(pathOf(path)), String(label ?? '').trim().slice(0, 120) || null, details(d)]);
      return l;
    },
    async updateNetLink(id, { label, path, details: d }) {
      const sets = []; const vals = [];
      const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length + 2}`); };
      if (label !== undefined) add('label', String(label).trim().slice(0, 120) || null);
      if (d !== undefined) add('details', details(d));
      if (path !== undefined) add('path', JSON.stringify(pathOf(path)));
      if (!sets.length) return;
      await pool.query(`update network_links set ${sets.join(', ')} where tenant_id=$1 and id=$2`, [tenantId, id, ...vals]);
    },
  };
}

export function skyplanOpenRouter() {
  const r = express.Router();

  // A browser on SkyPlan's own address calls this one, with the key in a header and no cookies, so any origin may.
  r.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'authorization, content-type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Who is asking: the key names the ISP, and the ISP must be in good standing.
  r.use(async (req, res, next) => {
    try {
      const m = /^Bearer\s+(\S+)$/i.exec(String(req.get('authorization') ?? ''));
      if (!m || !m[1].startsWith(KEY_PREFIX)) return res.status(401).json({ error: 'Send your API key as "Authorization: Bearer <key>".' });
      const { rows: [k] } = await pool.query(
        `select k.id, k.name, k.can_write, k.tenant_id, t.name as tenant_name, t.status,
                (t.licence_ends is not null and t.licence_ends < current_date) as lapsed
           from api_keys k join tenants t on t.id = k.tenant_id
          where k.key_hash = $1 and k.revoked_at is null`, [hashKey(m[1])]);
      if (!k) return res.status(401).json({ error: 'That API key is not valid, or it has been revoked.' });
      if (k.status === 'suspended') return res.status(402).json({ error: 'This account is suspended.' });
      if (k.status === 'readonly' || (['active', 'trial'].includes(k.status) && k.lapsed)) {
        return res.status(402).json({ error: 'This account\'s licence has expired.' });
      }
      req.apiKey = k;
      pool.query('update api_keys set last_used_at = now() where id = $1', [k.id]).catch(() => {});
      next();
    } catch (e) { next(e); }
  });

  r.get('/ping', (req, res) => {
    res.json({ ok: true, isp: req.apiKey.tenant_name, key: req.apiKey.name, canWrite: req.apiKey.can_write });
  });

  /** The live network as a SkyPlan project: sites, equipment, fibre and customers. */
  r.get('/skyplan/project', async (req, res, next) => {
    try {
      const t = req.apiKey.tenant_id;
      const { nodes, links } = await loadNetwork(t);
      const { rows: clients } = await pool.query(
        `select id, name, line_label, lat::float8 as lat, lng::float8 as lng, host(mgmt_ip) as mgmt_ip
           from subscribers where tenant_id=$1 and lat is not null and lng is not null`, [t]);
      const { rows: routers } = await pool.query(
        'select id, name, lat::float8 as lat, lng::float8 as lng from routers where tenant_id=$1 and lat is not null and lng is not null', [t]);
      const { rows: leads } = await pool.query(
        `select id, name, lat::float8 as lat, lng::float8 as lng from leads
          where tenant_id=$1 and lat is not null and lng is not null and status not in ('won','lost')`, [t]);
      const { project, report } = buildSkyPlanProject({ nodes, links, clients, routers, leads, name: req.apiKey.tenant_name });
      res.json({ isp: req.apiKey.tenant_name, canWrite: req.apiKey.can_write, project, report });
    } catch (e) { next(e); }
  });

  /**
   * Save a SkyPlan project into the network. Adds what is new and renames what exists (never moving it unless asked),
   * and never deletes — what SkyPlan no longer has is only counted, for the person to remove on the Map themselves.
   */
  r.post('/skyplan/project', async (req, res, next) => {
    try {
      if (!req.apiKey.can_write) return res.status(403).json({ error: 'This key can only read. Make a key with write access to save.' });
      const project = req.body?.project;
      const t = req.apiKey.tenant_id;
      const net = await loadNetwork(t);
      const result = await importSkyPlanProject(project, net, storeFor(t), {
        includePlanned: !!req.body?.includePlanned, moveExisting: !!req.body?.moveExisting,
      });
      res.json(result);
    } catch (e) {
      if (/not a SkyPlan/.test(e?.message)) return res.status(400).json({ error: e.message });
      next(e);
    }
  });

  /** SkyPlan's answer to "can this lead be served?" for leads it was given. Needs a key with write access. */
  r.post('/skyplan/lead-feasibility', async (req, res, next) => {
    try {
      if (!req.apiKey.can_write) return res.status(403).json({ error: 'This key can only read. Make a key with write access to save.' });
      res.json({ saved: await saveLeadCoverage(pool, req.apiKey.tenant_id, req.body?.results) });
    } catch (e) { next(e); }
  });

  return r;
}
