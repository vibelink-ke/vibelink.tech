import axios from 'axios';
import { pool, enabledTenants } from './db.js';
import * as secrets from './secrets.js';

/**
 * SmartOLT (smartolt.com) — a cloud service that manages a fibre operator's OLTs and ONUs.
 *
 * A tenant who has it gives us their SmartOLT address (the part before .smartolt.com) and an
 * API key (SmartOLT → Settings → API). From then on we keep a copy of their OLTs and ONUs here:
 * which are online, their signal and distance, which client each one belongs to. That drives the
 * ONU tab on a client, the SmartOLT page, the ONUs on the map, outage alerts, and (if the tenant
 * switches it on) disabling an expired client's ONU until they pay.
 *
 * Talking to SmartOLT is rate limited on their side (the full ONU details call is about 15 an
 * hour), so the full list is fetched hourly and only the light status call runs often. The host is
 * always <name>.smartolt.com — never an address the user typed — so this cannot be pointed
 * at anything else.
 *
 * Responses are read defensively (SmartOLT wraps lists in different keys per call, and a field may
 * be named a couple of ways), and every failure is kept on the config row for the page to show.
 */

const SUB_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Accepts "acme", "acme.smartolt.com" or "https://acme.smartolt.com/". */
export function parseSubdomain(input) {
  const s = String(input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  const sub = s.endsWith('.smartolt.com') ? s.slice(0, -'.smartolt.com'.length) : s;
  return SUB_RE.test(sub) ? sub : null;
}

export async function loadConfig(tenantId) {
  const { rows: [c] } = await pool.query('select * from smartolt_config where tenant_id=$1', [tenantId]);
  if (!c) return null;
  return { ...c, apiKey: c.api_key_enc ? secrets.decrypt(c.api_key_enc) : null };
}

async function call(cfg, method, path, { params, form } = {}) {
  if (!cfg?.subdomain || !cfg?.apiKey) throw new Error('SmartOLT is not connected yet.');
  const res = await axios({
    method,
    url: `https://${cfg.subdomain}.smartolt.com/api${path}`,
    params,
    data: form ? new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : undefined,
    headers: {
      'X-Token': cfg.apiKey,
      Accept: 'application/json',
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    timeout: 45000,
    maxContentLength: 80 * 1024 * 1024,
    validateStatus: () => true,
  });
  const body = res.data;
  const said = typeof body === 'object' && body ? (body.error || body.message || body.msg || body.response) : null;
  if (res.status === 401 || res.status === 403) throw new Error('SmartOLT refused the API key.');
  if (res.status === 404) throw new Error(`SmartOLT has no ${path} (${cfg.subdomain}.smartolt.com answered 404).`);
  if (res.status === 429) throw new Error('SmartOLT says too many requests — it will be tried again later.');
  if (res.status >= 400) throw new Error(`SmartOLT answered ${res.status}${typeof said === 'string' ? `: ${said}` : ''}`);
  if (body && typeof body === 'object' && body.status === false) {
    throw new Error(typeof said === 'string' && said ? said : 'SmartOLT reported an error.');
  }
  if (typeof body === 'string' && /^\s*</.test(body)) throw new Error('SmartOLT did not answer with data — check the address.');
  return body;
}

const list = (b) => {
  if (Array.isArray(b)) return b;
  for (const k of ['response', 'onus', 'data', 'olts', 'result', 'items']) {
    if (Array.isArray(b?.[k])) return b[k];
    // response: { onus: [...] }
    if (b?.[k] && typeof b[k] === 'object') for (const kk of ['onus', 'olts', 'items']) if (Array.isArray(b[k][kk])) return b[k][kk];
  }
  return [];
};
const first = (o, ...keys) => {
  for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return null;
};
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const text = (v) => (v === null || v === undefined ? null : String(v));

/** SmartOLT's words for an ONU's state, folded to online | offline | los | power_fail. */
export function normStatus(v) {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('power')) return 'power_fail';
  if (s.includes('los')) return 'los';
  if (s.startsWith('online')) return 'online';
  if (s.startsWith('offline')) return 'offline';
  return s.trim() || 'unknown';
}

const normOnu = (o) => ({
  external_id: text(first(o, 'unique_external_id', 'external_id', 'onu_external_id', 'id')),
  sn: text(first(o, 'sn', 'serial_number', 'serial')),
  name: text(first(o, 'name', 'onu_name')),
  olt_id: text(first(o, 'olt_id')),
  olt_name: text(first(o, 'olt_name')),
  board: text(first(o, 'board')),
  port: text(first(o, 'port')),
  onu_no: text(first(o, 'onu', 'onu_number', 'onu_no')),
  onu_type: text(first(o, 'onu_type', 'onu_type_name')),
  zone: text(first(o, 'zone_name', 'zone')),
  odb: text(first(o, 'odb_name', 'odb')),
  address: text(first(o, 'address')),
  lat: num(first(o, 'latitude', 'lat')),
  lng: num(first(o, 'longitude', 'lng', 'lon')),
  status: normStatus(first(o, 'status', 'onu_status')),
  signal_class: text(first(o, 'signal', 'signal_quality')),
  signal_dbm: num(first(o, 'signal_1310', 'rx_power', 'signal_dbm')),
  distance_m: num(first(o, 'distance', 'onu_distance')),
  admin_status: String(first(o, 'administrative_status', 'admin_status') ?? '').toLowerCase() || null,
  authorized_at: first(o, 'authorization_date', 'authorized_at'),
});

// ── keeping our copy ────────────────────────────────────────────────────────

async function setState(tenantId, fields) {
  const keys = Object.keys(fields);
  await pool.query(
    `update smartolt_config set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} where tenant_id=$1`,
    [tenantId, ...keys.map((k) => fields[k])]);
}

async function syncOlts(cfg) {
  const olts = list(await call(cfg, 'GET', '/system/get_olts'));
  for (const o of olts) {
    const id = text(first(o, 'id', 'olt_id'));
    if (!id) continue;
    await pool.query(
      `insert into smartolt_olts (tenant_id, olt_id, name, ip, hardware, raw, updated_at)
       values ($1,$2,$3,$4,$5,$6,now())
       on conflict (tenant_id, olt_id) do update
         set name=excluded.name, ip=excluded.ip, hardware=excluded.hardware, raw=excluded.raw, updated_at=now()`,
      [cfg.tenant_id, id, text(first(o, 'name', 'olt_name')), text(first(o, 'olt_ip', 'ip', 'ip_address')),
        text(first(o, 'olt_hardware_version', 'hardware', 'model')), JSON.stringify(o)]);
  }
  return olts.length;
}

/** The full ONU list. Heavy and rate limited on SmartOLT's side, so this is hourly. */
async function syncOnus(cfg) {
  const started = new Date();
  const onus = list(await call(cfg, 'GET', '/onu/get_all_onus_details')).map(normOnu).filter((o) => o.external_id);
  for (const o of onus) {
    await pool.query(
      `insert into smartolt_onus (tenant_id, external_id, sn, name, olt_id, olt_name, board, port, onu_no, onu_type,
                                  zone, odb, address, lat, lng, status, signal_class, signal_dbm, distance_m, admin_status,
                                  authorized_at, seen_at, updated_at, offline_since)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now(),now(),
               case when $16 = 'online' then null else now() end)
       on conflict (tenant_id, external_id) do update set
         sn=excluded.sn, name=excluded.name, olt_id=excluded.olt_id, olt_name=excluded.olt_name, board=excluded.board,
         port=excluded.port, onu_no=excluded.onu_no, onu_type=excluded.onu_type, zone=excluded.zone, odb=excluded.odb,
         address=excluded.address, lat=excluded.lat, lng=excluded.lng, signal_class=excluded.signal_class,
         signal_dbm=excluded.signal_dbm, distance_m=excluded.distance_m, admin_status=excluded.admin_status,
         authorized_at=excluded.authorized_at, seen_at=now(), updated_at=now(),
         offline_since = case when excluded.status = 'online' then null
                              when smartolt_onus.status = 'online' or smartolt_onus.offline_since is null then now()
                              else smartolt_onus.offline_since end,
         status=excluded.status`,
      [cfg.tenant_id, o.external_id, o.sn, o.name, o.olt_id, o.olt_name, o.board, o.port, o.onu_no, o.onu_type,
        o.zone, o.odb, o.address, o.lat, o.lng, o.status, o.signal_class, o.signal_dbm, o.distance_m, o.admin_status,
        o.authorized_at ? new Date(o.authorized_at) : null]);
  }
  // Only after a full, non-empty answer: an ONU that is no longer there has been deleted in SmartOLT.
  if (onus.length) await pool.query('delete from smartolt_onus where tenant_id=$1 and seen_at < $2', [cfg.tenant_id, started]);
  await linkOnus(cfg.tenant_id);
  return onus.length;
}

/** The light call: who is online right now. Updates what we already know about; new ONUs wait for the hourly list. */
async function syncStatuses(cfg) {
  const rows = list(await call(cfg, 'GET', '/onu/get_onus_statuses'));
  let n = 0;
  for (const r of rows) {
    const id = text(first(r, 'unique_external_id', 'external_id', 'onu_external_id', 'id'));
    if (!id) continue;
    const status = normStatus(first(r, 'status', 'onu_status'));
    const dbm = num(first(r, 'signal_1310', 'rx_power', 'signal_dbm'));
    const cls = text(first(r, 'signal', 'signal_quality'));
    const { rowCount } = await pool.query(
      `update smartolt_onus set
          offline_since = case when $3 = 'online' then null when status = 'online' or offline_since is null then now() else offline_since end,
          status=$3, signal_dbm=coalesce($4, signal_dbm), signal_class=coalesce($5, signal_class), updated_at=now()
        where tenant_id=$1 and external_id=$2`, [cfg.tenant_id, id, status, dbm, cls]);
    n += rowCount;
  }
  return n;
}

/** Tie ONUs to clients: by the serial saved on the client, else by an ONU named with a one-line client's account number. */
export async function linkOnus(tenantId) {
  await pool.query(
    `update smartolt_onus o set subscriber_id = s.id
       from subscribers s
      where o.tenant_id=$1 and o.subscriber_id is null and not o.link_locked
        and s.tenant_id=$1 and s.onu_sn is not null and o.sn is not null and lower(s.onu_sn) = lower(o.sn)`, [tenantId]);
  await pool.query(
    `update smartolt_onus o set subscriber_id = s.id
       from subscribers s
      where o.tenant_id=$1 and o.subscriber_id is null and not o.link_locked
        and s.tenant_id=$1 and o.name is not null and s.account_code = o.name
        and (select count(*) from subscribers x where x.tenant_id=$1 and x.account_code = o.name) = 1`, [tenantId]);
}

/**
 * Bring our copy up to date.
 *   'statuses'  the light call
 *   'full'      OLTs and the full ONU list (then statuses are already in it)
 */
export async function syncTenant(tenantId, mode = 'statuses') {
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) return { skipped: true };
  try {
    let olts = null; let onus = null;
    if (mode === 'full') {
      olts = await syncOlts(cfg);
      onus = await syncOnus(cfg);
      await setState(tenantId, { last_details_at: new Date(), last_statuses_at: new Date(), last_error: null });
    } else {
      onus = await syncStatuses(cfg);
      await setState(tenantId, { last_statuses_at: new Date(), last_error: null });
    }
    await evaluateOutages(tenantId).catch((e) => console.warn('smartolt outages', e.message));
    return { olts, onus };
  } catch (e) {
    await setState(tenantId, { last_error: String(e.message).slice(0, 400), last_error_at: new Date() }).catch(() => {});
    throw e;
  }
}

