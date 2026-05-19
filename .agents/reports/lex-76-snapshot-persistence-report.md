# Implementation Report: LEX-76 — Snapshot persistence with revision hash + zstd compression

**Plan**: `.agents/plans/lex-76-snapshot-persistence.plan.md`
**Plan review**: `.agents/reviews/lex-76-snapshot-persistence-plan-review.md`
**Branch**: `features/LEX-76-snapshot-persistence`
**Linear**: LEX-76 (VS-026)
**Status**: COMPLETE

## Summary

New `apps/web/src/lib/snapshots/` module turns a `ParsedArticle` (MediaWiki or generic) into a persisted snapshot: it normalizes the section text, hashes it as `sha256:<hex>`, wraps the article in a versioned JSON envelope, zstd-6 compresses the envelope, PUTs it to S3/R2 under `snapshots/anchored/{articleId}/{revisionHash}.zst`, and inserts a `snapshots` row keyed on `(article_id, revision_hash)` with `ON CONFLICT DO NOTHING` for idempotency. The `snapshots.content text` column is replaced with `snapshots.storage_key text` + `snapshots.size_bytes int`. No new API route ships in this PR — `persistSnapshot()` is a library; the proxy fetcher (VS-021) and correction-save path (VS-028+) will call it.

## Tasks Completed

| #   | Task                                              | File(s)                                                                                                              | Status |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Drizzle schema: drop `content`, add `storageKey` + `sizeBytes` | `packages/db/src/schema/articles.ts`                                                                                  | ✅     |
| 2   | Generate Drizzle migration                        | `packages/db/migrations/0001_worthless_whirlwind.sql`, `meta/0001_snapshot.json`, `meta/_journal.json`                | ✅     |
| 3   | Add `@mongodb-js/zstd` + allowlist its install script | `apps/web/package.json`, root `package.json` (`pnpm.onlyBuiltDependencies`)                                            | ✅     |
| 4   | Normalize / hash / compress / storageKey / types helpers | `apps/web/src/lib/snapshots/{normalize,hash,compress,storageKey,types}.ts`                                            | ✅     |
| 5   | `persistSnapshot` orchestrator + barrel           | `apps/web/src/lib/snapshots/persistSnapshot.ts`, `apps/web/src/lib/snapshots/index.ts`                                 | ✅     |
| 6   | Re-export `and`/`eq` from `@veritasee/db`         | `packages/db/src/index.ts`                                                                                            | ✅     |
| 7   | Unit tests for normalize, hash, compress, storageKey, persistSnapshot | `apps/web/src/lib/snapshots/*.test.ts`                                                                                | ✅     |
| 8   | Smoke test (env-gated, real Neon + R2)            | `apps/web/src/lib/snapshots/persistSnapshot.smoke.test.ts`                                                            | ✅     |
| 9   | Wire `@/` alias into smoke vitest workspace       | `vitest.smoke.workspace.ts`                                                                                           | ✅     |
| 10  | Fix pre-existing flat-config lint break by adding missing peer | `apps/web/package.json` (`eslint-plugin-react-hooks`)                                                                 | ✅     |

## Review Items Addressed

| Item | Source              | Resolution                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | Pre-compress SELECT | **Dropped.** Orchestrator now does compress → S3 PUT → `INSERT ... ON CONFLICT DO NOTHING RETURNING`; on conflict (no rows returned) it re-SELECTs the canonical row. New-revision path is 3 round-trips, dedupe path is 3. Rationale captured in `persistSnapshot.ts` step-2 comment. |
| H2   | Article upsert clobbers fields | **Documented live-fetch-only contract** at the top of `persistSnapshot.ts`: callers must invoke with freshly-fetched articles; backfill/drift compare-jobs that want to re-persist historical snapshots must take a different code path. `last_fetched_at` semantics updated in `articles.ts` to read as "last re-validated against origin." |
| M1   | sourceDomain narrowing | Refactored to `article.kind === 'generic' ? article.hostname : new URL(article.url).hostname` (kind-discriminant, throws on impossible-by-construction malformed URLs).                                                                                                                                                              |
| M2   | Buffer/Uint8Array matcher | All zstd magic-number assertions use `Array.from(buf.subarray(0,4))` to sidestep prototype mismatches.                                                                                                                                                                                                                                |
| M3   | drizzle-kit dummy URL | Verified empirically: `DATABASE_URL_UNPOOLED=postgres://noop` works because the diff is purely against `meta/*.json`; no network call observed during generate. (Used `expect` to drive the interactive create-not-rename prompts.)                                                                                                  |
| M4   | `onConflictDoUpdate({ target: articles.sourceUrl })` against `uniqueIndex` | Verified at runtime: smoke test exercises the article upsert against the real `articles_source_url_key` unique index and succeeds.                                                                                                                                                                                                  |
| M5   | Envelope format documentation | Header comment on `persistSnapshot.ts` documents the `v: 1` envelope shape (`revisionHash` / `sourceRevision` / `kind` / `url` / `title` / `fetchedAt` / `sections` / `leadHtml`) and explains why the stored blob differs from the hashed normalized text. ADR avoided — comment is the single source of truth in v1.            |
| L5   | Logging consistency  | Error paths still throw `SnapshotPersistError`; success/dedupe paths log `snapshot_persist_ok` / `snapshot_persist_dedupe`. The race-won path was merged into the dedupe event since the post-condition is identical from a caller standpoint.                                                                                                  |

