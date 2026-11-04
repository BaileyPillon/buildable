import { defineConfig } from 'vitest/config';
import { cspMetaPlugin, swPlugin } from './scripts/sw-plugin.ts';

// base './' makes every URL relative, so the build works from any sub-path
// (Cloudflare Pages root, GitHub Pages /repo/, or /rebuilt/adobe-acrobat-pro/).
export default defineConfig({
  base: './',
  plugins: [cspMetaPlugin(), swPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