// ── outages ─────────────────────────────────────────────────────────────────

/**
 * A single ONU going offline is a customer switching off a router. Many at once on one PON port,
 * or across a whole OLT, is a fault — so it is worth a message. Needs at least 4 ONUs on the group
 * and three quarters of them down.
 */
async function evaluateOutages(tenantId) {
  const { rows } = await pool.query(
    `select olt_id, coalesce(max(olt_name), olt_id) as olt_name, board, port, count(*)::int as total,
            count(*) filter (where status <> 'online')::int as down
       from smartolt_onus where tenant_id=$1 group by olt_id, board, port`, [tenantId]);

  const groups = new Map();
  const add = (key, label, total, down) => {
    const g = groups.get(key) ?? { label, total: 0, down: 0 };
    g.total += total; g.down += down; groups.set(key, g);
  };
  for (const r of rows) {
    add(`olt:${r.olt_id}`, `OLT ${r.olt_name}`, r.total, r.down);
    add(`pon:${r.olt_id}:${r.board}:${r.port}`, `${r.olt_name} port ${r.board ?? '?'}/${r.port ?? '?'}`, r.total, r.down);
  }

  const { rows: open } = await pool.query('select key, since, notified from smartolt_alerts where tenant_id=$1', [tenantId]);
  const openBy = new Map(open.map((a) => [a.key, a]));
  const { notifyOwner } = await import('./jobs.js');

  for (const [key, g] of groups) {
    const bad = g.total >= 4 && g.down / g.total >= 0.75;
    const was = openBy.get(key);
    if (bad && !was) {
      await pool.query('insert into smartolt_alerts (tenant_id, key, since) values ($1,$2,now()) on conflict do nothing', [tenantId, key]);
    } else if (bad && was && !was.notified && Date.now() - new Date(was.since) >= 2 * 60000) {
      await pool.query('update smartolt_alerts set notified=true where tenant_id=$1 and key=$2', [tenantId, key]);
      await notifyOwner(tenantId, `${g.label}: ${g.down} of ${g.total} ONUs are offline — possible fibre or power fault.`, { url: '/smartolt', title: 'ONUs offline' });
    } else if (!bad && was) {
      await pool.query('delete from smartolt_alerts where tenant_id=$1 and key=$2', [tenantId, key]);
      if (was.notified) await notifyOwner(tenantId, `${g.label} is back: ${g.total - g.down} of ${g.total} ONUs online.`, { url: '/smartolt', title: 'ONUs back' });
    }
  }
  // groups that no longer exist (their ONUs were deleted)
  for (const a of open) if (!groups.has(a.key)) await pool.query('delete from smartolt_alerts where tenant_id=$1 and key=$2', [tenantId, a.key]);
}

