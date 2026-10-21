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

/** Metres from the OLT. SmartOLT may name it a few ways and write it "1250", "1250m" or "1.25 km". */
const distanceM = (o) => {
  for (const k of ['distance', 'onu_distance', 'distance_m', 'ont_distance', 'distance_km']) {
    const raw = o?.[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = num(raw);
    if (n === null) continue;
    return /km/i.test(String(raw)) || k === 'distance_km' ? Math.round(n * 1000) : n;
  }
  return null;
};

/** What one ONU looks like as SmartOLT sends it, with anything secret hidden — shown on the Connection tab to see field names. */
const sampleOf = (o) => Object.fromEntries(Object.entries(o ?? {}).slice(0, 60).map(([k, v]) => [
  k,
  /pass|secret|token|key/i.test(k) ? '••••' : (typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 60) : String(v ?? '').slice(0, 60)),
]));

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
  distance_m: distanceM(o),
  admin_status: String(first(o, 'administrative_status', 'admin_status') ?? '').toLowerCase() || null,
  authorized_at: first(o, 'authorization_date', 'authorized_at'),
  // The PPPoE login configured on the ONU's WAN, when SmartOLT holds one.
  pppoe_user: text(first(o, 'username', 'pppoe_username', 'wan_username')),
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
  const rawOnus = list(await call(cfg, 'GET', '/onu/get_all_onus_details'));
  const onus = rawOnus.map(normOnu).filter((o) => o.external_id);
  if (rawOnus[0]) {
    await pool.query('update smartolt_config set sample_onu=$2 where tenant_id=$1', [cfg.tenant_id, JSON.stringify(sampleOf(rawOnus[0]))]).catch(() => {});
  }
  for (const o of onus) {
    await pool.query(
      `insert into smartolt_onus (tenant_id, external_id, sn, name, olt_id, olt_name, board, port, onu_no, onu_type,
                                  zone, odb, address, lat, lng, status, signal_class, signal_dbm, distance_m, admin_status,
                                  authorized_at, pppoe_user, seen_at, updated_at, offline_since)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now(),now(),
               case when $16 = 'online' then null else now() end)
       on conflict (tenant_id, external_id) do update set
         sn=excluded.sn, name=excluded.name, olt_id=excluded.olt_id, olt_name=excluded.olt_name, board=excluded.board,
         port=excluded.port, onu_no=excluded.onu_no, onu_type=excluded.onu_type, zone=excluded.zone, odb=excluded.odb,
         address=excluded.address, lat=excluded.lat, lng=excluded.lng, signal_class=excluded.signal_class,
         signal_dbm=excluded.signal_dbm, distance_m=excluded.distance_m, admin_status=excluded.admin_status,
         authorized_at=excluded.authorized_at, pppoe_user=excluded.pppoe_user, seen_at=now(), updated_at=now(),
         offline_since = case when excluded.status = 'online' then null
                              when smartolt_onus.status = 'online' or smartolt_onus.offline_since is null then now()
                              else smartolt_onus.offline_since end,
         los_polls = case when excluded.status = 'los' then smartolt_onus.los_polls + 1 else 0 end,
         los_notified = case when excluded.status = 'los' then smartolt_onus.los_notified else false end,
         status=excluded.status`,
      [cfg.tenant_id, o.external_id, o.sn, o.name, o.olt_id, o.olt_name, o.board, o.port, o.onu_no, o.onu_type,
        o.zone, o.odb, o.address, o.lat, o.lng, o.status, o.signal_class, o.signal_dbm, o.distance_m, o.admin_status,
        o.authorized_at ? new Date(o.authorized_at) : null, o.pppoe_user]);
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
    const dist = distanceM(r);
    const { rowCount } = await pool.query(
      `update smartolt_onus set
          offline_since = case when $3 = 'online' then null when status = 'online' or offline_since is null then now() else offline_since end,
          los_polls = case when $3 = 'los' then los_polls + 1 else 0 end,
          los_notified = case when $3 = 'los' then los_notified else false end,
          status=$3, signal_dbm=coalesce($4, signal_dbm), signal_class=coalesce($5, signal_class), distance_m=coalesce($6, distance_m), updated_at=now()
        where tenant_id=$1 and external_id=$2`, [cfg.tenant_id, id, status, dbm, cls, dist]);
    n += rowCount;
  }
  return n;
}

