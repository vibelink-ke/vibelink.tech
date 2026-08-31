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
  const name = String(host || '').toLowerCase().trim();
  const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();

  /**
   * The root domain belongs to no tenant.
   *
   * This matched on the first label alone, so vibelink.tech resolved to the
   * tenant whose subdomain happens to be "vibelink" — the platform's own front
   * door quietly served one ISP's captive portal and portal login to anyone who
   * visited it. Any tenant named after the root domain inherits the marketing
   * site, which is nobody's intention and not something a tenant chose.
   *
   * The subdomain has to be a label *under* the root, not the root itself.
   */
  if (!name || name === root || name === `www.${root}`) return null;

  const sub = name.split('.')[0];
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

/**
 * The platform owner's dedicated paybill for collect-and-settle (see
 * tenant_payment_config.is_platform_collect) — deliberately separate from
 * config()'s pick, which is whatever that same tenant uses for its own
 * ordinary SaaS billing. Callers fall back to config() when this returns
 * null, so setting one up is optional, not a breaking requirement.
 */
export async function platformCollectConfig(tenantId, provider) {
  const { rows } = await pool.query(
    `select * from tenant_payment_config where tenant_id=$1 and provider=$2 and is_platform_collect limit 1`,
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
