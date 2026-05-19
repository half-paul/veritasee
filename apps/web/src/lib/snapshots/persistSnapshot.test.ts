import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenericArticle } from '@/lib/generic-parser';
import type { MediaWikiArticle, Section } from '@/lib/mediawiki';

// Hoisted: defined before any module under test is imported. The fake DB
// keeps a tiny mutable state and recognizes which builder branch is in
// play by the reference equality of the table/column sentinels below.
const fixtures = vi.hoisted(() => {
  type FakeSnapshotRow = {
    id: string;
    articleId: string;
    revisionHash: string;
    storageKey: string;
    sizeBytes: number;
    fetchedAt: Date;
  };
  type Article = {
    id: string;
    sourceUrl: string;
    sourceDomain: string;
    currentRevisionHash: string | null;
    lastFetchedAt: Date | null;
  };

  const articleIdCol = Symbol('snapshots.articleId');
  const revisionHashCol = Symbol('snapshots.revisionHash');
  const sourceUrlCol = Symbol('articles.sourceUrl');

  const articlesTable = { sourceUrl: sourceUrlCol } as const;
  const snapshotsTable = {
    articleId: articleIdCol,
    revisionHash: revisionHashCol,
  } as const;

  const state = {
    articles: [] as Article[],
    snapshots: [] as FakeSnapshotRow[],
    failSnapshotInsert: false,
    failArticleUpsert: false,
    nextArticleN: 1,
    nextSnapshotN: 1,
  };

  function reset(): void {
    state.articles = [];
    state.snapshots = [];
    state.failSnapshotInsert = false;
    state.failArticleUpsert = false;
    state.nextArticleN = 1;
    state.nextSnapshotN = 1;
  }

  function newArticleId(): string {
    return `00000000-0000-0000-0000-${String(state.nextArticleN++).padStart(12, '0')}`;
  }
  function newSnapshotId(): string {
    return `11111111-1111-1111-1111-${String(state.nextSnapshotN++).padStart(12, '0')}`;
  }
  function findArticleByUrl(url: string): Article | undefined {
    return state.articles.find((a) => a.sourceUrl === url);
  }
  function findSnapshot(articleId: string, revisionHash: string): FakeSnapshotRow | undefined {
    return state.snapshots.find(
      (s) => s.articleId === articleId && s.revisionHash === revisionHash,
    );
  }

  function makeInsertBuilder(table: unknown) {
    return {
      values(input: Record<string, unknown>) {
        return {
          onConflictDoUpdate(_opts: unknown) {
            return {
              async returning(_select?: unknown): Promise<Array<{ id: string }>> {
                if (table === articlesTable) {
                  if (state.failArticleUpsert) throw new Error('articles upsert failed');
                  const url = input['sourceUrl'] as string;
                  const existing = findArticleByUrl(url);
                  if (existing) {
                    existing.currentRevisionHash = input['currentRevisionHash'] as string;
                    existing.lastFetchedAt = input['lastFetchedAt'] as Date;
                    return [{ id: existing.id }];
                  }
                  const row: Article = {
                    id: newArticleId(),
                    sourceUrl: url,
                    sourceDomain: input['sourceDomain'] as string,
                    currentRevisionHash: input['currentRevisionHash'] as string,
                    lastFetchedAt: input['lastFetchedAt'] as Date,
                  };
                  state.articles.push(row);
                  return [{ id: row.id }];
                }
                throw new Error('unsupported insert target');
              },
            };
          },
          onConflictDoNothing(_opts: unknown) {
            return {
              async returning(): Promise<FakeSnapshotRow[]> {
                if (table === snapshotsTable) {
                  if (state.failSnapshotInsert) throw new Error('snapshot insert failed');
                  const articleId = input['articleId'] as string;
                  const revisionHash = input['revisionHash'] as string;
                  const existing = findSnapshot(articleId, revisionHash);
                  if (existing) return [];
                  const row: FakeSnapshotRow = {
                    id: newSnapshotId(),
                    articleId,
                    revisionHash,
                    storageKey: input['storageKey'] as string,
                    sizeBytes: input['sizeBytes'] as number,
                    fetchedAt: new Date('2026-05-18T00:00:00.000Z'),
                  };
                  state.snapshots.push(row);
                  return [row];
                }
                throw new Error('unsupported insert target');
              },
            };
          },
        };
      },
    };
  }

  const db = {
    insert(table: unknown) {
      return makeInsertBuilder(table);
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where(predicate: { __articleId?: string; __revisionHash?: string }) {
              return {
                async limit(_n: number): Promise<FakeSnapshotRow[]> {
                  if (
                    table === snapshotsTable &&
                    predicate.__articleId &&
                    predicate.__revisionHash
                  ) {
                    const row = findSnapshot(predicate.__articleId, predicate.__revisionHash);
                    return row ? [row] : [];
                  }
                  return [];
                },
              };
            },
          };
        },
      };
    },
  };

  const putObject = vi.fn(async (_key: string, _body: Uint8Array, _opts?: unknown) => {});

  return {
    state,
    reset,
    db,
    putObject,
    articlesTable,
    snapshotsTable,
    articleIdCol,
    revisionHashCol,
  };
});

