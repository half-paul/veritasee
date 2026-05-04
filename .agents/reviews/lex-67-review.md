# Code Review: LEX-67 (VS-005) — Provision S3-compatible object store

**Scope**: `.agents/plans/lex-67-s3-object-store.plan.md` (no implementation committed yet — branch `features/LEX-66`, no `packages/storage/` directory, no LEX-67 commits or PR)
**Recommendation**: NEEDS WORK (plan changes) — fix two High-priority gaps before `/implement`

## Summary

LEX-67 is currently a plan only — no code, no branch, no PR. The plan adds a new `@veritasee/storage` workspace package wrapping `@aws-sdk/client-s3` behind a lazy Proxy, mirroring `@veritasee/redis` and `@veritasee/db`. It also adds an `/api/health/storage` route and a one-shot `apply-lifecycle.ts` runner that configures a 1-day expiration on `snapshots/unanchored/`. The structure faithfully follows existing patterns, but two consistency gaps with the `packages/db` precedent will cause concrete failures, plus a few smaller hardening items.

## Issues Found

### Critical

None.

### High Priority

1. **Plan's `tsconfig.json` excludes `scripts/**` — `apply-lifecycle.ts` won't be typechecked**
   - **Where**: Task 1 of the plan ("`tsconfig.json`: copy `packages/redis/tsconfig.json:1-12` verbatim").
   - **Problem**: `packages/redis/tsconfig.json:10` includes only `["src/**/*", "test/**/*", "vitest.config.ts"]`. But `packages/storage` will have a `scripts/apply-lifecycle.ts` file. `packages/db/tsconfig.json:10` already shows the right shape: `["src/**/*", "drizzle.config.ts", "scripts/**/*", "test/**/*", "vitest.config.ts"]`. Copying redis's tsconfig verbatim means the runner script is never type-checked; type errors in it will only surface at runtime when someone runs `pnpm storage:apply-lifecycle` against a live bucket.
   - **Recommendation**: Mirror `packages/db/tsconfig.json` (not redis's) since storage has scripts. Add `"scripts/**/*"` to `include`.

2. **`apply-lifecycle.ts` doesn't mirror the `loadEnv()` defensive pattern from `migrate.ts`**
   - **Where**: Task 5 ("`scripts/apply-lifecycle.ts`: tsx-runnable file ... Mirror the structure of `packages/db/scripts/migrate.ts`").
   - **Problem**: `packages/db/scripts/migrate.ts:1-7` calls `loadEnv()` from `../src/load-env` *inside* the script. The `with-env.mjs` wrapper does the same job in normal use, but the `loadEnv()` call is belt-and-braces: it ensures the script works when invoked directly (e.g. `tsx packages/storage/scripts/apply-lifecycle.ts` or in a future CI job that bypasses the wrapper). The plan does not list `packages/storage/src/load-env.ts` in "Files to Change" and does not call `loadEnv()` in the script. This silently diverges from the precedent set in commit `afcfec3` (LEX-65).
   - **Recommendation**: Either (a) add `packages/storage/src/load-env.ts` mirroring `packages/db/src/load-env.ts:1-46` and call `loadEnv()` at the top of `apply-lifecycle.ts`, or (b) add an explicit one-line note in the plan/code stating that storage relies *only* on `with-env.mjs` and explain why duplicating db's pattern is unnecessary. Option (a) is the lower-risk default.

### Medium Priority

3. **`apps/web` will have a phantom dependency on `@aws-sdk/client-s3`**
   - **Where**: Task 10 (`apps/web/src/app/api/health/storage/route.ts` imports `HeadBucketCommand` from `@aws-sdk/client-s3`).
   - **Problem**: Only `@veritasee/storage` declares the SDK as a dependency. The web route imports it directly. With pnpm's strict node_modules layout this can fail; even when it works (via hoisting or peer resolution), it's a "phantom dependency" anti-pattern — the web app's `package.json` doesn't declare what it uses.
   - **Recommendation**: Either (a) re-export `HeadBucketCommand` (or a `headBucket()` helper) from `@veritasee/storage` and have the route call that, keeping `@aws-sdk/client-s3` as a single owned dep — preferred — or (b) add `"@aws-sdk/client-s3": "^3.700.0"` to `apps/web/package.json` dependencies. Option (a) is cleaner: the storage health probe semantics belong in the storage package.

4. **`getObject` helper must guard a possibly-undefined `Body`**
   - **Where**: Task 4 (`getObject(key): Promise<Uint8Array>`).
   - **Problem**: AWS SDK v3 types `GetObjectCommandOutput.Body` as `StreamingBlobPayloadOutputTypes | undefined`. Calling `response.Body.transformToByteArray()` without a check is a runtime TypeError on the rare paths where the SDK returns no body, and `tsc` with `strict` will reject `response.Body!.transformToByteArray()` only via non-null assertion. The plan should specify the guard.
   - **Recommendation**: Add an explicit check, e.g. `if (!response.Body) throw new Error(\`getObject \${key}: empty body\`); return response.Body.transformToByteArray();`. State this in Task 4 so the implementer doesn't reach for `!`.

5. **"24h expiry" acceptance criterion vs S3 lifecycle granularity**
   - **Where**: Acceptance Criterion #2 of the Linear issue, Task 5, Risks table.
   - **Problem**: The plan acknowledges that S3/R2 lifecycle expiration has 1-day granularity and runs at midnight UTC, so an object uploaded at 23:59 UTC may be deleted at 00:00 UTC the next day (~1 minute later) and one uploaded at 00:01 UTC at the next midnight (~24h later). The wall-clock window in practice is roughly `[~0, 48h)` per object — **not** "24h" in the literal sense.
   - **Recommendation**: This is good enough for retention/compliance and is the correct mechanism per PRD §14.1, but the acceptance-criterion wording should be reconciled. Either (a) update the AC text to "≥1 day expiration on the unanchored prefix" before closing, or (b) add a short note in the PR description explaining the day-bucketed semantics so reviewers don't misread the gap as a bug.

6. **`S3_FORCE_PATH_STYLE` boolean parsing is brittle**
   - **Where**: Task 3 (`forcePathStyle: optionalEnv('S3_FORCE_PATH_STYLE') === 'true'`).
   - **Problem**: `"True"`, `"TRUE"`, `"1"`, `"yes"` all silently become `false`. Misconfigured R2 buckets will then fail with cryptic SDK errors instead of a config error.
   - **Recommendation**: Either lowercase the comparison (`?.toLowerCase() === 'true'`) and accept `"1"` as truthy, or throw on unrecognised values. The `.env.example` block already says "Required for Cloudflare R2" — combine that with permissive parsing.

7. **Health route lacks a clear error contract for "creds set but bucket wrong"**
   - **Where**: Task 10.
   - **Problem**: `HeadBucketCommand` returns 403 when creds are valid but the IAM key has no access to the bucket, and 404 when the bucket name is wrong. Both surface as exceptions. The plan returns `{ ok: false, error: message }` with status 503 — fine, but operators will want the underlying status code for triage.
   - **Recommendation**: When the error has `$metadata.httpStatusCode`, include it in the response body (`{ ok: false, error: msg, status: 403 }`). Mirrors what an oncall person would actually need.

### Suggestions (Low)

8. **Eslint config**: Plan mirrors `packages/redis/eslint.config.mjs` (lines 1-5). Actual file is 6 lines. Trivial — implementer should not literally copy a line-range that's off by one. Just say "mirror redis's eslint.config.mjs".

9. **Smoke-test cleanup ordering**: Test 2 deletes the key, then Test 1 already PUT and read it. Reading the plan, Test 2's `deleteObject` makes the `afterAll(deleteObject(key))` a redundant best-effort. That's fine — keep it for safety against early failures in Test 1. No change needed; just call out that the second `deleteObject` is intentionally defensive.

10. **Document the Node-runtime constraint in `client.ts`**: The Risks table mentions `runtime = 'nodejs'` is required because of bundle size. Adding a one-line top-of-file comment in `packages/storage/src/client.ts` ("Node-only: do not import from Edge-runtime routes") will save a future contributor a 30-minute debugging session if they import the package from an edge handler.

11. **Re-export `HeadBucketCommand` (or a `headBucket()` helper)** — see issue #3.

12. **Plan's "Mirror" line numbers**: Several "SOURCE: …:X-Y" annotations reference exact line ranges. After redis or db are touched in future PRs, those ranges will rot. Recommend dropping line numbers and just naming files.

## Validation Results

| Check | Status | Notes |
|-------|--------|-------|
| Type Check | N/A | No implementation to typecheck |
| Lint | N/A | No implementation to lint |
| Tests | N/A | No implementation; plan-time only |
| Plan structure | PASS | Follows project plan template; tasks atomic and ordered; has Validation, Risks, AC sections |
| Pattern fidelity | NEEDS WORK | tsconfig + load-env diverge from db precedent (issues #1, #2) |

`pnpm`/`node` are not on PATH in this review environment, so the standard `pnpm typecheck` / `pnpm lint` / `pnpm build` should be re-run by the implementing agent after Task 1–12 complete (the plan's own Validation section already lists these — good).

## What's Good

- Plan follows the established lazy-Proxy + `requireEnv` pattern from `packages/redis` and `packages/db`. No reinventing.
- Env-gated smoke test (`it.skip` when creds absent) matches the redis precedent and will not break CI.
- Smoke-test keys are placed under `snapshots/unanchored/` so the lifecycle policy auto-cleans any leaked test objects — nice belt-and-braces.
- Plan correctly identifies that `S3_FORCE_PATH_STYLE` is required for R2 and surfaces it via env, keeping the same code path for AWS S3 and R2.
- Health route uses `runtime = 'nodejs'` — required because the AWS SDK is too heavy for Edge.
- One-shot `apply-lifecycle.ts` runner is idempotent (S3/R2 replace lifecycle config in place), so re-running is safe.
- Acceptance-criteria mapping (PUT/GET/DELETE → AC#1, lifecycle policy → AC#2) is explicit, which keeps the `/merge-followup` summary honest.
- Risks table is genuinely useful — calls out Edge-bundle weight, R2 path-style requirement, lifecycle-day granularity, and CI smoke-test gating.

## Recommendation

Before `/implement` runs:

1. **Fix issue #1** — change Task 1 to mirror `packages/db/tsconfig.json` (include `scripts/**/*`).
2. **Fix issue #2** — add `packages/storage/src/load-env.ts` to "Files to Change" and call `loadEnv()` at the top of `apply-lifecycle.ts`. (Or add an explicit justification for omitting it.)
3. **Adopt the recommendation in #3** — re-export `HeadBucketCommand` (or a `headBucket()` helper) from `@veritasee/storage` so `apps/web` doesn't take a phantom dep on `@aws-sdk/client-s3`.
4. **Note in #4** — add the `Body` undefined-guard wording to Task 4 so the implementer writes a typed check rather than a `!` assertion.
5. Apply Medium #5–#7 and Low suggestions as time permits.

After implementation, the plan's Validation block already covers `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm storage:test`, and the manual `curl /api/health/storage` probe — those are the right gates.
