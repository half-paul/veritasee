# Veritasee Testing Strategy — Product Requirements Document

**Version:** 0.1 (Draft)
**Date:** 2026-05-16
**Owner:** Paul
**Status:** Initial draft pending review
**Scope:** Unit + e2e testing baseline for the Veritasee monorepo (`apps/web` + `packages/*`)

## Metadata

| Field | Value |
| :--- | :--- |
| Linear Issue | LEX-103 |
| Branch | `features/LEX-103` |

---

## 1. Executive Summary

Veritasee currently has **no test framework configured for the web app** and only one env-gated "smoke test" per shared package (`db`, `redis`, `storage`). `AGENTS.md` explicitly treats `pnpm lint`, `pnpm typecheck`, and `pnpm build` as the verification set. As the app surface area grows (proxy validation, URL/SSRF defense, source classification, MediaWiki client, parser dispatch, proxy cache, observability wrapper, RBAC), this gap has become the dominant source of regression risk.

This PRD defines a **two-track testing baseline**:

1. **Unit tests** (Vitest) covering critical library code in `apps/web/src/lib/` and expanding each shared package from a single smoke test to a real unit suite that mocks Upstash/Neon/S3/MediaWiki at the boundary.
2. **End-to-end tests** (Playwright + `@clerk/testing`) covering the few user-visible flows that exist today (sign-in, dashboard render, proxy URL validation) and ready to grow as the reader/contributor flows ship.

**MVP goal:** Make every PR runnable with `pnpm test` locally producing fast, deterministic, mock-based unit results, plus `pnpm e2e` running a small Playwright suite against `next dev`. Critical paths are enumerated and must be covered; **no global coverage threshold is enforced for MVP** — that lever is reserved for Phase 2.

---

## 2. Mission

Establish a testing baseline that catches regressions in the security- and correctness-sensitive code paths (URL validation/SSRF, RBAC, proxy cache keying, source classification, MediaWiki parsing) before they reach production, without slowing the inner loop or requiring secrets to run on every PR.

### Core principles

1. **Mock at the boundary, not inside the unit.** Unit tests mock Upstash/Neon/S3/MediaWiki clients, never the module under test. Existing real-service smoke tests live on as a separate `*.smoke.test.ts` suite that runs on demand.
2. **Critical paths first.** Coverage % is a lagging indicator; an enumerated list of must-cover flows is the leading one. No 80%-for-the-number tests.
3. **Deterministic by default.** No network, no real time (`vi.useFakeTimers()` where time matters), no env reliance. PR runs must pass on a clean clone with zero secrets.
4. **E2E is thin and load-bearing.** A small Playwright suite proves the auth + routing + middleware + Next.js build all wire together. We do not duplicate unit coverage at e2e level.
5. **Tests are part of the change.** Every new `lib/` module or API route ships with a test in the same PR. Adding a test for legacy code is welcome but never required to unblock unrelated work.

---

## 3. Target Users

| Persona | Description | Key needs from this PRD |
| :--- | :--- | :--- |
| **Contributor engineer (Paul, future hires)** | Building Veritasee features end-to-end. Needs fast feedback. | `pnpm test` runs in <10s locally; failures point at the file/line; no env setup. |
| **Reviewer (human or `/review`/`/ultrareview`)** | Validates correctness before merge. | Tests demonstrably exercise the claimed behavior, including failure paths. |
| **Future on-call** | Triages a Sentry incident or prod regression. | A failing test reproduces the bug in seconds; fix lands with a regression test attached. |

All readers of this PRD are technically expert; framing leans on existing conventions (Vitest, Playwright, vi.mock, MSW) rather than re-explaining them.

---

## 4. MVP Scope

### In Scope

**Core testing infrastructure**
- [ ] Root-level `pnpm test` script that runs Vitest across all workspaces in `--run` mode.
- [ ] Per-package Vitest configs already exist for `db`, `redis`, `storage`; add one for `apps/web` with React/Next-compatible test environment.
- [ ] Shared test-utilities package or `apps/web/test/` directory for fixtures, builders, and mock factories.
- [ ] Playwright config + `pnpm e2e` script that boots `next dev` against a Clerk test environment.
- [ ] Split smoke vs. unit by filename: `*.test.ts` = unit (always runs), `*.smoke.test.ts` = real-services (env-gated, runs on demand).