vi.mock('@veritasee/db', () => ({
  getDb: () => fixtures.db,
  articles: fixtures.articlesTable,
  snapshots: fixtures.snapshotsTable,
  and: (...preds: unknown[]) => {
    const merged: Record<string, unknown> = {};
    for (const p of preds) Object.assign(merged, p as object);
    return merged;
  },
  eq: (col: unknown, val: unknown) => {
    if (col === fixtures.articleIdCol) return { __articleId: val };
    if (col === fixtures.revisionHashCol) return { __revisionHash: val };
    return {};
  },
}));

vi.mock('@veritasee/storage', () => ({
  putObject: (key: string, body: Uint8Array, opts?: unknown) => fixtures.putObject(key, body, opts),
}));

import { revisionHashFor } from './hash';
import { normalizeArticleText } from './normalize';
import { decompressZstd } from './compress';
import { snapshotStorageKey } from './storageKey';
import { SnapshotPersistError } from './types';
import { persistSnapshot } from './persistSnapshot';

function genericArticle(overrides: Partial<GenericArticle> = {}): GenericArticle {
  return {
    kind: 'generic',
    url: 'https://example.com/a',
    hostname: 'example.com',
    title: 'Hello',
    revisionHash: 'sha256:placeholder',
    fetchedAt: '2026-05-18T00:00:00.000Z',
    sections: [{ id: '', title: 'Hello', level: 0, html: '<p>hello world</p>' }],
    leadHtml: '<p>hello world</p>',
    ...overrides,
  };
}

function mediawikiArticle(): MediaWikiArticle {
  const sections: Section[] = [
    { id: '', title: 'Hello', level: 0, html: '<p>hello mediawiki</p>' },
  ];
  return {
    kind: 'mediawiki',
    url: 'https://en.wikipedia.org/wiki/Hello',
    title: 'Hello',
    revisionHash: 'mw:42',
    pageId: 1,
    fetchedAt: '2026-05-18T00:00:00.000Z',
    sections,
    leadHtml: sections[0]?.html ?? '',
  };
}

describe('persistSnapshot', () => {
  beforeEach(() => {
    fixtures.reset();
    fixtures.putObject.mockClear();
    fixtures.putObject.mockImplementation(async () => {});
  });

  it('AC1: stores sha256(normalized text) as revision_hash with the sha256: prefix', async () => {
    const article = genericArticle();
    const expectedHash = revisionHashFor(normalizeArticleText(article));
    const { snapshot, deduped } = await persistSnapshot(article);
    expect(deduped).toBe(false);
    expect(snapshot.revisionHash).toBe(expectedHash);
    expect(snapshot.revisionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('AC2: second call with the same article returns deduped=true and the same snapshot id', async () => {
    const article = genericArticle();
    const a = await persistSnapshot(article);
    expect(a.deduped).toBe(false);
    const b = await persistSnapshot(article);
    expect(b.deduped).toBe(true);
    expect(b.snapshot.id).toBe(a.snapshot.id);
    expect(fixtures.state.snapshots).toHaveLength(1);
  });

  it('AC3: PUTs zstd-compressed bytes with the correct content type and storage key', async () => {
    const article = genericArticle();
    const { snapshot } = await persistSnapshot(article);

    expect(fixtures.putObject).toHaveBeenCalledTimes(1);
    const call = fixtures.putObject.mock.calls[0]!;
    const [key, body, opts] = call;
    expect(opts).toEqual({ contentType: 'application/zstd' });
    expect(key).toBe(snapshotStorageKey(snapshot.articleId, snapshot.revisionHash));
    expect(Array.from((body as Buffer).subarray(0, 4))).toEqual([0x28, 0xb5, 0x2f, 0xfd]);

    const decompressed = await decompressZstd(body as Buffer);
    const envelope = JSON.parse(decompressed.toString('utf8'));
    expect(envelope.v).toBe(1);
    expect(envelope.revisionHash).toBe(snapshot.revisionHash);
    expect(envelope.kind).toBe('generic');
    expect(envelope.sourceRevision).toBe(article.revisionHash);
    expect(envelope.url).toBe(article.url);
  });

  it('handles a mediawiki-shaped article and derives the hostname from its URL', async () => {
    const article = mediawikiArticle();
    const result = await persistSnapshot(article);
    expect(result.deduped).toBe(false);
    const stored = fixtures.state.articles[0];
    expect(stored?.sourceDomain).toBe('en.wikipedia.org');
  });

  it('throws SnapshotPersistError with code storage_write_failed when putObject rejects', async () => {
    fixtures.putObject.mockImplementation(async () => {
      throw new Error('boom');
    });
    await expect(persistSnapshot(genericArticle())).rejects.toMatchObject({
      name: 'SnapshotPersistError',
      detail: { code: 'storage_write_failed' },
    });
  });

  it('throws SnapshotPersistError with code db_insert_failed when the snapshots insert throws', async () => {
    fixtures.state.failSnapshotInsert = true;
    try {
      await persistSnapshot(genericArticle());
      throw new Error('expected SnapshotPersistError');
    } catch (err) {
      expect(err).toBeInstanceOf(SnapshotPersistError);
      expect((err as SnapshotPersistError).detail.code).toBe('db_insert_failed');
    }
  });

  it('throws SnapshotPersistError with code article_upsert_failed when the article upsert throws', async () => {
    fixtures.state.failArticleUpsert = true;
    try {
      await persistSnapshot(genericArticle());
      throw new Error('expected SnapshotPersistError');
    } catch (err) {
      expect((err as SnapshotPersistError).detail.code).toBe('article_upsert_failed');
    }
  });
});
