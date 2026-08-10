import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Express backend resolves the tenant from the request hostname
// (tenantByHost -> subdomain), so proxied calls carry an explicit Host header.
const API = process.env.VITE_API_ORIGIN ?? 'http://localhost:8080';
const TENANT_HOST = process.env.VITE_TENANT_HOST ?? 'demo.billing.co.ke';

const proxy = Object.fromEntries(
  ['/api', '/portal', '/radius', '/webhooks'].map((p) => [
    p,
    {
      target: API,
      changeOrigin: true,
      headers: { Host: TENANT_HOST },
    },
  ])
);

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
});
