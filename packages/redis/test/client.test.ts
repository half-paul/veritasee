import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { RedisCtor } = vi.hoisted(() => ({
  RedisCtor: vi.fn(() => ({})),
}));

vi.mock('@upstash/redis', () => ({
  Redis: RedisCtor,
}));

describe('@veritasee/redis client', () => {
  const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
  const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    RedisCtor.mockClear();
    process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token-123';
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
    if (ORIGINAL_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
  });

  it('instantiates Redis with URL and token from env', async () => {
    const { getRedis } = await import('../src');
    getRedis();
    expect(RedisCtor).toHaveBeenCalledWith({
      url: 'https://test.upstash.io',
      token: 'token-123',
    });
  });

  it('memoizes — second call does not re-instantiate', async () => {
    const { getRedis } = await import('../src');
    getRedis();
    getRedis();
    expect(RedisCtor).toHaveBeenCalledTimes(1);
  });

  it('throws a useful error when UPSTASH_REDIS_REST_URL is missing', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    const { getRedis } = await import('../src');
    expect(() => getRedis()).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it('throws a useful error when UPSTASH_REDIS_REST_TOKEN is missing', async () => {
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { getRedis } = await import('../src');
    expect(() => getRedis()).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
  });
});
