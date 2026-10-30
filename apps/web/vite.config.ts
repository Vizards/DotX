import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';

const target = 'http://127.0.0.1:8787';

const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  [
    '^/(?:\\?|$)',
    '/admin/api',
    '/admin/auth',
    '/admin/logout',
    '/oauth',
    '/.well-known',
    '/mcp',
    '/health',
    '/setup/info',
    '/setup/enroll',
    '/setup/admin/api',
    '/branding',
  ].map((path) => [path, { target, changeOrigin: false }]),
);

proxy['/device/connect'] = { target, changeOrigin: false, ws: true };

// Server creates the OAuth transaction before Vite renders its approval page.
proxy['/authorize'] = {
  target,
  changeOrigin: false,
  bypass: (request) =>
    ['GET', 'HEAD'].includes(request.method ?? '') &&
    new URL(request.url ?? '/', 'http://localhost').searchParams.has('transaction')
      ? '/index.html'
      : undefined,
};

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  server: {
    host: 'localhost',
    proxy,
  },
});
