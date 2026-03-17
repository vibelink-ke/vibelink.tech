// Define all available permissions in the system
export const PERMISSIONS = {
  // Dashboard
  'dashboard.view': { label: 'View Dashboard', category: 'Dashboard' },
  
  // Customers
  'customers.view': { label: 'View Customers', category: 'Customers' },
  'customers.create': { label: 'Create Customers', category: 'Customers' },
  'customers.edit': { label: 'Edit Customers', category: 'Customers' },
  'customers.delete': { label: 'Delete Customers', category: 'Customers' },
  
  // Onboarding
  'onboarding.view': { label: 'View Onboarding', category: 'Onboarding' },
  'onboarding.manage': { label: 'Manage Onboarding', category: 'Onboarding' },
  
  // Service Plans
  'plans.view': { label: 'View Service Plans', category: 'Service Plans' },
  'plans.create': { label: 'Create Plans', category: 'Service Plans' },
  'plans.edit': { label: 'Edit Plans', category: 'Service Plans' },
  'plans.delete': { label: 'Delete Plans', category: 'Service Plans' },
  
  // Hotspots
  'hotspot.view': { label: 'View Hotspots', category: 'Hotspots' },
  'hotspot.create': { label: 'Create Hotspots', category: 'Hotspots' },
  'hotspot.edit': { label: 'Edit Hotspots', category: 'Hotspots' },
  'hotspot.delete': { label: 'Delete Hotspots', category: 'Hotspots' },
  
  // Network & SLA
  'network.view': { label: 'View Network Settings', category: 'Network & SLA' },
  'sla.view': { label: 'View SLA', category: 'Network & SLA' },
  'sla.manage': { label: 'Manage SLA', category: 'Network & SLA' },
  'outages.view': { label: 'View Outages', category: 'Network & SLA' },
  'outages.create': { label: 'Report Outages', category: 'Network & SLA' },
  'outages.manage': { label: 'Manage Outages', category: 'Network & SLA' },
  
  // Billing & Invoices
  'invoices.view': { label: 'View Invoices', category: 'Billing & Finance' },
  'invoices.create': { label: 'Create Invoices', category: 'Billing & Finance' },
  'invoices.edit': { label: 'Edit Invoices', category: 'Billing & Finance' },
  'invoices.send': { label: 'Send Invoices', category: 'Billing & Finance' },
  
  // Payments
  'payments.view': { label: 'View Payments', category: 'Billing & Finance' },
  'payments.record': { label: 'Record Payments', category: 'Billing & Finance' },
  'payments.refund': { label: 'Process Refunds', category: 'Billing & Finance' },
  
  // Reports
  'reports.view': { label: 'View Reports', category: 'Billing & Finance' },
  
  // Analytics
  'analytics.view': { label: 'View Analytics', category: 'Analytics' },
  
  // Support Tickets
  'tickets.view': { label: 'View Tickets', category: 'Support' },
  'tickets.create': { label: 'Create Tickets', category: 'Support' },
  'tickets.respond': { label: 'Respond to Tickets', category: 'Support' },
  'tickets.manage': { label: 'Manage Tickets', category: 'Support' },
  'tickets.close': { label: 'Close Tickets', category: 'Support' },
  
  // Messages
  'messages.view': { label: 'View Messages', category: 'Messages' },
  'messages.send': { label: 'Send Messages', category: 'Messages' },
  
  // Knowledge Base
  'kb.view': { label: 'View Knowledge Base', category: 'Knowledge Base' },
  'kb.create': { label: 'Create Articles', category: 'Knowledge Base' },
  'kb.edit': { label: 'Edit Articles', category: 'Knowledge Base' },
  'kb.delete': { label: 'Delete Articles', category: 'Knowledge Base' },
  
  // Settings
  'settings.view': { label: 'View Settings', category: 'Settings' },
  'settings.edit': { label: 'Edit Settings', category: 'Settings' },
  
  // Roles & Users
  'roles.view': { label: 'View Roles', category: 'Administration' },
  'roles.manage': { label: 'Manage Roles', category: 'Administration' },
  'users.view': { label: 'View Users', category: 'Administration' },
  'users.manage': { label: 'Manage Users', category: 'Administration' },
  'users.invite': { label: 'Invite Users', category: 'Administration' },
  
  // Logs
  'logs.view': { label: 'View Audit Logs', category: 'Administration' },
  
  // IP Pool
  'ip_pool.view': { label: 'View IP Pool', category: 'Network & SLA' },
  'ip_pool.manage': { label: 'Manage IP Pool', category: 'Network & SLA' },
  
  // Tenants (Super Admin)
  'tenants.view': { label: 'View Tenants', category: 'Tenants' },
  'tenants.manage': { label: 'Manage Tenants', category: 'Tenants' },
  'tenant_billing.view': { label: 'View Tenant Billing', category: 'Tenants' },
  'tenant_billing.manage': { label: 'Manage Tenant Billing', category: 'Tenants' },
};

// Group permissions by category for UI display
export const PERMISSION_CATEGORIES = Object.entries(PERMISSIONS).reduce((acc, [key, perm]) => {
  if (!acc[perm.category]) {
    acc[perm.category] = [];
  }
  acc[perm.category].push({ code: key, ...perm });
  return acc;
}, {});

// Predefined role templates
export const ROLE_TEMPLATES = {
  support_agent: {
    name: 'Support Agent',
    description: 'Handles customer support tickets and inquiries',
    permissions: [
      'dashboard.view',
      'customers.view',
      'tickets.view',
      'tickets.respond',
      'kb.view',
      'messages.view',
      'analytics.view',
    ],
  },
  billing_manager: {
    name: 'Billing Manager',
    description: 'Manages invoices, payments, and financial reports',
    permissions: [
      'dashboard.view',
      'customers.view',
      'invoices.view',
      'invoices.create',
      'invoices.edit',
      'invoices.send',
      'payments.view',
      'payments.record',
      'reports.view',
      'analytics.view',
    ],
  },
  network_engineer: {
    name: 'Network Engineer',
    description: 'Manages network, hotspots, and SLA policies',
    permissions: [
      'dashboard.view',
      'customers.view',
      'hotspot.view',
      'hotspot.create',
      'hotspot.edit',
      'network.view',
      'sla.view',
      'outages.view',
      'outages.create',
      'ip_pool.view',
      'analytics.view',
    ],
  },
  manager: {
    name: 'Manager',
    description: 'Has broad access to manage most operational tasks',
    permissions: [
      'dashboard.view',
      'customers.view',
      'customers.create',
      'customers.edit',
      'plans.view',
      'plans.create',
      'plans.edit',
      'hotspot.view',
      'hotspot.create',
      'hotspot.edit',
      'invoices.view',
      'invoices.create',
      'invoices.edit',
      'payments.view',
      'payments.record',
      'reports.view',
      'tickets.view',
      'tickets.manage',
      'messages.view',
      'analytics.view',
      'settings.view',
    ],
  },
};