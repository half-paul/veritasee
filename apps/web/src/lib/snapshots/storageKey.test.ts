import { describe, expect, it } from 'vitest';
import { UNANCHORED_PREFIX } from '@veritasee/storage';
import { SNAPSHOT_ANCHORED_PREFIX, snapshotStorageKey } from './storageKey';

describe('snapshotStorageKey', () => {
  it('formats the key under the anchored prefix with a .zst suffix', () => {
    const key = snapshotStorageKey('00000000-0000-0000-0000-000000000001', 'sha256:abc');
    expect(key).toBe('snapshots/anchored/00000000-0000-0000-0000-000000000001/sha256:abc.zst');
  });

  it('uses the anchored prefix, never the unanchored one (§14.1 lifecycle invariant)', () => {
    const key = snapshotStorageKey('a', 'sha256:b');
    expect(key.startsWith(SNAPSHOT_ANCHORED_PREFIX)).toBe(true);
    expect(key.startsWith(UNANCHORED_PREFIX)).toBe(false);
  });
});
