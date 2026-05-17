// Smoke workspace — passed to vitest via `--workspace` so it replaces the
// default `vitest.workspace.ts`. Defines a single inline project that picks
// up every `*.smoke.test.ts` in the repo. Smoke files skip individually when
// their required env vars are absent, so a `pnpm test:smoke` run on a clean
// clone is green-with-skips, not a hard failure.
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'smoke',
      include: ['**/*.smoke.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
      testTimeout: 30_000,
    },
  },
]);
