import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { corrections } from './corrections';
import { users } from './users';

export const moderationDecisions = pgTable(
  'moderation_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correctionId: uuid('correction_id')
      .notNull()
      .references(() => corrections.id, { onDelete: 'cascade' }),
    moderatorId: uuid('moderator_id')
      .notNull()
      .references(() => users.id),
    decision: text('decision').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'moderation_decisions_decision_check',
      sql`${t.decision} in ('approve','reject','revise')`,
    ),
  ],
);

export const reputationEvents = pgTable(
  'reputation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    correctionId: uuid('correction_id').references(() => corrections.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reputation_events_user_created_idx').on(t.userId, t.createdAt)],
);

export type ModerationDecision = typeof moderationDecisions.$inferSelect;
export type NewModerationDecision = typeof moderationDecisions.$inferInsert;
export type ReputationEvent = typeof reputationEvents.$inferSelect;
export type NewReputationEvent = typeof reputationEvents.$inferInsert;
