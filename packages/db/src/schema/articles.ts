import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceUrl: text('source_url').notNull(),
    sourceDomain: text('source_domain').notNull(),
    currentRevisionHash: text('current_revision_hash'),
    topicTags: text('topic_tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('articles_source_url_key').on(t.sourceUrl),
    index('articles_source_domain_idx').on(t.sourceDomain),
  ],
);

export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    revisionHash: text('revision_hash').notNull(),
    content: text('content').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('snapshots_article_revision_key').on(t.articleId, t.revisionHash)],
);

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
