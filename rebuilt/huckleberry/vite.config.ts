/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorkerPlugin } from './scripts/sw-plugin';

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorkerPlugin()],
  build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
