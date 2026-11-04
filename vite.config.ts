import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // CSP is `font-src 'self'`: a font inlined as a data: URI would be blocked, so never inline assets.
    assetsInlineLimit: 0,
    // The merged knowledge base (~700 KB of JSON) is its own lazily loaded chunk (src/ui/data.ts loadKb), by design.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
