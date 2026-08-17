import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Express backend resolves the tenant from the request hostname
// (tenantByHost -> subdomain), so proxied calls carry an explicit Host header.
const API = process.env.VITE_API_ORIGIN ?? 'http://localhost:8080';
const TENANT_HOST = process.env.VITE_TENANT_HOST ?? 'demo.vibelink.tech';

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
  build: {
    rollupOptions: {
      output: {
        /**
         * React and the router in their own chunk.
         *
         * They change only when a dependency is upgraded, so a browser that has
         * them keeps them across every deploy — while the app chunk, which
         * changes constantly, is the only thing re-downloaded.
         */
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/leaflet')) return 'leaflet';
        },
      },
    },
  },
  plugins: [react()],
  server: { port: 5173, proxy },
});
