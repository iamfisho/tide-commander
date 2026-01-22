import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Port configuration - can be overridden via environment variables
const SERVER_PORT = process.env.PORT || 5174;
const VITE_PORT = process.env.VITE_PORT || 5173;
const VITE_HOST = process.env.LISTEN_ALL_INTERFACES ? '0.0.0.0' : '127.0.0.1';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/packages/client'),
      '@shared': resolve(__dirname, 'src/packages/shared'),
      '@server': resolve(__dirname, 'src/packages/server'),
    },
  },
  server: {
    host: VITE_HOST,
    port: Number(VITE_PORT),
    proxy: {
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true,
      },
      '/uploads': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
