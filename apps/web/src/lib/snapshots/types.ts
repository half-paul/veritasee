// Public types for the snapshot persistence layer.
//
// `SnapshotRecord` is the in-memory shape returned to callers (timestamps
// are ISO 8601 strings, not Date objects, for serialization safety across
// route boundaries). `SnapshotPersistError` mirrors `GenericParserError`
// in shape so callers can branch on `detail.code`.

export type SnapshotRecord = {
  id: string;
  articleId: string;
  /** Canonical hash, formatted `sha256:<64-hex>`. */
  revisionHash: string;
  /** S3/R2 object key of the zstd-compressed envelope. */
  storageKey: string;
  /** Compressed byte count, used for the §14.1 200 GB budget telemetry. */
  sizeBytes: number;
  /** ISO 8601 timestamp. */
  fetchedAt: string;
};

export type PersistSnapshotResult = {
  snapshot: SnapshotRecord;
  /** True if `(article_id, revision_hash)` already existed and the returned row is the existing one. */
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
