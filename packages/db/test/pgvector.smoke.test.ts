import { neon } from '@neondatabase/serverless';
import { describe, expect, it } from 'vitest';

const url = process.env['DATABASE_URL_UNPOOLED'];

describe('pgvector extension', () => {
  if (!url) {
    console.warn('DATABASE_URL_UNPOOLED unset — skipping pgvector load test');
    it.skip('pgvector is loadable (skipped: no DATABASE_URL_UNPOOLED)', () => {});
    return;
  }

  it('is loadable', async () => {
    const sql = neon(url);
    const rows = (await sql`select extname from pg_extension where extname = 'vector'`) as Array<{
      extname: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.extname).toBe('vector');
  });
});
