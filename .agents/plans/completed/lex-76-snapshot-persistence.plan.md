# Plan: VS-026 — Snapshot persistence with revision hash + zstd compression

## Summary

Introduce an `apps/web/src/lib/snapshots/` module that turns a `ParsedArticle` (the discriminated union of `MediaWikiArticle | GenericArticle` returned by `parseArticle()`) into a persisted snapshot record: it (1) normalizes the article text the same way `parseGenericArticle.ts:17-19` does, (2) computes `sha256(normalized_text)` as a canonical `revision_hash`, (3) zstd-compresses the article blob at level 6 and writes it to S3-compatible object storage under `snapshots/anchored/{articleId}/{revisionHash}.zst`, and (4) inserts a `snapshots` row keyed by the existing `(article_id, revision_hash)` unique index so re-persisting an identical revision is a no-op. The `snapshots.content text` column is replaced with `snapshots.storage_key text` (plus a `size_bytes int` field for the §14.1 storage budget) since the blob now lives in object storage, not Postgres. No new API route ships in this issue — the function exists for the proxy fetcher (VS-021) and the correction-save path (VS-028+) to call.

## User Story

As the Veritasee read path
I want every fetched article revision to be persisted exactly once, content-addressed by a sha256 of its normalized text and stored compressed in object storage
So that corrections can pin to immutable snapshots, drift detection can compare current vs pinned hash without storing the same revision twice, and storage stays bounded per PRD §14.1.

## Metadata

| Field             | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Type              | NEW_CAPABILITY                                                              |
| Complexity        | MEDIUM                                                                      |
| Systems Affected  | `apps/web` (new `lib/snapshots`), `@veritasee/db` (schema + migration), `@veritasee/storage` (consumer), object storage (R2/S3), Postgres |
| Linear Issue      | LEX-76 (VS-026)                                                             |
| PRD refs          | FR-VW-5 (anchoring & versioning), §14.1 (snapshot retention & compression)  |
| Blocked by        | VS-005 → LEX-67 (S3 wiring) ✅ done; LEX-65 (Postgres schema) ✅ done; LEX-74 (article extractor) ✅ done |
| Blocks            | VS-027 (drift detection — reads the snapshot blob), VS-028 (correction panel — needs `snapshot_id`), VS-094 (retention/eviction) |

---

## Acceptance Criteria (verbatim from LEX-76)

- [ ] Given a fetched article, when normalized, then `sha256(normalized_text)` is stored as `revision_hash`.
- [ ] Given an identical revision, when stored again, then the `(article_id, hash)` dedupe key prevents duplicate rows.
- [ ] Given a snapshot blob, when persisted, then it is zstd level-6 compressed in object storage.

---

## Key Design Decisions

### 1. `revision_hash` is recomputed at the snapshot layer — not the parser's `revisionHash` field

The two parsers populate `revisionHash` with different shapes:

- `MediaWikiArticle.revisionHash` = `mw:<revid>` (see `apps/web/src/lib/mediawiki/types.ts:8` and the value built at `parseResponse.ts:244`). The MediaWiki revid is a stable integer; it's perfect for cache invalidation but it is **not** `sha256(normalized_text)`.
- `GenericArticle.revisionHash` = `sha256:<hex>` over `stripTags + collapse ws + lowercase` (see `parseGenericArticle.ts:17-43`).

