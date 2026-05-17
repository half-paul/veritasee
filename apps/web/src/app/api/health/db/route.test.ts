import { describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';

const { execute } = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('@veritasee/db', () => ({
  getDb: () => ({ execute }),
  sql: (strings: TemplateStringsArray) => strings.join(''),
}));

import { GET } from './route';

describe('GET /api/health/db', () => {
  it('200 when the trivial select returns { ok: 1 }', async () => {
    execute.mockResolvedValue([{ ok: 1 }]);
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/db' }));
    expect(res.status).toBe(200);
  });

  it('200 when the driver shape is { rows: [{ ok: 1 }] }', async () => {
    execute.mockResolvedValue({ rows: [{ ok: 1 }] });
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/db' }));
    expect(res.status).toBe(200);
  });

  it('503 when the driver returns an unexpected shape', async () => {
    execute.mockResolvedValue([{ ok: 0 }]);
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/db' }));
    expect(res.status).toBe(503);
  });

  it('503 when execute throws', async () => {
    execute.mockRejectedValue(new Error('neon timeout'));
    const res = await GET(buildRequest({ url: 'https://localhost/api/health/db' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('neon');
  });
});
