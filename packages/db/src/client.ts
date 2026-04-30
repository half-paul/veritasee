import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { requireEnv } from './env';
import { schema } from './schema';

type Db = NeonHttpDatabase<typeof schema>;

let cached: Db | undefined;

export function getDb(): Db {
  if (!cached) {
    const sql = neon(requireEnv('DATABASE_URL'));
    cached = drizzle(sql, { schema });
  }
  return cached;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});