LEX-76's first acceptance criterion is literal: **`sha256(normalized_text)` is stored as `revision_hash`**. The snapshot layer therefore owns the canonical hash and re-derives it from the article's section text, regardless of which parser produced the article. The parser-side `revisionHash` is preserved as `sourceRevision` metadata in the stored blob (useful for VS-027's drift comparison: MediaWiki can short-circuit by revid before recomputing the sha256).

### 2. Normalization is text-only and matches the generic parser's existing rule

A new exported function `normalizeArticleText(article: ParsedArticle): string`:

1. Concatenates `sections[].html` separated by `\n` (for both kinds — MediaWiki and generic both populate `sections` with a `Section` whose `html` field is raw HTML; see `mediawiki/types.ts:15-24` and `generic-parser/parseGenericArticle.ts:45-47`).
2. `stripTags` via `/<[^>]+>/g` replacement.
3. `replace(/\s+/g, ' ').toLowerCase().trim()`.

This is the **same algorithm** as `apps/web/src/lib/generic-parser/parseGenericArticle.ts:17-19`. We extract it to a shared helper so it isn't duplicated. The lowercasing is intentional and is documented at `.agents/plans/completed/lex-75-text-fragment-anchor.plan.md:117` — case-only diffs should not register as drift in the snapshot pin. (Anchor normalization in LEX-75 is deliberately a different normalizer; do **not** import that one here.)

### 3. Schema change: replace `snapshots.content` with `snapshots.storage_key`

The current schema (`packages/db/src/schema/articles.ts:23-35`) keeps the snapshot blob inline as `content text NOT NULL`. PRD §14.1 explicitly says snapshots live in object storage, zstd-compressed. Inline-text storage would:

- Bloat Postgres (snapshots are 4–6× compressed HTML; uncompressed they swamp managed Postgres quickly).
- Make AC #3 ambiguous — "zstd-compressed in object storage" cannot be satisfied if the canonical copy is plain text in a `text` column.

Drop `content`, add `storage_key text NOT NULL` (the S3 object key), and add `size_bytes integer NOT NULL` (the compressed byte count, useful for the §14.1 alert at 80% of 200 GB). There are zero rows in production today (the table was created in `0000_lying_marvel_apes.sql` but nothing inserts into it yet — `grep -rn "snapshots" apps/web/src` finds zero call sites), so the migration can be a straight `DROP COLUMN content; ADD COLUMN storage_key ... NOT NULL; ADD COLUMN size_bytes ... NOT NULL` without backfill.

### 4. Storage key layout: `snapshots/anchored/{articleId}/{revisionHash}.zst`

- Under `anchored/` (not `unanchored/`) so the existing lifecycle rule at `packages/storage/src/lifecycle.ts:14` (which expires `snapshots/unanchored/` at 1 day) does **not** age our snapshots out. Retention/eviction of orphaned snapshots is **VS-094** (out of scope here).
- `articleId` is the UUID PK from `articles`; using it (rather than the domain or URL hash) keeps keys short and renames safe.
- `.zst` extension is conventional and pairs with `Content-Type: application/zstd` (IANA-registered) so an operator browsing R2/S3 can identify the compression algorithm without metadata lookup.

### 5. Compression library: `@mongodb-js/zstd`

Native zstd is not yet available in `node:zlib` at the project's Node baseline (`engines.node >= 20.11` per `package.json:6-8`; `node:zlib` zstd ships in Node 22.15+). `@mongodb-js/zstd` is a napi-rs binding maintained by MongoDB with prebuilt binaries for `linux-x64-gnu` (Vercel production), `darwin-x64`, `darwin-arm64`, and `win32-x64-msvc`. Surface: `compress(buffer, level)` / `decompress(buffer)`. Level 6 maps directly to PRD §14.1.

Alternative considered: bump engines to `>=22.15` and use `node:zlib.zstdCompressSync`. Rejected for this issue because it bundles a Node upgrade with a feature change. We can swap implementations under the same wrapper later without any caller-visible changes; the public `compress`/`decompress` helpers live in `apps/web/src/lib/snapshots/compress.ts` exactly so this swap is one-file.

Add `@mongodb-js/zstd` to **`apps/web`** (not the shared storage package): compression is snapshot-specific, the storage package stays generic, and Edge-runtime callers of `@veritasee/storage` aren't surprised by a native binding.

### 6. Article upsert is part of `persistSnapshot`

Snapshots FK to `articles.id` (`schema/articles.ts:27-29`). The caller may or may not have created an `articles` row. `persistSnapshot()` owns an upsert against `articles_source_url_key` (`migrations/0000_lying_marvel_apes.sql:156`): inserts the row on first sight (with `last_fetched_at = now()`) or updates `last_fetched_at` and `current_revision_hash` on every successful persist (which is desirable per FR-VW-5 — `current_revision_hash` on `articles` is the read-side drift comparison value).

### 7. Dedupe via `ON CONFLICT (article_id, revision_hash) DO NOTHING`

Drizzle's `.onConflictDoNothing()` against the existing unique index `snapshots_article_revision_key` (`migrations/0000_lying_marvel_apes.sql:158`) makes the insert idempotent. The helper returns the snapshot's `id` whether the row was newly created or already existed (via a follow-up SELECT when DO NOTHING swallows the row). The return value also carries a `deduped: boolean` so the caller can log / metric "new revision vs cache hit."

**Object-storage write happens before the DB insert.** Reasoning:

- If DB insert succeeds but the object is missing, every future read of that snapshot 500s — there is no recovery short of a re-fetch from origin, and the original source page may have changed.
- If the object exists but the DB insert is rolled back (or the caller crashes), the object is orphaned but harmless; the VS-094 retention job sweeps orphans by joining `snapshots.storage_key` to a `LIST` of `snapshots/anchored/`.
- For the dedupe path, we still re-write the object (idempotent S3 PUT) so a missing object is self-healed on the next call; the small bandwidth cost is bounded by Redis-side proxy cache (`apps/web/src/lib/proxy-cache/cache.ts`) deduping fetches before they reach this code.

---

## Patterns to Follow

### Naming — discriminated-union "kind" types and `sha256:`-prefixed hashes

```ts
// SOURCE: apps/web/src/lib/generic-parser/types.ts:10
export const GENERIC_PARSER_REVISION_PREFIX = 'sha256:';

// SOURCE: apps/web/src/lib/generic-parser/parseGenericArticle.ts:43
const revisionHash = `${GENERIC_PARSER_REVISION_PREFIX}${sha256Hex(normalizeForHash(extracted.contentHtml))}`;
```

Mirror this exactly: the snapshot revision hash is `sha256:<64-hex>` (same prefix, same hex casing, same shape that round-trips through `getCachedFresh`'s `revisionHash` comparison in `apps/web/src/lib/proxy-cache/cache.ts:47-57`).

### Error class — discriminated `detail` for caller-side switch

```ts
// SOURCE: apps/web/src/lib/generic-parser/types.ts:41-57
export type GenericParserErrorDetail =
  | { code: 'http_error'; status: number; message: string }
  | { code: 'bad_response'; message: string }
  | { code: 'extraction_failed'; hostname: string; message: string };

export class GenericParserError extends Error {
  readonly detail: GenericParserErrorDetail;
  constructor(detail: GenericParserErrorDetail) {
    super(detail.message ?? detail.code);
    this.name = 'GenericParserError';
    this.detail = detail;
  }
}
```

`SnapshotPersistError` follows the same shape with codes covering `compression_failed`, `storage_write_failed`, `db_insert_failed`, and `article_upsert_failed`.

### Drizzle schema — same import pattern, same column conventions

```ts
// SOURCE: packages/db/src/schema/articles.ts:23-35
export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    revisionHash: text('revision_hash').notNull(),
    content: text('content').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('snapshots_article_revision_key').on(t.articleId, t.revisionHash)],
);
```

Replace `content` with `storage_key` (and add `size_bytes`) keeping naming/casing identical (`column_name` SQL → `columnName` TS).

### Drizzle client + raw SQL escape hatch

```ts
// SOURCE: apps/web/src/app/api/health/db/route.ts:10-12
const rows = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
const ok = Array.isArray(rows) ? rows[0]?.ok === 1 : (rows as { rows: { ok: number }[] }).rows?.[0]?.ok === 1;
```

`getDb()` lazily resolves so import order doesn't matter. Both schema-typed builders (`.insert(snapshots).values(...).onConflictDoNothing()`) and raw `execute(sql\`…\`)` are available.

### S3 PUT — already wired

```ts
// SOURCE: packages/storage/src/objects.ts:13-26
export async function putObject(
  key: string,
  body: Uint8Array | string,
  opts: PutObjectOptions = {},
): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: opts.contentType,
    }),
  );
}
```

We pass a `Uint8Array` (the compressed bytes) and `contentType: 'application/zstd'`. Nothing else is needed from the storage package.

### Test patterns — unit (mock the boundaries)

```ts
// SOURCE: packages/storage/test/objects.test.ts:1-13
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { putObject } from '../src/objects';

const s3Mock = mockClient(S3Client);
```

Use `aws-sdk-client-mock` (already a `packages/storage` devDep) to assert the `PutObjectCommand` input shape. For the DB layer mirror `packages/db/test/client.test.ts:1-15` (`vi.hoisted` + `vi.mock('@neondatabase/serverless')`) so unit tests don't need a Neon instance.

### Test patterns — smoke (real services, env-gated, auto-skip)

```ts
// SOURCE: packages/storage/test/s3.smoke.test.ts:10-22
describe('s3 storage smoke', () => {
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
    console.warn('S3_ENDPOINT/_REGION/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY/_BUCKET unset — skipping storage smoke test');
    it.skip('PUT/GET/DELETE roundtrip (skipped: no s3 env)', () => {});
    return;
  }
  // …real PUT/GET roundtrip
});
```

The smoke test (Task 9) writes a real article through the full pipeline and re-reads + decompresses to verify the round-trip. It auto-skips when `DATABASE_URL_UNPOOLED`/`S3_*` are unset, per the `AGENTS.md` rule that smoke tests must skip on clean clones.

---

## Files to Change

| File                                                            | Action | Purpose                                                                                          |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `packages/db/src/schema/articles.ts`                            | UPDATE | Drop `content`, add `storageKey` + `sizeBytes` columns on `snapshots`                            |
| `packages/db/migrations/0001_*_snapshot_storage_key.sql`        | CREATE | Drizzle-kit generated migration: `ALTER TABLE snapshots DROP COLUMN content`, add columns        |
| `packages/db/migrations/meta/_journal.json`                     | UPDATE | Auto-appended by `drizzle-kit generate`                                                          |
| `packages/db/migrations/meta/0001_snapshot.json`                | CREATE | Auto-emitted Drizzle snapshot of the new schema state                                            |
| `apps/web/package.json`                                         | UPDATE | Add `@mongodb-js/zstd` to dependencies                                                           |
| `apps/web/src/lib/snapshots/types.ts`                           | CREATE | `SnapshotRecord`, `PersistSnapshotResult`, `SnapshotPersistError` + detail union, constants      |
| `apps/web/src/lib/snapshots/normalize.ts`                       | CREATE | `normalizeArticleText(article: ParsedArticle): string` — extract shared algorithm                |
| `apps/web/src/lib/snapshots/normalize.test.ts`                  | CREATE | Determinism + parser-agnostic equality tests                                                     |
| `apps/web/src/lib/snapshots/hash.ts`                            | CREATE | `sha256Hex` + `revisionHashFor(text)` returning `sha256:<hex>`                                   |
| `apps/web/src/lib/snapshots/hash.test.ts`                       | CREATE | Determinism, sensitivity, prefix-shape tests                                                     |
| `apps/web/src/lib/snapshots/compress.ts`                        | CREATE | `compressZstd(bytes, level=6)` + `decompressZstd(bytes)` wrappers around `@mongodb-js/zstd`      |
| `apps/web/src/lib/snapshots/compress.test.ts`                   | CREATE | Roundtrip + level-6 default + magic-bytes assertion                                              |
| `apps/web/src/lib/snapshots/storageKey.ts`                      | CREATE | `snapshotStorageKey(articleId, revisionHash): string` — single source of truth                   |
| `apps/web/src/lib/snapshots/storageKey.test.ts`                 | CREATE | Format + .zst suffix + anchored/ prefix                                                          |
| `apps/web/src/lib/snapshots/persistSnapshot.ts`                 | CREATE | Orchestrator: upsert article → compute hash → check dedupe → compress → putObject → insert      |
| `apps/web/src/lib/snapshots/persistSnapshot.test.ts`            | CREATE | AC1/2/3 coverage with mocked db + s3                                                             |
| `apps/web/src/lib/snapshots/index.ts`                           | CREATE | Barrel export                                                                                    |
| `apps/web/src/lib/snapshots/persistSnapshot.smoke.test.ts`      | CREATE | End-to-end smoke test against real Neon + real R2/S3, env-gated and auto-skip                    |

No new API route ships in this PR — confirmed against the issue text. Callers integrate later (VS-021 proxy fetcher; VS-028 correction save path).

---

## Tasks

Execute in order. Each task is atomic and verifiable with `pnpm typecheck` (or the task-specific check noted).

### Task 1: Update Drizzle schema — replace `content` with `storage_key` + `size_bytes`

- **File**: `packages/db/src/schema/articles.ts`
- **Action**: UPDATE
- **Implement**:
  - Remove the `content: text('content').notNull()` column from `snapshots`.
  - Add `storageKey: text('storage_key').notNull()` (the S3 object key, e.g. `snapshots/anchored/<uuid>/sha256:<hex>.zst`).
  - Add `sizeBytes: integer('size_bytes').notNull()` (compressed byte count, for §14.1 budget telemetry).
  - Import `integer` from `drizzle-orm/pg-core` (add to the existing import).
  - Keep the existing unique index on `(articleId, revisionHash)` unchanged.
  - Inferred types (`Snapshot`, `NewSnapshot`) auto-refresh; no edit needed at the export site.
- **Mirror**: existing column declarations in the same file, e.g. `revisionHash: text('revision_hash').notNull()` and `articleId: uuid('article_id').notNull().references(...)`. Use `integer('size_bytes').notNull()` exactly as `users.trustPoints` does at `packages/db/src/schema/users.ts` (already an `integer().notNull().default(0)` — minus the default here because the value is always supplied).
- **Validate**: `pnpm --filter @veritasee/db typecheck`.

### Task 2: Generate the migration file

- **File**: `packages/db/migrations/0001_*_snapshot_storage_key.sql` (Drizzle picks the codename suffix)
- **Action**: CREATE (via tool)
- **Implement**:
  - Run `pnpm db:generate` from the repo root (requires `DATABASE_URL_UNPOOLED` for the introspection step per `drizzle.config.ts:6-9`; if unavailable, set a dummy `DATABASE_URL_UNPOOLED=postgres://noop` — `drizzle-kit generate` does not connect for schema-diff output).
  - Verify the emitted SQL contains `ALTER TABLE "snapshots" DROP COLUMN "content"`, `ALTER TABLE "snapshots" ADD COLUMN "storage_key" text NOT NULL`, and `ALTER TABLE "snapshots" ADD COLUMN "size_bytes" integer NOT NULL`.
  - Verify the unique index on `(article_id, revision_hash)` is preserved (Drizzle should not regenerate it).
  - Commit the migration `.sql` plus the auto-emitted `meta/_journal.json` and `meta/0001_snapshot.json`.
- **Mirror**: existing migration `packages/db/migrations/0000_lying_marvel_apes.sql:26-35` shows the snapshot table baseline; the new migration only diffs against it.
- **Validate**: file exists, SQL parses (visual review), `pnpm --filter @veritasee/db typecheck` still passes.

### Task 3: Add `@mongodb-js/zstd` to `apps/web`

- **File**: `apps/web/package.json`
- **Action**: UPDATE
- **Implement**: Add `"@mongodb-js/zstd": "^2.0.0"` (latest at planning time; pin to a published `^2.x` major) under `dependencies`. Run `pnpm install` at the repo root so the workspace lockfile updates.
- **Mirror**: existing `"@mozilla/readability": "^0.5.0"` line in `apps/web/package.json` for placement / formatting.
- **Validate**: `pnpm install`, then `pnpm --filter web typecheck` (catches resolution issues), then `pnpm --filter web build` (catches Vercel-style native-binary resolution before deploy).

### Task 4: Build the normalization helper

- **File**: `apps/web/src/lib/snapshots/normalize.ts`
- **Action**: CREATE
- **Implement**:

  ```ts
  import type { ParsedArticle } from '@/lib/parser';

  // Same algorithm as parseGenericArticle.ts:17-19 (normalizeForHash) but
  // operates on a typed ParsedArticle so the MediaWiki + generic branches share
  // a single canonical normalization. Lowercasing is intentional: case-only
  // diffs must not register as snapshot drift (see lex-75 plan, line 117).
  function stripTags(s: string): string {
    return s.replace(/<[^>]+>/g, '').trim();
  }

  export function normalizeArticleText(article: ParsedArticle): string {
    const joined = article.sections.map((s) => s.html).join('\n');
    return stripTags(joined).replace(/\s+/g, ' ').toLowerCase().trim();
  }
  ```

- **Mirror**: `apps/web/src/lib/generic-parser/parseGenericArticle.ts:13-19` — copy the function shape, generalize the input.
- **Validate**: `pnpm --filter web typecheck`.

### Task 5: Build the hash helper

- **File**: `apps/web/src/lib/snapshots/hash.ts`
- **Action**: CREATE
- **Implement**:

  ```ts
  import { createHash } from 'node:crypto';

  export const SNAPSHOT_REVISION_PREFIX = 'sha256:';

  export function sha256Hex(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  export function revisionHashFor(normalizedText: string): string {
    return `${SNAPSHOT_REVISION_PREFIX}${sha256Hex(normalizedText)}`;
  }
  ```

- **Mirror**: `apps/web/src/lib/generic-parser/parseGenericArticle.ts:21-23` (exact same `sha256Hex` body); `apps/web/src/lib/generic-parser/types.ts:10` for the prefix-constant pattern.
- **Validate**: `pnpm --filter web typecheck`.

### Task 6: Build the zstd compression wrapper

- **File**: `apps/web/src/lib/snapshots/compress.ts`
- **Action**: CREATE
- **Implement**:

  ```ts
  // Node-only: do not import from Edge-runtime routes. `@mongodb-js/zstd` is
  // a napi-rs binding and requires `runtime = 'nodejs'`. Mirrors the same
  // constraint as packages/storage/src/client.ts:1-4.
  import { compress, decompress } from '@mongodb-js/zstd';

  /** PRD §14.1: snapshots are zstd level-6 compressed. */
  export const SNAPSHOT_ZSTD_LEVEL = 6;
  /** RFC 8478 + IANA `application/zstd`. */
  export const SNAPSHOT_CONTENT_TYPE = 'application/zstd';

  export async function compressZstd(
    bytes: Buffer,
    level: number = SNAPSHOT_ZSTD_LEVEL,
  ): Promise<Buffer> {
    return compress(bytes, level);
  }

  export async function decompressZstd(bytes: Buffer): Promise<Buffer> {
    return decompress(bytes);
  }
  ```

- **Why this shape**: the wrapper centralizes the level constant so a single edit changes the algorithm. Returning `Buffer` (a `Uint8Array` subclass) is compatible with `putObject`'s `Uint8Array | string` signature (`packages/storage/src/objects.ts:13-17`).
- **Mirror**: top-of-file comment is the same Node-only warning as `packages/storage/src/client.ts:1-4`.
- **Validate**: `pnpm --filter web typecheck`.

### Task 7: Build the storage-key helper

- **File**: `apps/web/src/lib/snapshots/storageKey.ts`
- **Action**: CREATE
- **Implement**:

  ```ts
  // §14.1: "Anchored" snapshots (any snapshot we persist to be referenced by
  // a correction, or potentially to be) live under this prefix and are NOT
  // covered by the unanchored 24h lifecycle rule (packages/storage/src/lifecycle.ts:14).
  // Retention/eviction of orphans is VS-094.
  export const SNAPSHOT_ANCHORED_PREFIX = 'snapshots/anchored/';

  export function snapshotStorageKey(articleId: string, revisionHash: string): string {
    return `${SNAPSHOT_ANCHORED_PREFIX}${articleId}/${revisionHash}.zst`;
  }
  ```

- **Mirror**: `packages/storage/src/lifecycle.ts:14` for the prefix-constant pattern and the comment explaining the lifecycle interaction.
- **Validate**: `pnpm --filter web typecheck`.

### Task 8: Build types + error class

- **File**: `apps/web/src/lib/snapshots/types.ts`
- **Action**: CREATE
- **Implement**:

  ```ts
  export type SnapshotRecord = {
    id: string; // uuid
    articleId: string; // uuid
    revisionHash: string; // sha256:<hex>
    storageKey: string;
    sizeBytes: number;
    fetchedAt: string; // ISO 8601
  };

  export type PersistSnapshotResult = {
    snapshot: SnapshotRecord;
    /** True if `(article_id, revision_hash)` already existed and we returned the existing row. */
    deduped: boolean;
  };

  export type SnapshotPersistErrorDetail =
    | { code: 'article_upsert_failed'; sourceUrl: string; message: string }
    | { code: 'compression_failed'; message: string }
    | { code: 'storage_write_failed'; storageKey: string; message: string }
    | { code: 'db_insert_failed'; message: string };

  export class SnapshotPersistError extends Error {
    readonly detail: SnapshotPersistErrorDetail;
    constructor(detail: SnapshotPersistErrorDetail) {
      super(detail.message ?? detail.code);
      this.name = 'SnapshotPersistError';
      this.detail = detail;
    }
  }
  ```

- **Mirror**: `apps/web/src/lib/generic-parser/types.ts:41-57` for the discriminated `detail` + custom-`Error` shape (identical structure).
- **Validate**: `pnpm --filter web typecheck`.

### Task 9: Build the orchestrator (`persistSnapshot`)

- **File**: `apps/web/src/lib/snapshots/persistSnapshot.ts`
- **Action**: CREATE
- **Implement** (sketch — final code follows TS strictness and naming patterns from the parser module):

  ```ts
  import { getDb, articles, snapshots, sql } from '@veritasee/db';
  import { putObject } from '@veritasee/storage';
  import { logger } from '@/lib/observability';
  import type { ParsedArticle } from '@/lib/parser';
  import { compressZstd, SNAPSHOT_CONTENT_TYPE, SNAPSHOT_ZSTD_LEVEL } from './compress';
  import { revisionHashFor } from './hash';
  import { normalizeArticleText } from './normalize';
  import { snapshotStorageKey } from './storageKey';
  import {
    SnapshotPersistError,
    type PersistSnapshotResult,
    type SnapshotRecord,
  } from './types';

  function articleDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function blobOf(article: ParsedArticle, revisionHash: string): Buffer {
    // Store an envelope, not just normalized text, so VS-027 (drift banner)
    // and the future read path can re-render the section HTML without a
    // re-fetch. `sourceRevision` is the parser-provided id (mw:<revid> or
    // sha256:<hex>), distinct from our canonical `revisionHash`.
    return Buffer.from(
      JSON.stringify({
        v: 1,
        revisionHash,
        sourceRevision: article.revisionHash,
        kind: article.kind,
        url: article.url,
        title: article.title,
        fetchedAt: article.fetchedAt,
        sections: article.sections,
        leadHtml: article.leadHtml,
      }),
      'utf8',
    );
  }

  export async function persistSnapshot(article: ParsedArticle): Promise<PersistSnapshotResult> {
    const start = performance.now();
    const normalized = normalizeArticleText(article);
    const revisionHash = revisionHashFor(normalized);
    const sourceDomain = 'hostname' in article ? article.hostname : articleDomain(article.url);
    const db = getDb();

    // 1) Article upsert. RETURNING gives us the id even on conflict-update.
    let articleId: string;
    try {
      const rows = await db
        .insert(articles)
        .values({
          sourceUrl: article.url,
          sourceDomain,
          currentRevisionHash: revisionHash,
          lastFetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: articles.sourceUrl,
          set: {
            currentRevisionHash: revisionHash,
            lastFetchedAt: new Date(),
          },
        })
        .returning({ id: articles.id });
      const row = rows[0];
      if (!row) throw new Error('insert returned no rows');
      articleId = row.id;
    } catch (err) {
      throw new SnapshotPersistError({
        code: 'article_upsert_failed',
        sourceUrl: article.url,
        message: err instanceof Error ? err.message : 'unknown',
      });
    }

    // 2) Dedupe check before compress to save CPU on the hot path.
    const existing = await db
      .select()
      .from(snapshots)
      .where(sql`${snapshots.articleId} = ${articleId} AND ${snapshots.revisionHash} = ${revisionHash}`)
      .limit(1);
    const hit = existing[0];
    if (hit) {
      logger.info('snapshot_persist_dedupe', {
        event: 'snapshot_persist_dedupe',
        article_id: articleId,
        revision_hash: revisionHash,
        duration_ms: performance.now() - start,
      });
      return {
        snapshot: hitToRecord(hit),
        deduped: true,
      };
    }

    // 3) Compress.
    const raw = blobOf(article, revisionHash);
    let compressed: Buffer;
    try {
      compressed = await compressZstd(raw, SNAPSHOT_ZSTD_LEVEL);
    } catch (err) {
      throw new SnapshotPersistError({
        code: 'compression_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }

    // 4) S3 PUT. Idempotent on the storage side (same key + same bytes).
    const storageKey = snapshotStorageKey(articleId, revisionHash);
    try {
      await putObject(storageKey, compressed, { contentType: SNAPSHOT_CONTENT_TYPE });
    } catch (err) {
      throw new SnapshotPersistError({
        code: 'storage_write_failed',
        storageKey,
        message: err instanceof Error ? err.message : 'unknown',
      });
    }

    // 5) DB insert. ON CONFLICT DO NOTHING handles a race: if two callers
    //    persist the same revision concurrently, only one row materializes.
    //    The follow-up SELECT re-reads the canonical row regardless of which
    //    caller won, so both return the same snapshot id.
    let inserted: { id: string; fetchedAt: Date } | undefined;
    try {
      const rows = await db
        .insert(snapshots)
        .values({
          articleId,
          revisionHash,
          storageKey,
          sizeBytes: compressed.byteLength,
        })
        .onConflictDoNothing({ target: [snapshots.articleId, snapshots.revisionHash] })
        .returning({ id: snapshots.id, fetchedAt: snapshots.fetchedAt });
      inserted = rows[0];
    } catch (err) {
      throw new SnapshotPersistError({
        code: 'db_insert_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }

    if (!inserted) {
      // Conflict — re-read.
      const reread = await db
        .select()
        .from(snapshots)
        .where(sql`${snapshots.articleId} = ${articleId} AND ${snapshots.revisionHash} = ${revisionHash}`)
        .limit(1);
      const row = reread[0];
      if (!row) {
        throw new SnapshotPersistError({
          code: 'db_insert_failed',
          message: 'conflict on insert but row not found on re-read',
        });
      }
      logger.info('snapshot_persist_race_won', {
        event: 'snapshot_persist_race_won',
        article_id: articleId,
        revision_hash: revisionHash,
        duration_ms: performance.now() - start,
      });
      return { snapshot: hitToRecord(row), deduped: true };
    }

    logger.info('snapshot_persist_ok', {
      event: 'snapshot_persist_ok',
      article_id: articleId,
      revision_hash: revisionHash,
      size_bytes: compressed.byteLength,
      duration_ms: performance.now() - start,
    });

    return {
      snapshot: {
        id: inserted.id,
        articleId,
        revisionHash,
        storageKey,
        sizeBytes: compressed.byteLength,
        fetchedAt: inserted.fetchedAt.toISOString(),
      },
      deduped: false,
    };
  }

  function hitToRecord(row: typeof snapshots.$inferSelect): SnapshotRecord {
    return {
      id: row.id,
      articleId: row.articleId,
      revisionHash: row.revisionHash,
      storageKey: row.storageKey,
      sizeBytes: row.sizeBytes,
      fetchedAt: row.fetchedAt.toISOString(),
    };
  }
  ```

- **Mirror**:
  - Error wrapping: `apps/web/src/lib/generic-parser/parseGenericArticle.ts:25-74` (single try/catch around the orchestration, throw a typed error).
  - Logging: `apps/web/src/lib/generic-parser/parseGenericArticle.ts:64-72` (`logger.info('<event>', { event: '<event>', …fields, duration_ms })`).
  - Drizzle `.onConflictDoNothing()` / `.onConflictDoUpdate()`: see Drizzle 0.36 docs; the project already uses raw SQL via `sql` template at `apps/web/src/app/api/health/db/route.ts:10`. Use the builder form for the inserts; fall back to raw `sql\`…\`` only if the builder does not surface a needed shape.
- **Validate**: `pnpm --filter web typecheck`.

### Task 10: Build the barrel

- **File**: `apps/web/src/lib/snapshots/index.ts`
- **Action**: CREATE
- **Implement**:

  ```ts
  export { persistSnapshot } from './persistSnapshot';
  export { normalizeArticleText } from './normalize';
  export { revisionHashFor, sha256Hex, SNAPSHOT_REVISION_PREFIX } from './hash';
  export { compressZstd, decompressZstd, SNAPSHOT_CONTENT_TYPE, SNAPSHOT_ZSTD_LEVEL } from './compress';
  export { snapshotStorageKey, SNAPSHOT_ANCHORED_PREFIX } from './storageKey';
  export { SnapshotPersistError } from './types';
  export type { PersistSnapshotResult, SnapshotRecord, SnapshotPersistErrorDetail } from './types';
  ```

- **Mirror**: `apps/web/src/lib/generic-parser/index.ts`, `apps/web/src/lib/proxy-cache/index.ts` — same barrel style, named exports only, types separated with `export type`.
- **Validate**: `pnpm --filter web typecheck`.

### Task 11: Unit test — `normalize.test.ts`

- **File**: `apps/web/src/lib/snapshots/normalize.test.ts`
- **Action**: CREATE
- **Implement** (cases):
  - Identical sections → identical normalized text.
  - Same plain-text content rendered with different HTML markup (e.g. `<p>foo</p>` vs `<div>foo</div>`) → identical normalized text.
  - Case-only difference (`Foo` vs `foo`) → identical normalized text. *(This is the §14.1 / LEX-75 line-117 invariant.)*
  - Whitespace-only difference (`foo  bar` vs `foo bar\n`) → identical normalized text.
  - Different text → different normalized text.
  - MediaWiki-shaped article (`kind: 'mediawiki'`) and generic-shaped article (`kind: 'generic'`) with the same text → identical normalized output.
- **Mirror**: assertion style at `apps/web/src/lib/generic-parser/parseGenericArticle.test.ts:38-57` (revision-hash determinism + sensitivity).
- **Validate**: `pnpm --filter web test src/lib/snapshots/normalize.test.ts`.

### Task 12: Unit test — `hash.test.ts`

- **File**: `apps/web/src/lib/snapshots/hash.test.ts`
- **Action**: CREATE
- **Implement** (cases):
  - `revisionHashFor('hello')` is `sha256:<64-hex>` and matches the Node-crypto reference value `sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.
  - `revisionHashFor('') !== revisionHashFor('hello')`.
  - Same input → same output across calls (pure).
- **Mirror**: `apps/web/src/lib/proxy-cache/keys.test.ts` (small focused hash-shape test).
- **Validate**: `pnpm --filter web test src/lib/snapshots/hash.test.ts`.

### Task 13: Unit test — `compress.test.ts`

- **File**: `apps/web/src/lib/snapshots/compress.test.ts`
- **Action**: CREATE
- **Implement** (cases):
  - `decompressZstd(await compressZstd(Buffer.from('hello world')))` equals the original bytes.
  - `SNAPSHOT_ZSTD_LEVEL === 6`.
  - Compressed output starts with the zstd magic number `0x28 0xb5 0x2f 0xfd` (RFC 8478 §3.1.1) so an operator inspecting an object can confirm the algorithm. Assertion: `expect(compressed.subarray(0, 4)).toEqual(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))`.
  - Large input (e.g. 100 KB of repeated text) compresses to a smaller byte length than the input — sanity, not a fixed ratio.
- **Mirror**: `packages/storage/test/objects.test.ts:40-60` for the focused-assertion style.
- **Validate**: `pnpm --filter web test src/lib/snapshots/compress.test.ts`. *(Note: this loads the native binding; if Vitest can't resolve it in the unit run, fall back to mocking `@mongodb-js/zstd` in the unit test and exercising the wrapper logic only — but on `linux-x64-gnu` / `darwin-arm64` the prebuilt binding loads cleanly.)*

### Task 14: Unit test — `storageKey.test.ts`

- **File**: `apps/web/src/lib/snapshots/storageKey.test.ts`
- **Action**: CREATE
- **Implement**:
  - `snapshotStorageKey('00000000-0000-0000-0000-000000000001', 'sha256:abc')` returns `'snapshots/anchored/00000000-0000-0000-0000-000000000001/sha256:abc.zst'`.
  - The result starts with `SNAPSHOT_ANCHORED_PREFIX`, not with `UNANCHORED_PREFIX` (assert that the existing `packages/storage` `UNANCHORED_PREFIX = 'snapshots/unanchored/'` constant is **not** a prefix of the returned key — defends the §14.1 retention decision against a future search-and-replace).
- **Validate**: `pnpm --filter web test src/lib/snapshots/storageKey.test.ts`.

### Task 15: Unit test — `persistSnapshot.test.ts` (the AC-coverage test)

- **File**: `apps/web/src/lib/snapshots/persistSnapshot.test.ts`
- **Action**: CREATE
- **Implement**:
  - Mock `@veritasee/db` (drizzle), `@veritasee/storage` (`putObject`), and `@mongodb-js/zstd` (optional — let the real binding run if it loads).
  - Use `vi.hoisted` + `vi.mock(...)` per the `packages/db/test/client.test.ts:1-15` pattern.
  - Build a sample `ParsedArticle` (both `kind: 'generic'` and `kind: 'mediawiki'`).
  - **AC1**: assert the value passed to the `snapshots` insert has `revisionHash === 'sha256:' + sha256(normalizeArticleText(article))` (compute the expected value with the real helpers).
  - **AC2**: call `persistSnapshot()` twice with the same article. Second call returns `{ deduped: true }` and the same `snapshot.id`. Verify the `snapshots` insert was attempted twice (the helper does not skip the insert speculatively, but `onConflictDoNothing` returned 0 rows) **OR** verify the dedupe-by-SELECT short-circuit fires on the second call. Whichever path the implementation took, the **post-condition** is "no new row, same id."
  - **AC3**: assert the `putObject` mock received `(storageKey, Buffer, { contentType: 'application/zstd' })`. Decompress the captured `Buffer` and verify its prefix is the zstd magic number `0x28 0xb5 0x2f 0xfd`, and that `decompressZstd(captured)` parses as JSON containing `revisionHash === expected`.
  - Error paths: storage failure (`putObject` mock rejects) → `SnapshotPersistError` with `code === 'storage_write_failed'`; db insert failure → `code === 'db_insert_failed'`.
- **Mirror**: mock layout at `apps/web/src/lib/proxy-cache/cache.test.ts:1-17` (in-memory double via `vi.mock`); error-class assertions at `apps/web/src/lib/generic-parser/parseGenericArticle.test.ts:59-93`.
- **Validate**: `pnpm --filter web test src/lib/snapshots/persistSnapshot.test.ts`.

### Task 16: Smoke test (env-gated, end-to-end)

- **File**: `apps/web/src/lib/snapshots/persistSnapshot.smoke.test.ts`
- **Action**: CREATE
- **Implement**:
  - Skip if `DATABASE_URL_UNPOOLED`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, or `S3_BUCKET` is unset. Use the same `console.warn` + `it.skip` shape as `packages/storage/test/s3.smoke.test.ts:10-22`.
  - Build a deterministic `GenericArticle` literal (no fetch — keep the smoke test free of network deps beyond Neon + S3).
  - Call `persistSnapshot()` once: assert `deduped === false`, `revisionHash` matches `revisionHashFor(normalizeArticleText(...))`.
  - Read the object back via `getObject(snapshot.storageKey)`, decompress with `decompressZstd`, parse JSON, assert `revisionHash` and `kind` match.
  - Call `persistSnapshot()` again with the same input: assert `deduped === true` and the same `snapshot.id`.
  - Cleanup: `afterAll` deletes the snapshot row (raw `sql\`DELETE FROM snapshots WHERE id = ${id}\``) and the S3 object via `deleteObject`. Treat both as best-effort.
  - File ends with `.smoke.test.ts` so it is picked up only by `pnpm test:smoke` (per `vitest.smoke.workspace.ts:8` and `AGENTS.md`).
