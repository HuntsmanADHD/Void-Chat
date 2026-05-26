import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Vite is the build/dev server for the Tauri webview. Next will be
 * removed at the end of the migration; until then the two coexist on
 * different ports (Next: 3000, Vite: 5173).
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
