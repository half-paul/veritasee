import { describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';

const { headBucket } = vi.hoisted(() => ({
  headBucket: vi.fn(),
}));

vi.mock('@veritasee/storage', () => ({
  headBucket,
}));

import { GET } from './route';

describe('GET /api/health/storage', () => {
  it('200 when headBucket resolves', async () => {
    headBucket.mockResolvedValue(undefined);
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/storage' }));
    expect(res.status).toBe(200);
  });

  it('503 with status when AWS error carries httpStatusCode', async () => {
    headBucket.mockRejectedValue(
      Object.assign(new Error('forbidden'), {
        $metadata: { httpStatusCode: 403 },
      }),
    );
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/storage' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string; status?: number };
    expect(body.ok).toBe(false);
    expect(body.status).toBe(403);
  });

  it('503 without status when the error is a plain Error', async () => {
    headBucket.mockRejectedValue(new Error('network'));
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/storage' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string; status?: number };
    expect(body.status).toBeUndefined();
    expect(body.error).toBe('network');
  });
});
