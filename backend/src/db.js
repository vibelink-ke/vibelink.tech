import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

/** Run fn inside a transaction scoped to one tenant (RLS applies). */
export async function withTenant(tenantId, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export async function tenantByShortcode(provider, shortcode) {
  const { rows } = await pool.query(
    'select tenant_id from tenant_payment_config where provider=$1 and shortcode=$2 limit 1',
    [provider, shortcode]
  );
  return rows[0]?.tenant_id ?? null;
}

export async function tenantByHost(host) {
  const sub = String(host || '').split('.')[0];
  const { rows } = await pool.query('select * from tenants where subdomain=$1', [sub]);
  return rows[0] ?? null;
}

/**
 * The gateway to charge through for a provider.
 * A tenant may hold several paybills/tills per provider, so prefer the one
 * flagged default and fall back to the oldest configured row.
 */
export async function config(tenantId, provider) {
  const { rows } = await pool.query(
    `select * from tenant_payment_config
     where tenant_id=$1 and provider=$2
     order by is_default desc, id
     limit 1`,
    [tenantId, provider]
  );
  return rows[0] ?? null;
}

/** True unless the tenant has explicitly switched this cron job off. */
export async function jobEnabled(tenantId, job) {
  const { rows } = await pool.query(
    'select enabled from automation_jobs where tenant_id=$1 and job=$2', [tenantId, job]);
  return rows[0]?.enabled ?? true;
}

/** SQL fragment: tenants that have NOT disabled `job`. Use as `tenant_id in (...)`. */
export const enabledTenants = `
  select t.id from tenants t
  left join automation_jobs a on a.tenant_id = t.id and a.job = $1
  where coalesce(a.enabled, true)`;