Items not addressed (intentional, low priority): L1 (drop `:` from storage key — fine as-is; works on S3/R2), L2 (FK runbook line — covered in the migration runbook below), L3 (deterministic smoke URL — addressed: `https://smoke-test.veritasee.local/snapshot-persistence/${Date.now()}`), L4/L6 (confirmation only).

## Validation Results

| Check                | Result                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| `pnpm typecheck`     | ✅ (all 4 packages)                                                     |
| `pnpm lint`          | ✅ (all 4 packages) — required fixing a pre-existing `eslint-plugin-react-hooks` missing-peer break |
| `pnpm test`          | ✅ 304 tests pass (23 new in `src/lib/snapshots/`)                       |
| `pnpm build`         | ✅ Next.js production build green; `@mongodb-js/zstd` native binding resolves in webpack |
| `pnpm test:smoke`    | ✅ 6 tests (all 4 smoke suites) pass against staging Neon + R2          |
| `pnpm format:check`  | Pre-existing repo-wide format drift unchanged; new files formatted     |

## Files Changed

| File                                                                          | Action | Approx. lines |
| ----------------------------------------------------------------------------- | ------ | ------------- |
| `packages/db/src/schema/articles.ts`                                          | UPDATE | +14 / −2      |
| `packages/db/src/index.ts`                                                    | UPDATE | +1 / −1       |
| `packages/db/migrations/0001_worthless_whirlwind.sql`                         | CREATE | +3            |
| `packages/db/migrations/meta/0001_snapshot.json`                              | CREATE | (auto)        |
| `packages/db/migrations/meta/_journal.json`                                   | UPDATE | +7            |
| `apps/web/package.json`                                                       | UPDATE | +2            |
| `package.json` (root) — pnpm `onlyBuiltDependencies`                          | UPDATE | +5            |
| `pnpm-lock.yaml`                                                              | UPDATE | (auto)        |
| `vitest.smoke.workspace.ts`                                                   | UPDATE | +10 / −0      |
| `apps/web/src/lib/snapshots/normalize.ts`                                     | CREATE | +21           |
| `apps/web/src/lib/snapshots/hash.ts`                                          | CREATE | +11           |
| `apps/web/src/lib/snapshots/compress.ts`                                      | CREATE | +21           |
| `apps/web/src/lib/snapshots/storageKey.ts`                                    | CREATE | +10           |
| `apps/web/src/lib/snapshots/types.ts`                                         | CREATE | +37           |
| `apps/web/src/lib/snapshots/persistSnapshot.ts`                               | CREATE | +210          |
| `apps/web/src/lib/snapshots/index.ts`                                         | CREATE | +12           |
| `apps/web/src/lib/snapshots/normalize.test.ts`                                | CREATE | +69           |
| `apps/web/src/lib/snapshots/hash.test.ts`                                     | CREATE | +28           |
| `apps/web/src/lib/snapshots/compress.test.ts`                                 | CREATE | +28           |
| `apps/web/src/lib/snapshots/storageKey.test.ts`                               | CREATE | +16           |
| `apps/web/src/lib/snapshots/persistSnapshot.test.ts`                          | CREATE | +260          |
| `apps/web/src/lib/snapshots/persistSnapshot.smoke.test.ts`                    | CREATE | +96           |

## Deviations from Plan

