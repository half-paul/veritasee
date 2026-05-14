# ADR 0003 — Vercel deployment + preview environments

- **Status:** Accepted
- **Date:** 2026-05-03
- **Linear:** LEX-68

## Context

PRD §7 and §12 lock Vercel as the host for the v1 Next.js application. The repository is a pnpm workspace with a single Next.js app at `apps/web` consuming three workspace packages (`@veritasee/db`, `@veritasee/redis`, `@veritasee/storage`).

We need:

1. PR preview deploys (a "review" environment) so changes can be exercised in a live URL before merge.
2. Production deploys triggered by `main` so promotion is automatic and reversible.
3. Per-environment env-var isolation so test-mode credentials never leak into production and production credentials never leak into preview/dev.
4. A reproducible build contract that does not depend on Vercel dashboard tweaks one developer applied months ago.

## Decision

We host the Next.js app on **Vercel** and pin the build contract in `vercel.json` at the repo root. Three Vercel environments (Production, Preview, Development) each map to a distinct set of managed-service credentials.

- **Hosting**: Vercel for the Next.js app. Vercel's GitHub App handles PR/push triggers and posts the preview URL as a GitHub check on every PR.
- **Build contract**: Pinned in `vercel.json` at the repo root so behavior is reproducible without dashboard drift. Root Directory in the Vercel project is left at `.` (repo root); Vercel's pnpm workspace detection then handles symlinking and per-package builds.
- **Three environments map to three configurations**:

  | Env         | Trigger        | Auth (Clerk)                                                          | DB (Neon)                                        | Redis (Upstash)           | Object store (R2/S3)                                        |
  | ----------- | -------------- | --------------------------------------------------------------------- | ------------------------------------------------ | ------------------------- | ----------------------------------------------------------- |
  | Production  | push to `main` | live keys (`pk_live_*`/`sk_live_*`) on a dedicated Clerk app          | `main` Neon branch                               | dedicated prod Upstash DB | dedicated prod bucket                                       |
  | Preview     | every PR       | test keys (`pk_test_*`/`sk_test_*`) on a separate Clerk _preview_ app | per-PR Neon branch via Neon ↔ Vercel integration | shared preview Upstash DB | shared preview bucket (or `preview/` prefix on prod bucket) |
  | Development | local only     | test keys (same as preview) via `.env.local`                          | shared dev Neon branch via `.env.local`          | shared dev Upstash DB     | shared dev bucket                                           |

- **Per-PR Postgres isolation**: enable the **Neon ↔ Vercel** integration so opening a PR auto-creates a Neon branch DB and injects `DATABASE_URL` / `DATABASE_URL_UNPOOLED` into the Preview environment for that deploy. Closing or merging the PR tears the branch down. This is the per-branch DB capability foreshadowed in ADR 0002 §Context item 4.
- **Per-PR Redis / object-store isolation**: not free; we accept a single shared preview Upstash DB and a single shared preview bucket. Rationale: preview test data is bounded and short-lived; the cost and operational complexity of per-PR provisioning outweigh the marginal isolation benefit. Re-evaluate at v1.2.
- **Env-var injection precedence**: Vercel injects env vars at build/runtime; `scripts/with-env.mjs:17,42` only fills missing keys, so Vercel-injected values always take precedence. `.env*` files are `.gitignore`d and never deployed, so there is no risk of local files leaking into hosted builds.

## Consequences

**Easier**

- PR previews are automatic; the preview URL appears as a GitHub check on every PR.
- Production rollback is one click ("Promote previous deployment" in the Vercel Deployments tab).
- Schema changes can be exercised in isolation via the Neon ↔ Vercel preview branch, with no manual provisioning.
- Workspace packages build without bespoke transpile config because Next.js 15 + pnpm workspaces handle the case out of the box. If a future regression breaks workspace imports, the fallback is a one-line `transpilePackages: ['@veritasee/db', '@veritasee/redis', '@veritasee/storage']` addition to `apps/web/next.config.ts`.
- Migrating off Vercel later means swapping the host; env vars and the `vercel.json` contract move to the equivalent on the new platform. No application code changes.

**Harder / Constrained**

- We pay Vercel egress and serverless function compute. Long-running AI scenarios (PRD §7) will exceed per-invocation limits and must move to background functions; this is explicitly out of scope here and tracked under the AI-router issues.
- Preview Redis and object store are _shared_ across PRs; one PR's test data can clobber another's preview state. Mitigation deferred until first observed conflict — namespace keys with `${VERCEL_GIT_COMMIT_REF}` if it becomes a problem.
- Vercel env-var management is per-project, so creating a new Clerk preview app, a new Upstash preview DB, and a new preview bucket are operational tasks the developer performs once. The runbook (`docs/general/DEPLOYMENT.md`) walks through them.

## Alternatives Considered

### Self-hosting on Fly / Render

Rejected: explicitly violates the "use managed services" principle in `docs/general/SYSTEM-OVERVIEW.md` and the PRD §12 Vercel lock-in. Self-hosting also adds patching, scaling, and pool-management ops we do not want at v1.

### Cloudflare Workers / Pages

Rejected for v1. Next.js 15 App Router on Workers still has gaps for our workload — particularly Node-runtime APIs in the AWS SDK v3 used by `packages/storage`. Re-evaluate when those gaps close.

### Per-PR provisioning of Redis + object store buckets

Rejected at v1. Operational complexity (creating and tearing down an Upstash DB and bucket per PR) and cost outweigh the marginal isolation gain over a shared preview environment. The accepted compromise is per-PR Postgres isolation (cheap via the Neon integration) plus shared preview Redis and bucket.