**Web app unit coverage (critical paths)**
- [ ] `apps/web/src/lib/url-validation/` — scheme/length, denylist, private-IP detection, DNS resolution behavior, full `validateUrl` orchestration. Includes adversarial inputs (IPv4-mapped IPv6, decimal-encoded IPs, redirect-host mismatches).
- [ ] `apps/web/src/lib/auth/roles.ts` — role precedence, missing-role defaults, RBAC predicate truth table.
- [ ] `apps/web/src/lib/source-classifier/` — host classification across MediaWiki, Britannica, Citizendium, generic, and edge cases (subdomains, ports, IDN).
- [ ] `apps/web/src/lib/parser/` — dispatcher routes to the correct parser per classification; unknown source falls back cleanly.
- [ ] `apps/web/src/lib/mediawiki/` — `buildRequest`, `parseResponse`, and `client` against fixture HTTP responses (MSW). Including error-shape responses, redirects, 429s.
- [ ] `apps/web/src/lib/proxy-cache/` — `keys` (key derivation determinism, collisions), `cache` (set/get/expire roundtrips against a mocked Upstash client).
- [ ] `apps/web/src/lib/observability/withObservability.ts` — wraps handlers, emits the right log events on success/failure, doesn't swallow exceptions.

**Web app route-handler coverage**
- [ ] `POST /api/proxy/validate` — auth required (401), invalid body (400), denylisted/private-IP (403), DNS failure (503), happy path (200 with normalized output).
- [ ] `GET /api/me` — returns the right role/profile shape; 401 when unauthenticated.
- [ ] Each `/api/health/*` route — returns degraded vs. healthy correctly based on mocked dependency state.

**Package unit coverage (harden existing smoke tests)**
- [ ] `@veritasee/redis` — promote `getRedis` initialization tests (env validation, singleton behavior) using a mocked `@upstash/redis` constructor. Keep `smoke.test.ts` as `smoke` suite.
- [ ] `@veritasee/db` — schema/query helper tests against a mocked Neon driver. Keep pgvector load test as `smoke`.
- [ ] `@veritasee/storage` — S3 client wiring, path/key conventions, signed URL generation against a mocked S3 client (`aws-sdk-client-mock` or hand-rolled). Keep smoke test as `smoke`.

**E2E coverage (Playwright)**
- [ ] Anonymous user visits `/` → sign-in CTA visible.
- [ ] Sign-in via Clerk test user → lands on `/dashboard`.
- [ ] Submit valid URL on dashboard → `/api/proxy/validate` returns success and UI reflects it.
- [ ] Submit blocked URL (private IP, denylisted) → UI shows the right rejection message.
- [ ] Protected route accessed without session → middleware redirects to sign-in.

### Out of Scope (Deferred)

- [ ] **Coverage thresholds in CI** — defer to Phase 2 once baseline is in place (see §12).
- [ ] **GitHub Actions wiring** — PRD documents the test commands and contracts; actually adding `.github/workflows/test.yml` is a follow-up ticket.
- [ ] **Visual regression / screenshot diffing** — defer until the reader UI lands.
- [ ] **Browser-extension tests** — extension isn't built yet.
- [ ] **Load / performance testing** — separate concern; covered by FR-VW-6 in the product PRD, not this one.
- [ ] **Contract tests against external APIs** (MediaWiki, OpenRouter) — the smoke-test layer covers this; full contract testing is a Phase 3 concern.
- [ ] **Mutation testing** (Stryker etc.) — not until coverage is meaningful.

---

## 5. User Stories

**US-1 — Fast inner loop.**
> As a contributor engineer, I want `pnpm test` to run all unit tests in under 10 seconds, so that I run them on every save without thinking about it.
> *Example:* I edit `validateUrl.ts` to add a new check; `pnpm --filter web test --watch` re-runs the 12 affected tests in <1s and shows me a red diff.

**US-2 — Test without secrets.**
> As a new contributor, I want unit tests to pass on a fresh clone with no `.env` configured, so that onboarding doesn't depend on getting access to Upstash/Neon/Clerk.
> *Example:* `git clone && pnpm install && pnpm test` is green on a machine with no Veritasee env vars.

**US-3 — Real-services smoke check on demand.**
> As an engineer cutting a release, I want to run the smoke suite (real Upstash/Neon/R2/MediaWiki) on demand, so that I catch integration drift before deploying.
> *Example:* `pnpm test:smoke` runs only `*.smoke.test.ts` and hits the staging Upstash project.