- **Mirror**: `packages/storage/test/s3.smoke.test.ts` end-to-end; `packages/db/test/pgvector.smoke.test.ts` env-gate pattern.
- **Validate**: `pnpm test:smoke` (auto-skips on clean clone; passes when env is provided).

### Task 17: Run the migration (manual, documented in the PR description)

- **File**: n/a — operational
- **Action**: documented runbook
- **Implement**: in the PR description, include:

  ```
  Pre-merge ops:
  1. `pnpm db:migrate` against staging Neon (DATABASE_URL_UNPOOLED in shell env).
  2. Verify: \d snapshots shows storage_key + size_bytes, no content column.
  3. Same migration against prod Neon at merge time (or via CI hook if configured).
  ```

  This task does not produce a code change — it's a reminder that the migration must run before any caller (VS-021) lands.

- **Validate**: not applicable at PR time; verified during the merge runbook.

---

## Validation

```bash
# Type check (workspace)
pnpm typecheck

# Lint (workspace)
pnpm lint

# Build (web app — exercises Vercel-style resolution of @mongodb-js/zstd's native binding)
pnpm build

# Unit tests
pnpm test

# Smoke (env-gated; auto-skips if Neon/S3 creds missing)
pnpm test:smoke

# Format check (CI parity)
pnpm format:check
```

