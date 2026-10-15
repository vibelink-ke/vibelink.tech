const STATES = ['serviceable', 'marginal', 'weak', 'none'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v, lo, hi) => { const x = Number(v); return v !== null && v !== undefined && Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x * 10) / 10 : null; };

/**
 * Keep what SkyPlan worked out about whether leads can be served. Only leads of this organisation are touched, only the coverage columns, and
 * everything is checked and trimmed first: this arrives from a browser (or a key), so nothing in it is trusted.
 */
export async function saveLeadCoverage(pool, tenantId, results) {
  let saved = 0;
  for (const r of (Array.isArray(results) ? results : []).slice(0, 500)) {
    if (!UUID.test(String(r?.leadId ?? '')) || !STATES.includes(r?.coverage)) continue;
    const detail = {
      sector: r.sector ? String(r.sector).slice(0, 120) : null,
      distanceM: num(r.distanceM, 0, 200000), mbps: num(r.mbps, 0, 100000),
      dl: num(r.dl, -200, 50), ul: num(r.ul, -200, 50), clearancePct: num(r.clearancePct, -1000, 10000),
    };
    const { rowCount } = await pool.query(
      'update leads set coverage=$3, coverage_detail=$4, coverage_at=now() where tenant_id=$1 and id=$2',
      [tenantId, r.leadId, r.coverage, JSON.stringify(detail)]);
    saved += rowCount;
  }
  return saved;
}

/** Line drops (the router lost the customer or their service) in the last 24 hours, per customer. */
export async function customerDrops(pool, tenantId) {
  const { rows } = await pool.query(
    `select s.id, count(*)::int as n
       from radacct a join subscribers s on s.tenant_id = $1 and s.pppoe_user = a.username
      where a.acctstoptime > now() - interval '24 hours' and a.acctterminatecause in ('Lost-Carrier', 'Lost-Service')
      group by s.id`, [tenantId]);
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
}

/** The correction SkyPlan last worked out for this organisation (0 when none). */
export async function getCalibration(pool, tenantId) {
  const { rows: [r] } = await pool.query(
    'select correction_db::float8 as correction_db, samples, rms_db::float8 as rms_db, updated_at from skyplan_calibration where tenant_id=$1', [tenantId]);
  return r ?? { correction_db: 0, samples: 0, rms_db: null, updated_at: null };
}

/** Keep a correction from SkyPlan: checked and limited to +/-30 dB, because it arrives from a browser or a key. */
export async function saveCalibration(pool, tenantId, body) {
  const db = Number(body?.correctionDb);
  if (!Number.isFinite(db) || Math.abs(db) > 30) throw Object.assign(new Error('The correction must be between -30 and 30 dB.'), { status: 400 });
  const samples = Math.max(0, Math.min(100000, Math.round(Number(body?.samples) || 0)));
  const rms = Number.isFinite(Number(body?.rmsDb)) ? Math.max(0, Math.min(99, Number(body.rmsDb))) : null;
  await pool.query(
    `insert into skyplan_calibration (tenant_id, correction_db, samples, rms_db) values ($1,$2,$3,$4)
     on conflict (tenant_id) do update set correction_db = excluded.correction_db, samples = excluded.samples, rms_db = excluded.rms_db, updated_at = now()`,
    [tenantId, Math.round(db * 10) / 10, samples, rms]);
  return { ok: true };
}
