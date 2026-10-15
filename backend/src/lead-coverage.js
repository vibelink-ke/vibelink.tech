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