1. **Pre-compress SELECT removed (review H1).** Plan §9 step 2 had a speculative dedupe SELECT before compression; review showed this is a perf regression on the Neon HTTP driver. Removed; race/dedupe is now handled exclusively by `ON CONFLICT DO NOTHING` + re-SELECT on conflict.
2. **`and`/`eq` re-exported from `@veritasee/db`** (instead of consumers importing from `drizzle-orm` directly, which isn't a direct dep of `apps/web`). This keeps the snapshot orchestrator's import block clean and avoids forcing `apps/web` to add `drizzle-orm` as a direct dependency.
3. **`pnpm.onlyBuiltDependencies` added** in root `package.json` so pnpm 10 runs the `@mongodb-js/zstd` `prebuild-install` install-script. Without it the native binding never lands in `node_modules` and `import('@mongodb-js/zstd')` fails. Not mentioned in plan; required to make the dependency usable.
4. **Smoke vitest workspace teaches `@/` alias.** The smoke test imports `@/lib/parser` etc. The shared smoke workspace didn't carry the alias; added it so smoke tests under `apps/web/src/` resolve.
5. **`eslint-plugin-react-hooks` added** to `apps/web` devDeps. This is a pre-existing `eslint-config-next@15.5.x` flat-config flaw on `main` (confirmed by stashing my work and re-running lint on a clean tree); adding the missing peer dep unblocks the lint gate. Adjacent cleanup, not a code change.

## Tests Written

| Test File                                                          | Test Count | Coverage                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/lib/snapshots/normalize.test.ts`                     | 6          | Determinism, markup-invariance, case-invariance (FR-VW-5), whitespace collapse, sensitivity, mediawiki↔generic equivalence                                                                                                                                                                            |
| `apps/web/src/lib/snapshots/hash.test.ts`                          | 4          | Known sha256 vector for "hello", determinism, prefix shape, sensitivity                                                                                                                                                                                                                                |
| `apps/web/src/lib/snapshots/compress.test.ts`                      | 4          | Round-trip identity, level-6 default, zstd magic (RFC 8478), compression effectiveness                                                                                                                                                                                                                |
| `apps/web/src/lib/snapshots/storageKey.test.ts`                    | 2          | Format with `.zst` suffix, anchored-prefix invariant (never overlaps `UNANCHORED_PREFIX` → §14.1 lifecycle)                                                                                                                                                                                            |
| `apps/web/src/lib/snapshots/persistSnapshot.test.ts`               | 7          | **AC1** sha256-prefixed hash stored; **AC2** dedupe returns same id, no duplicate row; **AC3** putObject called with correct content-type, key, zstd-magic bytes, decompressible JSON envelope; mediawiki hostname derivation; all three error paths (`storage_write_failed`, `db_insert_failed`, `article_upsert_failed`) |
| `apps/web/src/lib/snapshots/persistSnapshot.smoke.test.ts`         | 1          | Real Neon + real R2/S3: persist → S3 readback → decompress → JSON envelope round-trip; second call dedupes to same id                                                                                                                                                                                  |

**Total**: 24 new test cases (23 unit + 1 smoke).

## Migration Runbook (per Task 17)

Pre-merge ops:

1. `pnpm db:migrate` against staging Neon (already done as part of this implementation's smoke verification — staging schema currently reflects the new shape).
2. Verify with psql: `\d snapshots` should show `storage_key text NOT NULL`, `size_bytes integer NOT NULL`, no `content` column. Unique index `snapshots_article_revision_key` on `(article_id, revision_hash)` must still exist.
3. `corrections.snapshot_id` FK references `snapshots.id`, not `snapshots.content` — the FK is untouched by this migration.
4. Production Neon: run the migration at PR merge time. No backfill needed (zero production rows in `snapshots` today).

## Acceptance Criteria — Result

- [x] **AC1** — sha256(normalized_text) stored as `revision_hash`. (`normalize.test.ts` × 6, `hash.test.ts` × 4, `persistSnapshot.test.ts` AC1)
- [x] **AC2** — `(article_id, hash)` dedupe key prevents duplicate rows. (`persistSnapshot.test.ts` AC2 + smoke test)
- [x] **AC3** — Snapshot blob zstd level-6 compressed in object storage. (`compress.test.ts` × 4, `persistSnapshot.test.ts` AC3 + smoke decompress round-trip)
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green.
- [x] No regressions in `generic-parser`, `mediawiki`, or `proxy-cache` suites (all pre-existing tests still pass).
