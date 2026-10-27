// Bring back subscribers that were deleted, from a backup restored into a scratch database (restore_scratch).
// It never touches anything else, and it is a dry run unless APPLY=1: everything happens in one transaction that is rolled back.
//
//   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T \
//     -e TENANT=<tenant uuid> -e CODES=15864,VBTL2662 [-e APPLY=1] api node --input-type=module - < scripts/restore-deleted-subscribers.mjs
//
// For each subscriber in the backup with one of those account codes that no longer exists in the live database it:
//   - inserts the subscriber row (only columns both databases have);
//   - puts back rows in tables that were deleted along with the subscriber (foreign key "on delete cascade");
//   - points payments, invoices and the like (foreign key "on delete set null") at the subscriber again.
// RADIUS credentials are not restored: a PPPoE client gets them again when their service is next activated.
import pg from 'pg';

const tenant = process.env.TENANT;
const codes = String(process.env.CODES ?? '').split(',').map((c) => c.trim()).filter(Boolean);
const apply = process.env.APPLY === '1';
if (!tenant || !codes.length) { console.error('Set TENANT and CODES.'); process.exit(1); }

const liveUrl = process.env.DATABASE_URL;
const scratchUrl = new URL(liveUrl); scratchUrl.pathname = '/restore_scratch';
const live = new pg.Pool({ connectionString: liveUrl, max: 2 });
const old = new pg.Pool({ connectionString: scratchUrl.toString(), max: 2 });

const columnsOf = async (db, table) => (await db.query(
  `select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [table])).rows.map((r) => r.column_name);
const common = async (table) => { const a = await columnsOf(live, table); const b = new Set(await columnsOf(old, table)); return a.filter((c) => b.has(c)); };
const q = (c) => `"${c}"`;

const client = await live.connect();
try {
  await client.query('begin');

  // 1. the subscribers that are in the backup and gone from the live database
  const subCols = await common('subscribers');
  const { rows: inBackup } = await old.query(
    `select ${subCols.map(q).join(',')} from subscribers where tenant_id=$1 and account_code = any($2)`, [tenant, codes]);
  const { rows: stillThere } = await client.query('select id from subscribers where id = any($1::uuid[])', [inBackup.map((r) => r.id)]);
  const have = new Set(stillThere.map((r) => r.id));
  const missing = inBackup.filter((r) => !have.has(r.id));
  console.log(`In the backup for these account codes: ${inBackup.length}. Already in the live database: ${have.size}. To bring back: ${missing.length}.`);
  for (const r of missing) console.log(`  ${r.account_code}  ${r.name ?? ''}  [${r.status}]  ${r.line_label ?? ''}  ${r.pppoe_user ?? ''}`);
  if (!missing.length) { await client.query('rollback'); console.log('Nothing to do.'); process.exit(0); }
  const ids = missing.map((r) => r.id);

  const ins = await client.query(
    `insert into subscribers (${subCols.map(q).join(',')})
     select ${subCols.map(q).join(',')} from jsonb_populate_recordset(null::subscribers, $1::jsonb)
     on conflict do nothing`, [JSON.stringify(missing)]);
  console.log(`Subscribers inserted: ${ins.rowCount}`);

  // 2. every table with a foreign key to subscribers
  const { rows: fks } = await client.query(
    `select c.conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as del
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'subscribers'::regclass and array_length(c.conkey, 1) = 1
      order by 1, 2`);
  for (const { tbl, col, del } of fks) {
    const table = tbl.replace(/^public\./, '').replace(/"/g, '');
    try {
      if (!(await columnsOf(old, table)).length) { console.log(`  ${table}.${col}: not in the backup, skipped`); continue; }
      if (del === 'c') {            // deleted along with the subscriber: put the rows back
        const cols = await common(table);
        const { rows } = await old.query(`select ${cols.map(q).join(',')} from ${table} where ${q(col)} = any($1::uuid[])`, [ids]);
        if (!rows.length) { console.log(`  ${table}.${col}: no rows to restore`); continue; }
        const r = await client.query(
          `insert into ${table} (${cols.map(q).join(',')}) select ${cols.map(q).join(',')} from jsonb_populate_recordset(null::${table}, $1::jsonb) on conflict do nothing`, [JSON.stringify(rows)]);
        console.log(`  ${table}.${col}: ${r.rowCount} of ${rows.length} rows put back`);
      } else if (del === 'n') {     // kept, but unlinked: link them again
        if (!(await columnsOf(live, table)).includes('id')) { console.log(`  ${table}.${col}: no id column, skipped`); continue; }
        const { rows } = await old.query(`select id::text as id, ${q(col)}::text as sub from ${table} where ${q(col)} = any($1::uuid[])`, [ids]);
        if (!rows.length) { console.log(`  ${table}.${col}: nothing to relink`); continue; }
        const r = await client.query(
          `update ${table} t set ${q(col)} = x.sub::uuid from jsonb_to_recordset($1::jsonb) as x(id text, sub text) where t.id::text = x.id and t.${q(col)} is null`, [JSON.stringify(rows)]);
        console.log(`  ${table}.${col}: ${r.rowCount} of ${rows.length} relinked`);
      } else {
        console.log(`  ${table}.${col}: restrict/no action, skipped`);
      }
    } catch (e) {
      console.log(`  ${table}.${col}: FAILED (${e.message}) - this is not applied`);
      throw e;
    }
  }

  for (const r of missing) {
    await client.query(
      `insert into activity_log (tenant_id, subscriber_id, account_code, actor, action, detail) values ($1,$2,$3,'system','Service restored',$4)`,
      [tenant, r.id, r.account_code, `Restored from backup after the dormant sweep deleted it${r.line_label ? ` - line "${r.line_label}"` : ''}`]);
  }

  if (apply) { await client.query('commit'); console.log('APPLIED: the changes are saved.'); }
  else { await client.query('rollback'); console.log('DRY RUN: nothing was changed. Run again with -e APPLY=1 to save.'); }
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('Stopped, nothing was changed:', e.message);
  process.exitCode = 1;
} finally {
  client.release(); await live.end(); await old.end();
}