The required CI verification set per `AGENTS.md` is `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. All four must pass.

---

## Risks

| Risk                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mongodb-js/zstd` native binding doesn't load on Vercel's runtime (Linux x64).                                       | The package ships a prebuilt `linux-x64-gnu` binary. Verified via `pnpm build` locally before merge. Fallback: switch to `node:zlib` zstd functions and bump `engines.node` to `>=22.15` (single-file change in `compress.ts`).                                                                                                                                                  |
| Schema migration rolled out before consumers, breaking writers that still expect `content`.                           | No production callers insert into `snapshots` today (verified by `grep -rn "snapshots" apps/web/src` returning zero non-schema matches). Migration is safe to run ahead of consumer code, and the migration runs before any caller of `persistSnapshot()` is wired up.                                                                                                           |
| Storage-then-DB ordering can leave an orphan blob if the DB insert fails after S3 PUT.                                | Acceptable: VS-094 (retention) will sweep `snapshots/anchored/` objects whose `storage_key` does not appear in `snapshots.storage_key`. The blob is harmless until then. Documented in the file header and in the Task 9 comment block.                                                                                                                                          |
| Two callers persist the same revision concurrently → unique-index violation on the second insert.                     | `onConflictDoNothing` collapses the race to a single row. The helper re-SELECTs on `deduped` to return the canonical id to both callers. Verified by the test in Task 15.                                                                                                                                                                                                        |
| Normalization rule diverges from the existing `generic-parser`'s rule, producing different hashes for the same input. | Both call sites share the same `stripTags + collapse ws + lowercase + trim` algorithm. Task 11's "same content via different markup" test pins this. **Followup recommended (out of scope here)**: refactor `parseGenericArticle.ts:17-19` to call `normalizeArticleText` so there's a single source of truth — flagged as a v1.1 cleanup, not a blocker for this issue.         |
| Drizzle `.onConflictDoUpdate(target: articles.sourceUrl, …)` requires the target to be a unique constraint Drizzle knows about. | The unique index `articles_source_url_key` (`migrations/0000_lying_marvel_apes.sql:156`) is declared on the schema via `uniqueIndex` (`schema/articles.ts:18`). If Drizzle 0.36 surfaces the conflict target through a different API for `uniqueIndex` vs `unique()`, fall back to raw `sql\`… ON CONFLICT (source_url) DO UPDATE …\`` per the health route pattern.            |
| `pnpm db:generate` requires a reachable Postgres for introspection.                                                   | Use a dummy connection string (`DATABASE_URL_UNPOOLED=postgres://noop`) — `drizzle-kit generate` diffs the TS schema against the recorded `meta/*.json` snapshots and does not actually connect. Documented in Task 2.                                                                                                                                                          |

