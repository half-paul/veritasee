import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';
import { articles, snapshots } from './articles';
import { users } from './users';

export const corrections = pgTable(
  'corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => snapshots.id),
    anchorTextFragment: text('anchor_text_fragment').notNull(),
    anchorPrefix: text('anchor_prefix'),
    anchorSuffix: text('anchor_suffix'),
    bodyMd: text('body_md').notNull(),
    verityScore: integer('verity_score'),
    rationale: text('rationale'),
    status: text('status').notNull().default('pending'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('corrections_article_status_idx').on(t.articleId, t.status),
    index('corrections_author_idx').on(t.authorId),
    check(
      'corrections_status_check',
      sql`${t.status} in ('pending','approved','rejected','withdrawn')`,
    ),
    check(
      'corrections_verity_score_check',
      sql`${t.verityScore} is null or (${t.verityScore} between 0 and 100)`,
    ),
  ],
);

// PRD §8 calls this `references`; renamed because REFERENCES is a reserved word in SQL.
export const correctionReferences = pgTable('correction_references', {
  id: uuid('id').primaryKey().defaultRandom(),
  correctionId: uuid('correction_id')
    .notNull()
    .references(() => corrections.id, { onDelete: 'cascade' }),
  urlOrIdentifier: text('url_or_identifier').notNull(),
  title: text('title'),
  author: text('author'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Correction = typeof corrections.$inferSelect;
export type NewCorrection = typeof corrections.$inferInsert;
export type CorrectionReference = typeof correctionReferences.$inferSelect;
export type NewCorrectionReference = typeof correctionReferences.$inferInsert;
