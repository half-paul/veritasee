# Plan Review: LEX-76 — Snapshot persistence with revision hash + zstd compression

**Scope**: `.agents/plans/lex-76-snapshot-persistence.plan.md`
**Recommendation**: NEEDS WORK (small/medium revisions — direction is sound)

## Summary

The plan is well-researched and cites concrete file:line patterns to mirror; the AC mapping, risk table, and dedup-race reasoning are strong. Two issues need to be addressed before implementation begins: (1) the `persistSnapshot` orchestrator does a pre-compress speculative SELECT that is a net negative on the Neon HTTP driver (each query is a separate HTTP round-trip), and (2) the article upsert clobbers `current_revision_hash` and `last_fetched_at` unconditionally even when the snapshot is a dedupe hit, which subtly changes the semantics those columns serve in FR-VW-5. A handful of smaller items below.

## Issues Found

### Critical

None. The architectural decisions (storage-then-DB ordering, `revision_hash` recomputed at snapshot layer, anchored prefix to avoid the 24h lifecycle rule, `onConflictDoNothing` for race handling) are all defensible and well-justified.

### High Priority

**H1. Speculative pre-compress SELECT is a perf regression on `neon-http`** — Task 9, step 2.
The orchestrator does `SELECT … WHERE article_id = … AND revision_hash = …` *before* compression, with the comment "save CPU on the hot path." On the Neon HTTP driver (`packages/db/src/client.ts:1-3` uses `drizzle-orm/neon-http`), every statement is an independent HTTP fetch — typical 30–80ms RTT from Vercel us-east-1 to Neon. zstd-6 on a 50–200 KB article is ~5–15 ms of CPU. The speculative SELECT trades ~50 ms of network for ~10 ms of CPU on **every** call, including the new-revision common case.
**Recommendation**: drop the pre-SELECT. Always compress → S3 PUT → INSERT … ON CONFLICT DO NOTHING RETURNING. On conflict (no rows returned), do the re-SELECT (the "race won" branch you already have). New-revision path drops from 4 round-trips to 3; dedupe path stays at 3.

**H2. Article upsert unconditionally overwrites `current_revision_hash` and `last_fetched_at`, including on dedupe.**
Task 9's article upsert runs *before* the dedupe check, with `onConflictDoUpdate` setting both columns to "now" / "new hash." Two problems:
- `current_revision_hash` is the read-side drift comparison field (per FR-VW-5). If `persistSnapshot()` is ever called with a non-latest revision (out-of-order fetches, backfill, drift-detection compare-job that re-persists an older snapshot for evidence), this clobbers the latest hash with an older one.
- The plan's §6 prose says `last_fetched_at` is updated "on every successful persist (which is desirable per FR-VW-5)." Fine, but be explicit that "successful persist" includes dedupe hits — that changes the semantic from "last time content changed" to "last time we re-validated against origin." This is probably the right call, but it should be in the field's docstring on `articles.ts`.
**Recommendation**: either (a) add a guard `WHERE excluded.last_fetched_at > articles.last_fetched_at` so the upsert never goes backwards on the hash, or (b) explicitly scope the API to "live fetch path only, never call with stale data" and document it in the function header.

### Medium Priority

**M1. `sourceDomain` extraction uses property-existence narrowing that's fragile.**
Task 9 sketch: `const sourceDomain = 'hostname' in article ? article.hostname : articleDomain(article.url);`. The discriminated union has `kind: 'mediawiki' | 'generic'` — branch on that. Also, `articleDomain` returns `''` on parse failure, and `articles.source_domain` is `NOT NULL` with no default. If we ever hit that path, we'll insert an empty string. Throw instead.
**Recommendation**: `const sourceDomain = article.kind === 'generic' ? article.hostname : new URL(article.url).hostname;` — let `new URL` throw on the (impossible-by-construction) malformed-URL case.

**M2. `Buffer` vs `Uint8Array` in the magic-number assertion.**
Task 13: `expect(compressed.subarray(0, 4)).toEqual(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))`. `@mongodb-js/zstd@^2` returns `Uint8Array` from `compress()`, not `Buffer`. Vitest's `toEqual` compares structurally and *should* pass `Uint8Array` vs `Buffer` since Buffer is a Uint8Array subclass, but the prototype mismatch can trip `toStrictEqual` and some other matchers. Stabilize by comparing as plain arrays: `expect(Array.from(compressed.subarray(0, 4))).toEqual([0x28, 0xb5, 0x2f, 0xfd])`. Same for the `decompressed` round-trip assertion.

**M3. `pnpm db:generate` with `DATABASE_URL_UNPOOLED=postgres://noop` is an unverified workaround.**
Task 2 and the risk table both claim drizzle-kit generate doesn't connect. This is empirically true for `drizzle-kit generate` *most* of the time but it sometimes opens a connection for introspection-fallback when meta snapshots don't align. The plan should call this out as "verify before relying on" rather than presenting as a reliable workaround, or simply require staging credentials for the migration-generation step.

