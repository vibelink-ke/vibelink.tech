// VIBELINK - Production API Client
// src/api/vibelinkClient.js

const BASE_URL = 'https://vibelink-api.kandie.workers.dev';

const getTenantId = () => {
  const userStr = localStorage.getItem('vibelink_user');
  if (!userStr) return 't1';
  const user = JSON.parse(userStr);
  return user.tenant_id || user.id || 't1';
};

const createEntityClient = (endpoint) => ({
  list: async () => {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { 'X-Tenant-ID': getTenantId() }
    });
    return res.json();
  },
  create: async (data) => {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Tenant-ID': getTenantId()
      },
      body: JSON.stringify(data)
    });
    return res.json();
  },
  delete: async (id) => {
    // Implement DELETE in worker later
    return true;
  }
});

export const vibelink = {
  entities: {
    Customer: createEntityClient('/api/customers'),
    ServicePlan: createEntityClient('/api/plans'),
    Invoice: createEntityClient('/api/invoices'),
    Payment: createEntityClient('/api/payments'),
    SupportTicket: createEntityClient('/api/tickets'),
    Mikrotik: createEntityClient('/api/mikrotiks'),
    VPNConfig: createEntityClient('/api/vpn/configs'),
    // These remain mock until implemented
    SLA: { list: async () => [] },
    SystemLog: { list: async () => [] },
    Tenant: { list: async () => [] },
    Role: { list: async () => [] },
    Hotspot: { list: async () => [] },
    Notification: { list: async () => [] },
    TicketNote: { list: async () => [] }
  },
  auth: {
    me: async () => JSON.parse(localStorage.getItem('vibelink_user')),
    login: async (e, p) => { /* Implement login in worker */ },
    logout: async () => localStorage.removeItem('vibelink_user')
  }
};

export const base44 = vibelink;