// ── things the operator can do ──────────────────────────────────────────────

const ACTIONS = {
  reboot: '/onu/reboot/',
  enable: '/onu/enable/',
  disable: '/onu/disable/',
  resync: '/onu/resync_config/',
};

export async function onuAction(tenantId, externalId, action) {
  if (!ACTIONS[action]) throw new Error('Unknown action.');
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) throw new Error('SmartOLT is not connected.');
  const { rows: [onu] } = await pool.query('select external_id from smartolt_onus where tenant_id=$1 and external_id=$2', [tenantId, externalId]);
  if (!onu) throw new Error('That ONU is not in the list — sync first.');
  const body = await call(cfg, 'POST', ACTIONS[action] + encodeURIComponent(externalId));
  if (action === 'enable' || action === 'disable') {
    await pool.query(
      `update smartolt_onus set admin_status=$3, disabled_by_us=false, updated_at=now() where tenant_id=$1 and external_id=$2`,
      [tenantId, externalId, action === 'enable' ? 'enabled' : 'disabled']);
  }
  return body;
}

export async function unconfiguredOnus(tenantId) {
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) throw new Error('SmartOLT is not connected.');
  return list(await call(cfg, 'GET', '/onu/unconfigured_onus')).map((o) => ({
    sn: text(first(o, 'sn', 'serial_number')),
    olt_id: text(first(o, 'olt_id')),
    olt_name: text(first(o, 'olt_name')),
    board: text(first(o, 'board')),
    port: text(first(o, 'port')),
    pon_type: text(first(o, 'pon_type')),
    onu_type: text(first(o, 'onu_type', 'onu_type_name')),
    raw: o,
  }));
}

