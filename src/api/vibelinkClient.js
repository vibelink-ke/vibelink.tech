import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
});

// Interceptor to attach JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vibelink_jwt_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const buildEntityMethods = (name) => ({
  list: async () => {
    const res = await api.get(`/entities/${name}`);
    return res.data;
  },
  create: async (data) => {
    const res = await api.post(`/entities/${name}`, data);
    return res.data;
  },
  update: async (id, data) => {
    const res = await api.put(`/entities/${name}/${id}`, data);
    return res.data;
  },
  delete: async (id) => {
    const res = await api.delete(`/entities/${name}/${id}`);
    return res.data;
  },
  filter: async () => {
    // Stub definition based on mockData
    const res = await api.get(`/entities/${name}`);
    return res.data;
  },
  subscribe: () => () => {},
});

export const vibelink = {
  entities: {
    Customer: buildEntityMethods('Customer'),
    ServicePlan: buildEntityMethods('ServicePlan'),
    Invoice: buildEntityMethods('Invoice'),
    Payment: buildEntityMethods('Payment'),
    SupportTicket: buildEntityMethods('SupportTicket'),
    TicketNote: buildEntityMethods('TicketNote'),
    SLA: buildEntityMethods('SLA'),
    SystemLog: buildEntityMethods('SystemLog'),
    Tenant: buildEntityMethods('Tenant'),
    Mikrotik: buildEntityMethods('Mikrotik'),
    Role: buildEntityMethods('Role'),
    Hotspot: buildEntityMethods('Hotspot'),
    Notification: buildEntityMethods('Notification'),
  },
  auth: {
    login: async (email, password) => {
      const res = await api.post('/auth/login', { email, password });
      localStorage.setItem('vibelink_jwt_token', res.data.token);
      return res.data.user;
    },
    me: async () => {
      const res = await api.get('/auth/me');
      return res.data;
    },
    updateMe: async (data) => {
      const res = await api.put('/auth/me', data);
      return res.data;
    },
    logout: async () => {
      localStorage.removeItem('vibelink_jwt_token');
      window.location.href = '/login';
    },
    redirectToLogin: () => {
      window.location.href = '/login';
    }
  },
  functions: {
    invoke: async (name, params) => {
      const res = await api.post('/functions/invoke', { name, params });
      return res.data;
    }
  },
  appLogs: {
    logUserInApp: async (pageName) => {
      await api.post('/appLogs/logUserInApp', { pageName });
      return true;
    }
  }
};

export const base44 = vibelink;
