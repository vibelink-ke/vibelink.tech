// Seed data for the independent ISP billing system
const SEED_DATA = {
  customers: [],
  plans: [],
  invoices: [],
  payments: [],
  tickets: [],
  slas: [],
  logs: [],
  tenants: [],
  mikrotiks: [
    {
      id: 'm1',
      tenant_id: 't1', // Assuming t1 is a common tenantId for testing
      router_name: 'Main HQ Router',
      ip_address: '192.168.88.1',
      status: 'online',
      uptime: '15d 4h',
      cpu_usage: 12,
      memory_usage: 45,
      last_sync: new Date().toISOString()
    }
  ],
  vpn_configs: [
    {
      id: 'v1',
      tenant_id: 't1',
      type: 'server',
      name: 'Primary VPN Gateway',
      public_endpoint: 'vpn.vibelink.cloud',
      port: 51820,
      public_key: 'server-public-key-abcdef1234567890=',
      allowed_ips: '0.0.0.0/0'
    },
    {
      id: 'v2',
      tenant_id: 't1',
      type: 'peer',
      name: 'Branch Office A',
      inner_ip: '10.8.0.2',
      public_key: 'peer-a-public-key-xyz987654321=',
      private_key: 'peer-a-private-key-confidential=',
      listen_port: 13231
    }
  ]
};

// Local storage keys
const STORAGE_KEYS = {
  CUSTOMERS: 'vibelink_customers',
  PLANS: 'vibelink_plans',
  INVOICES: 'vibelink_invoices',
  PAYMENTS: 'vibelink_payments',
  TICKETS: 'vibelink_tickets',
  SLAS: 'vibelink_slas',
  LOGS: 'vibelink_logs',
  USER: 'vibelink_user',
  TENANTS: 'vibelink_tenants',
  MIKROTIKS: 'vibelink_mikrotiks',
  VPN_CONFIGS: 'vibelink_vpn_configs'
};


// Initialize localStorage if empty
const initializeStorage = () => {
  Object.keys(STORAGE_KEYS).forEach(key => {
    if (!localStorage.getItem(STORAGE_KEYS[key])) {
      const dataKey = key.toLowerCase();
      if (SEED_DATA[dataKey]) {
        localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(SEED_DATA[dataKey]));
      }
    }
  });
};

// Helper to get raw data
const getData = (key) => {
  initializeStorage();
  return JSON.parse(localStorage.getItem(key) || '[]');
};

// Helper to get current tenant ID
const getTenantId = () => {
  const userStr = localStorage.getItem(STORAGE_KEYS.USER);
  if (!userStr) return null;
  const user = JSON.parse(userStr);
  return user.tenant_id || user.id;
};

// Helper to get data filtered by tenant
const getTenantData = (key) => {
  const data = getData(key);
  const tenantId = getTenantId();
  if (!tenantId) return data;
  
  // Special case: some data might be "global" or the user is a superadmin
  // For this mock, we'll assume everything is tenant-scoped
  return data.filter(item => item.tenant_id === tenantId);
};

// Helper to save data
const saveData = (key, data) => {
  localStorage.setItem(key, JSON.stringify(data));
};

