import { describe, expect, it } from 'vitest';
import { compressZstd, decompressZstd, SNAPSHOT_ZSTD_LEVEL } from './compress';

describe('compress / decompress', () => {
  it('round-trips identical bytes', async () => {
    const original = Buffer.from('hello world');
    const compressed = await compressZstd(original);
    const decompressed = await decompressZstd(compressed);
    // Compare as plain arrays to sidestep Buffer-vs-Uint8Array prototype
    // mismatches in vitest matchers.
    expect(Array.from(decompressed)).toEqual(Array.from(original));
  });

  it('defaults to PRD §14.1 level 6', () => {
    expect(SNAPSHOT_ZSTD_LEVEL).toBe(6);
  });

  it('emits the zstd frame magic number (RFC 8478 §3.1.1)', async () => {
    const compressed = await compressZstd(Buffer.from('hello world'));
    expect(Array.from(compressed.subarray(0, 4))).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
  });

  it('compresses repeated data to fewer bytes than the input', async () => {
    const original = Buffer.from('the quick brown fox jumps over the lazy dog '.repeat(2000));
    const compressed = await compressZstd(original);
    expect(compressed.byteLength).toBeLessThan(original.byteLength);
  });
});
