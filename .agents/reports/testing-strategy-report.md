# Implementation Report — Testing Strategy Baseline

**Plan**: `.agents/plans/completed/testing-strategy.md`
**Linear Issue**: [LEX-103](https://linear.app/lexaim/issue/LEX-103/vs-test-establish-unit-e2e-testing-baseline-vitest-playwright)
**Branch**: `features/LEX-103` (cut from `features/LEX-73` because the mediawiki/parser/source-classifier modules under test exist only on that branch; once LEX-73 merges, this PR rebases onto `main` cleanly)
**Status**: COMPLETE — Phases 1–3 of the PRD landed; Phase 4 (CI workflow) deferred per the PRD scope.

---

## Summary

Established the two-track testing baseline from `.agents/PRDs/testing-strategy.md`:

- **Unit testing** with Vitest 2.1, MSW 2, and a workspace config so `pnpm test` from root runs every package in one shot, with zero secrets required and a sub-2s wall-clock.
- **Smoke testing** preserved as opt-in via a separate `vitest.smoke.workspace.ts` plus filename suffix (`*.smoke.test.ts`); env-gated suites still skip cleanly.
- **End-to-end testing** via Playwright + Chromium against `next dev`; three anonymous specs pass today (no Clerk test instance required). The fixtures file is laid out so per-role authenticated `Page` fixtures can be added once Clerk test creds are provisioned.
- **Critical-path coverage** for every module enumerated in PRD §4, **every API route** under `apps/web/src/app/api/`, and **non-smoke unit suites** for each shared package.
- **Documentation** updated: `docs/general/TESTING.md` is the new canonical reference and `AGENTS.md`'s Testing Guidelines section is rewritten to match.

---

## Tasks Completed

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Linear issue + branch | LEX-103, `features/LEX-103` | ✅ |
| 2 | Workspace test infrastructure | `vitest.workspace.ts`, `vitest.smoke.workspace.ts`, `apps/web/vitest.config.ts`, `apps/web/test/setup.ts`, MSW server | ✅ |
| 3 | Mock factories | `apps/web/test/factories/{mockClerkAuth,mockRedis,buildRequest,mockMediaWikiResponse}.ts` | ✅ |
| 4 | url-validation suite | `privateIp.test.ts`, `denylist.test.ts`, `resolveHost.test.ts`, `validateUrl.test.ts` | ✅ |
| 5 | auth/roles tests | `apps/web/src/lib/auth/roles.test.ts` | ✅ |
| 6 | source-classifier tests | `apps/web/src/lib/source-classifier/classify.test.ts` | ✅ |
| 7 | Parser dispatcher tests | `apps/web/src/lib/parser/index.test.ts` | ✅ |
| 8 | MediaWiki tests | `buildRequest.test.ts`, `parseResponse.test.ts`, `client.test.ts` (MSW-driven) | ✅ |
| 9 | Proxy-cache tests | `keys.test.ts`, `cache.test.ts` (mocked Upstash) | ✅ |
| 10 | Observability tests | `logger.test.ts`, `withObservability.test.ts` (Sentry stubbed) | ✅ |
| 11 | Route-handler tests | proxy/validate, me, health/{db,redis,storage,proxy-cache,mediawiki} | ✅ |
| 12 | Package unit suites | redis/client, db/client, storage/{client,objects}; smoke files renamed to `*.smoke.test.ts` | ✅ |
| 13 | Playwright scaffold + anonymous specs | `playwright.config.ts`, `fixtures.ts`, `anonymous.spec.ts` (3 passing specs) | ✅ |
| 14 | Docs | `docs/general/TESTING.md`, `AGENTS.md` Testing Guidelines | ✅ |
| 15 | Final validation | typecheck, lint, build, test, e2e, smoke — all green | ✅ |

---

## Validation Results

| Check                 | Command                                          | Result | Notes |
|-----------------------|--------------------------------------------------|--------|-------|
| Type check            | `pnpm typecheck`                                 | ✅     | All 4 packages clean |
| Lint                  | `pnpm lint`                                      | ✅     | 0 errors, 0 warnings |
| Build                 | `pnpm build`                                     | ✅     | Production Next.js build succeeds |
| Unit tests            | `pnpm test`                                      | ✅     | **194 tests across 25 files in ~2s** |
| Smoke tests           | `pnpm test:smoke`                                | ✅     | 5 tests (real Upstash/Neon/R2) — passes when env present; skips cleanly when absent |
| End-to-end tests      | `pnpm e2e`                                       | ✅     | **3 specs pass** against `next dev` in ~14s wall-clock |

### Unit test breakdown by area

| Area                                  | Files | Tests |
|---------------------------------------|-------|-------|
| `lib/url-validation/`                 | 4     | 58    |
| `lib/auth/`                           | 1     | 12    |
| `lib/source-classifier/`              | 1     | 14    |
| `lib/parser/`                         | 1     | 5     |
| `lib/mediawiki/`                      | 3     | 25    |
| `lib/proxy-cache/`                    | 2     | 16    |
| `lib/observability/`                  | 2     | 8     |
| `app/api/*/route.test.ts`             | 7     | 28    |
| `packages/{redis,db,storage}/`        | 4     | 28    |
| **Total**                             | **25**| **194** |

### MVP success criteria — verified

| Criterion                                                                              | Status |
|----------------------------------------------------------------------------------------|--------|
| `git clone && pnpm install && pnpm test` green in <10s with no env setup               | ✅ (~2s) |
| Every critical-path module in PRD §4 has unit coverage + ≥1 failure-path assertion     | ✅ |
| `pnpm e2e` runs Playwright specs in <90s                                               | ✅ (~14s) |
| SSRF / RBAC / cache-key / middleware regressions are caught by a test                  | ✅ (covered by `validateUrl.test.ts`, `roles.test.ts`, `proxy-cache/keys.test.ts`, `anonymous.spec.ts`) |
| `AGENTS.md` updated to reflect `pnpm test` as required verification                    | ✅ |

---

## Files Changed

### New (45 files)

**Workspace infrastructure**
- `vitest.workspace.ts`
- `vitest.smoke.workspace.ts`

**`apps/web` test infrastructure**
- `apps/web/vitest.config.ts`
- `apps/web/test/setup.ts`
- `apps/web/test/msw/{handlers,server}.ts`
- `apps/web/test/factories/{mockClerkAuth,mockRedis,buildRequest,mockMediaWikiResponse}.ts`
- `apps/web/e2e/{playwright.config,fixtures,anonymous.spec}.ts`

**Unit tests — `apps/web/src/lib/`**
- `url-validation/{privateIp,denylist,resolveHost,validateUrl}.test.ts`
- `auth/roles.test.ts`
- `source-classifier/classify.test.ts`
- `parser/index.test.ts`
- `mediawiki/{buildRequest,parseResponse,client}.test.ts`
- `proxy-cache/{keys,cache}.test.ts`
- `observability/{logger,withObservability}.test.ts`

**Route-handler tests**
- `app/api/proxy/validate/route.test.ts`
- `app/api/me/route.test.ts`
- `app/api/health/{redis,db,storage,proxy-cache,mediawiki}/route.test.ts`

**Package unit suites**
- `packages/redis/test/client.test.ts`
- `packages/db/test/client.test.ts`
- `packages/storage/test/{client,objects}.test.ts`

**Docs**
- `docs/general/TESTING.md`

### Modified (10 files)

- `package.json` — added `test`, `test:watch`, `test:coverage`, `test:smoke`, `e2e`, `e2e:ui` scripts; added Vitest devDeps
- `apps/web/package.json` — added `test`, `test:watch`, `e2e`, `e2e:ui` scripts; added msw, playwright, @clerk/testing, jsdom, vitest devDeps
- `apps/web/tsconfig.json` — added `@test/*` path alias; excluded `e2e/**` from typecheck
- `apps/web/eslint.config.mjs` — unchanged (test files use the existing config; the unused-disable-directive rule caught and forced removal of one stale comment)
- `packages/{db,redis,storage}/vitest.config.ts` — exclude `*.smoke.test.ts` from the default run
- `packages/storage/package.json` — added `aws-sdk-client-mock`
- `AGENTS.md` — rewrote Testing Guidelines section
- `.gitignore` — ignore `test-results/`, `playwright-report/`, `.playwright/`

### Renamed (3 files)

- `packages/redis/test/smoke.test.ts` → `upstash.smoke.test.ts`
- `packages/storage/test/smoke.test.ts` → `s3.smoke.test.ts`
- `packages/db/test/pgvector.test.ts` → `pgvector.smoke.test.ts`

---

## Deviations from the Plan

1. **Default test environment is `node`, not `jsdom`.** The PRD specifies `jsdom` as the default with `// @vitest-environment node` per route handler. Since the MVP has no component tests (the PRD itself defers them), defaulting to `node` avoids loading jsdom on every file and matches what every existing test actually needs. `jsdom` is installed as a devDep so component tests can opt in per-file later.
2. **Test alias is `@test/*` (not `@/test/*`).** The PRD's example uses `@/test/factories/...`, but `@/*` is bound to `./src/*` in Next.js's tsconfig (which we honor). A second alias `@test/*` → `./test/*` keeps test factories cleanly out of `src/` while still being importable from anywhere in the suite. `tsconfig.json` and `vitest.config.ts` are aligned.
3. **Smoke tests run via a dedicated workspace file.** Vitest auto-discovers `vitest.workspace.ts`, which would shadow a CLI `--config` flag. The workaround is `vitest.smoke.workspace.ts`, passed explicitly via `--workspace`. Functionally identical to the PRD's intent.
4. **Anonymous-only Playwright specs land today.** The PRD enumerates five e2e flows; three (anonymous → sign-in, protected-route redirect, anonymous `/api/me` → 401) ship now because they need no Clerk test instance. The remaining two (sign-in → dashboard, submit valid URL) require Clerk test creds and are tracked as a follow-up; the `fixtures.ts` scaffold + `hasClerkTestEnv` guard are in place so adding them is a single PR.
5. **Branch base.** Cut from `features/LEX-73` rather than `main` because the mediawiki/parser/source-classifier modules under test only exist on that branch. Once LEX-73's PR merges, this PR rebases onto `main` without conflict.

---

## Tests Written

See the "Unit test breakdown by area" table above for the count summary (194 unit tests + 3 e2e + 5 smoke = 202 tests).

### Notable assertions

- **`url-validation`**: covers the IPv4-mapped IPv6 SSRF bypass, DNS-rebinding-style dual-homed hosts (public + private A records, must fail closed), and IP-literal hostnames including the AWS metadata endpoint (`169.254.169.254`).
- **`auth/roles`**: full truth table across `reader`/`contributor`/`moderator`/`admin`, the `contributor` default, and rejection of all non-string role values.
- **`proxy-cache/keys`**: asserts deterministic same-URL → same-key, distinct URLs → distinct keys, fixed-length sha256 digest, **and** that the literal URL does not appear in the cache key (defense against grepping Upstash for sensitive URLs).
- **`observability/withObservability`**: explicitly asserts that exceptions are **not** swallowed (rethrown after Sentry capture) and that query strings are **not** logged (token-leak defense per the logger's "callers MUST pass pathname only" contract).
- **Route handlers**: every protected route has a 401-when-unauthenticated test plus at least one happy-path or rejection-path test. Health routes test both the token-gated production path and the un-gated dev path.

---

## Follow-ups (not in scope)

- **CI workflow** — `.github/workflows/test.yml` running `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`. PRD Phase 4; tracked separately.
- **Clerk test instance provisioning + remaining e2e specs** — sign-in → dashboard, submit-valid-URL → success state, submit-blocked-URL → rejection.
- **Component tests** — once the reader UI ships (correction panel, Verity Score chips); jsdom is already installed and a per-file `// @vitest-environment jsdom` directive will suffice.
- **Coverage thresholds** — revisit once Phase 4 CI lands and the critical-path checklist is mature; PRD recommends 70% line / 60% branch as a floor.