---

## Out of Scope (deferred to follow-up issues)

- **VS-027** (drift detection + fuzzy re-anchor + "Source has changed" banner). The snapshot blob layout (`v: 1`, envelope JSON) is designed to make VS-027 a pure read-path concern.
- **VS-028** (correction panel + correction save path that consumes `snapshot.id`).
- **VS-094** (retention/eviction: anchored-vs-unanchored promotion, 90-day grace for soft-deleted corrections, 200 GB budget alerts).
- **Refactor of the generic parser** to call into `normalizeArticleText` instead of holding its own copy of `normalizeForHash` — recommended cleanup, not a blocker for AC.
- **Streaming compression** for very large articles. PRD §14.1 caps interest at "≤200 GB compressed snapshots through v1.2"; per-article sizes are well below the napi binding's in-memory ceiling. Revisit only if profiling shows the binding is a bottleneck.
- **Public API or HTTP route** for persisting snapshots. The function is a library; callers are server-side only.

---

## Acceptance Criteria — Implementation Checklist

- [ ] **AC1** — sha256 hash storage:
  - [ ] `normalizeArticleText` produces deterministic lowercase, tag-stripped, whitespace-collapsed text (Task 11).
  - [ ] `revisionHashFor` returns `sha256:<64-hex>` (Task 12).
  - [ ] `persistSnapshot` writes `revisionHash` derived from those two helpers (Task 15 AC1 assertion).
- [ ] **AC2** — `(article_id, hash)` dedupe:
  - [ ] Unique index `snapshots_article_revision_key` preserved across the migration (Task 2 verification).
  - [ ] Second call with identical input returns `{ deduped: true }` and the same `snapshot.id`; only one row exists (Task 15 AC2 assertion + Task 16 smoke).
- [ ] **AC3** — zstd level-6 compression in object storage:
  - [ ] `compressZstd` defaults to level 6, output starts with the zstd magic number (Task 13).
  - [ ] `persistSnapshot` PUTs the compressed bytes with `Content-Type: application/zstd` (Task 15 AC3 assertion).
  - [ ] Round-trip (compress → S3 → fetch → decompress → JSON parse) yields the original envelope (Task 16 smoke).
- [ ] All tasks completed; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
- [ ] No regressions in `generic-parser`, `mediawiki`, or `proxy-cache` test suites.
- [ ] PR description includes the migration runbook from Task 17.
- [ ] Linear issue LEX-76 moved to `In Review` by `/implement` after the PR is opened (per `AGENTS.md` lifecycle rule).
