import { afterAll, describe, expect, it } from 'vitest';
import { getRedis } from '../src';

const url = process.env['UPSTASH_REDIS_REST_URL'];
const token = process.env['UPSTASH_REDIS_REST_TOKEN'];

describe('upstash redis smoke', () => {
  if (!url || !token) {
    console.warn('UPSTASH_REDIS_REST_URL/_TOKEN unset — skipping redis smoke test');
    it.skip('SET/GET/EXPIRE roundtrip (skipped: no upstash env)', () => {});
    return;
  }

  const key = `veritasee:smoke:${Date.now()}`;
  const client = getRedis();

  afterAll(async () => {
    await client.del(key);
  });

  it('SET with EXPIRE then GET returns the value', async () => {
    await client.set(key, 'ok', { ex: 60 });
    const value = await client.get<string>(key);
    expect(value).toBe('ok');
  });

  it('TTL reflects the EXPIRE window', async () => {
    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