**M4. Drizzle `onConflictDoUpdate({ target: articles.sourceUrl, ... })` against a `uniqueIndex` — verify before merge.**
The unique-ness on `articles.source_url` is declared via `uniqueIndex('articles_source_url_key')`, not via a `unique()` constraint. In Drizzle 0.36, `target` is matched against any unique-index covering exactly the listed columns, which should work — but it's worth a one-line test (e.g. a unit test of the orchestrator that asserts the SQL emitted) to catch this if Drizzle's resolver doesn't accept the column reference for an index-only uniqueness. Risk table already lists the raw-SQL fallback as mitigation — fine, just confirm during Task 9 implementation.

**M5. Snapshot blob format (`v: 1` envelope JSON) is introduced without an explicit ADR or AC.**
Task 9's `blobOf()` defines a JSON envelope (`{ v: 1, revisionHash, sourceRevision, kind, url, title, fetchedAt, sections, leadHtml }`) and that's what gets compressed. This is reasonable (VS-027 needs to re-render without a re-fetch), but it ships a new on-disk format with no ADR entry. Either:
- Add a one-paragraph note in `docs/adr/` for the snapshot envelope shape, **or**
- Move the envelope decision to VS-027 and have VS-026 store only the normalized text in the blob (revision_hash is derived from the same bytes, so it's self-describing).
The current plan stores something different from what the hash hashes, and the relationship between the two is only visible to a reader who studies `persistSnapshot.ts` carefully. Document it.

### Suggestions (Low)

**L1. Storage key contains `:` from `sha256:<hex>` prefix.**
S3/R2 accept `:` in object keys; most HTTP tooling encodes it correctly. But if you ever expose the storage key in a URL path (e.g. a debug route), URL encoding will need handling. Consider dropping the `:` separator in the storage-key form: `snapshots/anchored/{articleId}/{hexOnly}.zst`. The `sha256:` prefix lives in the DB column; the key is just bytes. (Mild — fine to defer.)

**L2. Plan says "no production callers" but `corrections.snapshot_id` has an FK to `snapshots.id`.**
True at table level — the FK is on `id`, not `content`, so the schema migration is safe. Worth a sentence in the migration runbook (Task 17) confirming the FK is untouched, just to defuse a reviewer's "is the FK okay?" question without code-reading.

**L3. Task 16 smoke cleanup is best-effort and leaves potential test pollution.**
"`afterAll` deletes the snapshot row… and the S3 object via `deleteObject`. Treat both as best-effort." On clean-environment smoke runs that's fine; on shared smoke envs (do they exist?), a flaky cleanup leaves orphan snapshots that survive into VS-094's eviction. Add a deterministic test-specific article URL (e.g. `https://smoke-test.veritasee.local/${Date.now()}`) so any leak is identifiable and easy to GC.

**L4. Followup flagged in Risks but not in Out of Scope.**
The "refactor `parseGenericArticle.ts:17-19` to call `normalizeArticleText` so there's a single source of truth" is in the Risks table as "flagged as a v1.1 cleanup." Also in Out of Scope. That's consistent — just confirming the duplication is on the followup list (LEX-?? if you want to file it now).

**L5. Logging field naming consistency.**
The orchestrator emits `snapshot_persist_ok`, `snapshot_persist_dedupe`, `snapshot_persist_race_won`. The generic parser uses `generic_parse_ok` (positive only). If the observability convention is "one event per terminal state," adopt the same for the error paths too (`snapshot_persist_error` with `code` field) so the dashboard can count `count by event = 'snapshot_persist_*'`. Cheap to add now.

**L6. `pnpm test:smoke` exclusion for unit run — already correct.**
`apps/web/vitest.config.ts:11` excludes `**/*.smoke.test.ts` from `pnpm test`, so the new smoke file won't double-run. Just confirming this — no action.

## Validation Results

| Check       | Status                                                                       |
| ----------- | ---------------------------------------------------------------------------- |
| Type Check  | N/A (no code yet — plan-only)                                                |
| Lint        | N/A                                                                          |
| Tests       | N/A                                                                          |

A plan-level validation: the LEX-75 line-117 citation is accurate (verified in the completed plan); the "no production callers" claim is true (`grep -rn "snapshots" apps/web/src` returns nothing); the Drizzle version is `^0.36.0` (verified in `packages/db/package.json`), which supports both `onConflictDoNothing({ target: [...] })` and the column-array form.

## What's Good

- The §1 / §2 split (hash recomputed at the snapshot layer; normalization shared between parsers) and the explicit "do not import the LEX-75 anchor normalizer here" warning is exactly the kind of cross-cutting concern that's easy to get wrong and you got right.
- §6 storage-then-DB ordering reasoning, including the orphan-blob mitigation pointer to VS-094, is solid.
- Risk table is comprehensive and lists actual mitigations rather than hand-waves.
- The "envelope JSON includes `sourceRevision` so VS-027 can short-circuit by MediaWiki revid" detail is the kind of forward-looking design that prevents a rewrite three issues from now.
- Smoke-test gating pattern (`*.smoke.test.ts` + env-var auto-skip) matches existing `s3.smoke.test.ts` exactly.

## Recommendation

NEEDS WORK before `/implement`. Address H1 (drop the pre-compress SELECT), H2 (article-upsert semantics), M1 (sourceDomain narrowing), and M5 (document the envelope format choice — even one paragraph). M2/M3/M4 are easy to handle during implementation; the L items can land as a followup or in the same PR.

After those edits, the plan is implementation-ready.
