// Node-only: do not import from Edge-runtime routes. `@mongodb-js/zstd` is
// a prebuilt N-API binding and requires `runtime = 'nodejs'`. Mirrors the
// same constraint as packages/storage/src/client.ts.

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