const LOOKUPS = {
  onu_types: '/system/get_onu_types',
  zones: '/system/get_zones',
  speed_profiles: '/system/get_speed_profiles',
};

/** Choices for the authorise form. Anything SmartOLT will not list just leaves that box free text. */
export async function lookup(tenantId, what) {
  if (!LOOKUPS[what]) throw new Error('Unknown list.');
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) throw new Error('SmartOLT is not connected.');
  return list(await call(cfg, 'GET', LOOKUPS[what])).map((o) => ({
    id: text(first(o, 'id')),
    name: text(first(o, 'name', 'onu_type', 'title', 'profile_name')) ?? text(first(o, 'id')),
  })).filter((o) => o.name);
}

/** Authorise an ONU that SmartOLT has discovered but not configured. Sent as SmartOLT documents it; its own message comes back on failure. */
export async function authorizeOnu(tenantId, f) {
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) throw new Error('SmartOLT is not connected.');
  for (const k of ['olt_id', 'sn']) if (!String(f[k] ?? '').trim()) throw new Error(`${k === 'sn' ? 'The serial number' : 'The OLT'} is required.`);
  const form = {
    olt_id: f.olt_id, pon_type: f.pon_type || 'gpon', board: f.board, port: f.port, sn: f.sn,
    onu_type: f.onu_type, onu_mode: f.onu_mode || 'Routing', custom_profile: f.custom_profile,
    cvlan: f.vlan, svlan: f.vlan, zone: f.zone, odb: f.odb, name: f.name, address: f.address,
    upload_speed_profile_name: f.upload_speed_profile, download_speed_profile_name: f.download_speed_profile,
  };
  return call(cfg, 'POST', '/onu/authorize_onu', { form });
}

