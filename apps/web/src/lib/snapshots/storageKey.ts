// §14.1: "anchored" snapshots (any snapshot persisted to be referenceable
// by a correction, or potentially to be) live under this prefix and are
// NOT covered by the 24h unanchored lifecycle rule
// (packages/storage/src/lifecycle.ts:14). Retention/eviction of orphans is
// VS-094.
export const SNAPSHOT_ANCHORED_PREFIX = 'snapshots/anchored/';

export function snapshotStorageKey(articleId: string, revisionHash: string): string {
  return `${SNAPSHOT_ANCHORED_PREFIX}${articleId}/${revisionHash}.zst`;
}
