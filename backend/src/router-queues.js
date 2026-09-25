/**
 * A router's queues, brought in line with the database.
 *
 * What belongs in a router's Simple Queue list is decided here and nowhere else,
 * so a manual Refresh, the two-minute automatic pass and a payment all agree:
 *
 *   - customers on a contended plan are grouped by (speed, contention ratio):
 *     one parent queue per group, MAIN_TARIFF_<speed>, targeting every member's
 *     address, its limit the combined rate of the members, and each member's own
 *     queue (SiPLMT_US_<username>, the customer's name as comment) listed beneath it;
 *   - every other customer entitled to service has one queue of their own,
 *     SiPLMT_US_<username>: their address, the plan's rate, their name as comment;
 *   - the speed cap of every hotspot device bound to a code that is still running.
 *
 * Refresh wipes the list and writes it fresh (`wipe: true`). The automatic pass
 * only changes what differs and never removes a queue it does not recognise.
 */
import { pool } from './db.js';
import * as ros from './routeros.js';

const ENTITLED = ['active', 'grace'];

/** First host address of a CIDR — the gateway the PPP profile hands out as its own end. */
export function gatewayOf(cidr) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(cidr ?? '').trim());
  if (!m) return null;
  const bits = Number(m[5]);
  if (bits < 8 || bits > 30) return null;
  const ip = ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
  const net = (ip & (0xffffffff << (32 - bits))) >>> 0;
  const gw = (net + 1) >>> 0;
  return [gw >>> 24, (gw >>> 16) & 255, (gw >>> 8) & 255, gw & 255].join('.');
}

const ipNumber = (a) => String(a).split('/')[0].split('.').reduce((n, o) => n * 256 + Number(o), 0);
const numberIp = (n) => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');

// RouterOS takes at most this many addresses in one queue target.
const TARGET_LIMIT = 128;

/**
 * The smallest set of CIDR blocks that covers exactly these addresses (sorted, unique):
 * runs of neighbours collapse into aligned blocks, so a busy pool of consecutive
 * customers is a handful of entries instead of one each.
 */
function cidrBlocks(numbers) {
  const blocks = [];
  let i = 0;
  while (i < numbers.length) {
    const start = numbers[i];
    let end = start;
    while (i + 1 < numbers.length && numbers[i + 1] === end + 1) { i += 1; end = numbers[i]; }
    i += 1;
    let cur = start;
    while (cur <= end) {
      let size = 1;
      while (cur % (size * 2) === 0 && cur + size * 2 - 1 <= end && size < 2 ** 31) size *= 2;
      blocks.push({ start: cur, size });
      cur += size;
    }
  }
  return blocks;
}
const blockText = (b) => `${numberIp(b.start)}/${32 - Math.log2(b.size)}`;

/** Every PPPoE customer on a router, with the address RADIUS gives them and their plan. */
export async function customerLines(tenantId, routerId) {
  const { rows } = await pool.query(
    `select s.pppoe_user, s.name, s.status, s.plan_id,
            -- A customer over their fair-use cap is held to the policy's throttle speed, on a queue of their own
            -- (out of any shared group, so the cap is real) until the window ends.
            coalesce(th.throttle_down, p.rate_down) as rate_down,
            coalesce(th.throttle_up, p.rate_up) as rate_up,
            case when th.throttle_down is not null then null else p.contention_ratio end as contention_ratio,
            (th.throttle_down is not null) as throttled,
            rr.value as address
       from subscribers s
       left join plans p on p.id = s.plan_id
       left join lateral (
         select f.throttle_down, f.throttle_up
           from fup_state st join fup_policies f on f.id = st.policy_id
          where st.subscriber_id = s.id and st.throttled and f.throttle_down > 0 and f.throttle_up > 0
            and st.window_start >= (case coalesce(f.window_period, 'monthly') when 'daily' then current_date when 'weekly' then date_trunc('week', now())::date else date_trunc('month', now())::date end)
          limit 1) th on true
       left join radreply rr on rr.tenant_id = s.tenant_id and rr.username = s.pppoe_user
                            and rr.attribute = 'Framed-IP-Address'
      where s.tenant_id=$1 and s.router_id=$2 and s.service='pppoe' and s.pppoe_user is not null`,
    [tenantId, routerId]);
  return rows.map((l) => ({
    ...l,
    entitled: ENTITLED.includes(l.status) && !!l.address && l.rate_down != null && l.rate_up != null,
  }));
}