const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Tie ONUs to clients. Each unlinked ONU is tried against the clients, most certain way first, and is
 * linked only when exactly ONE client fits — two possible clients is left for a person, never guessed:
 *   1. the ONU's serial number saved on the client
 *   2. the ONU's PPPoE login equals the client's PPPoE user (the secret on the router)
 *   3. the ONU is named with the client's account number
 * and, with { loose: true } (the "Match to clients" button):
 *   4. the ONU is named with the client's PPPoE user
 *   5. the ONU is named with the client's name (ignoring case and punctuation)
 * A client that already has an ONU is never given a second. The serial is saved on the client, so the link
 * survives every refresh.
 */
export async function matchOnus(tenantId, { loose = false } = {}) {
  const { rows: onus } = await pool.query(
    'select external_id, sn, name, pppoe_user from smartolt_onus where tenant_id=$1 and subscriber_id is null and not link_locked', [tenantId]);
  const out = { checked: onus.length, linked: [], ambiguous: [], unmatched: 0 };
  if (!onus.length) return out;

  const { rows: subs } = await pool.query(
    `select s.id, s.name, s.account_code, s.pppoe_user, s.onu_sn,
            exists (select 1 from smartolt_onus o where o.tenant_id=$1 and o.subscriber_id = s.id) as has_onu
       from subscribers s where s.tenant_id=$1`, [tenantId]);
  const index = (keyOf) => {
    const m = new Map();
    for (const s of subs) {
      const k = keyOf(s);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return m;
  };
  const bySn = index((s) => s.onu_sn && s.onu_sn.toLowerCase());
  const byPppoe = index((s) => s.pppoe_user && s.pppoe_user.toLowerCase());
  const byAccount = index((s) => s.account_code && String(s.account_code).toLowerCase());
  const byName = index((s) => norm(s.name));
  const lower = (v) => String(v ?? '').toLowerCase();

  const rules = [
    ['serial number', (o) => bySn.get(lower(o.sn))],
    ['PPPoE user', (o) => byPppoe.get(lower(o.pppoe_user))],
    ['account number', (o) => byAccount.get(lower(o.name))],
    ...(loose ? [
      ['ONU named with the PPPoE user', (o) => byPppoe.get(lower(o.name))],
      ['client name', (o) => byName.get(norm(o.name))],
    ] : []),
  ];

  const taken = new Set(subs.filter((s) => s.has_onu).map((s) => s.id));
  for (const o of onus) {
    let hit = null;
    let many = null;
    for (const [by, find] of rules) {
      const fits = (find(o) ?? []).filter((s) => !taken.has(s.id));
      if (fits.length === 1) { hit = { by, s: fits[0] }; break; }
      if (fits.length > 1) { many = { by, n: fits.length }; break; }
    }
    if (hit) {
      taken.add(hit.s.id);
      await pool.query('update smartolt_onus set subscriber_id=$3 where tenant_id=$1 and external_id=$2 and subscriber_id is null', [tenantId, o.external_id, hit.s.id]);
      if (o.sn) await pool.query('update subscribers set onu_sn=$3 where tenant_id=$1 and id=$2 and onu_sn is null', [tenantId, hit.s.id, o.sn]);
      out.linked.push({ external_id: o.external_id, onu: o.name ?? o.sn, sn: o.sn, client: hit.s.name, account_code: hit.s.account_code, by: hit.by });
    } else if (many) {
      out.ambiguous.push({ external_id: o.external_id, onu: o.name ?? o.sn, sn: o.sn, matches: many.n, by: many.by });
    } else {
      out.unmatched += 1;
    }
  }
  return out;
}

/** The automatic pass after every refresh: only the certain ways (1 to 3). */
export async function linkOnus(tenantId) {
  await matchOnus(tenantId, { loose: false });
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
    await handleLos(tenantId).catch((e) => console.warn('smartolt los', e.message));
    await recoverLos(tenantId).catch((e) => console.warn('smartolt los recovery', e.message));
    // ONUs waiting to be authorised: a separate call whose failure must not spoil the sync
    await syncUnconfigured(cfg).catch((e) => console.warn('smartolt unconfigured', e.message));
    return { olts, onus };
  } catch (e) {
    await setState(tenantId, { last_error: String(e.message).slice(0, 400), last_error_at: new Date() }).catch(() => {});
    throw e;
  }
}

