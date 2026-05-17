# Testing Guide

Veritasee uses **Vitest** for unit tests and **Playwright** for end-to-end tests. This document covers the conventions, how to add tests, and how to run the suite locally and in CI.

> **Source-of-truth PRD:** `.agents/PRDs/testing-strategy.md`

---

## TL;DR

```bash
pnpm test            # all unit tests (no secrets, <10s, runs on every PR)
pnpm test:watch      # unit tests in watch mode
pnpm test:coverage   # unit tests with v8 coverage reporter
pnpm test:smoke      # real-services tests — skipped when env vars absent
pnpm e2e             # Playwright suite against `next dev` (needs Clerk test env)
pnpm e2e:ui          # Playwright UI mode for debugging
```

---

## Two tracks

| Track   | Runner     | Where                                              | Network            | Secrets needed | Runs on every PR? |
|---------|------------|----------------------------------------------------|--------------------|----------------|-------------------|
| Unit    | Vitest     | `apps/web/src/**/*.test.ts`, `packages/*/test/**/*.test.ts` | Mocked (MSW + vi.mock) | No             | Yes               |
| Smoke   | Vitest     | `**/*.smoke.test.ts`                              | Real (Upstash/Neon/R2/MediaWiki) | Yes (skips when unset) | No — on demand |
| E2E     | Playwright | `apps/web/e2e/**/*.spec.ts`                       | Real `next dev` + Clerk test instance | Yes for auth flows | After CI lands  |

The split is **filename-based**:

- `*.test.ts` → unit (default `pnpm test` includes it)
- `*.smoke.test.ts` → smoke (excluded from `pnpm test`, included by `pnpm test:smoke`)
- `*.spec.ts` under `apps/web/e2e/` → Playwright

---

## Adding a unit test

### Library / pure logic

Colocate the test next to the source. Mock anything that talks over the network or to a managed service.

```ts
// apps/web/src/lib/url-validation/validateUrl.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('./resolveHost');

import { resolveHost } from './resolveHost';
import { validateUrl } from './validateUrl';

describe('validateUrl', () => {
  it('rejects RFC1918 IPv4 resolutions', async () => {
    vi.mocked(resolveHost).mockResolvedValue({ ok: true, addresses: ['10.0.0.1'] });
    const result = await validateUrl('https://internal.example.com');
    expect(result).toMatchObject({ ok: false, code: 'private_ip' });
  });
});
```

### Route handlers (`app/api/.../route.ts`)

Mock Clerk's `auth()` and any data clients. Use the `buildRequest` factory.

```ts
// apps/web/src/app/api/proxy/validate/route.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';
import { mockAuth } from '@test/factories/mockClerkAuth';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: null, sessionClaims: null })),
  currentUser: vi.fn(async () => null),
}));

import { POST } from './route';

it('401 when unauthenticated', async () => {
  await mockAuth({ userId: null });
  const res = await POST(buildRequest({ body: { url: 'https://en.wikipedia.org' } }));
  expect(res.status).toBe(401);
});
```

Every protected `/api/*` route gets, at minimum, one auth-required + one happy-path test.

### HTTP-mocked tests (MediaWiki, future LLM APIs)

Register handlers with **MSW**. The global setup runs with `onUnhandledRequest: 'error'` so any uncovered call fails loudly.

```ts
import { http, HttpResponse } from 'msw';
import { server } from '@test/msw/server';

server.use(
  http.get('https://en.wikipedia.org/w/api.php', () =>
    HttpResponse.json(mockMediaWikiParse({ revid: 12345 })),
  ),
);
```

### Component tests

Deferred until the reader UI lands. When they arrive, opt into jsdom per-file:

```ts
// @vitest-environment jsdom
```

---

## Adding a smoke test

Smoke tests hit real Upstash/Neon/R2/MediaWiki. The pattern is **skip-on-missing-env** so `pnpm test:smoke` on a clean clone is green-with-skips, not a hard failure.

