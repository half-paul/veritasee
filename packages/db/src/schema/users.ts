// Role values mirror `apps/web/src/lib/auth/roles.ts` Role union — keep in sync.
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: text('external_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull().default('contributor'),
    trustPoints: integer('trust_points').notNull().default(0),
    byokProvider: text('byok_provider'),
    byokKeyEncrypted: text('byok_key_encrypted'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_external_id_key').on(t.externalId),
    uniqueIndex('users_email_key').on(t.email),
    check('users_role_check', sql`${t.role} in ('reader','contributor','moderator','admin')`),
    check(
      'users_byok_provider_check',
      sql`${t.byokProvider} is null or ${t.byokProvider} in ('anthropic','openai','gemini','openrouter')`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
