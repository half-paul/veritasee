import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { neon, drizzle } = vi.hoisted(() => ({
  neon: vi.fn((_url: string) => ({ __neon: true })),
  drizzle: vi.fn((_sql: unknown, _opts: unknown) => ({ __drizzle: true })),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon,
}));

vi.mock('drizzle-orm/neon-http', () => ({
  drizzle,
}));

describe('@veritasee/db client', () => {
  const ORIGINAL_URL = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    neon.mockClear();
    drizzle.mockClear();
    process.env.DATABASE_URL = 'postgres://test';
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_URL;
  });

  it('wires neon(DATABASE_URL) into drizzle with the schema', async () => {
    const { getDb } = await import('../src');
    getDb();
    expect(neon).toHaveBeenCalledWith('postgres://test');
    expect(drizzle).toHaveBeenCalledTimes(1);
    expect(drizzle.mock.calls[0]?.[1]).toMatchObject({ schema: expect.any(Object) });
  });

  it('memoizes the drizzle instance across calls', async () => {
    const { getDb } = await import('../src');
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
    expect(drizzle).toHaveBeenCalledTimes(1);
  });

  it('throws when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const { getDb } = await import('../src');
    expect(() => getDb()).toThrow(/DATABASE_URL/);
  });
});
