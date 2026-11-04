/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { serviceWorkerPlugin } from './vite-plugin-sw.ts';

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorkerPlugin()],
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
