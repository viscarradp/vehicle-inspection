import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // host:true binds 0.0.0.0 so the dev server is reachable from outside the
    // container; harmless for native dev. Polling is enabled only when
    // CHOKIDAR_USEPOLLING is set (bind-mounted source on Docker Desktop/Windows
    // doesn't propagate native fs events reliably).
    host: true,
    allowedHosts: true,
    watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === 'true' },
    proxy: {
      '/api': {
        // Native dev → localhost:3001; in the dev container → the backend
        // service (VITE_PROXY_TARGET=http://backend:3001).
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
