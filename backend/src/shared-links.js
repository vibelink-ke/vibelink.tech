/**
 * Shared links: the radio, switch or ONU that several customers get their service through.
 *
 * One customer's line cannot tell you whether the fault is theirs or the thing they share. So customers are grouped by what they share, the
 * group is read as a whole, and the verdict names the shared device first. A link can be "unmanaged" (a plain switch, a radio nobody can log
 * into): nothing can be read from the device itself, so it is judged only from the customers behind it, and the verdict says so.
 */
export const KINDS = ['radio', 'switch', 'onu', 'other'];
const KIND_LABEL = { radio: 'radio', switch: 'switch', onu: 'ONU', other: 'link' };

/** A customer whose signal is this weak or worse is a poor radio client. */
export const WEAK_DBM = -75;
const SAME_TIME_MINUTES = 10;

const live = (m) => m.status === 'active' || m.status === 'grace';

/**
 * Read a link from its customers, no database needed.
 *   members      [{ id, name, status, online, drops, signal, line_state }]
 *   worstWindow  { n, at } the most customers that lost their line within the same few minutes in the last day
 * Returns { level: ok | watch | down | unknown, headline, detail[], outliers[], steps[] }.
 * A fault is called shared only when most of the group shows it (at least 2 customers and 60%), so one bad customer is never blamed on the link.
 */