export const mockApi = {
  entities: {
    Customer: {
      list: async (sort = '', limit = 100) => getTenantData(STORAGE_KEYS.CUSTOMERS),
      filter: async () => getTenantData(STORAGE_KEYS.CUSTOMERS),
      subscribe: () => () => {},
      create: async (data) => {
        const customers = getData(STORAGE_KEYS.CUSTOMERS);
        const tenantId = getTenantId();
        const newCustomer = { 
          ...data, 
          id: Math.random().toString(36).substr(2, 9), 
          tenant_id: tenantId,
          created_date: new Date().toISOString() 
        };
        saveData(STORAGE_KEYS.CUSTOMERS, [...customers, newCustomer]);
        return newCustomer;
      },
      update: async (id, data) => {
        const customers = getData(STORAGE_KEYS.CUSTOMERS);
        const tenantId = getTenantId();
        const index = customers.findIndex(c => c.id === id && c.tenant_id === tenantId);
        if (index !== -1) {
          customers[index] = { ...customers[index], ...data };
          saveData(STORAGE_KEYS.CUSTOMERS, customers);
          return customers[index];
        }
        return null;
      },
      delete: async (id) => {
        const customers = getData(STORAGE_KEYS.CUSTOMERS);
        const tenantId = getTenantId();
        saveData(STORAGE_KEYS.CUSTOMERS, customers.filter(c => !(c.id === id && c.tenant_id === tenantId)));
        return true;
      }
    },
    ServicePlan: {
      list: async () => getTenantData(STORAGE_KEYS.PLANS),
      create: async (data) => {
        const plans = getData(STORAGE_KEYS.PLANS);
        const tenantId = getTenantId();
        const newPlan = { 
          ...data, 
          id: Math.random().toString(36).substr(2, 9),
          tenant_id: tenantId
        };
        saveData(STORAGE_KEYS.PLANS, [...plans, newPlan]);
        return newPlan;
      }
    },
    Invoice: {
      list: async () => getTenantData(STORAGE_KEYS.INVOICES),
      create: async (data) => {
        const invoices = getData(STORAGE_KEYS.INVOICES);
        const tenantId = getTenantId();
        const newInvoice = { 
          ...data, 
          id: Math.random().toString(36).substr(2, 9),
          tenant_id: tenantId,
          created_at: new Date().toISOString()
        };
        saveData(STORAGE_KEYS.INVOICES, [...invoices, newInvoice]);
        return newInvoice;
      }
    },
    Payment: {
      list: async () => getTenantData(STORAGE_KEYS.PAYMENTS),
      create: async (data) => {
        const payments = getData(STORAGE_KEYS.PAYMENTS);
        const tenantId = getTenantId();
        const newPayment = { 
          ...data, 
          id: Math.random().toString(36).substr(2, 9), 
          tenant_id: tenantId,
          date: new Date().toISOString() 
        };
        saveData(STORAGE_KEYS.PAYMENTS, [...payments, newPayment]);
        return newPayment;
      }
    },
    SupportTicket: {
      list: async () => getTenantData(STORAGE_KEYS.TICKETS),
      create: async (data) => {
        const tickets = getData(STORAGE_KEYS.TICKETS);
        const tenantId = getTenantId();
        const newTicket = { 
          ...data, 
          id: Math.random().toString(36).substr(2, 9), 
          tenant_id: tenantId,
          created_date: new Date().toISOString() 
        };
        saveData(STORAGE_KEYS.TICKETS, [...tickets, newTicket]);
        return newTicket;
      }
    },
    SLA: {
      list: async () => getTenantData(STORAGE_KEYS.SLAS)
    },
    SystemLog: {
      list: async () => getTenantData(STORAGE_KEYS.LOGS)
    },
    Tenant: {
      list: async (sort = '', limit = 100) => getData(STORAGE_KEYS.TENANTS),
      get: async (id) => {
        const tenants = getData(STORAGE_KEYS.TENANTS);
        return tenants.find(t => t.id === id);
      },
      create: async (data) => {
        const tenants = getData(STORAGE_KEYS.TENANTS);
        const newTenant = { ...data, id: Math.random().toString(36).substr(2, 9), created_date: new Date().toISOString() };
        saveData(STORAGE_KEYS.TENANTS, [...tenants, newTenant]);
        return newTenant;
      },
      update: async (id, data) => {
        const tenants = getData(STORAGE_KEYS.TENANTS);
        const index = tenants.findIndex(t => t.id === id);
        if (index !== -1) {
          tenants[index] = { ...tenants[index], ...data };
          saveData(STORAGE_KEYS.TENANTS, tenants);
          return tenants[index];
        }
        throw { status: 404, message: 'Tenant not found' };
      },
      delete: async (id) => {
        const tenants = getData(STORAGE_KEYS.TENANTS);
        saveData(STORAGE_KEYS.TENANTS, tenants.filter(t => t.id !== id));
        return true;
      }
    },
    Mikrotik: {
      list: async () => getTenantData(STORAGE_KEYS.MIKROTIKS),
      create: async (data) => {
        const routers = getData(STORAGE_KEYS.MIKROTIKS);
        const tenantId = getTenantId();
        const newRouter = { 
          ...data, 
          id: Math.random().toString(36).substr(2, 9), 
          tenant_id: tenantId,
          status: data.status || 'offline',
          uptime: '0s',
          cpu_usage: 0,
          memory_usage: 0,
          last_sync: new Date().toISOString()
        };
        saveData(STORAGE_KEYS.MIKROTIKS, [...routers, newRouter]);
        return newRouter;
      },
      update: async (id, data) => {
        const routers = getData(STORAGE_KEYS.MIKROTIKS);
        const tenantId = getTenantId();
        const index = routers.findIndex(r => r.id === id && r.tenant_id === tenantId);
        if (index !== -1) {
          routers[index] = { ...routers[index], ...data };
          saveData(STORAGE_KEYS.MIKROTIKS, routers);
          return routers[index];
        }
        return null;
      }
    },
    VPNConfig: {
      list: async () => getTenantData(STORAGE_KEYS.VPN_CONFIGS),
      create: async (data) => {
        const configs = getData(STORAGE_KEYS.VPN_CONFIGS);
        const tenantId = getTenantId();
        const newConfig = { 
          ...data, 
          id: Math.random().toString(36).substr(2, 9), 
          tenant_id: tenantId,
          created_at: new Date().toISOString()
        };
        saveData(STORAGE_KEYS.VPN_CONFIGS, [...configs, newConfig]);
        return newConfig;
      },
      update: async (id, data) => {
        const configs = getData(STORAGE_KEYS.VPN_CONFIGS);
        const tenantId = getTenantId();
        const index = configs.findIndex(c => c.id === id && c.tenant_id === tenantId);
        if (index !== -1) {
          configs[index] = { ...configs[index], ...data };
          saveData(STORAGE_KEYS.VPN_CONFIGS, configs);
          return configs[index];
        }
        return null;
      }
    },
    Role: {
      list: async () => []
    },
    Hotspot: {
      list: async () => []
    },
    Notification: {
      list: async () => [],
      filter: async () => [],
      subscribe: () => () => {},
    },
    TicketNote: {
      list: async () => [],
      filter: async () => [],
      subscribe: () => () => {},
    }
  },
  auth: {
    me: async () => {
      const user = localStorage.getItem(STORAGE_KEYS.USER);
      if (!user) throw { status: 401, message: 'Unauthorized' };
      return JSON.parse(user);
    },
    login: async (email, password) => {
      // Simulate finding a user with a tenant
      const user = { 
        id: 'u' + Math.random().toString(36).substr(2, 5), 
        name: 'ISP Admin', 
        email: email, 
        role: 'admin', 
        tenant_id: 't' + Math.random().toString(36).substr(2, 5),
        onboarding_completed: true 
      };
      saveData(STORAGE_KEYS.USER, user);
      return user;
    },
    register: async (email, password, organization) => {
      const tenantId = 't' + Math.random().toString(36).substr(2, 5);
      const user = { 
        id: 'u' + Math.random().toString(36).substr(2, 5), 
        name: organization + ' Admin', 
        email: email, 
        role: 'admin', 
        tenant_id: tenantId,
        onboarding_completed: false 
      };
      saveData(STORAGE_KEYS.USER, user);
      
      // Also save to tenants list
      const tenants = getData(STORAGE_KEYS.TENANTS);
      saveData(STORAGE_KEYS.TENANTS, [...tenants, { 
        id: tenantId,
        company_name: organization, 
        admin_email: email,
        status: 'active', 
        created_at: new Date().toISOString() 
      }]);
      return user;
    },
    updateMe: async (data) => {
      const user = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || '{}');
      const updatedUser = { ...user, ...data };
      saveData(STORAGE_KEYS.USER, updatedUser);
      return updatedUser;
    },
    logout: async () => {
      localStorage.removeItem(STORAGE_KEYS.USER);
    },
    redirectToLogin: () => {
      window.location.href = '/login';
    }
  },
  functions: {
    invoke: async (name, params) => {
      console.log(`Function ${name} invoked with:`, params);
      return { success: true };
    }
  },
  appLogs: {
    logUserInApp: async (pageName) => {
      console.log(`User navigated to: ${pageName}`);
      return true;
    }
  }
};