**US-4 — Regression captured on bug fix.**
> As a reviewer, I want bug-fix PRs to include a failing-then-passing test, so that the bug can't silently regress.
> *Example:* A PR titled "fix: IPv4-mapped IPv6 bypassed private-IP check" adds a test asserting `::ffff:10.0.0.1` is rejected.

**US-5 — E2E proves the wiring.**
> As an engineer changing middleware or auth, I want a Playwright run to fail if Clerk redirects or middleware route guards break, so that I find auth regressions before users do.
> *Example:* I tighten `middleware.ts` to require auth on `/dashboard/*`; the existing "anonymous redirect" e2e turns green.

**US-6 — Mock factories, not duplicated setup.**
> As an engineer adding the 6th MediaWiki test, I want a shared `mockMediaWikiResponse(...)` factory, so that I'm not pasting 40-line fixture objects into each file.
> *Example:* `import { mockEnPedia, mockEsPedia } from '@/test/fixtures/mediawiki'` covers 80% of cases.

**US-7 — Failing test in CI points to the line.**
> As a reviewer, I want test failures to surface the source file and line, so that I don't have to clone the PR locally to diagnose.
> *Example:* Vitest output shows `apps/web/src/lib/url-validation/privateIp.ts:42` with the actual vs. expected value.

**US-8 — Tests survive refactors of internals.**
> As an engineer refactoring `proxy-cache/keys.ts`, I want tests written against observable behavior, not internal call shape, so that refactors don't cascade into mock-updates.
> *Example:* The proxy-cache tests assert "same URL + revision → same key, different revision → different key," not "calls `sha256` with these exact bytes."

---

## 6. Core Architecture & Patterns

### 6.1 Directory layout

```
apps/web/
├── src/
│   ├── lib/
│   │   ├── url-validation/
│   │   │   ├── validateUrl.ts
│   │   │   ├── validateUrl.test.ts          ← unit, mocks resolveHost
│   │   │   ├── privateIp.ts
│   │   │   └── privateIp.test.ts            ← unit, pure
│   │   ├── mediawiki/
│   │   │   ├── client.ts
│   │   │   ├── client.test.ts               ← unit, MSW for HTTP
│   │   │   └── parseResponse.test.ts        ← unit, fixture-driven
│   │   └── ...
│   └── app/api/
│       ├── proxy/validate/
│       │   ├── route.ts
│       │   └── route.test.ts                ← unit, mocks auth() + validateUrl
│       └── ...
├── test/
│   ├── fixtures/
│   │   ├── mediawiki/                       ← captured real responses, sanitized
│   │   └── clerk/
│   ├── factories/
│   │   ├── mockRedis.ts
│   │   └── mockClerkAuth.ts
│   ├── msw/
│   │   ├── handlers.ts
│   │   └── server.ts                        ← node MSW server for unit tests
│   └── setup.ts                             ← Vitest setup file (global mocks, MSW lifecycle)
├── e2e/
│   ├── auth.spec.ts
│   ├── proxy-validate.spec.ts
│   ├── fixtures.ts                          ← Clerk test-user fixtures
│   └── playwright.config.ts
└── vitest.config.ts

packages/redis/
├── src/index.ts
├── test/
│   ├── client.test.ts                       ← unit, mocks @upstash/redis
│   └── smoke.test.ts                        ← existing, real Upstash
└── vitest.config.ts                         ← include both, gate smoke by env
```

### 6.2 Naming & file conventions

- **Unit tests:** `<source>.test.ts` colocated next to the file under test (`apps/web`) or under `test/` (packages, matching existing convention).
- **Smoke tests:** `<topic>.smoke.test.ts` — always env-gated, skipped when env unset (preserves the current pattern).
- **E2E specs:** `apps/web/e2e/<flow>.spec.ts`.
- **Fixtures:** `apps/web/test/fixtures/<domain>/<name>.json` for static fixtures; factory functions under `test/factories/` for parameterized ones.

### 6.3 Vitest config patterns

- Root `vitest.workspace.ts` enumerates each package and `apps/web` so `pnpm test` from root runs everything.
- Each package's `vitest.config.ts`:
  - `include: ['src/**/*.test.ts', 'test/**/*.test.ts']`
  - `exclude` adds `**/*.smoke.test.ts` (smoke runs via `pnpm test:smoke` with its own config).
