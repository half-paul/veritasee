# Implementation Report

**Plan**: `.agents/plans/lex-65-postgres-orm-schema.plan.md`
**Branch**: `features/LEX-65`
**Status**: COMPLETE

## Summary

Stood up the v1 data layer: `@veritasee/db` workspace package using Drizzle ORM on Neon Postgres. Wrote ADR 0002 capturing the Drizzle + Neon decision. Modeled the PRD §8 schema (users, articles, snapshots, corrections, correction_references, ai_runs, moderation_decisions, reputation_events) as Drizzle pg-core tables with FKs, indexes, and CHECK constraints mirroring the auth Role union and AI scenario set. Generated the initial SQL migration with `CREATE EXTENSION IF NOT EXISTS vector;` prepended, applied it to the Neon dev branch, and verified pgvector loads. Wired `apps/web` to consume the package and added a `/api/health/db` smoke endpoint that returns `{"ok":true}` from a live Neon `select 1`.

## Tasks Completed

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 1 | ADR 0002 | `docs/adr/0002-postgres-orm.md` | ✅ |
| 2 | Provision Neon (operational) | env-only | ✅ |
| 3 | Scaffold `packages/db` | `package.json`, `tsconfig.json`, `eslint.config.mjs` | ✅ |
| 4 | Drizzle schema modules | `src/schema/{users,articles,corrections,ai,moderation,index}.ts` | ✅ |
| 5 | Drizzle config + client | `drizzle.config.ts`, `src/{client,env,index}.ts` | ✅ |
| 6 | Generate migration | `migrations/0000_lying_marvel_apes.sql`, `meta/_journal.json` | ✅ |
| 7 | Migration runner | `scripts/migrate.ts` | ✅ |
| 8 | pgvector test + vitest | `test/pgvector.test.ts`, `vitest.config.ts` | ✅ |
| 9 | Wire `apps/web` consumer | `apps/web/package.json`, `.env.example`, `.env.local` | ✅ |
| 10 | `/api/health/db` route | `apps/web/src/app/api/health/db/route.ts` | ✅ |
| 11 | Root scripts + gitignore | `package.json`, `.gitignore` | ✅ |

## Validation Results

| Check | Result |
|-------|--------|
| `pnpm typecheck` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm --filter web build` | ✅ (route registered) |
| `pnpm db:generate` | ✅ (8 tables, 11 indexes, 11 FKs) |
| `pnpm db:migrate` | ✅ (applied to Neon dev branch) |
| `pnpm --filter @veritasee/db test` | ✅ (pgvector loadable, 1/1) |
| `curl /api/health/db` | ✅ `{"ok":true}` |

## Files Changed

| File | Action |
|------|--------|
| `docs/adr/0002-postgres-orm.md` | CREATE |
| `packages/db/package.json` | CREATE |
| `packages/db/tsconfig.json` | CREATE |
| `packages/db/eslint.config.mjs` | CREATE |
| `packages/db/drizzle.config.ts` | CREATE |
| `packages/db/src/env.ts` | CREATE |
| `packages/db/src/client.ts` | CREATE |
| `packages/db/src/index.ts` | CREATE |
| `packages/db/src/schema/users.ts` | CREATE |
| `packages/db/src/schema/articles.ts` | CREATE |
| `packages/db/src/schema/corrections.ts` | CREATE |
| `packages/db/src/schema/ai.ts` | CREATE |
| `packages/db/src/schema/moderation.ts` | CREATE |
| `packages/db/src/schema/index.ts` | CREATE |
| `packages/db/scripts/migrate.ts` | CREATE |
| `packages/db/test/pgvector.test.ts` | CREATE |
| `packages/db/vitest.config.ts` | CREATE |
| `packages/db/migrations/0000_lying_marvel_apes.sql` | CREATE |
| `packages/db/migrations/meta/_journal.json` | CREATE |
| `apps/web/src/app/api/health/db/route.ts` | CREATE |
| `apps/web/package.json` | UPDATE |
| `apps/web/.env.example` | UPDATE |
| `apps/web/.env.local` | UPDATE (manual; not committed) |
| `package.json` (root) | UPDATE |
| `.gitignore` | UPDATE |

## Deviations from Plan

- **Migration filename** — kept the drizzle-kit auto-generated tag (`0000_lying_marvel_apes.sql`) instead of renaming to `0000_init.sql`. Drizzle's migrator reads the tag from `meta/_journal.json`; renaming the SQL file without regenerating breaks the journal/file linkage. The semantics (single foundational migration enabling pgvector + creating all eight tables) match the plan; only the filename slug differs.
- **`packages/db/src/env.ts`** — split the `requireEnv` helper into its own module (instead of inlining in `client.ts`) so `scripts/migrate.ts` and tests can import it without dragging in the Neon driver. Mirrors the `apps/web/src/lib/auth/roles.ts` defensiveness pattern called out in the plan.
- **`db.execute(sql\`select 1\`)`** in the health route — the plan said "runs `select 1`" without prescribing the call shape; using `db.execute` keeps the route insulated from the underlying driver (`@neondatabase/serverless`) so we don't need a second import in `apps/web`.
- **Re-export `sql` from `@veritasee/db`** so `apps/web` doesn't take a direct dependency on `drizzle-orm`. Keeps the cross-package surface a single import.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `packages/db/test/pgvector.test.ts` | `pgvector extension > is loadable` (skipped automatically when `DATABASE_URL_UNPOOLED` is unset) |

No tests were added for the schema files themselves: they are declarative Drizzle `pgTable()` calls and are exercised end-to-end by the migration apply + the `/api/health/db` round-trip. The migration itself is the strongest assertion that the schema is correct — drizzle-kit refused to generate divergent SQL during validation.
