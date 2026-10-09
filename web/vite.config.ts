import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

// The web app reuses the mobile app's pure TypeScript (money math, budget
// and cashflow stats, categories) straight from the repo root via `@app`.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@app': path.resolve(__dirname, '..') } },
  server: { fs: { allow: ['..'] } },
});