/** Give SmartOLT's answer to a key/subdomain a tenant has typed but not saved yet. */
export async function testConnection({ subdomain, apiKey }) {
  const cfg = { subdomain, apiKey };
  const body = await call(cfg, 'GET', '/system/get_olts');
  const olts = list(body);
  return {
    ok: true,
    olts: olts.length,
    names: olts.slice(0, 8).map((o) => text(first(o, 'name', 'olt_name'))).filter(Boolean),
    // What the first OLT looked like, so a difference in SmartOLT's answer is easy to see and fix.
    shape: olts[0] ? Object.keys(olts[0]).slice(0, 30) : Object.keys(body ?? {}).slice(0, 30),
  };
}

// ── automatic enable / disable ──────────────────────────────────────────────

/**
 * For tenants who switched it on: a client who is expired, suspended or paused has their ONU
 * disabled at the OLT, and it is enabled again when they are active. Only an ONU this switched
 * off is ever switched back on — one the operator disabled by hand stays as they left it.
 * A handful per run, so a bad answer from SmartOLT cannot cut off a whole network at once.
 */
export async function enforceOnus() {
  const { rows } = await pool.query(
    `select o.tenant_id, o.external_id, o.admin_status, o.disabled_by_us, s.id as subscriber_id, s.account_code, s.status as sub_status
       from smartolt_onus o
       join smartolt_config c on c.tenant_id = o.tenant_id and c.enabled and c.auto_disable
       join subscribers s on s.id = o.subscriber_id
      where o.tenant_id in (${enabledTenants})
        and ((s.status in ('expired','suspended','paused') and coalesce(o.admin_status,'') <> 'disabled' and not o.disabled_by_us)
          or (s.status = 'active' and o.disabled_by_us))
      limit 40`, ['smartoltEnforce']);

  for (const r of rows) {
    const disabling = r.sub_status !== 'active';
    try {
      await onuAction(r.tenant_id, r.external_id, disabling ? 'disable' : 'enable');
      await pool.query('update smartolt_onus set disabled_by_us=$3 where tenant_id=$1 and external_id=$2', [r.tenant_id, r.external_id, disabling]);
      await pool.query(
        `insert into activity_log (tenant_id, subscriber_id, account_code, actor, action, detail) values ($1,$2,$3,'SmartOLT',$4,$5)`,
        [r.tenant_id, r.subscriber_id, r.account_code, disabling ? 'ONU disabled' : 'ONU enabled',
          disabling ? `Client is ${r.sub_status}` : 'Client is active again']);
    } catch (e) {
      console.warn('smartolt enforce', r.external_id, '—', e.message);
      await setState(r.tenant_id, { last_error: `Could not ${disabling ? 'disable' : 'enable'} an ONU: ${String(e.message).slice(0, 300)}`, last_error_at: new Date() }).catch(() => {});
    }
  }
}

/** The scheduled jobs' entry: one pass over every tenant that has it on. */
export async function syncAll(mode) {
  const { rows } = await pool.query(
    `select tenant_id from smartolt_config c where enabled and tenant_id in (${enabledTenants})`, [mode === 'full' ? 'smartoltDetails' : 'smartoltStatuses']);
  for (const { tenant_id: id } of rows) {
    await syncTenant(id, mode).catch((e) => console.warn('smartolt sync', id, '—', e.message));
  }
}
