import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';
import { createMockRedis, type MockRedis } from '@test/factories/mockRedis';

let mock: MockRedis;
vi.mock('@veritasee/redis', () => ({
  getRedis: () => mock,
}));

import { GET } from './route';

describe('GET /api/health/redis', () => {
  beforeEach(() => {
    mock = createMockRedis();
  });

  it('200 when ping returns PONG', async () => {
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/redis' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('503 when ping throws', async () => {
    mock.ping = vi.fn(async () => {
      throw new Error('upstash unreachable');
    }) as unknown as MockRedis['ping'];
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/redis' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('upstash');
  });

  it('503 when ping returns an unexpected value', async () => {
    mock.ping = vi.fn(async () => 'NOT-PONG') as unknown as MockRedis['ping'];
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/redis' }));
    expect(res.status).toBe(503);
  });
});
