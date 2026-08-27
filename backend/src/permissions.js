import { pool } from './db.js';

/**
 * The real permission matrix — expanded from Staff.jsx's original ten
 * broad keys into one view/edit/delete row per page, matching what the
 * "Roles & permissions" tab now actually controls. Owner is always true
 * everywhere here on purpose: it's the one role every tenant is guaranteed
 * to have, and a tenant that locks itself out of its own owner account has
 * no other way back in.
 */
export const ROLES = ['owner', 'cashier', 'technician', 'support', 'sales'];

const all = (owner = true) => ({ owner, cashier: false, technician: false, support: false, sales: false });

export const DEFAULT_PERMISSIONS = {
  'clients.view':    { owner: true, cashier: true,  technician: true,  support: true,  sales: true },
  'clients.edit':    { owner: true, cashier: false, technician: false, support: false, sales: false },
  'clients.delete':  { owner: true, cashier: false, technician: false, support: false, sales: false },

  'routers.view':    { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'routers.edit':    { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'routers.delete':  all(),

  'tariffs.view':    { owner: true, cashier: true,  technician: true,  support: true,  sales: true },
  'tariffs.edit':    all(),
  'tariffs.delete':  all(),

  'hotspot.view':    { owner: true, cashier: true,  technician: true,  support: true,  sales: false },
  'hotspot.edit':    { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'hotspot.delete':  { owner: true, cashier: false, technician: true,  support: false, sales: false },

  'tickets.view':    { owner: true, cashier: true,  technician: true,  support: true,  sales: false },
  'tickets.edit':    { owner: true, cashier: false, technician: true,  support: true,  sales: false },
  'tickets.delete':  all(),

  'leads.view':      { owner: true, cashier: false, technician: false, support: false, sales: true },
  'leads.edit':      { owner: true, cashier: false, technician: false, support: false, sales: true },
  'leads.delete':    all(),

  'messaging.view':  { owner: true, cashier: true,  technician: false, support: true,  sales: false },
  'messaging.send':  { owner: true, cashier: false, technician: false, support: true,  sales: false },

  'kb.view':         { owner: true, cashier: true,  technician: true,  support: true,  sales: true },
  'kb.edit':         { owner: true, cashier: false, technician: true,  support: true,  sales: false },
  'kb.delete':       all(),

  'payments.view':   { owner: true, cashier: true,  technician: false, support: false, sales: false },
  'payments.apply':  { owner: true, cashier: true,  technician: false, support: false, sales: false },
  'payments.edit':   all(),

  'staff.view':      all(),
  'staff.edit':      all(),
  'staff.delete':    all(),

  'settings.view':   { owner: true, cashier: true,  technician: false, support: false, sales: false },
  'settings.edit':   all(),
};

export const PERMISSION_META = [
  { key: 'clients.view',   page: 'Clients',         action: 'View' },
  { key: 'clients.edit',   page: 'Clients',         action: 'Edit' },
  { key: 'clients.delete', page: 'Clients',         action: 'Delete' },
  { key: 'routers.view',   page: 'Routers',         action: 'View' },
  { key: 'routers.edit',   page: 'Routers',         action: 'Edit / Configure' },
  { key: 'routers.delete', page: 'Routers',         action: 'Delete' },
  { key: 'tariffs.view',   page: 'Internet tariffs',action: 'View' },
  { key: 'tariffs.edit',   page: 'Internet tariffs',action: 'Edit' },
  { key: 'tariffs.delete', page: 'Internet tariffs',action: 'Delete' },
  { key: 'hotspot.view',   page: 'Hotspot',         action: 'View' },
  { key: 'hotspot.edit',   page: 'Hotspot',         action: 'Edit' },
  { key: 'hotspot.delete', page: 'Hotspot',         action: 'Delete vouchers' },
  { key: 'tickets.view',   page: 'Tickets',         action: 'View' },
  { key: 'tickets.edit',   page: 'Tickets',         action: 'Edit / assign' },
  { key: 'tickets.delete', page: 'Tickets',         action: 'Delete' },
  { key: 'leads.view',     page: 'Leads',           action: 'View' },
  { key: 'leads.edit',     page: 'Leads',           action: 'Edit' },
  { key: 'leads.delete',   page: 'Leads',           action: 'Delete' },
  { key: 'messaging.view', page: 'Messaging',       action: 'View history' },
  { key: 'messaging.send', page: 'Messaging',       action: 'Send' },
  { key: 'kb.view',        page: 'Knowledge base',  action: 'View' },
  { key: 'kb.edit',        page: 'Knowledge base',  action: 'Edit / publish' },
  { key: 'kb.delete',      page: 'Knowledge base',  action: 'Delete' },
  { key: 'payments.view',  page: 'Payments',        action: 'View' },
  { key: 'payments.apply', page: 'Payments',        action: 'Apply / match' },
  { key: 'payments.edit',  page: 'Payments',        action: 'Edit gateway credentials' },
  { key: 'staff.view',     page: 'Staff & roles',   action: 'View' },
  { key: 'staff.edit',     page: 'Staff & roles',   action: 'Edit' },
  { key: 'staff.delete',   page: 'Staff & roles',   action: 'Delete' },
  { key: 'settings.view',  page: 'Settings',        action: 'View' },
  { key: 'settings.edit',  page: 'Settings',        action: 'Edit' },
];

/** The full matrix for a tenant — defaults with any saved overrides applied on top. */
export async function loadPermissions(tenantId) {
  const matrix = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
  const { rows } = await pool.query(
    'select role, perm_key, allowed from role_permissions where tenant_id=$1', [tenantId]);
  for (const r of rows) {
    if (!matrix[r.perm_key]) matrix[r.perm_key] = {};
    matrix[r.perm_key][r.role] = r.allowed;
  }
  return matrix;
}

export async function savePermissions(tenantId, matrix) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    for (const [key, byRole] of Object.entries(matrix)) {
      if (!DEFAULT_PERMISSIONS[key]) continue;   // ignore anything not a real key
      for (const role of ROLES) {
        if (!(role in byRole)) continue;
        // Owner is never actually stored as deniable — see the comment on
        // DEFAULT_PERMISSIONS on why a tenant can never lock itself out of
        // its own owner role.
        if (role === 'owner') continue;
        await c.query(
          `insert into role_permissions (tenant_id, role, perm_key, allowed)
           values ($1,$2,$3,$4)
           on conflict (tenant_id, role, perm_key) do update set allowed=excluded.allowed`,
          [tenantId, role, key, !!byRole[role]]);
      }
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** True if `role` (or a platform-owner session) has `key`, defaults included. */
export async function hasPermission(tenantId, role, key) {
  if (role === 'owner') return true;
  const { rows: [row] } = await pool.query(
    'select allowed from role_permissions where tenant_id=$1 and role=$2 and perm_key=$3',
    [tenantId, role, key]);
  if (row) return row.allowed;
  return !!DEFAULT_PERMISSIONS[key]?.[role];
}

/**
 * Express middleware gate, parallel to requireRole() but checked against
 * the actual saved/overridable matrix instead of a fixed role list.
 * is_super_admin always passes, same as requireRole.
 */
export function requirePermission(key) {
  return async (req, res, next) => {
    if (req.session?.is_super_admin) return next();
    try {
      const ok = await hasPermission(req.tenant.id, req.session?.role, key);
      if (ok) return next();
      res.status(403).json({ error: `Your role does not have "${key}" permission.` });
    } catch (e) {
      next(e);
    }
  };
}
