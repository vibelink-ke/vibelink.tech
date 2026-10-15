/**
 * What can be changed in billing from SkyPlan: where a customer or a lead is, which access point a customer is on, and a lead's progress
 * (contacted, a note, a follow-up date). Used by the Map page (with the person's own sign-in and permissions) and by the SkyPlan API key
 * (which needs write access). Everything here is checked and limited, because it arrives from a browser or a key.
 *
 * Deliberately not here: a customer's money, plan or status, and closing a lead as won or lost (those stay on their own screens).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
const coord = (v, max) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : null; };

/** Put a customer or a lead somewhere on the map. A lead's earlier coverage answer is cleared: it was for the old spot. */
export async function moveOnMap(pool, tenantId, { kind, id, lat, lng }) {
  if (!UUID.test(String(id ?? ''))) throw fail(400, 'That is not a customer or lead.');
  const la = coord(lat, 90); const ln = coord(lng, 180);
  if (la === null || ln === null || (la === 0 && ln === 0)) throw fail(400, 'That is not a place on the map.');
  let rowCount;
  if (kind === 'customer') {
    ({ rowCount } = await pool.query('update subscribers set lat=$3, lng=$4 where tenant_id=$1 and id=$2', [tenantId, id, la, ln]));
  } else if (kind === 'lead') {
    ({ rowCount } = await pool.query(
      `update leads set lat=$3, lng=$4, coverage=null, coverage_detail=null, coverage_at=null, last_activity_at=now() where tenant_id=$1 and id=$2`,
      [tenantId, id, la, ln]));
  } else throw fail(400, 'kind must be customer or lead.');
  if (!rowCount) throw fail(404, kind === 'lead' ? 'No such lead.' : 'No such customer.');
  return { ok: true };
}

/** Put a customer on an access point (a node of kind "ap" on the map), or take them off one. */
export async function setCustomerAp(pool, tenantId, { id, apNodeId }) {
  if (!UUID.test(String(id ?? ''))) throw fail(400, 'That is not a customer.');
  if (apNodeId !== null && apNodeId !== undefined && apNodeId !== '') {
    if (!UUID.test(String(apNodeId))) throw fail(400, 'That is not an access point.');
    const { rowCount: ok } = await pool.query("select 1 from network_nodes where tenant_id=$1 and id=$2 and kind='ap'", [tenantId, apNodeId]);
    if (!ok) throw fail(404, 'No such access point.');
  } else apNodeId = null;
  const { rowCount } = await pool.query('update subscribers set ap_node_id=$3 where tenant_id=$1 and id=$2', [tenantId, id, apNodeId]);
  if (!rowCount) throw fail(404, 'No such customer.');
  return { ok: true };
}

/** A lead's progress: mark it contacted, add a note, set a follow-up date. A lead already won or lost is changed on the Leads screen. */
export async function updateLeadFromMap(pool, tenantId, author, { id, markContacted, note, nextFollowUp }) {
  if (!UUID.test(String(id ?? ''))) throw fail(400, 'That is not a lead.');
  const { rows: [lead] } = await pool.query('select status from leads where tenant_id=$1 and id=$2', [tenantId, id]);
  if (!lead) throw fail(404, 'No such lead.');
  if (['won', 'lost'].includes(lead.status)) throw fail(409, `This lead is ${lead.status}. Change it on the Leads screen.`);
  const text = String(note ?? '').trim().slice(0, 2000);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(nextFollowUp ?? '')) ? nextFollowUp : null;
  if (!text && !due && !markContacted) throw fail(400, 'Nothing to save.');
  if (text) {
    await pool.query('insert into lead_notes (tenant_id, lead_id, author, body) values ($1,$2,$3,$4)', [tenantId, id, String(author ?? 'SkyPlan').slice(0, 80), text]);
  }
  // A note, a follow-up date or marking it contacted all mean someone has been in touch: a new lead becomes contacted.
  await pool.query(
    `update leads set last_activity_at = now(),
            next_follow_up = coalesce($3::timestamptz, next_follow_up),
            first_contacted_at = case when status = 'new' then coalesce(first_contacted_at, now()) else first_contacted_at end,
            status = case when status = 'new' then 'contacted' else status end
      where tenant_id=$1 and id=$2`, [tenantId, id, due]);
  return { ok: true };
}