/** A short fingerprint of what the router should hold, so an unchanged router is not queried again. */
export function signature(lines) {
  return lines
    .filter((l) => l.entitled)
    .map((l) => `${l.pppoe_user}|${l.address}|${l.rate_down}|${l.rate_up}|${l.name ?? ''}|${l.contention_ratio ?? ''}`)
    .sort()
    .join('\n');
}

// 5000 -> "5", 1500 -> "1.5"
const mbps = (k) => String(Math.round((Number(k) / 1000) * 100) / 100);

/**
 * Splits customers into shared-tariff groups and single queues.
 *
 * The group's name is MAIN_TARIFF_<speed>Mbps (download, plus _<up>Mbps when the
 * upload differs). Two ratios at one speed on the same router would share a name,
 * so those alone also get _1to<ratio>.
 */
export function queuePlan(lines) {
  const entitled = lines.filter((l) => l.entitled);
  const drop = lines.filter((l) => !l.entitled).map((l) => l.pppoe_user);

  const contended = new Map();
  const singles = [];
  for (const l of entitled) {
    const member = { pppoeUser: l.pppoe_user, address: l.address, rateDown: l.rate_down, rateUp: l.rate_up, customerName: l.name };
    if (l.plan_id && Number(l.contention_ratio) > 1) {
      const key = `${l.rate_down}|${l.rate_up}|${l.contention_ratio}`;
      if (!contended.has(key)) contended.set(key, { rateDown: Number(l.rate_down), rateUp: Number(l.rate_up), ratio: Number(l.contention_ratio), members: [] });
      contended.get(key).members.push(member);
    } else {
      singles.push(member);
    }
  }

  const base = (g) => `${ros.MAIN_TARIFF_PREFIX}${mbps(g.rateDown)}Mbps${g.rateUp === g.rateDown ? '' : `_${mbps(g.rateUp)}Mbps`}`;
  const perBase = new Map();
  for (const g of contended.values()) perBase.set(base(g), (perBase.get(base(g)) ?? 0) + 1);

  // A group is one parent queue, unless its members need more than the 128 target entries
  // RouterOS allows even after neighbouring addresses are merged into blocks: then it is
  // split into parts (MAIN_TARIFF_12Mbps_1, _2 …), each holding its own share of the members.
  const groups = [...contended.values()].flatMap((g) => {
    g.members.sort((a, b) => ipNumber(a.address) - ipNumber(b.address));
    const name = perBase.get(base(g)) > 1 ? `${base(g)}_1to${g.ratio}` : base(g);
    const blocks = cidrBlocks([...new Set(g.members.map((m) => ipNumber(m.address)))]);
    const parts = [];
    for (let i = 0; i < blocks.length; i += TARGET_LIMIT) parts.push(blocks.slice(i, i + TARGET_LIMIT));
    return parts.map((part, idx) => {
      const members = parts.length === 1
        ? g.members
        : g.members.filter((m) => { const n = ipNumber(m.address); return part.some((b) => n >= b.start && n < b.start + b.size); });
      return {
        name: parts.length > 1 ? `${name}_${idx + 1}` : name,
        rateDown: members.reduce((n, m) => n + Number(m.rateDown), 0),
        rateUp: members.reduce((n, m) => n + Number(m.rateUp), 0),
        targets: part.map(blockText),
        members,
      };
    });
  }).sort((a, b) => a.name.localeCompare(b.name));

  return { groups, singles, drop };
}

/**
 * Per-customer PPP profiles, and the RADIUS attributes that put each customer on
 * theirs. Order matters: a profile is created on the router first, and only then is
 * RADIUS told to use it. Naming a profile the router does not have rejects the
 * login, so a customer whose profile could not be written simply keeps the default
 * one — their traffic is then counted in the dynamic queue only.
 */
