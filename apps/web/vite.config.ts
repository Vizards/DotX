import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  server: {
    host: '127.0.0.1',
    proxy: Object.fromEntries(
      [
        '/admin/api',
        '/admin/login',
        '/admin/callback',
        '/admin/logout',
        '/oauth',
        '/health',
        '/setup',
        '/branding',
      ].map((path) => [path, { target: 'http://127.0.0.1:8787', changeOrigin: false }]),
    ),
  },
});
