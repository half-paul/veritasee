// Snapshot persistence orchestrator. Turns a `ParsedArticle` into a row in
// `snapshots` + an object in S3/R2.
//
// ## Contract
//
// `persistSnapshot` is the **live-fetch path**. Callers must invoke it with
// an article they just fetched from origin — never with stale or
// historical data. The article-row upsert unconditionally bumps
// `current_revision_hash` and `last_fetched_at` on the matched row, so
// calling with an older revision would clobber the read-side drift
// comparison value (FR-VW-5). Future paths that re-persist historical
// snapshots (drift compare-jobs, backfill) must take a different code path.
//
// `last_fetched_at` is updated on every successful persist *including
// dedupe hits* (the content was the same, but we did re-validate against
// origin) — so it reads as "last time we re-validated," not "last time
// content changed."
//
// ## Stored blob format (envelope v1)
//
// The compressed blob is a JSON envelope, **not** the bare normalized text
// the hash hashes. The envelope includes:
//
// - `v: 1`              — schema version (bump on any breaking change)
// - `revisionHash`      — `sha256:<hex>` of the normalized text (this row's PK component)
// - `sourceRevision`    — parser-provided id (`mw:<revid>` or `sha256:<hex>`); lets VS-027 short-circuit MediaWiki drift checks by revid
// - `kind` / `url` / `title` / `fetchedAt`
// - `sections`          — array of `{ id, title, level, html }` for re-rendering without re-fetch
// - `leadHtml`          — convenience accessor for `sections[0].html`
//
// VS-027 reads this envelope to compare against a fresh fetch and render
// the "Source has changed" banner; VS-028 reads it to pin a correction.
//
// ## Ordering: storage PUT before DB insert
//
// If the DB insert fails after the PUT, the orphan blob is harmless (VS-094
// sweeps `snapshots/anchored/` against `snapshots.storage_key`). The
// inverse — DB insert with a missing blob — would 500 every future read of
// that snapshot. See plan §6 for the full reasoning.

import { and, eq, getDb, articles, snapshots, type Snapshot } from '@veritasee/db';
import { putObject } from '@veritasee/storage';
import type { ParsedArticle } from '@/lib/parser';
import { logger } from '@/lib/observability';
import { compressZstd, SNAPSHOT_CONTENT_TYPE, SNAPSHOT_ZSTD_LEVEL } from './compress';
import { revisionHashFor } from './hash';
import { normalizeArticleText } from './normalize';
import { snapshotStorageKey } from './storageKey';
import { SnapshotPersistError, type PersistSnapshotResult, type SnapshotRecord } from './types';

const ENVELOPE_VERSION = 1;

function articleHostname(article: ParsedArticle): string {
  // Branch on the discriminant rather than property existence; the generic
  // branch carries `hostname` directly, the MediaWiki branch derives it
  // from `url`. `new URL` throws on malformed URLs — which is impossible by
  // construction (callers feed normalized URLs) but we'd rather crash than
  // insert an empty string into a NOT NULL column.
  return article.kind === 'generic' ? article.hostname : new URL(article.url).hostname;
}

function blobOf(article: ParsedArticle, revisionHash: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      v: ENVELOPE_VERSION,
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

function toRecord(row: Snapshot): SnapshotRecord {
  return {
    id: row.id,
    articleId: row.articleId,
    revisionHash: row.revisionHash,
    storageKey: row.storageKey,
    sizeBytes: row.sizeBytes,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

export async function persistSnapshot(article: ParsedArticle): Promise<PersistSnapshotResult> {
  const start = performance.now();
  const normalized = normalizeArticleText(article);
  const revisionHash = revisionHashFor(normalized);
  const sourceDomain = articleHostname(article);
  const now = new Date();
  const db = getDb();

  // 1) Article upsert. RETURNING gives us the id on both the insert and the
  //    update branch. See module header: this is the live-fetch path; the
  //    SET clause overwrites the row's `current_revision_hash` and
  //    `last_fetched_at` unconditionally.
  let articleId: string;
  try {
    const rows = await db
      .insert(articles)
      .values({
        sourceUrl: article.url,
        sourceDomain,
        currentRevisionHash: revisionHash,
        lastFetchedAt: now,
      })
      .onConflictDoUpdate({
        target: articles.sourceUrl,
        set: {
          currentRevisionHash: revisionHash,
          lastFetchedAt: now,
        },
      })
      .returning({ id: articles.id });
    const row = rows[0];
    if (!row) {
      throw new Error('article upsert returned no rows');
    }
    articleId = row.id;
  } catch (err) {
    throw new SnapshotPersistError({
      code: 'article_upsert_failed',
      sourceUrl: article.url,
      message: err instanceof Error ? err.message : 'unknown',
    });
  }

  // 2) Compress the envelope. zstd-6 on a typical 50–200 KB article is
  //    ~5–15 ms of CPU. We do NOT pre-SELECT for an existing
  //    (article_id, revision_hash) row — on the Neon HTTP driver each
  //    statement is an independent fetch (~30–80 ms RTT), so the
  //    speculative-SELECT optimization would be a net negative for the
  //    common new-revision case. Dedupe is handled by ON CONFLICT below.
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

  // 3) S3 PUT. Idempotent at the storage layer (same key + same bytes).
  //    On the dedupe path the PUT is wasted bandwidth but self-heals any
  //    object that previously went missing; the cost is bounded upstream
  //    by the proxy-cache Redis dedupe.
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

  // 4) DB insert with ON CONFLICT DO NOTHING. On a race (two callers
  //    persisting the same revision concurrently) only one row materializes;
  //    the loser re-SELECTs the winner's row so both callers see the same
  //    canonical id.
  let inserted: Snapshot | undefined;
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
      .returning();
    inserted = rows[0];
  } catch (err) {
    throw new SnapshotPersistError({
      code: 'db_insert_failed',
      message: err instanceof Error ? err.message : 'unknown',
    });
  }

  const duration_ms = performance.now() - start;

  if (!inserted) {
    // Conflict (or dedupe) — re-read the canonical row.
    const reread = await db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.articleId, articleId), eq(snapshots.revisionHash, revisionHash)))
      .limit(1);
    const row = reread[0];
    if (!row) {
      throw new SnapshotPersistError({
        code: 'db_insert_failed',
        message: 'conflict on insert but row not found on re-read',
      });
    }
    logger.info('snapshot_persist_dedupe', {
      event: 'snapshot_persist_dedupe',
      article_id: articleId,
      revision_hash: revisionHash,
      duration_ms,
    });
    return { snapshot: toRecord(row), deduped: true };
  }

  logger.info('snapshot_persist_ok', {
    event: 'snapshot_persist_ok',
    article_id: articleId,
    revision_hash: revisionHash,
    size_bytes: compressed.byteLength,
    duration_ms,
  });

  return {
    snapshot: toRecord(inserted),
    deduped: false,
  };
}
