# Implementation Report: LEX-67 (VS-005) — Provision S3-compatible object store

**Plan**: `.agents/plans/completed/lex-67-s3-object-store.plan.md`
**Branch**: `features/LEX-67` (cut from `features/LEX-66` because the plan mirrors the redis package introduced in LEX-66; LEX-66 is committed locally but not yet merged)
**Status**: COMPLETE — code written; **automated validation NOT run locally** (no `node`/`pnpm` on PATH in implementation env). Validation must be run by the user before opening the PR; full command list below.

## Summary

Adds a new `@veritasee/storage` workspace package that wraps the AWS SDK v3 `S3Client` behind a lazy Proxy, mirroring `@veritasee/redis` and `@veritasee/db`. Exposes `putObject` / `getObject` / `deleteObject` / `headBucket` helpers, a typed `S3Client` re-export, and an `applyUnanchoredLifecycle()` function that configures `snapshots/unanchored/` to expire after 1 day (the S3/R2 minimum granularity that satisfies LEX-67 AC#2's "24h expiry"). Wires `apps/web` to consume the package via a new `/api/health/storage` route that calls `HeadBucket` (Node-runtime only). Adds env vars (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`) to `apps/web/.env.example`, plus `storage:test` and `storage:apply-lifecycle` root convenience scripts.

The implementation incorporates all four pre-implementation review fixes from `.agents/reviews/lex-67-review.md` — see "Deviations from Plan" below.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Manifest + configs | `packages/storage/{package.json,tsconfig.json,vitest.config.ts,eslint.config.mjs}` | ✅ |
| 2 | env helpers | `packages/storage/src/env.ts` | ✅ |
| 2b | load-env (defensive belt-and-braces, mirrors db) | `packages/storage/src/load-env.ts` | ✅ |
| 3 | Lazy Proxy S3 client | `packages/storage/src/client.ts` | ✅ |
| 4 | Object helpers + headBucket | `packages/storage/src/objects.ts` | ✅ |
| 5 | Lifecycle helper + bootstrap script | `packages/storage/src/lifecycle.ts`, `packages/storage/scripts/apply-lifecycle.ts` | ✅ |
| 6 | Barrel export | `packages/storage/src/index.ts` | ✅ |
| 7 | Smoke test | `packages/storage/test/smoke.test.ts` | ✅ |
| 8 | env.example block | `apps/web/.env.example` | ✅ |
| 9 | apps/web dep | `apps/web/package.json` | ✅ |
| 10 | health route | `apps/web/src/app/api/health/storage/route.ts` | ✅ |
| 11 | Root scripts | `package.json` | ✅ |
| 12 | AGENTS.md note | `AGENTS.md` | ✅ |

## Validation Results

| Check | Result | Notes |
|-------|--------|-------|
| `pnpm install` | ⚠ NOT RUN | No `pnpm` on PATH in this environment. `pnpm-lock.yaml` was NOT regenerated. The user must run `pnpm install` locally to fetch `@aws-sdk/client-s3` (`^3.700.0`) and update the lockfile before opening the PR. |
| `pnpm typecheck` | ⚠ NOT RUN | Same reason. |
| `pnpm lint` | ⚠ NOT RUN | Same reason. |
| `pnpm build` | ⚠ NOT RUN | Same reason. |
| `pnpm storage:test` | ⚠ NOT RUN | Requires live S3/R2 creds; design choice is `it.skip` when env unset. |

**To run all checks locally:**

```bash
pnpm install                    # regenerates pnpm-lock.yaml with @aws-sdk/client-s3
pnpm typecheck                  # all workspaces
pnpm lint
pnpm build                      # apps/web build must succeed with new health route
pnpm --filter @veritasee/storage test          # smoke test (skips cleanly if env unset)
pnpm storage:apply-lifecycle    # one-shot lifecycle apply (idempotent)

# Existing checks must remain green:
pnpm --filter @veritasee/db test
pnpm --filter @veritasee/redis test

# Manual end-to-end: dev server + health probes
pnpm dev
# curl http://localhost:3000/api/health/storage  -> {"ok":true}
```

End-to-end verification (`pnpm dev` + curl) is also gated on local creds and must be performed by the user.

## Files Changed

| File | Action |
|------|--------|
| `packages/storage/package.json` | CREATE |
| `packages/storage/tsconfig.json` | CREATE (includes `scripts/**/*` per pre-review fix #1) |
| `packages/storage/vitest.config.ts` | CREATE |
| `packages/storage/eslint.config.mjs` | CREATE |
| `packages/storage/src/env.ts` | CREATE |
| `packages/storage/src/load-env.ts` | CREATE (per pre-review fix #2) |
| `packages/storage/src/client.ts` | CREATE |
| `packages/storage/src/objects.ts` | CREATE |
| `packages/storage/src/lifecycle.ts` | CREATE |
| `packages/storage/src/index.ts` | CREATE |
| `packages/storage/scripts/apply-lifecycle.ts` | CREATE |
| `packages/storage/test/smoke.test.ts` | CREATE |
| `apps/web/package.json` | UPDATE (+1 dep) |
| `apps/web/src/app/api/health/storage/route.ts` | CREATE |
| `apps/web/.env.example` | UPDATE (+13 lines) |
| `package.json` (root) | UPDATE (+2 scripts) |
| `AGENTS.md` | UPDATE (single sentence in opening paragraph) |

`pnpm-lock.yaml` was **not** regenerated (no pnpm on PATH); user must run `pnpm install` locally.

## Deviations from Plan

All deviations are **improvements** that incorporate the four pre-implementation review fixes from `.agents/reviews/lex-67-review.md`. None are regressions.

1. **Pre-review High #1 — `tsconfig.json` includes `scripts/**/*`.** The plan as updated already specified this (mirroring `packages/db/tsconfig.json`). Implemented as specified.

2. **Pre-review High #2 — `packages/storage/src/load-env.ts` added** and called at the top of `apply-lifecycle.ts`. The plan as updated already specified this. Implemented as specified.

3. **Pre-review Medium #3 — phantom dep avoided.** Plan said the health route imports `HeadBucketCommand` directly from `@aws-sdk/client-s3`. Instead, I added a `headBucket()` helper to `packages/storage/src/objects.ts` and re-exported it from the barrel; the health route imports `headBucket` from `@veritasee/storage` only. `apps/web/package.json` does **not** declare `@aws-sdk/client-s3` as a dep — only `@veritasee/storage` owns it. Cleaner; matches db/redis precedent of opaque package boundaries.

4. **Pre-review Medium #4 — `getObject` Body undefined-guard.** Implemented as `if (!response.Body) throw new Error(\`getObject ${key}: empty body\`);` with no non-null assertion. Strict-mode compatible.

5. **Pre-review Medium #6 — permissive boolean parsing for `S3_FORCE_PATH_STYLE`.** Added a `parseBool()` helper in `client.ts` that accepts `true`/`1`/`yes` (case-insensitive). Misconfiguration via `"True"` no longer silently becomes `false`.

6. **Pre-review Medium #7 — health route returns SDK status code on error.** When the caught error has `$metadata.httpStatusCode` (set by AWS SDK v3 on all responses), the route includes it in the body as `{ ok: false, error, status }`. Operators can distinguish 403 (creds wrong) from 404 (bucket name wrong) without reading server logs.

7. **Pre-review Low #10 — Node-runtime constraint documented.** `packages/storage/src/client.ts` opens with a one-line comment: "Node-only: do not import from Edge-runtime routes."

8. **Smoke test cleanup hardened.** `afterAll` wraps `deleteObject` in a try/catch so the test still passes if Test 2 (which deletes the key) ran successfully — a subsequent delete in afterAll would otherwise throw NoSuchKey. The lifecycle policy is the safety net for any actual leaks.

9. **Lifecycle prefix exported as `UNANCHORED_PREFIX` constant.** Single source of truth for `'snapshots/unanchored/'`; reused by the bootstrap script's log line. Minor structural improvement; not in plan.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `packages/storage/test/smoke.test.ts` | (1) PUT then GET roundtrip — asserts UTF-8 decoded body equals `'ok'`. (2) DELETE then GET — asserts `getObject` rejects after delete. |

The smoke test follows the env-gated `it.skip` pattern from `packages/redis/test/smoke.test.ts`: when any of the five required `S3_*` vars are unset, both tests are skipped with a `console.warn`. CI without bucket creds is unaffected.

## Acceptance-Criteria Mapping (LEX-67)

- **AC#1** "Given creds, when calling the SDK, then we can put/get/delete a test object." → covered by `packages/storage/test/smoke.test.ts`. Run via `pnpm storage:test` against a real bucket.
- **AC#2** "Given a lifecycle policy, when configured, then unanchored snapshot prefix has 24h expiry." → covered by `packages/storage/src/lifecycle.ts` + `scripts/apply-lifecycle.ts`. Run via `pnpm storage:apply-lifecycle`. Day-bucketed semantics are documented in `lifecycle.ts` and the pre-review.

## Known Follow-ups

- **`pnpm-lock.yaml` regeneration**: user must run `pnpm install` locally; the lockfile is intentionally not in this commit because pnpm wasn't available in the implementation environment.
- **Bucket + IAM provisioning**: per the plan, this is operational, not code. The bootstrap script applies the *policy*; the bucket itself must be created in the provider console (Cloudflare R2 or AWS S3) with an access-key pair scoped to it.
- **VS-026 (snapshot persistence)**: this issue blocks VS-026; the storage package is the dependency it was waiting on.

## Linear

To be updated by the wrap-up: move LEX-67 to `In Review` once the PR is opened, post implementation comment.
