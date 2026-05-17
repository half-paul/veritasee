// Vitest workspace — enumerates every package that has its own vitest.config so
// `pnpm test` (root) discovers and runs them all in one invocation. Per-package
// configs keep include/exclude rules, env, and aliases local to their package.
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './apps/web/vitest.config.ts',
  './packages/db/vitest.config.ts',
  './packages/redis/vitest.config.ts',
  './packages/storage/vitest.config.ts',
]);
