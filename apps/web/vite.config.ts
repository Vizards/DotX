import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';

const target = 'http://127.0.0.1:8787';

const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  [
    '/admin/api',
    '/admin/auth',
    '/admin/logout',
    '/oauth',
    '/health',
    '/setup/info',
    '/setup/enroll',
    '/setup/admin/api',
    '/branding',
  ].map((path) => [path, { target, changeOrigin: false }]),
);

// Consent POSTs go to Server; the GET form of /authorize stays an SPA route.
proxy['/authorize'] = {
  target,
  changeOrigin: false,
  bypass: (request) => (request.method === 'POST' ? undefined : '/index.html'),
};

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  server: {
    host: '127.0.0.1',
    proxy,
  },
});
