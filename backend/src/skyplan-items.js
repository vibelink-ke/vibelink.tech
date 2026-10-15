/**
 * The parts of a SkyPlan design that billing's own map has no place for in full: wireless links (their radios, antennas, heights, power) and
 * sectors. Their whole definition is kept here, one row each, so the design comes back exactly as it was drawn on any computer that connects to
 * billing; the map side of the same things (a wireless link between two towers, an access point with a direction and reach) is made as ordinary
 * network items by the importer (skyplan-convert.js).
 *
 * Checked and limited on the way in: this arrives from a browser or a key.
 */
const KINDS = { links: 'link', coverages: 'coverage' };
const MAX_ITEMS = 2000;
const MAX_BYTES = 20000;

const clean = (list) => {
  const out = [];
  for (const x of (Array.isArray(list) ? list : []).slice(0, MAX_ITEMS)) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || x.id.length > 80) continue;
    if (JSON.stringify(x).length > MAX_BYTES) continue;
    out.push(x);
  }
  return out;
};

/**
 * Keep the links and sectors of a design. What is not in the lists any more was deleted in SkyPlan and goes too, but only when the design
 * has sites (`mirror`): an empty design must never wipe what was saved.
 */
export async function saveDesignItems(pool, tenantId, { links, coverages, mirror = true } = {}) {
  let saved = 0; let removed = 0;
  for (const [key, kind] of Object.entries(KINDS)) {
    const items = clean(key === 'links' ? links : coverages);
    for (const x of items) {
      await pool.query(
        `insert into skyplan_items (tenant_id, kind, ref, data) values ($1,$2,$3,$4)
         on conflict (tenant_id, kind, ref) do update set data = excluded.data, updated_at = now()`,
        [tenantId, kind, x.id, JSON.stringify(x)]);
      saved += 1;
    }
    if (mirror) {
      const { rowCount } = await pool.query(
        'delete from skyplan_items where tenant_id=$1 and kind=$2 and not (ref = any($3::text[]))', [tenantId, kind, items.map((x) => x.id)]);
      removed += rowCount;
    }
  }
  return { saved, removed };
}

export async function loadDesignItems(pool, tenantId) {
  // Before the table exists (a server updated ahead of its database) the design simply has no kept links or sectors yet, instead of failing to load.
  const { rows } = await pool.query('select kind, data from skyplan_items where tenant_id=$1 order by updated_at', [tenantId])
    .catch((e) => { if (e.code === '42P01') return { rows: [] }; throw e; });
  return {
    links: rows.filter((r) => r.kind === 'link').map((r) => r.data),
    coverages: rows.filter((r) => r.kind === 'coverage').map((r) => r.data),
  };
}
