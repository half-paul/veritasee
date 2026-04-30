import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { requireEnv } from '../src/env';

async function main() {
  const url = requireEnv('DATABASE_URL_UNPOOLED');
  const sql = neon(url);
  const db = drizzle(sql);
  console.log('Applying migrations…');
  await migrate(db, { migrationsFolder: './migrations' });
  console.log('Migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
