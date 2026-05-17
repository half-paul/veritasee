import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Default to the Node environment because everything in MVP scope (route
// handlers, lib/) is server-side. Component tests opt in per-file with
// `// @vitest-environment jsdom` once they land.
export default defineConfig({
  test: {
    name: 'web',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/*.smoke.test.ts', 'e2e/**'],
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      // Order matters: '@test' is more specific than '@', so it must come
      // first. Vitest matches aliases by prefix in declared order.
      '@test': resolve(__dirname, './test'),
      '@': resolve(__dirname, './src'),
    },
  },
});