```ts
// packages/redis/test/upstash.smoke.test.ts
import { describe, it } from 'vitest';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

describe('upstash redis smoke', () => {
  if (!url || !token) {
    it.skip('SET/GET/EXPIRE roundtrip (skipped: no upstash env)', () => {});
    return;
  }
  // ... real client calls
});
```

File suffix must be `.smoke.test.ts` or the smoke runner won't pick it up.

---

## Adding an e2e test

E2E specs live in `apps/web/e2e/` and use Playwright. The `playwright.config.ts` boots `next dev` and tears it down automatically.

```ts
// apps/web/e2e/anonymous.spec.ts
import { test, expect } from './fixtures';

test('protected /dashboard redirects anonymous users to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
});
```

Specs that require an authenticated session (`contributorPage`, `moderatorPage`, …) need a **Clerk test instance** with `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_TESTING_TOKEN` exported. The `hasClerkTestEnv` flag in `fixtures.ts` is the canonical check.

---

## Setting up a Clerk test instance

1. In the Clerk dashboard, create a **test instance** (separate from production).
2. Mark it as a **testing instance** so `@clerk/testing` accepts tokens.
3. Export the keys into `apps/web/.env.local` (already gitignored):
   ```
   CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   CLERK_TESTING_TOKEN=tk_test_...
   ```
4. Create test users for each role (`reader`, `contributor`, `moderator`, `admin`) and set their `publicMetadata.role`.
5. Document the credentials in 1Password (Veritasee → Testing → Clerk).

Never point e2e at the production Clerk instance.

---

## Mock factories

Reusable mocks live in `apps/web/test/factories/`. Import them via the `@test/*` alias:

| Factory                              | Purpose                                                          |
|--------------------------------------|------------------------------------------------------------------|
| `mockClerkAuth.ts` — `mockAuth(...)` | Configure `auth()` and `currentUser()` per test                  |
| `mockRedis.ts` — `createMockRedis()` | In-memory Upstash double (get/set/del/ttl/expire/incr/ping)     |
| `mockMediaWikiResponse.ts`           | Canonical MediaWiki API response + error builders               |
| `buildRequest.ts`                    | `NextRequest` builder with headers and JSON body                 |

Add to this directory rather than duplicating fixtures across files.

---

## Conventions

- **Test file naming:** unit `*.test.ts`, smoke `*.smoke.test.ts`, e2e `*.spec.ts`.
- **Colocation:** unit tests for `apps/web/src/lib/foo/bar.ts` live at `apps/web/src/lib/foo/bar.test.ts`. Tests for package code live under `packages/<name>/test/`.
- **No secrets in unit tests.** If a unit test needs `process.env.X`, it's misclassified — move it to `*.smoke.test.ts`.
- **Mock at the boundary, not inside the unit.** If a test of `validateUrl` mocks `validateUrl`'s callees rather than `validateUrl` itself, you're doing it right.
- **Tests are part of the change.** Every new `lib/` module or API route ships with a test in the same PR.
- **Tests assert observable behavior**, not internal call shape. The proxy-cache tests check "same URL → same key", not "`sha256` was called with these exact bytes".

---

## Running on a clean clone

```bash
git clone …
pnpm install
pnpm test       # → green, no secrets needed
```

If `pnpm test` requires env vars on a fresh clone, that's a bug — please file it.

---

## Coverage

`pnpm test:coverage` produces a v8 coverage report at `coverage/`. **No threshold is enforced for MVP** — coverage is a lagging indicator; the leading one is the critical-path checklist in the PRD. Thresholds become a Phase 4 (CI) decision once the baseline is mature.

---

## CI

CI integration is **deferred** to a follow-up ticket (PRD §12 Phase 4). When wired:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e` run on every PR.
- Playwright HTML report uploads on failure.
- The workflow is a required status check on `main`.

---

## Adding a regression test for a bug

When fixing a bug:

1. Write a failing test that reproduces it.
2. Land the fix and the test in the **same PR**.
3. Reference the test in the PR body so reviewers can verify it actually exercises the bug.

The "before/after" delta is the cheapest, highest-fidelity proof that a regression won't silently come back.
