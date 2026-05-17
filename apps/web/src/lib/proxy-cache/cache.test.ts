import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRedis, type MockRedis } from '@test/factories/mockRedis';

// Mock @veritasee/redis so cache.ts grabs our in-memory double.
let mock: MockRedis;
vi.mock('@veritasee/redis', () => ({
  getRedis: () => mock,
}));

import {
  getCached,
  getCachedFresh,
  invalidateCached,
  setCached,
} from './cache';
import { proxyCacheKey } from './keys';
import { MAX_PAYLOAD_BYTES, PROXY_CACHE_TTL_SECONDS, type CachedProxyResponse } from './types';

const URL_A = 'https://en.wikipedia.org/wiki/A';

function makeEntry(overrides: Partial<CachedProxyResponse> = {}): CachedProxyResponse {
  return {
    url: URL_A,
    revisionHash: 'sha:1',
    fetchedAt: '2026-05-16T00:00:00.000Z',
    payload: 'hello',
    contentType: 'text/html; charset=utf-8',
    ...overrides,
  };
}

describe('proxy-cache: set/get/invalidate', () => {
  beforeEach(() => {
    mock = createMockRedis();
  });

  it('set then get returns the same entry', async () => {
    const entry = makeEntry();
    const wrote = await setCached(URL_A, entry);
    expect(wrote).toBe(true);
    const got = await getCached(URL_A);
    expect(got).toEqual(entry);
  });

  it('get returns null on a cache miss', async () => {
    expect(await getCached(URL_A)).toBeNull();
  });

  it('invalidate removes the key', async () => {
    await setCached(URL_A, makeEntry());
    await invalidateCached(URL_A);
    expect(await getCached(URL_A)).toBeNull();
  });

  it('set applies the TTL of 900s', async () => {
    await setCached(URL_A, makeEntry());
    const ttl = await mock.ttl(proxyCacheKey(URL_A));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PROXY_CACHE_TTL_SECONDS);
  });

  it('refuses to write a payload exceeding MAX_PAYLOAD_BYTES', async () => {
    const big = 'x'.repeat(MAX_PAYLOAD_BYTES + 1);
    const wrote = await setCached(URL_A, makeEntry({ payload: big }));
    expect(wrote).toBe(false);
    expect(await getCached(URL_A)).toBeNull();
  });

  it('writes a payload exactly at MAX_PAYLOAD_BYTES', async () => {
    const at = 'x'.repeat(MAX_PAYLOAD_BYTES);
    const wrote = await setCached(URL_A, makeEntry({ payload: at }));
    expect(wrote).toBe(true);
  });
});

describe('proxy-cache: getCachedFresh revision check', () => {
  beforeEach(() => {
    mock = createMockRedis();
  });

  it('returns the cached entry when no expected revision is given', async () => {
    await setCached(URL_A, makeEntry({ revisionHash: 'sha:1' }));
    const got = await getCachedFresh(URL_A);
    expect(got?.revisionHash).toBe('sha:1');
  });

  it('returns the entry when the expected revision matches', async () => {
    await setCached(URL_A, makeEntry({ revisionHash: 'sha:1' }));
    const got = await getCachedFresh(URL_A, 'sha:1');
    expect(got?.revisionHash).toBe('sha:1');
  });

  it('invalidates and returns null when the revision differs (drift)', async () => {
    await setCached(URL_A, makeEntry({ revisionHash: 'sha:1' }));
    const got = await getCachedFresh(URL_A, 'sha:2');
    expect(got).toBeNull();
    // Stale entry should be evicted so the next call doesn't re-serve it.
    expect(await getCached(URL_A)).toBeNull();
  });

  it('returns null on a fresh miss (no invalidate needed)', async () => {
    const got = await getCachedFresh(URL_A, 'sha:1');
    expect(got).toBeNull();
  });
});