// ── waiting to be authorised ────────────────────────────────────────────────

/** Keep a copy of the ONUs SmartOLT has discovered but not configured, so the dashboard can count them. */
async function syncUnconfigured(cfg) {
  const rows = (await unconfiguredFor(cfg)).filter((r) => r.sn);
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('delete from smartolt_unconfigured where tenant_id=$1', [cfg.tenant_id]);
    for (const r of rows) {
      await c.query(
        `insert into smartolt_unconfigured (tenant_id, sn, olt_id, olt_name, board, port, pon_type, onu_type)
         values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tenant_id, sn) do nothing`,
        [cfg.tenant_id, r.sn, r.olt_id, r.olt_name, r.board, r.port, r.pon_type, r.onu_type]);
    }
    await c.query('update smartolt_config set unconfigured_at=now() where tenant_id=$1', [cfg.tenant_id]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ── LOS: no light ───────────────────────────────────────────────────────────

/**
 * An ONU reporting LOS (loss of signal — no light arriving) is a cut or unplugged fibre or a dead
 * ONU, and the customer is down. Two checks in a row (so a blip does not count) send the owner a
 * message and raise a high-priority ticket, once per episode. When most ONUs on the same PON port
 * or OLT are down the outage alert already says so, so single tickets are held back until that is
 * over — a cut trunk should be one job, not forty tickets.
 */
async function handleLos(tenantId) {
  const { rows } = await pool.query(
    `select n.external_id, n.sn, n.name, n.olt_id, n.olt_name, n.board, n.port, n.subscriber_id,
            s.name as client_name, s.account_code
       from smartolt_onus n left join subscribers s on s.id = n.subscriber_id
      where n.tenant_id=$1 and n.status='los' and n.los_polls >= 2 and not n.los_notified`, [tenantId]);
  if (!rows.length) return;
  const { notifyOwner } = await import('./jobs.js');

  for (const o of rows) {
    const { rows: [g] } = await pool.query(
      `select count(*)::int as total, count(*) filter (where status <> 'online')::int as down
         from smartolt_onus where tenant_id=$1 and olt_id is not distinct from $2 and board is not distinct from $3 and port is not distinct from $4`,
      [tenantId, o.olt_id, o.board, o.port]);
    if (g.total >= 4 && g.down / g.total >= 0.75) continue;   // covered by the outage alert

    const label = o.client_name ? `${o.client_name} (${o.name ?? o.sn})` : (o.name ?? o.sn);
    const where = `${o.olt_name ?? 'OLT'} port ${o.board ?? '?'}/${o.port ?? '?'}`;

    // one open LOS ticket per client at a time
    const { rows: [open] } = await pool.query(
      `select number from tickets where tenant_id=$1 and subscriber_id is not distinct from $2 and subject like 'ONU on LOS%' and status <> 'resolved' limit 1`,
      [tenantId, o.subscriber_id]);
    let number = open?.number ?? null;
    if (!open) {
      const { rows: [policy] } = await pool.query(
        `select id, resolve_mins from sla_policies where tenant_id=$1 and priority='high' and coalesce(enabled, true) order by resolve_mins asc limit 1`, [tenantId]);
      const { rows: [t] } = await pool.query(
        `insert into tickets (tenant_id, number, subject, subscriber_id, priority, description, source, sla_policy_id, due_at)
         values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, 'high', $4, 'smartolt', $5, $6) returning number`,
        [tenantId, `ONU on LOS — ${label}`, o.subscriber_id,
          `SmartOLT reports loss of signal (no light) on ONU ${o.sn ?? o.name} at ${where}. Likely a cut or unplugged fibre, or a dead ONU. The client is offline until it is fixed.`,
          policy?.id ?? null, policy ? new Date(Date.now() + policy.resolve_mins * 60000) : null]).catch(async () => ({
          // older schemas may lack a column: raise it plainly rather than not at all
          rows: [(await pool.query(
            `insert into tickets (tenant_id, number, subject, subscriber_id, priority)
             values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, 'high') returning number`,
            [tenantId, `ONU on LOS — ${label}`, o.subscriber_id])).rows[0]] }));
      number = t?.number ?? null;
    }
    await pool.query('update smartolt_onus set los_notified=true where tenant_id=$1 and external_id=$2', [tenantId, o.external_id]);
    await notifyOwner(tenantId, `${label} has lost light (LOS) at ${where}${number ? ` — ticket ${number}` : ''}.`, { url: '/support', title: 'ONU on LOS' });
  }
}


/**
 * Close the LOS tickets whose ONU has come back. A ticket raised by handleLos ("ONU on LOS — ...") stays open until someone resolves it, though the fibre
 * was mended and the client is online again. When the ONU it was raised for is online (and none of that client's ONUs is still on LOS), the ticket is
 * resolved with a note, and the owner is told once. The ONU is found through the client the ticket is for, or, for a ticket with no client, by the serial
 * or name written in its description.
 */
async function recoverLos(tenantId) {
  const { rows: open } = await pool.query(
    `select id, number, subject, subscriber_id, description from tickets
      where tenant_id=$1 and subject like 'ONU on LOS%' and status <> 'resolved' and source = 'smartolt' limit 200`, [tenantId]);
  if (!open.length) return;
  const { notifyOwner } = await import('./jobs.js');
  for (const t of open) {
    let onus;
    if (t.subscriber_id) {
      onus = (await pool.query('select status, los_polls from smartolt_onus where tenant_id=$1 and subscriber_id=$2', [tenantId, t.subscriber_id])).rows;
    } else {
      const ref = /ONU (S+) at /.exec(String(t.description ?? ''))?.[1];
      if (!ref) continue;
      onus = (await pool.query('select status, los_polls from smartolt_onus where tenant_id=$1 and (sn=$2 or name=$2)', [tenantId, ref])).rows;
    }
    if (!onus.length) continue;
    if (onus.some((o) => o.status === 'los') || !onus.some((o) => o.status === 'online')) continue;   // still no light, or not back yet
    await pool.query("update tickets set status='resolved', resolved_at=coalesce(resolved_at, now()), updated_at=now() where id=$1 and tenant_id=$2", [t.id, tenantId]);
    await pool.query(
      `insert into ticket_notes (tenant_id, ticket_id, author, body, internal) values ($1,$2,'System',$3,true)`,
      [tenantId, t.id, 'Closed automatically: SmartOLT now reports the ONU online, so the loss of signal is over.']);
    await notifyOwner(tenantId, `${t.subject.replace(/^ONU on LOS — /, '')} is back online. Ticket ${t.number} was closed automatically.`, { url: '/support', title: 'LOS recovered' });
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

async function unconfiguredFor(cfg) {
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

export async function unconfiguredOnus(tenantId) {
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) throw new Error('SmartOLT is not connected.');
  return unconfiguredFor(cfg);
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
    vlan: f.vlan, zone: f.zone, odb: f.odb, name: f.name, address_or_comment: f.address, onu_external_id: f.onu_external_id,
    upload_speed_profile_name: f.upload_speed_profile, download_speed_profile_name: f.download_speed_profile,
  };
  return call(cfg, 'POST', '/onu/authorize_onu', { form });
}


/** The VLANs defined on one OLT (SmartOLT → OLT → VLANs): id, number, description and scope (internet, mgmt/voip, iptv, lan_to_lan). */
export async function oltVlans(tenantId, oltId) {
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) throw new Error('SmartOLT is not connected.');
  return list(await call(cfg, 'GET', `/olt/get_vlans/${encodeURIComponent(oltId)}`)).map((o) => ({
    id: text(first(o, 'id')), vlan: text(first(o, 'vlan')), description: text(first(o, 'description')), scope: text(first(o, 'scope')),
  })).filter((o) => o.vlan);
}

/**
 * The TR069 profile names in use on this OLT, most used first. SmartOLT has no call that lists profiles, but every ONU shows the profile it uses, and the ONU
 * list can be filtered to those with TR069 enabled. Best effort: [] when nothing can be learned.
 */
export async function discoverTr069Profiles(cfg, oltId) {
  const count = new Map();
  const read = async (params) => {
    for (const o of list(await call(cfg, 'GET', '/onu/get_all_onus_details', { params }))) {
      const p = text(first(o, 'tr069_profile'));
      if (p && !/^(null|none|disabled|-)$/i.test(p)) count.set(p, (count.get(p) ?? 0) + (String(first(o, 'olt_id') ?? '') === String(oltId ?? '') ? 3 : 1));
    }
  };
  try { await read({ tr069: 'enabled', ...(oltId ? { olt_id: oltId } : {}) }); } catch { /* an OLT filter this API does not take: ask for all */ }
  if (!count.size) { try { await read({ tr069: 'enabled' }); } catch { /* nothing to learn from */ } }
  return [...count.entries()].sort((x, y) => y[1] - x[1]).map(([p]) => p);
}

/**
 * Change the WiFi name and password on an ONU that is already set up (the customer's own page, the technician app). The 2.4 GHz network is wifi_0/1 and the
 * 5 GHz one wifi_0/5 with "_5G" on its name, as when authorising. If SmartOLT says TR069 is needed, it is switched on first (the profile found the same
 * way as when authorising) and the change is tried again, because a freshly enabled ONU takes a minute to check in.
 */
export async function setWifiOnOnu(tenantId, target, { ssid, password, band5 = false }) {
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) throw new Error('SmartOLT is not connected.');
  const id = encodeURIComponent(target.externalId);
  const one = (port, name) => call(cfg, 'POST', `/onu/set_wifi_port_lan/${id}`, { form: { wifi_port: port, ssid: name, password, authentication_mode: 'WPA2', dhcp: 'No control' } });
  const all = async () => { await one('wifi_0/1', ssid); if (band5) await one('wifi_0/5', `${ssid}_5G`); };
  try { await all(); return; } catch (e) { if (!/tr069/i.test(e.message)) throw e; }
  const candidates = [];
  const add = (p) => { const v = String(p ?? '').trim(); if (v && !candidates.includes(v)) candidates.push(v); };
  for (const p of await discoverTr069Profiles(cfg, target.oltId)) add(p);
  add(cfg.tr069_profile); add('SmartOLT');
  let enabled = false;
  outer: for (const profile of candidates) {
    for (const extra of [{}, { tr069_interface: 'wan' }, { tr069_interface: 'mgmt' }]) {
      try { await call(cfg, 'POST', `/onu/enable_tr069/${id}`, { form: { tr069_profile: profile, ...extra } }); enabled = true; break outer; }
      catch (e) { if (/already/i.test(e.message)) { enabled = true; break outer; } }
    }
  }
  if (!enabled) throw new Error('This ONU needs TR069 and it could not be switched on. Contact support.');
  let last = null;
  for (let i = 0; i < 4; i += 1) {
    await sleep(15000);
    try { await all(); return; } catch (e) { last = e; }
  }
  throw last;
}

// ── authorise and set up in one go ────────────────────────────────────────────────────────────────
//
// Authorising is the first step; the rest (management VLAN, other VLANs, the customer's PPPoE login on the ONU's WAN,
// the WiFi name and password, and the message to the customer) are separate SmartOLT calls that only work once the OLT
// has finished applying the authorisation, so each is retried a few times and its result is kept for the screen to show.
// The progress lives in memory (an hour): it is only there to be watched while it happens.

const jobs = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alnum = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '');