- `apps/web/vitest.config.ts` uses `environment: 'jsdom'` for React component tests, `environment: 'node'` per-file (`// @vitest-environment node`) for route handlers.
- Path alias `@/` mirrors Next.js' `tsconfig.json` `paths` so imports work identically in tests and source.
- MSW server lifecycle in `test/setup.ts`: `beforeAll(server.listen)`, `afterEach(server.resetHandlers)`, `afterAll(server.close)`.

### 6.4 Mock-at-the-boundary rules

| Layer | What we mock | How |
| :--- | :--- | :--- |
| HTTP to external APIs (MediaWiki, OpenRouter, future LLMs) | `fetch` | MSW (`msw/node`) with per-test handler overrides. |
| Upstash Redis | `@upstash/redis` `Redis` constructor | `vi.mock('@upstash/redis', ...)` returning an in-memory object with `get/set/del/ttl/expire`. |
| Neon Postgres | `@neondatabase/serverless` `neon` | `vi.mock` returning a tagged-template function that resolves canned rows. |
| S3 / R2 | `@aws-sdk/client-s3` | `aws-sdk-client-mock` or hand-rolled `vi.mock`. |
| Clerk auth (unit) | `@clerk/nextjs/server` `auth()` | `vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(...) }))`. Factory in `test/factories/mockClerkAuth.ts`. |
| Clerk auth (e2e) | Not mocked — Clerk test users | `@clerk/testing` Playwright helpers + `CLERK_*_TEST_*` env. |
| Sentry | `@sentry/nextjs` | Stub `captureException`/`captureMessage` so assertions can verify "we logged the right thing" without sending. |
| Time | `Date`, `setTimeout` | `vi.useFakeTimers()` where TTLs/timestamps matter (proxy-cache, observability). |

### 6.5 Playwright patterns

- `playwright.config.ts` boots `next dev` on a random port via `webServer`. `reuseExistingServer: !process.env.CI`.
- Single browser project (Chromium) for MVP; Firefox/WebKit deferred.
- `@clerk/testing` provides `setupClerkTestingToken` and authenticated-session fixtures; we wrap them in `e2e/fixtures.ts` exposing `test.extend<{ readerUser, contributorUser, moderatorUser, adminUser }>`.
- Traces on first retry (`trace: 'on-first-retry'`); screenshots `only-on-failure`.
- All e2e specs idempotent — no shared mutable state across tests.

---

## 7. Tools / Features

### 7.1 `pnpm test` (root)

**Purpose:** Run all unit tests across the workspace, deterministically, with no secrets.

**Behavior:**
- Invokes Vitest in workspace mode (`vitest run`).
- Excludes `*.smoke.test.ts`.
- Reports per-package results; non-zero exit on any failure.
- Suitable for `pre-push` Git hook (not required at MVP).

**Outputs:** Vitest pretty-printed summary; JUnit XML when `VITEST_REPORTER=junit` is set (future CI hook).

### 7.2 `pnpm test:smoke`

**Purpose:** Run real-services tests against staging credentials. Used pre-release and during integration debugging.

**Behavior:**
- Loads `.env` via `scripts/with-env.mjs` (existing pattern).
- Runs only `**/*.smoke.test.ts`.
- Skips individual suites when their required env vars are absent (existing behavior).

### 7.3 `pnpm e2e`

**Purpose:** Playwright e2e suite against a live `next dev` instance.

**Behavior:**
- Spawns `next dev` on a free port, waits for ready, runs Playwright, tears down.
- Requires Clerk test instance env vars (`CLERK_TESTING_TOKEN`, test-user credentials) loaded via `scripts/with-env.mjs`.
- `pnpm e2e --ui` opens Playwright UI for local debugging.
- `pnpm e2e --update-snapshots` for any future snapshot updates.

### 7.4 Shared test utilities

- `apps/web/test/factories/mockClerkAuth.ts` — `mockAuth({ userId, role })` returns a mocked `auth()` result.
- `apps/web/test/factories/mockRedis.ts` — in-memory Redis double matching Upstash's surface for `get`, `set` (with `ex`/`nx`), `del`, `ttl`, `expire`, `incr`, `pipeline`.
- `apps/web/test/factories/mockMediaWikiResponse.ts` — builder for canonical MediaWiki API responses, with parameter knobs for known edge cases.
- `apps/web/test/factories/buildRequest.ts` — shorthand for constructing `NextRequest` instances with headers, body, and auth state.
- `apps/web/test/msw/handlers.ts` — default handlers for MediaWiki, Clerk webhooks (future), OpenRouter (future).

