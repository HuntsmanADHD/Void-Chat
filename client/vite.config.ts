import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events'],
      exclude: ['crypto'],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Tauri expects a fixed port in dev
  server: {
    port: 1420,
    strictPort: true,
  },
  // For Tauri — don't open browser, clear screen
  clearScreen: false,
  // Env prefix for client-side env vars
  envPrefix: ['VITE_'],
  build: {
    // Tauri uses Chromium on Windows/Linux and WebKit on macOS
    target: ['es2021', 'chrome100', 'safari13'],
    // Don't inline assets smaller than 4kb — Tauri handles assets
    assetsInlineLimit: 0,
    outDir: 'dist',
  },
});
