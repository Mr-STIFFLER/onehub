import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.ONEHUB_SERVER ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': target,
      '/gateway': { target: target.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { target: 'es2021', chunkSizeWarningLimit: 900 },
});
