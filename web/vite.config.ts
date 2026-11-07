import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const version = (() => {
  try { return readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(); } catch { return '0.0.0'; }
})();

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8099' } },
  build: { outDir: 'dist', sourcemap: false },
});
