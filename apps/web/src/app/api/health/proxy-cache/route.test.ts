import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';
import { createMockRedis, type MockRedis } from '@test/factories/mockRedis';

let mock: MockRedis;
vi.mock('@veritasee/redis', () => ({
  getRedis: () => mock,
}));

import { GET } from './route';

const URL_BASE = 'https://localhost/api/health/proxy-cache';

describe('GET /api/health/proxy-cache', () => {
  const ORIGINAL_TOKEN = process.env.PROXY_CACHE_HEALTH_TOKEN;

  beforeEach(() => {
    mock = createMockRedis();
    delete process.env.PROXY_CACHE_HEALTH_TOKEN;
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.PROXY_CACHE_HEALTH_TOKEN;
    else process.env.PROXY_CACHE_HEALTH_TOKEN = ORIGINAL_TOKEN;
    vi.unstubAllEnvs();
  });

  it('200 when the set/get/ttl/delete probe roundtrip succeeds', async () => {
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ttl: number };
    expect(body.ok).toBe(true);
    expect(body.ttl).toBeGreaterThan(0);
  });

  it('503 in production when PROXY_CACHE_HEALTH_TOKEN is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('health_token_unconfigured');
  });

  it('401 when the token is configured but missing on the request', async () => {
    process.env.PROXY_CACHE_HEALTH_TOKEN = 'secret-token';
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(401);
  });

  it('401 when the supplied token does not match', async () => {
    process.env.PROXY_CACHE_HEALTH_TOKEN = 'secret-token';
    const res = await GET(
      buildRequest({
        url: URL_BASE,
        headers: { 'x-health-token': 'wrong' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('200 when the supplied token matches', async () => {
    process.env.PROXY_CACHE_HEALTH_TOKEN = 'secret-token';
    const res = await GET(
      buildRequest({
        url: URL_BASE,
        headers: { 'x-health-token': 'secret-token' },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('503 when redis throws during the probe roundtrip', async () => {
    mock.set = vi.fn(async () => {
      throw new Error('upstash down');
    }) as unknown as MockRedis['set'];
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(503);
  });
});
