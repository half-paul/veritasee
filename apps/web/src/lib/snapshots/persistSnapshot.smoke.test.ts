// End-to-end smoke test: persistSnapshot against real Neon + real R2/S3.
//
// Skips automatically when the required env vars are absent so a clean-clone
// `pnpm test:smoke` run is green-with-skips. Picked up only by the smoke
// workspace (vitest.smoke.workspace.ts) because of the `.smoke.test.ts`
// suffix; excluded from `pnpm test` by apps/web/vitest.config.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GenericArticle } from '@/lib/generic-parser';
import { eq, getDb, snapshots, sql } from '@veritasee/db';
import { deleteObject, getObject } from '@veritasee/storage';
import { decompressZstd } from './compress';
import { revisionHashFor } from './hash';
import { normalizeArticleText } from './normalize';
import { persistSnapshot } from './persistSnapshot';

const dbUrl = process.env['DATABASE_URL'] ?? process.env['DATABASE_URL_UNPOOLED'];
const s3Endpoint = process.env['S3_ENDPOINT'];
const s3Region = process.env['S3_REGION'];
const s3Key = process.env['S3_ACCESS_KEY_ID'];
const s3Secret = process.env['S3_SECRET_ACCESS_KEY'];
const s3Bucket = process.env['S3_BUCKET'];

describe('persistSnapshot smoke', () => {
  if (!dbUrl || !s3Endpoint || !s3Region || !s3Key || !s3Secret || !s3Bucket) {
    console.warn('DATABASE_URL/S3_* unset — skipping persistSnapshot smoke test');
    it.skip('round-trips a snapshot through Neon + R2/S3 (skipped: env unset)', () => {});
    return;
  }

  // Deterministic, test-domain URL: any leak left behind by a failed
  // cleanup is identifiable and GC-able by humans/scripts later.
  const testUrl = `https://smoke-test.veritasee.local/snapshot-persistence/${Date.now()}`;
  const article: GenericArticle = {
    kind: 'generic',
    url: testUrl,
    hostname: 'smoke-test.veritasee.local',
    title: 'Smoke',
    revisionHash: 'sha256:placeholder',
    fetchedAt: new Date().toISOString(),
    sections: [
      {
        id: '',
        title: 'Smoke',
        level: 0,
        html: `<p>smoke test ${Date.now()}</p>`,
      },
    ],
    leadHtml: '<p>smoke test</p>',
  };

  let snapshotId: string | undefined;
  let storageKey: string | undefined;

  beforeAll(() => {
    // No-op; placeholder for future bootstrap.
  });

  afterAll(async () => {
    // Best-effort cleanup. If anything throws, the test-domain URL above
    // makes the orphans easy to find and reap manually.
    try {
      if (snapshotId) {
        await getDb().delete(snapshots).where(eq(snapshots.id, snapshotId));
      }
      // Also delete the article row we created so the smoke test is
      // truly idempotent.
      await getDb().execute(sql`DELETE FROM articles WHERE source_url = ${testUrl}`);
    } catch {
      // ignore
    }
    try {
      if (storageKey) await deleteObject(storageKey);
    } catch {
      // ignore — orphan blob is harmless (VS-094 will reap)
    }
  });

  it('round-trips a snapshot through Neon + R2/S3 with sha256 hash + zstd magic + dedupe', async () => {
    const expectedHash = revisionHashFor(normalizeArticleText(article));

    const first = await persistSnapshot(article);
    snapshotId = first.snapshot.id;
    storageKey = first.snapshot.storageKey;

    expect(first.deduped).toBe(false);
    expect(first.snapshot.revisionHash).toBe(expectedHash);
    expect(first.snapshot.sizeBytes).toBeGreaterThan(0);

    // Read the object back, decompress, verify the envelope.
    const bytes = await getObject(first.snapshot.storageKey);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
    const decompressed = await decompressZstd(Buffer.from(bytes));
    const envelope = JSON.parse(decompressed.toString('utf8'));
    expect(envelope.v).toBe(1);
    expect(envelope.revisionHash).toBe(expectedHash);
    expect(envelope.kind).toBe('generic');

    // Second persist must dedupe.
    const second = await persistSnapshot(article);
    expect(second.deduped).toBe(true);
    expect(second.snapshot.id).toBe(first.snapshot.id);
  });
});
