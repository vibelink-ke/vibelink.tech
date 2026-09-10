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
  'clients.create':  { owner: true, cashier: true,  technician: false, support: false, sales: true },
  'clients.edit':    { owner: true, cashier: false, technician: false, support: false, sales: false },
  'clients.suspend': { owner: true, cashier: true,  technician: false, support: false, sales: false },
  'clients.delete':  { owner: true, cashier: false, technician: false, support: false, sales: false },
  // Real money moving with no payment behind it — same trust level as
  // payments.apply, not clients.edit (which a cashier can't touch either).
  'clients.wallet_adjust': { owner: true, cashier: true,  technician: false, support: false, sales: false },
  // Extends service for free, in bulk, across however many accounts are
  // named — a bigger blast radius than one wallet adjustment on one
  // account, so owner-only by default rather than matching wallet_adjust.
  'clients.compensate': { owner: true, cashier: false, technician: false, support: false, sales: false },
  // A customer's own login credential, not their account data — the same
  // trust level as viewing one (owner-only, same as the credentials read
  // this sits beside), not general clients.edit.
  'clients.reset_portal_password': { owner: true, cashier: false, technician: false, support: false, sales: false },
  // Financial documents — same trust level as applying a payment.
  'clients.invoices': { owner: true, cashier: true,  technician: false, support: false, sales: false },

  'routers.view':      { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'routers.edit':      { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'routers.configure': { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'routers.delete':    all(),

  'tariffs.view':    { owner: true, cashier: true,  technician: true,  support: true,  sales: true },
  'tariffs.create':  all(),
  'tariffs.edit':    all(),
  'tariffs.delete':  all(),

  'hotspot.view':     { owner: true, cashier: true,  technician: true,  support: true,  sales: false },
  'hotspot.edit':     { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'hotspot.vouchers': { owner: true, cashier: true,  technician: true,  support: false, sales: false },
  'hotspot.delete':   { owner: true, cashier: false, technician: true,  support: false, sales: false },

  'tickets.view':    { owner: true, cashier: true,  technician: true,  support: true,  sales: false },
  'tickets.edit':    { owner: true, cashier: false, technician: true,  support: true,  sales: false },
  'tickets.delete':  all(),

  // Revenue/MRR reporting — same trust level as payments.view, since it's
  // the same underlying money figures rolled up rather than itemized.
  'analytics.view': { owner: true, cashier: true, technician: false, support: false, sales: false },

  // Gates only the Dashboard's own revenue tiles (collected today, PPPoE
  // income, the collections chart, KES-at-risk) — everything else on the
  // page (online count, tickets, automation feed) stays visible to anyone
  // who can reach the Dashboard at all. Same default as payments.view: it
  // is the same class of figure, just surfaced on a different screen.
  'dashboard.finance': { owner: true, cashier: true, technician: false, support: false, sales: false },

  'leads.view':      { owner: true, cashier: false, technician: false, support: false, sales: true },
  'leads.create':    { owner: true, cashier: false, technician: false, support: false, sales: true },
  'leads.edit':      { owner: true, cashier: false, technician: false, support: false, sales: true },
  'leads.delete':    all(),

  'messaging.view':      { owner: true, cashier: true,  technician: false, support: true,  sales: false },
  'messaging.send':      { owner: true, cashier: false, technician: false, support: true,  sales: false },
  // Bulk is its own key, not folded into messaging.send — one bad template
  // sent to one customer is a mistake; the same mistake sent to the whole
  // base is an incident, so it gets its own, narrower default.
  'messaging.send_bulk': { owner: true, cashier: false, technician: false, support: false, sales: false },

  'kb.view':         { owner: true, cashier: true,  technician: true,  support: true,  sales: true },
  'kb.edit':         { owner: true, cashier: false, technician: true,  support: true,  sales: false },
  'kb.delete':       all(),

  'payments.view':   { owner: true, cashier: true,  technician: false, support: false, sales: false },
  'payments.apply':  { owner: true, cashier: true,  technician: false, support: false, sales: false },
  'payments.edit':   all(),
  'payments.request_payout': { owner: true, cashier: true,  technician: false, support: false, sales: false },
  // Pushes a real M-Pesa prompt to an arbitrary handset — same trust level
  // as applying a payment, not something a technician or support role needs.
  'payments.stk': { owner: true, cashier: true,  technician: false, support: false, sales: false },

  // A referral commission is a real payout — the same trust level as
  // payments.request_payout, deliberately not leads.edit: a sales rep who
  // manages their own referral sources should not also be the one who
  // authorizes paying them.
  'referrers.manage': { owner: true, cashier: true,  technician: false, support: false, sales: false },

  'staff.view':               all(),
  'staff.create':             all(),
  'staff.edit':               all(),
  'staff.delete':             all(),
  // Separate from staff.edit on purpose — someone allowed to fix a
  // colleague's phone number is not automatically someone who should be
  // able to grant themselves (or anyone else) more access than they have.
  'staff.manage_permissions': all(),

  'settings.view':   { owner: true, cashier: true,  technician: false, support: false, sales: false },
  'settings.edit':   all(),

  // A technician is the one actually carrying/installing the gadget, so
  // create/edit is theirs by default; deleting a record (as opposed to
  // marking it retired/returned) is owner-only, same reasoning as
  // clients.delete — a record vanishing outright is harder to notice went
  // wrong than one that just changed status.
  'inventory.view':   { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'inventory.create': { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'inventory.edit':   { owner: true, cashier: false, technician: true,  support: false, sales: false },
  'inventory.delete': all(),

  'expenses.view':    { owner: true, cashier: true,  technician: false, support: false, sales: false },
  'expenses.edit':    { owner: true, cashier: true,  technician: false, support: false, sales: false },
  // Approving your own logged expense for payment is the same trust level
  // as payments.apply, not expenses.edit — a cashier can log a fuel receipt,
  // only an owner signs off on it actually getting paid.
  'expenses.approve': { owner: true, cashier: false, technician: false, support: false, sales: false },

  'hr.view': { owner: true, cashier: false, technician: false, support: false, sales: false },
  'hr.edit': { owner: true, cashier: false, technician: false, support: false, sales: false },
  // Drafting a payroll run (who's on it, salary/commission/bonus lines) is
  // separate from approving and actually disbursing it — the same
  // propose-then-approve split as expenses.edit/expenses.approve, but
  // owner-only on both ends here since this moves real salary money, not
  // one line at a time.
  'payroll.create':  { owner: true, cashier: false, technician: false, support: false, sales: false },
  'payroll.approve': { owner: true, cashier: false, technician: false, support: false, sales: false },
};

export const PERMISSION_META = [
  { key: 'clients.view',    page: 'Clients',          action: 'View' },
  { key: 'clients.create',  page: 'Clients',          action: 'Create' },
  { key: 'clients.edit',    page: 'Clients',          action: 'Edit' },
  { key: 'clients.suspend', page: 'Clients',          action: 'Pause / suspend / resume' },
  { key: 'clients.delete',  page: 'Clients',          action: 'Delete' },
  { key: 'clients.wallet_adjust', page: 'Clients',    action: 'Adjust wallet balance' },
  { key: 'clients.compensate', page: 'Clients',       action: 'Compensate (extend free, in bulk)' },
  { key: 'clients.reset_portal_password', page: 'Clients', action: "Reset a customer's portal password" },
  { key: 'clients.invoices', page: 'Clients',         action: 'Create / edit / delete invoices' },
  { key: 'routers.view',      page: 'Routers',         action: 'View' },
  { key: 'routers.edit',      page: 'Routers',         action: 'Edit' },
  { key: 'routers.configure', page: 'Routers',         action: 'Push config to a router' },
  { key: 'routers.delete',    page: 'Routers',         action: 'Delete' },
  { key: 'tariffs.view',   page: 'Internet tariffs', action: 'View' },
  { key: 'tariffs.create', page: 'Internet tariffs', action: 'Create' },
  { key: 'tariffs.edit',   page: 'Internet tariffs', action: 'Edit' },
  { key: 'tariffs.delete', page: 'Internet tariffs', action: 'Delete' },
  { key: 'hotspot.view',     page: 'Hotspot', action: 'View' },
  { key: 'hotspot.edit',     page: 'Hotspot', action: 'Edit settings' },
  { key: 'hotspot.vouchers', page: 'Hotspot', action: 'Generate vouchers' },
  { key: 'hotspot.delete',   page: 'Hotspot', action: 'Delete / void vouchers' },
  { key: 'tickets.view',   page: 'Tickets', action: 'View' },
  { key: 'tickets.edit',   page: 'Tickets', action: 'Edit / assign' },
  { key: 'tickets.delete', page: 'Tickets', action: 'Delete' },
  { key: 'analytics.view', page: 'Analytics', action: 'View' },
  { key: 'dashboard.finance', page: 'Dashboard', action: 'View revenue figures' },
  { key: 'leads.view',     page: 'Leads', action: 'View' },
  { key: 'leads.create',   page: 'Leads', action: 'Create' },
  { key: 'leads.edit',     page: 'Leads', action: 'Edit' },
  { key: 'leads.delete',   page: 'Leads', action: 'Delete' },
  { key: 'messaging.view',      page: 'Messaging', action: 'View history' },
  { key: 'messaging.send',      page: 'Messaging', action: 'Send' },
  { key: 'messaging.send_bulk', page: 'Messaging', action: 'Send bulk' },
  { key: 'kb.view',   page: 'Knowledge base', action: 'View' },
  { key: 'kb.edit',   page: 'Knowledge base', action: 'Edit / publish' },
  { key: 'kb.delete', page: 'Knowledge base', action: 'Delete' },
  { key: 'payments.view',  page: 'Payments', action: 'View' },
  { key: 'payments.apply', page: 'Payments', action: 'Apply / match' },
  { key: 'payments.edit',  page: 'Payments', action: 'Edit gateway credentials' },
  { key: 'payments.request_payout', page: 'Payments', action: 'Request settlement payout' },
  { key: 'payments.stk', page: 'Payments',            action: 'Push STK to a handset' },
  { key: 'referrers.manage', page: 'Referrers',        action: 'Create / edit / delete / mark commission paid' },
  { key: 'staff.view',               page: 'Staff & roles', action: 'View' },
  { key: 'staff.create',             page: 'Staff & roles', action: 'Invite' },
  { key: 'staff.edit',               page: 'Staff & roles', action: 'Edit' },
  { key: 'staff.delete',             page: 'Staff & roles', action: 'Delete' },
  { key: 'staff.manage_permissions', page: 'Staff & roles', action: 'Change the permission matrix' },
  { key: 'settings.view', page: 'Settings', action: 'View' },
  { key: 'settings.edit', page: 'Settings', action: 'Edit' },
  { key: 'inventory.view',   page: 'Inventory', action: 'View' },
  { key: 'inventory.create', page: 'Inventory', action: 'Create' },
  { key: 'inventory.edit',   page: 'Inventory', action: 'Edit' },
  { key: 'inventory.delete', page: 'Inventory', action: 'Delete' },
  { key: 'expenses.view',    page: 'Expenses', action: 'View' },
  { key: 'expenses.edit',    page: 'Expenses', action: 'Create / edit' },
  { key: 'expenses.approve', page: 'Expenses', action: 'Approve for payment' },
  { key: 'hr.view', page: 'HR', action: 'View staff pay/employment details' },
  { key: 'hr.edit', page: 'HR', action: 'Edit staff pay/employment details' },
  { key: 'payroll.create',  page: 'HR', action: 'Draft a payroll run' },
  { key: 'payroll.approve', page: 'HR', action: 'Approve / disburse a payroll run' },
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