export function getProvision(tenantId, id) {
  const j = jobs.get(String(id));
  return j && j.tenantId === tenantId ? { steps: j.steps, done: j.done } : null;
}

/**
 * Authorise the ONU (an error here is thrown: nothing else is attempted), then set it up in the background.
 * ctx: { pppoe: {user, pass} | null, wifi: {ssid, password, band5} | null, phone, customerName, notify }
 * Returns the id to poll with getProvision.
 */
export async function provisionOnu(tenantId, f, ctx = {}) {
  const cfg = await loadConfig(tenantId);
  if (!cfg?.enabled || !cfg.apiKey) throw new Error('SmartOLT is not connected.');
  // SmartOLT wants the ONU's external ID to be unique across everything it has ever held, so the serial alone is not
  // enough (a removed ONU, or an earlier attempt, may already have used it): a short random tail is added, and a
  // clash is retried once with a new one.
  const newId = () => `${alnum(f.sn)}${Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(2, 8)}`;
  let externalId = newId();
  try {
    await authorizeOnu(tenantId, { ...f, onu_external_id: externalId });
  } catch (e) {
    if (!/unique/i.test(e.message)) throw e;
    externalId = newId();
    await authorizeOnu(tenantId, { ...f, onu_external_id: externalId });
  }

  const routing = String(f.onu_mode || 'Routing') !== 'Bridging';
  const post = (path, form) => () => call(cfg, 'POST', `/onu/${path}/${encodeURIComponent(externalId)}`, { form });
  const steps = [{ key: 'authorize', label: 'Authorised on the OLT', state: 'ok', message: '' }];
  const runs = [];

  if (f.mgmt_vlan) {
    // A fixed (static) management address, not DHCP: the one typed on the Authorise screen, or else SmartOLT picks a free one from the OLT's IP pool.
    steps.push({ key: 'mgmt', label: `Management VLAN ${f.mgmt_vlan} (static IP)`, state: 'pending' });
    const ip = String(f.mgmt_ip ?? '').trim();
    const mgmt = { vlan: f.mgmt_vlan };
    if (ip) {
      mgmt.ipv4_address = ip;
      for (const [k, v] of [['subnet_mask', f.mgmt_mask], ['gateway', f.mgmt_gateway], ['dns1', f.mgmt_dns1], ['dns2', f.mgmt_dns2]]) if (String(v ?? '').trim()) mgmt[k] = String(v).trim();
    }
    runs.push(post('set_onu_mgmt_ip_static_ip', mgmt));
  }
  const others = (Array.isArray(f.other_vlans) ? f.other_vlans : []).map(String).filter((v) => /^[0-9]+$/.test(v) && v !== String(f.vlan) && v !== String(f.mgmt_vlan));
  if (others.length) {
    steps.push({ key: 'vlans', label: `Other VLANs ${others.join(', ')}`, state: 'pending' });
    runs.push(post('update_attached_vlans', { add_vlans: others.join(',') }));
  }
  if (ctx.pppoe?.user && routing) {
    steps.push({ key: 'pppoe', label: `PPPoE login ${ctx.pppoe.user} on the ONU`, state: 'pending' });
    runs.push(async () => {
      // SmartOLT accepts letters and digits only, up to 64
      if (!/^[A-Za-z0-9]{1,64}$/.test(ctx.pppoe.user) || !/^[A-Za-z0-9]{1,64}$/.test(String(ctx.pppoe.pass ?? ''))) {
        throw new Error('SmartOLT only accepts letters and digits in a PPPoE username and password.');
      }
      return post('set_onu_wan_mode_pppoe', { username: ctx.pppoe.user, password: ctx.pppoe.pass, configuration_method: 'OMCI', ip_protocol: 'ipv4' })();
    });
  }
  const wifiCall = (port, ssid) => post(routing ? 'set_wifi_port_lan' : 'set_wifi_port_access', {
    wifi_port: port, ssid, password: ctx.wifi.password, authentication_mode: 'WPA2', dhcp: 'No control',
    ...(routing ? {} : { vlan: f.vlan }),
  });
  if (ctx.wifi) {
    // Most OLT types can only change an ONU's WiFi through TR-069, so TR-069 is switched on first (SmartOLT's POST /onu/enable_tr069 takes the name of the
    // TR069 profile: "SmartOLT" unless the tenant's smartolt_config.tr069_profile says otherwise). An ONU that already has it answers "already", which is fine.
    steps.push({ key: 'tr069', label: 'TR069 on the ONU (needed to set the WiFi)', state: 'pending' });
    const tr069 = async () => {
      // Which profile: the one typed on the Authorise screen; if that is left empty (automatic), the one the ONUs on this OLT that already have TR069 use
      // (SmartOLT shows it on each ONU), then the one this tenant used last time, then SmartOLT's own name. Each is tried in turn until one is accepted.
      const typed = String(f.tr069_profile ?? '').trim().slice(0, 80);
      const candidates = [];
      const add = (p) => { const v = String(p ?? '').trim(); if (v && !candidates.includes(v)) candidates.push(v); };
      if (typed && typed.toLowerCase() !== 'auto') add(typed);
      else for (const p of await discoverTr069Profiles(cfg, f.olt_id)) add(p);
      add(cfg.tr069_profile); add('SmartOLT');
      // The interface is optional: asked for without it first, then each value SmartOLT lists, so a value it does not accept for this OLT cannot be what fails.
      const tries = [{}, { tr069_interface: 'wan' }, { tr069_interface: 'mgmt' }];
      let used = null; let last = null;
      outer: for (const profile of candidates) {
        for (const extra of tries) {
          try { await post('enable_tr069', { tr069_profile: profile, ...extra })(); used = profile; break outer; }
          catch (e) {
            if (/already/i.test(e.message)) { used = profile; break outer; }
            last = e;
          }
        }
      }
      if (!used) throw new Error(`${last?.message ?? 'TR069 was not enabled'} (profiles tried: ${candidates.join(', ')}. Type the exact name of the TR069 profile from SmartOLT, Settings → VPN & TR069)`);
      if (used !== cfg.tr069_profile) await pool.query('update smartolt_config set tr069_profile=$2 where tenant_id=$1', [tenantId, used]).catch(() => {});   // remembered as the default
      await sleep(15000);   // the ONU needs a moment to reach SmartOLT's ACS before the WiFi can be set
    };
    runs.push(tr069);
    // The WiFi is set through TR-069 only once the ONU has checked in, which can take a minute or two: try for longer.
    steps.push({ key: 'wifi', label: `WiFi name "${ctx.wifi.ssid}"`, state: 'pending' });
    const w1 = wifiCall('wifi_0/1', ctx.wifi.ssid); w1.attempts = 8; w1.gap = 15000; runs.push(w1);
    if (ctx.wifi.band5) {
      steps.push({ key: 'wifi5', label: `5 GHz WiFi name "${ctx.wifi.ssid}_5G"`, state: 'pending' });
      const w5 = wifiCall('wifi_0/5', `${ctx.wifi.ssid}_5G`); w5.attempts = 8; w5.gap = 15000; runs.push(w5);
    }
  }
  const smsWanted = !!(ctx.wifi && ctx.phone && ctx.notify !== false);
  if (smsWanted) steps.push({ key: 'sms', label: 'Message to the customer with the WiFi name and password', state: 'pending' });

  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const job = { tenantId, steps, done: false, at: Date.now() };
  jobs.set(id, job);
  for (const [k, v] of jobs) if (Date.now() - v.at > 3600000) jobs.delete(k);

  (async () => {
    await sleep(6000);   // the OLT is still applying the authorisation
    let index = 1;
    for (const run of runs) {
      const step = steps[index++];
      step.state = 'running';
      const attempts = run.attempts ?? 3; const gap = run.gap ?? 8000;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try { await run(); step.state = 'ok'; step.message = ''; break; }
        catch (e) { step.state = 'failed'; step.message = e.message; if (attempt < attempts) await sleep(gap); }
      }
    }
    const sms = steps.find((s) => s.key === 'sms');
    if (sms) {
      const wifiOk = steps.filter((s) => s.key === 'wifi' || s.key === 'wifi5').every((s) => s.state === 'ok');
      if (!wifiOk) { sms.state = 'skipped'; sms.message = 'Not sent: the WiFi was not set.'; }
      else {
        try {
          const { send } = await import('./sms.js');
          const first = String(ctx.customerName ?? '').trim().split(/\s+/)[0];
          await send(tenantId, ctx.phone, 'custom', {
            body: `Hello${first ? ` ${first}` : ''}, your internet is ready. WiFi name: ${ctx.wifi.ssid}  Password: ${ctx.wifi.password}. Please keep these safe.`,
          });
          sms.state = 'ok';
        } catch (e) { sms.state = 'failed'; sms.message = e.message; }
      }
    }
    job.done = true;
    syncTenant(tenantId, 'full').catch(() => {});
  })().catch((e) => { job.done = true; steps.push({ key: 'error', label: 'Setting up', state: 'failed', message: e.message }); });

  return id;
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