---

## 8. Technology Stack

### Unit testing

- **Runner:** `vitest@^2.1.0` (already used by packages — keep version pinned at workspace root)
- **DOM:** `jsdom` (for React component tests when they arrive)
- **HTTP mocking:** `msw@^2` (`msw/node` for Vitest)
- **AWS mocking:** `aws-sdk-client-mock@^4` for `@veritasee/storage`
- **React Testing Library** (deferred — no component tests in MVP scope; included here so the framework choice doesn't have to be re-litigated): `@testing-library/react`, `@testing-library/user-event`

### E2E testing

- **Runner:** `@playwright/test@^1.49`
- **Auth fixtures:** `@clerk/testing@latest` — official Clerk Playwright support
- **Browser:** Chromium only at MVP

### Tooling / dev dependencies

- `vitest`, `@vitest/coverage-v8` (installed but not enforced — used for local `pnpm test --coverage` introspection)
- `msw` + `@mswjs/data` (deferred)
- `@playwright/test`
- `@clerk/testing`
- `aws-sdk-client-mock`
- `@types/jsdom`

### Why these

- **Vitest over Jest** — every existing package already uses Vitest; consistency outweighs Jest's ecosystem size, and Vitest's speed (especially in watch mode) materially helps the inner loop.
- **MSW over `nock` or `vi.mock('node:fetch')`** — MSW handlers double as e2e-time mocks if we ever stub upstream APIs there, and they read closely to actual request/response shapes.
- **Playwright over Cypress** — `@clerk/testing` is first-class Playwright; Cypress + Clerk requires more workarounds. Playwright's parallelism and trace viewer are also better for CI debugging.
- **No Storybook/Chromatic** at MVP — no reusable component library yet to justify it.

---

## 9. Security & Configuration

### 9.1 Secrets & env

- **Unit tests must run with zero secrets.** Any unit test that requires a real env var is misclassified — convert it to a smoke test.
- **Smoke tests** continue the current `process.env[...]` + `it.skip` pattern. New smoke tests must follow the same skip-on-missing-env convention so a `pnpm test:smoke` run never hard-fails on absent config.
- **Playwright e2e** uses Clerk **test instance** credentials only — never production Clerk keys. Test-instance setup documented in `docs/general/TESTING.md` (new doc, part of this work).
- `.env.test` is gitignored; secrets live in 1Password / Vercel env (existing pattern).

### 9.2 Test-data safety

- Fixtures captured from real MediaWiki/Britannica responses are **sanitized** — strip user IDs, IPs, and any unbounded HTML — before being committed.
- No production data ever lands in fixture files. PRs touching fixtures must call this out explicitly.

### 9.3 In-scope (security)

- Adversarial inputs for `url-validation` (SSRF defense): IPv4-mapped IPv6, decimal/octal-encoded IPs, IPv6 link-local, `0.0.0.0`, AWS metadata host (`169.254.169.254`), DNS-rebinding-style mismatches between validation-time and fetch-time resolution.
- RBAC edge cases for `auth/roles.ts`: missing role, multiple roles, role precedence.
- Auth-required route handlers: every protected `/api/*` route gets at least one "no session → 401" test.

### 9.4 Out-of-scope (security)

- Pen-testing / dynamic security scans (handled separately by `/security-review`).
- Dependency vulnerability scanning (Dependabot or `pnpm audit` — separate concern).

---

## 10. API / Test Contract Specification

This section defines the **observable contract** of the testing infrastructure so future changes don't drift.

### 10.1 Script contract (`package.json` at workspace root)

| Script | Runs | Exit code semantics | Env required |
| :--- | :--- | :--- | :--- |
| `pnpm test` | All `*.test.ts` (excludes `*.smoke.test.ts`) | 0 = all green; >0 = at least one failure | none |
| `pnpm test:watch` | Same set, watch mode | n/a (interactive) | none |
| `pnpm test:smoke` | Only `*.smoke.test.ts` | 0 = all configured suites green; suites without env auto-skip | varies per suite |
| `pnpm e2e` | Playwright specs in `apps/web/e2e/` | 0 = all green | Clerk test instance env |
| `pnpm e2e:ui` | Same, UI mode | n/a | Clerk test instance env |
| `pnpm test:coverage` | Unit tests with v8 coverage reporter | 0 if tests pass (no threshold enforcement at MVP) | none |

### 10.2 Test file conventions

```ts
// apps/web/src/lib/url-validation/validateUrl.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateUrl } from './validateUrl';
import * as resolveHost from './resolveHost';

vi.mock('./resolveHost');

describe('validateUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects private IPv4 addresses', async () => {
    vi.mocked(resolveHost.resolveHost).mockResolvedValue({ ok: true, ip: '10.0.0.1' });
    const result = await validateUrl('https://internal.example.com/x');
    expect(result).toMatchObject({ ok: false, code: 'private_ip' });
  });

  it('rejects IPv4-mapped IPv6 addresses', async () => {
    vi.mocked(resolveHost.resolveHost).mockResolvedValue({ ok: true, ip: '::ffff:10.0.0.1' });
    const result = await validateUrl('https://internal.example.com/x');
    expect(result).toMatchObject({ ok: false, code: 'private_ip' });
  });
});
```

### 10.3 Route-handler test convention

```ts
// apps/web/src/app/api/proxy/validate/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';
import { mockAuth } from '@/test/factories/mockClerkAuth';
import { buildRequest } from '@/test/factories/buildRequest';

vi.mock('@clerk/nextjs/server');

describe('POST /api/proxy/validate', () => {
  it('401 when unauthenticated', async () => {
    mockAuth({ userId: null });
    const res = await POST(buildRequest({ body: { url: 'https://en.wikipedia.org' } }));
    expect(res.status).toBe(401);
  });

  it('403 when host is denylisted', async () => {
    mockAuth({ userId: 'user_123' });
    const res = await POST(buildRequest({ body: { url: 'https://malware.test/x' } }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'denylisted' });
  });
});
```

### 10.4 Playwright spec convention

```ts
// apps/web/e2e/proxy-validate.spec.ts
import { test, expect } from './fixtures';

test('contributor submits a valid URL and sees success state', async ({ contributorPage }) => {
  await contributorPage.goto('/dashboard');
  await contributorPage.getByLabel('Article URL').fill('https://en.wikipedia.org/wiki/Test');
  await contributorPage.getByRole('button', { name: 'Validate' }).click();
  await expect(contributorPage.getByText(/Validated/)).toBeVisible();
});
```

---

## 11. Success Criteria

### MVP success definition

Veritasee has a testing baseline such that:

1. A new contributor can `git clone && pnpm install && pnpm test` and see green in <10s with no env setup.
2. Every critical-path module listed in §4 has unit-test coverage, including at least one failure-path assertion.
3. `pnpm e2e` runs the listed flows in <90s against a local `next dev` instance.
4. A regression in `validateUrl` (SSRF bypass), `roles.ts` (RBAC), `proxy-cache/keys` (cache poisoning), or middleware (auth bypass) **cannot** merge without a test failing.
5. `AGENTS.md` is updated to reflect that `pnpm test` is the required verification set alongside lint/typecheck/build.

### Functional requirements checklist

- [ ] `pnpm test` exists at workspace root and runs all unit tests.
- [ ] `pnpm test:smoke` exists and runs only smoke tests.
- [ ] `pnpm e2e` exists and runs Playwright against `next dev`.
- [ ] Every module listed in §4 "Web app unit coverage" has a corresponding `.test.ts` file.
- [ ] Every API route in `apps/web/src/app/api/` has at least one auth + one happy-path test.
- [ ] Each shared package has a non-smoke unit suite alongside its existing smoke test.
- [ ] At least 5 Playwright specs covering the §4 e2e list.
- [ ] Shared mock factories exist for Clerk auth, Upstash Redis, MediaWiki responses, and `NextRequest`.
- [ ] `docs/general/TESTING.md` documents conventions, how to add a test, and how to set up Clerk test users.
- [ ] `AGENTS.md` "Testing Guidelines" section rewritten to match the new reality.

### Quality indicators

- Unit suite runtime (cold): **<10s** local, **<30s** CI.
- E2E suite runtime: **<90s** local, **<3min** CI.
- Flake rate target: **<1%** over the last 50 CI runs once CI lands.
- Time from "I want to add a test for X" to "I have a passing test asserting X" for a new contributor: **<5 minutes**.

### User-experience goals (developer-facing)

- Test output is readable and links to source. No 200-line stack traces from internal Vitest plumbing.
- Adding a new API route mechanically implies adding a test file from a template (documented in `TESTING.md`).
- Failures during PR review can be reproduced locally with a single command.

---

## 12. Implementation Phases

### Phase 1 — Infrastructure (Week 1)

**Goal:** Test scaffolding exists and runs, even if empty.

**Deliverables:**
- [ ] `pnpm test`, `pnpm test:smoke`, `pnpm test:coverage` scripts wired at root.
- [ ] `vitest.workspace.ts` enumerates packages + `apps/web`.
- [ ] `apps/web/vitest.config.ts` with jsdom env, path aliases, MSW setup file.
- [ ] `apps/web/test/setup.ts` with MSW lifecycle hooks.
- [ ] Rename existing `smoke.test.ts` files in packages to `*.smoke.test.ts`; update each package's `vitest.config.ts` to exclude them from the default run.
- [ ] Skeleton mock factories: `mockClerkAuth`, `mockRedis`, `buildRequest`.
- [ ] Playwright installed; `apps/web/e2e/playwright.config.ts`; Clerk test fixtures stub (no live test yet).
- [ ] `docs/general/TESTING.md` first cut.
- [ ] `AGENTS.md` testing section updated.

**Validation:** `pnpm test` runs and reports "0 tests found" cleanly; `pnpm test:smoke` runs the existing smoke tests; `pnpm e2e` boots `next dev` and reports "0 specs."

### Phase 2 — Critical-path coverage (Weeks 2–3)

**Goal:** Every module enumerated in §4 has a test.

**Deliverables:**
- [ ] `url-validation/` full suite (validateUrl, privateIp, denylist, resolveHost) — highest priority due to SSRF risk.
- [ ] `auth/roles.ts` truth-table tests.
- [ ] `source-classifier/` host classification tests.
- [ ] `parser/` dispatcher tests.
- [ ] `mediawiki/` (buildRequest, parseResponse, client with MSW).
- [ ] `proxy-cache/` (keys + cache against mocked Upstash).
- [ ] `observability/withObservability.ts` wrapper tests.
- [ ] All API route handler tests (auth + happy path + 1 failure path each).
- [ ] Package unit suites for `redis`, `db`, `storage` (mocked clients).

**Validation:** Removing any line of code from `validateUrl.ts`, `roles.ts`, `proxy-cache/keys.ts`, or `source-classifier/classify.ts` causes at least one test to fail. (Spot-check, not enforced mutation testing.)

### Phase 3 — E2E baseline (Week 4)

**Goal:** Playwright suite covers the listed flows against a Clerk test instance.

**Deliverables:**
- [ ] Clerk test instance provisioned; credentials stored in env management (Vercel + 1Password).
- [ ] `e2e/fixtures.ts` exposing per-role authenticated `Page` fixtures.
- [ ] 5 specs from §4 e2e list passing locally.
- [ ] `TESTING.md` updated with Clerk test instance setup steps.

**Validation:** Tampering with `middleware.ts` to remove auth gating causes the relevant e2e to fail.

### Phase 4 — CI integration & hardening (Week 5, deferred follow-up)

**Goal:** Tests run on every PR; observability for flakiness.

**Deliverables (separate ticket, not part of MVP closure but recorded here):**
- [ ] `.github/workflows/test.yml` running `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e` on PRs.
- [ ] Playwright HTML report uploaded as artifact on failure.
- [ ] Required-status-check on `main` for the test workflow.
- [ ] Decision point on whether to enforce a coverage threshold; if yes, configure `@vitest/coverage-v8` thresholds and document the rationale.

**Validation:** PRs cannot merge without test workflow green; flake rate visible in workflow history.

---

## 13. Future Considerations

- **Coverage gates.** Once §4's critical paths are covered, revisit whether a numeric threshold (line/branch on `apps/web/src/lib/`, `apps/web/src/app/api/`, and `packages/*/src/`) helps catch drift. Likely 70% line / 60% branch as a floor, not a target.
- **Component tests (React Testing Library).** Begin once the reader UI lands (correction panel, Verity Score chips). Until then, components are too thin or too in-flux to justify the cost.
- **Visual regression** for the reader/extension UI once it stabilizes.
- **Contract tests** against MediaWiki / Britannica / OpenRouter recording real responses periodically (pact-style) — surfaces upstream schema drift.
- **Mutation testing** (Stryker) once coverage is meaningful — catches assertion weakness.
- **Property-based testing** (fast-check) for `url-validation` and `proxy-cache/keys` — the input spaces are fuzz-friendly.
- **Performance budgets** in CI — assert on p95 of e2e test wall-clock and on cold proxy-fetch latency (FR-VW-6 in the product PRD).
- **Browser-extension testing** once the extension exists — Playwright supports loading extensions via Chromium.
- **Accessibility** (`@axe-core/playwright`) baked into e2e once any meaningful UI ships.

---

## 14. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| :--- | :--- | :--- | :--- |
| **Mocks drift from reality** — unit tests pass while real Upstash/MediaWiki behavior diverges. | Medium | High | Keep smoke suite green pre-release; capture real fixtures into `test/fixtures/` and refresh them quarterly; surface schema mismatches via TypeScript types pulled from the real client libraries. |
| **E2E flakiness erodes trust** — flaky Playwright tests get muted, then ignored. | High | Medium | Strict patterns: no shared state across specs; `await expect(...).toBeVisible()` over arbitrary `waitFor`; retries=1 in CI with trace-on-retry; any spec failing twice in a week is quarantined and triaged within 24h. |
| **Clerk test-instance dependency** — e2e suite depends on Clerk's test environment availability and on test-user credential rotation. | Medium | Medium | Document the test instance setup in `TESTING.md`; gate `pnpm e2e` on a single env var check that prints a helpful error if unset; revisit per-PR e2e if Clerk test instances are too rate-limited (fall back to fewer specs, or to a mocked Clerk middleware for the cheapest checks). |
| **Critical-path list rots** — §4 enumerates today's modules; new code lands without tests because the list isn't updated. | Medium | High | Enforce via review: any new file in `apps/web/src/lib/**/!(*.test).ts` or `apps/web/src/app/api/**/route.ts` without an adjacent `.test.ts` fails review by default. Codify in `AGENTS.md` and in `/review`/`/ultrareview` checklists. |
| **Inner-loop slowdown** — test suite grows past 10s and engineers stop running it. | Low (initially) | Medium | Vitest `--changed` and watch mode keep effective time low; profile slow tests with `--reporter=verbose --slow`; budget any single test file at <300ms or move heavy work to smoke. |

---

## 15. Appendix

### 15.1 Related documents

- **Product PRD:** `docs/PRD.md` — Veritasee Override v0.1
- **Repository guidelines:** `AGENTS.md` (will be updated as part of this work)
- **ADRs touched indirectly:**
  - `docs/adr/0001-managed-auth.md` (Clerk) — informs e2e auth approach
  - `docs/adr/0002-postgres-orm.md` (Neon + Drizzle) — informs DB mocking strategy
  - `docs/adr/0003-vercel-deployment.md` — informs CI workflow design (Phase 4)
  - `docs/adr/0004-observability-baseline.md` — informs observability assertions in handler tests

### 15.2 Key dependencies (to be added)

| Package | Version | Where |
| :--- | :--- | :--- |
| `vitest` | `^2.1.0` (pin existing) | root devDep (workspace-wide) |
| `@vitest/coverage-v8` | `^2.1.0` | root devDep |
| `jsdom` | `^25` | `apps/web` devDep |
| `msw` | `^2` | `apps/web` devDep |
| `@playwright/test` | `^1.49` | `apps/web` devDep |
| `@clerk/testing` | latest stable | `apps/web` devDep |
| `aws-sdk-client-mock` | `^4` | `packages/storage` devDep |

### 15.3 Open questions (to resolve during Phase 1)

1. Do we want to introduce a top-level `@veritasee/test-utils` package now, or wait until duplication justifies it? (Default: wait; keep utilities under `apps/web/test/`.)
2. For `db` unit tests against mocked Neon: do we accept hand-rolled `vi.mock` shims, or pull in a lightweight in-memory pg implementation (e.g., `pg-mem`)? (Default: hand-rolled until pain emerges.)
3. Sentry assertions: do we assert on exact event payloads (brittle) or only "captureException was called with an Error matching /pattern/"? (Default: the latter.)
4. Should `pnpm test` block on a pre-push hook? (Default: no for MVP; revisit with Phase 4.)

### 15.4 Out-of-band reminders

- The product PRD (`docs/PRD.md`) and `AGENTS.md` both pre-date this work and contain language ("No dedicated test framework is configured yet") that becomes inaccurate once this lands. Updating them is part of the MVP scope (§11 functional requirements checklist).