export function judgeLink({ kind = 'radio', managed = true, members = [], worstWindow = null }) {
  const label = KIND_LABEL[kind] ?? 'link';
  const active = members.filter(live);
  const n = active.length;
  const steps = checkSteps(kind, managed);
  const note = managed ? null : `This ${label} is unmanaged, so nothing can be read from it. This is judged only from the customers behind it.`;
  if (n === 0) {
    return { level: 'unknown', headline: members.length ? 'No active customers on this link right now.' : 'No customers added to this link yet.', detail: note ? [note] : [], outliers: [], steps: [] };
  }
  const need = Math.max(2, Math.ceil(n * 0.6));
  const offline = active.filter((m) => !m.online);
  const stuck = active.filter((m) => m.online && m.line_state === 'unreachable');
  const together = worstWindow?.n ?? 0;
  const withSignal = active.filter((m) => Number.isFinite(m.signal));
  const weak = withSignal.filter((m) => m.signal <= WEAK_DBM);
  const detail = [];
  if (note) detail.push(note);

  let level = 'ok';
  let headline = `The ${label} looks healthy: ${n - offline.length} of ${n} active customers are online and no shared fault shows.`;
  if (n >= 2 && offline.length >= need) {
    level = 'down';
    headline = `${offline.length} of ${n} active customers behind this ${label} are offline right now. Suspect the ${label}, not the customers.`;
  } else if (n >= 2 && together >= need) {
    level = 'watch';
    const when = worstWindow?.at ? ` around ${new Date(worstWindow.at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : '';
    headline = `${together} of ${n} customers lost their line within ${SAME_TIME_MINUTES} minutes of each other${when}. That points at the ${label} (power or the link), not at the customers.`;
  } else if (n >= 2 && stuck.length >= need) {
    level = 'watch';
    headline = `${stuck.length} of ${n} customers are connected but passing no traffic. Suspect the ${label}.`;
  } else if (kind === 'radio' && withSignal.length >= 2 && weak.length >= Math.max(2, Math.ceil(withSignal.length * 0.6))) {
    level = 'watch';
    headline = `${weak.length} of ${withSignal.length} customers with a reading are at ${WEAK_DBM} dBm or weaker. The sector is weak for most of them.`;
  }
  if (level === 'ok' && offline.length) detail.push(`${offline.length} of ${n} offline, but not enough of them to blame the ${label}.`);
  if (managed === false && level !== 'ok') detail.push('Because it is unmanaged, confirm on site (power, cable, port) before replacing anything.');
  if (kind === 'radio' && withSignal.length) {
    const avg = withSignal.reduce((a, m) => a + m.signal, 0) / withSignal.length;
    detail.push(`Signal readings: ${withSignal.length} customers, average ${avg.toFixed(0)} dBm, weakest ${Math.min(...withSignal.map((m) => m.signal))} dBm.`);
  }

  const outliers = active
    .filter((m) => !m.online || m.line_state === 'unreachable' || m.drops >= 3 || (Number.isFinite(m.signal) && m.signal <= WEAK_DBM - 5))
    .map((m) => ({
      id: m.id, name: m.name,
      why: [
        !m.online ? 'offline' : null,
        m.online && m.line_state === 'unreachable' ? 'online, no traffic' : null,
        m.drops >= 3 ? `${m.drops} drops in a day` : null,
        Number.isFinite(m.signal) && m.signal <= WEAK_DBM - 5 ? `signal ${m.signal} dBm` : null,
      ].filter(Boolean).join(', '),
    }));
  return { level, headline, detail, outliers: level === 'ok' ? outliers : outliers.slice(0, 50), steps: level === 'ok' ? [] : steps };
}

/** What to do on site, by what kind of device it is and whether it can be logged into. */
export function checkSteps(kind, managed) {
  if (kind === 'switch') {
    return managed
      ? ['Look at the uplink port: errors, flaps, speed and duplex.', 'Check the switch has power and has not restarted (uptime).', 'Check the cable and the port the customers hang off.']
      : ['Check the switch has power: the lights, the power adapter, the socket.', 'Reseat the uplink cable and try another uplink port.', 'Unplug customer cables one at a time: one bad cable or device can drag the whole switch down.', 'Swap the switch for a known good one if the lights are fine.'];
  }
  if (kind === 'onu') {
    return managed
      ? ['Read the optical power: about -8 to -27 dBm is healthy, and LOS means the fibre is cut.', 'Check how many customers are on that PON port and its load.', 'Check the ONU is online and not in a restart loop.']
      : ['Look at the PON and LOS lights: a red LOS means no light from the fibre.', 'Check the ONU power adapter and socket.', 'Clean and reseat the fibre connector.', 'Ask the upstream provider whether the splitter or the PON port has a fault.'];
  }
  if (kind === 'radio') {
    return managed
      ? ['Check the radio is up and see each client\'s signal, CCQ and airtime.', 'Look for interference or a new obstruction; check alignment.', 'One poor client can drag a sector down: test with the weakest one disconnected.']
      : ['Check the radio has power and its link light; reset its PoE injector.', 'Check the alignment and look for a new obstruction or interference.', 'Check the cable from the radio to the injector for water or damage.'];
  }
  return ['Check power at the shared device.', 'Check the cable and port the customers share.', 'Compare against a customer not on this link.'];
}

const DROPS = `('Lost-Carrier', 'Lost-Service')`;

/** Customers on links with what is needed to judge them: online now, drops in the last day, last signal reading, line health. */
async function memberRows(pool, tenantId, linkId = null) {
  const { rows } = await pool.query(
    `select s.id, s.name, s.account_code, s.phone, s.status, s.pppoe_user, s.shared_link_id,
            s.cpe_signal_dbm::float8 as signal,
            exists (select 1 from radacct a where a.username = s.pppoe_user and a.acctstoptime is null) as online,
            (select count(*)::int from radacct a where a.username = s.pppoe_user and a.acctstoptime > now() - interval '24 hours'
                and a.acctterminatecause in ${DROPS}) as drops,
            lh.state as line_state
       from subscribers s
       left join line_health lh on lh.tenant_id = s.tenant_id and lh.pppoe_user = s.pppoe_user
      where s.tenant_id = $1 and s.shared_link_id is not null and ($2::uuid is null or s.shared_link_id = $2)
      order by s.name`, [tenantId, linkId]);
  return rows;
}

/** For each link, the most customers that lost their line inside one few-minute window in the last day, and when. */
async function worstWindows(pool, tenantId, linkId = null) {
  const secs = SAME_TIME_MINUTES * 60;
  const { rows } = await pool.query(
    `select link, n, bucket as at from (
        select s.shared_link_id as link,
               to_timestamp(floor(extract(epoch from a.acctstoptime) / ${secs}) * ${secs}) as bucket,
               count(distinct s.id)::int as n,
               row_number() over (partition by s.shared_link_id order by count(distinct s.id) desc, max(a.acctstoptime) desc) as rk
          from radacct a join subscribers s on s.tenant_id = $1 and s.pppoe_user = a.username and s.shared_link_id is not null
         where a.acctstoptime > now() - interval '24 hours' and a.acctterminatecause in ${DROPS}
           and ($2::uuid is null or s.shared_link_id = $2)
         group by 1, 2) w
      where rk = 1`, [tenantId, linkId]);
  return new Map(rows.map((r) => [r.link, { n: r.n, at: r.at }]));
}

const brief = (v) => ({ level: v.level, headline: v.headline });

/** Every link with its verdict, for the list. */
export async function listLinks(pool, tenantId) {
  const [{ rows: links }, members, windows] = await Promise.all([
    pool.query('select * from shared_links where tenant_id=$1 order by name', [tenantId]),
    memberRows(pool, tenantId),
    worstWindows(pool, tenantId),
  ]);
  return links.map((l) => {
    const mine = members.filter((m) => m.shared_link_id === l.id);
    const verdict = judgeLink({ kind: l.kind, managed: l.managed, members: mine, worstWindow: windows.get(l.id) });
    const act = mine.filter(live);
    return {
      ...l, ...brief(verdict),
      customers: mine.length, active: act.length, online: act.filter((m) => m.online).length,
      drops: mine.reduce((a, m) => a + m.drops, 0), memberIds: mine.map((m) => m.id),
    };
  });
}

/** One link, its customers and its full verdict. */
export async function linkDetail(pool, tenantId, id) {
  const { rows: [l] } = await pool.query('select * from shared_links where id=$1 and tenant_id=$2', [id, tenantId]);
  if (!l) return null;
  const [members, windows] = await Promise.all([memberRows(pool, tenantId, id), worstWindows(pool, tenantId, id)]);
  return { ...l, members, verdict: judgeLink({ kind: l.kind, managed: l.managed, members, worstWindow: windows.get(id) }) };
}

const text = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const bad = (m) => Object.assign(new Error(m), { status: 400 });

export async function createLink(pool, tenantId, b) {
  const name = text(b?.name, 80);
  if (!name) throw bad('Give the link a name, for example "Mlima mast sector 1".');
  const kind = KINDS.includes(b?.kind) ? b.kind : 'radio';
  try {
    const { rows: [r] } = await pool.query(
      `insert into shared_links (tenant_id, name, kind, managed, location, notes) values ($1,$2,$3,$4,$5,$6) returning *`,
      [tenantId, name, kind, b?.managed !== false, text(b?.location, 120), text(b?.notes, 1000)]);
    return r;
  } catch (e) {
    if (e.code === '23505') throw bad(`There is already a link called "${name}".`);
    throw e;
  }
}

export async function updateLink(pool, tenantId, id, b) {
  const { rows: [cur] } = await pool.query('select * from shared_links where id=$1 and tenant_id=$2', [id, tenantId]);
  if (!cur) return null;
  const name = b?.name === undefined ? cur.name : text(b.name, 80);
  if (!name) throw bad('Give the link a name.');
  const kind = b?.kind === undefined ? cur.kind : (KINDS.includes(b.kind) ? b.kind : cur.kind);
  try {
    const { rows: [r] } = await pool.query(
      `update shared_links set name=$3, kind=$4, managed=$5, location=$6, notes=$7 where id=$1 and tenant_id=$2 returning *`,
      [id, tenantId, name, kind, b?.managed === undefined ? cur.managed : b.managed !== false,
        b?.location === undefined ? cur.location : text(b.location, 120), b?.notes === undefined ? cur.notes : text(b.notes, 1000)]);
    return r;
  } catch (e) {
    if (e.code === '23505') throw bad(`There is already a link called "${name}".`);
    throw e;
  }
}

export async function deleteLink(pool, tenantId, id) {
  const { rowCount } = await pool.query('delete from shared_links where id=$1 and tenant_id=$2', [id, tenantId]);
  return rowCount > 0;
}

/** Put customers on a link (a customer sits on one link; adding moves them) or take them off it. Only this organisation's customers. */
export async function setMembers(pool, tenantId, id, { add = [], remove = [] }) {
  const { rows: [l] } = await pool.query('select id from shared_links where id=$1 and tenant_id=$2', [id, tenantId]);
  if (!l) return null;
  const ids = (a) => (Array.isArray(a) ? a : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  let added = 0; let removed = 0;
  if (ids(add).length) added = (await pool.query('update subscribers set shared_link_id=$1 where tenant_id=$2 and id = any($3::uuid[])', [id, tenantId, ids(add)])).rowCount;
  if (ids(remove).length) removed = (await pool.query('update subscribers set shared_link_id=null where tenant_id=$1 and shared_link_id=$2 and id = any($3::uuid[])', [tenantId, id, ids(remove)])).rowCount;
  return { added, removed };
}