/**
 * Sending a customer to their own profile is opt-in. RADIUS naming a profile the router
 * rejects drops that customer's login, so it is switched on for a few customers first:
 * QUEUE_PROFILE_USERS=VBTL26118,VBTL26120 in the environment, or QUEUE_PROFILES=all once
 * it has been seen to work. Left unset, profiles are still written to the router (they
 * do nothing until named) and no customer is sent to one.
 */
function profileAllowed(user) {
  if (String(process.env.QUEUE_PROFILES ?? '').toLowerCase() === 'all') return true;
  return String(process.env.QUEUE_PROFILE_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(user);
}

/**
 * Speed held by the static queues, so they carry the customer's live traffic.
 *
 * With a rate in RADIUS, RouterOS builds its own dynamic queue for every PPP session,
 * matched ahead of the static ones, and the static queue (name, address, plan speed)
 * never sees a packet. The PPP interface still shows live traffic either way; this is
 * what makes the queue show it too. For a customer whose queue is on the router the
 * RADIUS rate is removed, and the router is marked so it is not sent again.
 *
 * Only customers whose queue is actually there, and never one sent to their own profile
 * (there the dynamic queue is deliberately kept, as the child of the static one).
 * A session already up keeps its dynamic queue until it next reconnects.
 */
export function speedInQueues(s) { return !!s.queue_shaping && !profileAllowed(s.pppoe_user); }

async function holdSpeedInQueues({ tenantId, routerId, all, queued }) {
  const users = all
    .filter((l) => l.entitled && queued.has(`${ros.SUB_QUEUE_PREFIX}${l.pppoe_user}`) && !profileAllowed(l.pppoe_user))
    .map((l) => l.pppoe_user);
  await pool.query('update routers set queue_shaping = true where id=$1', [routerId]);
  if (!users.length) return null;
  const { rowCount } = await pool.query(
    "delete from radreply where tenant_id=$1 and attribute='Mikrotik-Rate-Limit' and username = any($2::text[])",
    [tenantId, users]);
  return rowCount ? `speeds now held by the queues: ${rowCount} customer(s) no longer sent a RADIUS rate limit` : null;
}

async function customerProfiles(conn, { tenantId, routerId, all, queued }) {
  const { rows: [r] } = await pool.query('select pppoe_pool from routers where id=$1 and tenant_id=$2', [routerId, tenantId]);
  const gateway = gatewayOf(r?.pppoe_pool);
  if (!gateway) return ['customer profiles skipped: this router has no PPPoE address pool set'];

  const entitled = all.filter((l) => l.entitled && queued.has(`${ros.SUB_QUEUE_PREFIX}${l.pppoe_user}`));
  const names = entitled.map((l) => `${ros.SUB_QUEUE_PREFIX}${l.pppoe_user}`);
  const p = await ros.syncCustomerProfiles(conn, { wanted: names, gateway });

  const ok = entitled.filter((l) => p.ok.has(`${ros.SUB_QUEUE_PREFIX}${l.pppoe_user}`));
  const sent = ok.filter((l) => profileAllowed(l.pppoe_user));
  if (sent.length) {
    // Group and speed together: a customer on their own profile keeps a RADIUS rate, because
    // their dynamic queue is the child of their static one and holds the speed.
    await pool.query(
      `insert into radreply (tenant_id, username, attribute, op, value)
       select $1, u, 'Mikrotik-Group', ':=', $3 || u from unnest($2::text[]) as u
       on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
      [tenantId, sent.map((l) => l.pppoe_user), ros.SUB_QUEUE_PREFIX]);
    await pool.query(
      `insert into radreply (tenant_id, username, attribute, op, value)
       select $1, u, 'Mikrotik-Rate-Limit', ':=', rate
         from unnest($2::text[], $3::text[]) as t(u, rate)
       on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
      [tenantId, sent.map((l) => l.pppoe_user), sent.map((l) => `${l.rate_up}k/${l.rate_down}k`)]);
  }
  // Anyone on this router no longer entitled (or whose profile could not be written)
  // goes back to the default profile at their next login.
  await pool.query(
    `delete from radreply
      where tenant_id=$1 and attribute='Mikrotik-Group' and value like $4
        and username in (select pppoe_user from subscribers where tenant_id=$1 and router_id=$2 and pppoe_user is not null)
        and not (username = any($3::text[]))`,
    [tenantId, routerId, sent.map((l) => l.pppoe_user), `${ros.SUB_QUEUE_PREFIX}%`]);
  await pool.query('update routers set queue_profiles = true where id=$1', [routerId]);

  return [`customer profiles: ${p.added} added, ${p.updated} updated, ${p.same} already correct, ${p.removed} removed`
    + `; ${sent.length} customer(s) sent to their own profile`
    + (p.failed ? `; ${p.failed} failed (first: ${p.firstError})` : '')];
}

/**
 * Returns the sentences a Configure result shows. Never throws for a queue-level
 * problem: those are reported, so the customers-stay-online work around it is not
 * marked failed for the sake of a list.
 */
async function syncRouterQueuesUnlocked(conn, { tenantId, routerId, role, wipe = false, lines = null }) {
  const out = [];

  if (role === 'both' || role === 'pppoe') {
    const all = lines ?? await customerLines(tenantId, routerId);
    const cleared = wipe ? await ros.wipeSimpleQueues(conn) : 0;
    const plan = queuePlan(all);
    // A full rewrite has nothing left to drop; the routine pass removes the queue
    // of a customer who is no longer entitled to service.
    const q = await ros.syncQueuePlan(conn, { ...plan, drop: wipe ? [] : plan.drop });
    const inGroups = plan.groups.reduce((n, g) => n + g.members.length, 0);
    // Each customer's own PPP profile, so RouterOS's dynamic queue for their session sits
    // under their static queue and traffic is counted in both.
    // Not held up by a queue that failed elsewhere: a customer gets a profile when THEIR queue is
    // on the router, which is what the profile's parent-queue names.
    try {
      out.push(...await customerProfiles(conn, { tenantId, routerId, all, queued: q.ok }));
    } catch (e) {
      out.push(`could not write customer profiles: ${e.message}`);
    }
    try {
      const held = await holdSpeedInQueues({ tenantId, routerId, all, queued: q.ok });
      if (held) out.push(held);
    } catch (e) {
      out.push(`could not move speeds to the queues: ${e.message}`);
    }
    out.push((wipe ? `queues cleared (${cleared}) and rewritten: ` : 'queues: ')
      + `${q.added} added, ${q.updated} updated, ${q.same} already correct, ${q.removed} removed`
      + (plan.groups.length ? `; ${plan.groups.length} shared tariff(s) holding ${inGroups} customer(s): ${plan.groups.map((g) => g.name).join(', ')}` : '')
      + (q.leftover ? `; ${q.leftover} ${ros.SUB_QUEUE_PREFIX} queue(s) match no customer here and were left alone` : '')
      + (q.failed ? `; ${q.failed} failed (first: ${q.firstError})` : ''));
  } else if (wipe) {
    const cleared = await ros.wipeSimpleQueues(conn);
    out.push(`queues cleared (${cleared})`);
  }

  // Devices locked to a paid code get their cap from a queue of their own, since
  // a bypassed device never goes through RADIUS. A wipe removes those, so they are
  // written back here; on the routine pass they are not touched at all.
  if (wipe && (role === 'both' || role === 'hotspot')) {
    const { rows: devices } = await pool.query(
      `select d.mac, v.code, d.label, p.rate_down, p.rate_up
         from voucher_devices d
         join vouchers v on v.id = d.voucher_id
         left join plans p on p.id = v.plan_id
        where d.router_id=$1 and d.unbound_at is null and v.tenant_id=$2
          and v.status = 'in_use' and (v.expires_at is null or v.expires_at > now())`,
      [routerId, tenantId]);
    let ok = 0; let skipped = 0;
    for (const d of devices) {
      try {
        await ros.bindDeviceByMac(conn, {
          mac: d.mac, downKbps: d.rate_down ?? 2000, upKbps: d.rate_up ?? 1000,
          comment: d.label ? `${d.code} — ${d.label}` : d.code,
        });
        ok += 1;
      } catch { skipped += 1; }
    }
    if (devices.length) out.push(`device speed caps: ${ok} re-applied${skipped ? `, ${skipped} skipped (not on the network right now)` : ''}`);
  }
  return out;
}

/**
 * The PPP profile's own end of the link. Without it every login authenticates and
 * is dropped a second later ("could not determine remote IP address"), so it is
 * checked on every pass and put back if it has gone. Only ever fills a missing
 * value in: one an operator set on purpose is left as it is.
 */
export async function repairPppProfile(conn, pppoePool, profileName = 'vibelink-pppoe') {
  const gateway = gatewayOf(pppoePool);
  if (!gateway) return null;
  const profile = (await conn.write('/ppp/profile/print', [`?name=${profileName}`]))[0];
  if (!profile || profile['local-address']) return null;
  await conn.write('/ppp/profile/set', [`=.id=${profile['.id']}`, `=local-address=${gateway}`]);
  return `PPP profile ${profileName} had no local-address; set it to ${gateway}`;
}

// One router is only ever being rewritten by one caller at a time: Refresh, the
// two-minute pass and the pass a customer change triggers would otherwise add the
// same queue twice. Later callers wait their turn.
const chain = new Map();
function serial(routerId, fn) {
  const prev = chain.get(routerId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chain.set(routerId, next);
  next.catch(() => {}).finally(() => { if (chain.get(routerId) === next) chain.delete(routerId); });
  return next;
}

export function syncRouterQueues(conn, opts) {
  return serial(opts.routerId, () => syncRouterQueuesUnlocked(conn, opts));
}

// routerId -> what the router was last brought to, so an unchanged one is skipped.
const state = new Map();

/**
 * Connect to a PPPoE router and bring its PPP profile and queues in line with the
 * database. Not a wipe: only what differs is written, and a queue this does not
 * recognise is left alone. Skipped, returning null, when nothing about the
 * router's customers changed since the last time and it was checked recently —
 * unless `force`, which a customer change uses.
 */
export async function syncRouterNow(r, { force = false } = {}) {
  const secrets = await import('./secrets.js');
  const password = secrets.decrypt(r.service_password_enc);
  if (!password) return null;
  let conn;
  try {
    conn = await ros.connect({
      host: String(r.host).split('/')[0], port: r.api_port ?? 8728,
      user: r.service_user, password, timeoutSec: 8,
    });
    const fixed = await repairPppProfile(conn, r.pppoe_pool).catch(() => null);
    if (fixed) console.warn('router queues:', r.name, '—', fixed);

    const lines = await customerLines(r.tenant_id, r.id);
    const sig = signature(lines);
    const prev = state.get(r.id);
    if (!force && prev && prev.sig === sig && Date.now() - prev.at < 30 * 60000) return null;

    const out = await syncRouterQueues(conn, { tenantId: r.tenant_id, routerId: r.id, role: r.role, wipe: false, lines });
    state.set(r.id, { sig, at: Date.now() });
    return out;
  } finally {
    if (conn) { try { ros.close(conn); } catch { /* already gone */ } }
  }
}

const timers = new Map();

/**
 * A customer was added, edited, paid, paused, moved or deleted: bring that
 * router's queues in line a few seconds later. The delay collects a burst of
 * changes (an import, a bulk edit, a batch of payments) into one pass instead of
 * one connection each. Nothing here can fail the change that triggered it.
 */
export function queueRouterSync(tenantId, routerId, delayMs = 4000) {
  if (!routerId) return;
  clearTimeout(timers.get(routerId));
  const t = setTimeout(async () => {
    timers.delete(routerId);
    try {
      const { rows: [r] } = await pool.query(
        `select id, tenant_id, name, host, api_port, role, pppoe_pool, service_user, service_password_enc
           from routers
          where id=$1 and tenant_id=$2 and status = 'up' and autoconfig_last_ok = true
            and role in ('pppoe','both') and service_user is not null and service_password_enc is not null`,
        [routerId, tenantId]);
      if (!r) return;
      const out = await syncRouterNow(r, { force: true });
      if (out?.length) console.log('router queues after a customer change:', r.name, '—', out.join('; '));
    } catch (e) {
      console.warn('router queues: refresh after a customer change failed —', e?.message ?? e);
    }
  }, delayMs);
  t.unref?.();
  timers.set(routerId, t);
}
