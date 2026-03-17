// Seed data for the independent ISP billing system
const SEED_DATA = {
  customers: [],
  plans: [],
  invoices: [],
  payments: [],
  tickets: [],
  slas: [],
  logs: [],
  tenants: []
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
  TENANTS: 'vibelink_tenants'
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

// Helper to get data
const getData = (key) => {
  initializeStorage();
  return JSON.parse(localStorage.getItem(key) || '[]');
};

// Helper to save data
const saveData = (key, data) => {
  localStorage.setItem(key, JSON.stringify(data));
};

export const mockApi = {
  entities: {
    Customer: {
      list: async (sort = '', limit = 100) => getData(STORAGE_KEYS.CUSTOMERS),
      filter: async () => getData(STORAGE_KEYS.CUSTOMERS),
      subscribe: () => () => {},
      create: async (data) => {
        const customers = getData(STORAGE_KEYS.CUSTOMERS);
        const newCustomer = { ...data, id: Math.random().toString(36).substr(2, 9), created_date: new Date().toISOString() };
        saveData(STORAGE_KEYS.CUSTOMERS, [...customers, newCustomer]);
        return newCustomer;
      },
      update: async (id, data) => {
        const customers = getData(STORAGE_KEYS.CUSTOMERS);
        const index = customers.findIndex(c => c.id === id);
        if (index !== -1) {
          customers[index] = { ...customers[index], ...data };
          saveData(STORAGE_KEYS.CUSTOMERS, customers);
          return customers[index];
        }
        return null;
      },
      delete: async (id) => {
        const customers = getData(STORAGE_KEYS.CUSTOMERS);
        saveData(STORAGE_KEYS.CUSTOMERS, customers.filter(c => c.id !== id));
        return true;
      }
    },
    ServicePlan: {
      list: async () => getData(STORAGE_KEYS.PLANS),
      create: async (data) => {
        const plans = getData(STORAGE_KEYS.PLANS);
        const newPlan = { ...data, id: Math.random().toString(36).substr(2, 9) };
        saveData(STORAGE_KEYS.PLANS, [...plans, newPlan]);
        return newPlan;
      }
    },
    Invoice: {
      list: async () => getData(STORAGE_KEYS.INVOICES)
    },
    Payment: {
      list: async () => getData(STORAGE_KEYS.PAYMENTS),
      create: async (data) => {
        const payments = getData(STORAGE_KEYS.PAYMENTS);
        const newPayment = { ...data, id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString() };
        saveData(STORAGE_KEYS.PAYMENTS, [...payments, newPayment]);
        return newPayment;
      }
    },
    SupportTicket: {
      list: async () => getData(STORAGE_KEYS.TICKETS),
      create: async (data) => {
        const tickets = getData(STORAGE_KEYS.TICKETS);
        const newTicket = { ...data, id: Math.random().toString(36).substr(2, 9), created_date: new Date().toISOString() };
        saveData(STORAGE_KEYS.TICKETS, [...tickets, newTicket]);
        return newTicket;
      }
    },
    SLA: {
      list: async () => getData(STORAGE_KEYS.SLAS)
    },
    SystemLog: {
      list: async () => getData(STORAGE_KEYS.LOGS)
    },
    Tenant: {
      list: async (sort = '', limit = 100) => getData(STORAGE_KEYS.TENANTS),
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
      list: async () => []
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
      const user = { id: 'u1', name: 'Admin User', email: email, role: 'admin', onboarding_completed: false };
      saveData(STORAGE_KEYS.USER, user);
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
