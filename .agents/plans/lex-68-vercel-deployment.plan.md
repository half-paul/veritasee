# Plan: Set up Vercel deployment + preview environments

## Summary

Wire the existing Next.js monorepo (`apps/web` + `packages/db|redis|storage`) to Vercel so that every PR gets a preview URL posted as a check, every merge to `main` triggers a production deploy, and the three Vercel environments (Production, Preview, Development) are isolated by env vars. The committed surface is intentionally small — most of this issue is operational (Vercel dashboard, Neon branches, Upstash databases, R2 buckets) — but we pin the build contract with a tiny `vercel.json` at the repo root, document the choice in ADR 0003, and ship a runbook (`docs/general/DEPLOYMENT.md`) so a new contributor can replicate the setup. No application code changes; existing health endpoints (`/api/health/db`, `/api/health/redis`, `/api/health/storage`) double as the deploy-side smoke check.

## User Story

As a developer
I want PR preview deploys on Vercel and isolated env vars per environment
So that changes are reviewable in a live environment before merging and prod is shielded from preview/dev secrets.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY (infra) |
| Complexity | LOW |
| Systems Affected | repo root (`vercel.json`), `docs/adr` (new ADR 0003), `docs/general` (new DEPLOYMENT.md), `apps/web/.env.example` (header comment), `AGENTS.md` (one-line pointer) |
| Linear Issue | LEX-68 (VS-006) |

---

## Patterns to Follow

### ADR shape (mirror `docs/adr/0002-postgres-orm.md`)

```markdown
// SOURCE: docs/adr/0002-postgres-orm.md:1-12
# ADR 0002 — Postgres + ORM: Neon + Drizzle

- **Status:** Accepted
- **Date:** 2026-04-29
- **Linear:** LEX-65

## Context
…
## Decision
…
## Consequences
**Easier**
…
**Harder / Constrained**
…
## Alternatives Considered
…
```

The MADR-lite contract is documented in `docs/adr/README.md` (Status / Context / Decision / Consequences / Alternatives). Match this exactly — both 0001 and 0002 follow it.

### Environment-injection model already in place

```js
// SOURCE: scripts/with-env.mjs:18 (originalEnvKeys), 49 (skip if already set)
const originalEnvKeys = new Set(Object.keys(process.env));
…
if (!key || originalEnvKeys.has(key)) continue;
process.env[key] = unquote(rawValue);
```

`with-env.mjs` only fills env keys that are **not** already set, so Vercel-injected env vars take precedence on hosted builds. No code change needed for that to keep working — just verify the precedence in the runbook.

### Workspace package entry points use raw `.ts`

```json
// SOURCE: packages/db/package.json:6-8 (and redis, storage)
"main": "./src/index.ts",
"types": "./src/index.ts",
"exports": { ".": "./src/index.ts" }
```

This is load-bearing for Vercel: the Next.js build needs to transpile workspace deps. `pnpm build` already succeeds locally per `AGENTS.md:35-36`, so no `transpilePackages` change is required up front, but if the Vercel build fails on workspace imports we add the three names to `apps/web/next.config.ts` (`transpilePackages: ['@veritasee/db', '@veritasee/redis', '@veritasee/storage']`).

### Existing health-probe contract for post-deploy smoke

```ts
// SOURCE: apps/web/src/app/api/health/db/route.ts:1-19  (also redis, storage routes)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { … return NextResponse.json({ ok: true }); }
```

These three endpoints already exist. The deploy runbook will cite them as the per-environment smoke check (`curl https://<preview-url>/api/health/db|redis|storage`).

### Env-var conventions already documented

```
// SOURCE: apps/web/.env.example:1-50
# Clerk — managed auth provider (see docs/adr/0001-managed-auth.md)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=…
CLERK_SECRET_KEY=…
…
DATABASE_URL=…
DATABASE_URL_UNPOOLED=…
UPSTASH_REDIS_REST_URL=…
UPSTASH_REDIS_REST_TOKEN=…
S3_ENDPOINT=…  S3_REGION=…  S3_ACCESS_KEY_ID=…  S3_SECRET_ACCESS_KEY=…  S3_BUCKET=…  S3_FORCE_PATH_STYLE=…
```

The runbook enumerates the same set, grouped by which Vercel environments need each one.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `vercel.json` | CREATE | Pin framework, install/build commands, output directory so deploy is reproducible without dashboard drift |
| `docs/adr/0003-vercel-deployment.md` | CREATE | ADR for hosting choice, monorepo build approach, per-env isolation strategy |
| `docs/general/DEPLOYMENT.md` | CREATE | Operational runbook: Vercel project linking, per-env env var matrix, verification steps |
| `apps/web/.env.example` | UPDATE | Add a short header explaining `.env.local` (dev) vs Vercel project env vars (preview/prod) and the precedence rule from `with-env.mjs` |
| `AGENTS.md` | UPDATE | One-line pointer to `docs/general/DEPLOYMENT.md` and ADR 0003 |

No app code changes. No new dependencies. No new packages.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Add `vercel.json` at repo root

- **File**: `vercel.json`
- **Action**: CREATE
- **Implement**:
  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "framework": "nextjs",
    "installCommand": "pnpm install --frozen-lockfile",
    "buildCommand": "pnpm --filter web build",
    "outputDirectory": "apps/web/.next"
  }
  ```
  Notes for the implementer:
  - Vercel reads `vercel.json` from the project's Root Directory. Setting Root Directory = `.` (repo root, the default if you don't override) lets Vercel pick this file up.
  - `installCommand` runs from the root so the pnpm workspace and lockfile resolve cleanly. `--frozen-lockfile` matches CI norms and fails closed on lockfile drift.
  - `buildCommand` delegates to the workspace package script; `apps/web/package.json:5` already runs `node ../../scripts/with-env.mjs next build`, which is a no-op for env loading on Vercel (no `.env*` files committed) and correctly runs `next build`.
  - `outputDirectory` tells Vercel where Next.js wrote the build artifacts inside the monorepo.
  - Do NOT add `regions`, `functions`, or `crons` blocks here; those belong to later issues (LEX-? for AI background jobs, VS-022 for region-pinned cache).
- **Mirror**: There is no in-repo precedent for `vercel.json`. Use the [Vercel monorepo docs](https://vercel.com/docs/monorepos) shape; the schema is at the URL above.
- **Validate**: `pnpm install --frozen-lockfile && pnpm --filter web build` from the repo root succeeds. (This mirrors what Vercel will run.)

### Task 2: Write ADR 0003 — Vercel deployment + preview environments

- **File**: `docs/adr/0003-vercel-deployment.md`
- **Action**: CREATE
- **Implement**: Match the MADR-lite shape from `docs/adr/0002-postgres-orm.md:1-160`. Sections to include, in this order:
  - **Front matter**: `Status: Accepted`, `Date: 2026-05-03`, `Linear: LEX-68`.
  - **Context**: PRD §7 and §12 lock Vercel as the host. The repo is a pnpm workspace with a single Next.js app at `apps/web` consuming three workspace packages (`@veritasee/db`, `@veritasee/redis`, `@veritasee/storage`). We need PR preview deploys (review env), production deploys on `main`, and isolated env vars per Vercel environment so test-mode credentials don't leak into prod and prod credentials don't leak into preview/dev.
  - **Decision**:
    - **Hosting**: Vercel for the Next.js app; Vercel's GitHub App handles PR/push triggers and posts the preview URL as a check.
    - **Build contract**: Pinned in `vercel.json` at the repo root (Task 1) so behavior is reproducible without dashboard tweaks. Root Directory in the Vercel project is left at `.` (repo root); Vercel's pnpm workspace detection then handles symlinking.
    - **Three Vercel environments map to three configs**:
      | Env | Trigger | Auth (Clerk) | DB (Neon) | Redis (Upstash) | Object store (R2/S3) |
      |---|---|---|---|---|---|
      | Production | push to `main` | live keys (`pk_live_*`/`sk_live_*`) on a dedicated Clerk app | `main` Neon branch | dedicated prod Upstash DB | dedicated prod bucket |
      | Preview | every PR | test keys (`pk_test_*`/`sk_test_*`) on a separate Clerk *preview* app | per-PR Neon branch via Neon-Vercel integration | shared preview Upstash DB | shared preview bucket (or `preview/` prefix on prod bucket — call out tradeoff) |
      | Development | local only | test keys (same as preview) via `.env.local` | shared dev Neon branch via `.env.local` | shared dev Upstash DB | shared dev bucket |
    - **Per-PR Postgres isolation**: enable the **Neon ↔ Vercel** integration so opening a PR auto-creates a Neon branch DB and injects `DATABASE_URL`/`DATABASE_URL_UNPOOLED` into the Preview environment for that deploy. Deleting the PR or merging tears the branch down. (Already foreshadowed in ADR 0002 §Context item 4.)
    - **Per-PR Redis/object-store isolation**: not free; we accept a single shared preview Upstash DB and a single shared preview bucket. Rationale: preview test data is bounded and short-lived; the cost of per-PR provisioning outweighs the marginal isolation benefit. Re-evaluate at v1.2.
    - **Env-var injection precedence**: Vercel injects env vars at build/runtime; `scripts/with-env.mjs:18,49` only fills missing keys, so Vercel values win and `.env*` files (which are `.gitignore`d) never leak into hosted builds.
  - **Consequences (Easier)**:
    - PR previews are automatic; the preview URL appears as a GitHub check on every PR.
    - Production rollback is one click (Vercel "Promote previous deployment").
    - Schema changes can be exercised in isolation via the Neon-Vercel preview branch.
    - Workspace packages build without bespoke transpile config because Next.js 15 + pnpm workspaces handle this case out of the box.
  - **Consequences (Harder / Constrained)**:
    - We pay Vercel egress and function compute; long-running AI scenarios (PRD §7) will need to move to background functions to stay inside per-invocation limits — explicitly out of scope here, tracked under the AI-router issues.
    - Preview Redis and object store are *shared* across PRs; a contributor can clobber another's preview state. Mitigated by namespacing keys with `${VERCEL_GIT_COMMIT_REF}` once we have multi-PR concurrency in flight (deferred until first observed conflict).
    - Vercel env-var management is per-project, so creating a new Clerk preview app, a new Upstash preview DB, and a new preview bucket are operational tasks the developer performs once.
  - **Alternatives Considered**:
    - **Self-hosting on Fly/Render**: rejected — explicitly violates the "managed services" principle in `docs/general/SYSTEM-OVERVIEW.md` and the PRD §12 lock-in.
    - **Cloudflare Workers / Pages**: rejected for v1 — Next.js 15 App Router on Workers still has gaps (e.g., specific Node-runtime APIs in the AWS SDK v3 used by `packages/storage`).
    - **Per-PR provisioning of Redis + bucket**: rejected at v1 — operational complexity and cost outweigh marginal isolation gain.
- **Mirror**: `docs/adr/0002-postgres-orm.md:1-160` (header, section ordering, plain-language tone). Use ADR 0001 §"Migration Path" pattern only if it adds value here — for hosting, the migration story is "swap the host; env vars and `vercel.json` move to the equivalent on the new host"; this is short enough to fold into "Consequences" rather than its own section.
- **Validate**: `pnpm format:check` clean; the file renders correctly on GitHub (visual inspection); ADR README contract (`docs/adr/README.md`) sections all present.

### Task 3: Write the deployment runbook

- **File**: `docs/general/DEPLOYMENT.md`
- **Action**: CREATE
- **Implement**: Operational, step-by-step. Sections in this order:
  1. **Overview** — one paragraph, points readers to ADR 0003 for the *why* and lists the three Vercel environments and the trigger for each.
  2. **Prerequisites** — a Vercel team, a GitHub repo connected to Vercel, and accounts on Clerk, Neon, Upstash, and the chosen object-store provider (R2 or AWS S3).
  3. **One-time Vercel project setup**:
     - "Add New… → Project → Import Git Repository" pointing at the repo.
     - Leave Root Directory as `.` (repo root). The committed `vercel.json` overrides framework / install / build / output.
     - Confirm pnpm is auto-detected (it is, via the root `packageManager` field at `package.json:5`).
     - Save without setting env vars yet.
  4. **Environment variable matrix** — reproduce the table from ADR 0003 §Decision and add concrete provisioning steps:
     - **Clerk (Production)**: create a separate Clerk application for production at https://dashboard.clerk.com → API keys. Copy `pk_live_*` and `sk_live_*` into Vercel → Project → Settings → Environment Variables, scope = **Production only**.
     - **Clerk (Preview + Development)**: use a *separate* Clerk application (test mode). Copy `pk_test_*`/`sk_test_*` into Vercel scoped to **Preview + Development**.
     - **Postgres (Production)**: in Neon, take the `main` branch's pooled and unpooled URLs and add `DATABASE_URL` / `DATABASE_URL_UNPOOLED` to Vercel scoped to **Production**.
     - **Postgres (Preview)**: install the **Neon Vercel integration** (Vercel Marketplace → Neon). Configure it to "create a database branch per Preview deployment" and let it inject `DATABASE_URL` / `DATABASE_URL_UNPOOLED` automatically into the Preview environment. **Do not** also set static Preview values — the integration overrides them per-deploy.
     - **Postgres (Development)**: developers use a shared dev branch by setting `DATABASE_URL`/`DATABASE_URL_UNPOOLED` in `.env.local` locally. Do NOT add to Vercel's "Development" environment unless the developer is using `vercel dev`.
     - **Upstash Redis**: create three databases (or two — one prod, one shared preview/dev) at https://console.upstash.com. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Vercel scoped to the matching environments.
     - **Object store (R2 or AWS S3)**: provision per the env-var block in `apps/web/.env.example:36-50` (or the table in ADR 0003). Recommend per-environment buckets; if shared, namespace via path prefix.
  5. **Verification** (the AC checklist):
     - **AC #1 (preview URL on PR)**: open a small no-op PR (e.g., a comment-only docs change). Within ~2 minutes, the PR's "Checks" tab should show a `Vercel` status with a clickable preview URL. Visit the URL → load the home page → hit `/api/health/db`, `/api/health/redis`, `/api/health/storage` → all return `{"ok":true}`.
     - **AC #2 (prod deploy on merge)**: merge that PR. The Vercel project's "Deployments" tab should show a new Production build. The production URL serves the merged change. Re-run the three health endpoints against production.
     - **AC #3 (env-var isolation)**: from the Production deployment, confirm that `pk_live_*` is the publishable key in the page source (not `pk_test_*`). From a Preview deployment, confirm `pk_test_*`. (Clerk's publishable key is intentionally exposed in the bundle; it identifies the environment.)
  6. **Rollback** — Vercel → Deployments → previous Production → "Promote to Production".
  7. **FAQ** — short notes:
     - "Why isn't my new env var visible in a Preview build?" → Vercel only injects env vars set at build time; redeploy after adding.
     - "Can I run `vercel dev`?" → Yes, but the canonical local flow is `pnpm dev` with `.env.local`. `vercel dev` requires the "Development" env scope to be populated.
     - "How do I rotate Clerk/Postgres/Redis/S3 keys?" → update Vercel env vars, then redeploy. No code change needed.
- **Mirror**: There is no precedent for `docs/general/*.md` runbooks (only `SYSTEM-OVERVIEW.md` exists, which is reference material, not procedural). Tone: terse, imperative, command-first. Match the style of `apps/web/.env.example` comments — short blocks, links to providers, no marketing copy.
- **Validate**: links to provider dashboards work; AC checklist matches LEX-68 acceptance criteria verbatim; `pnpm format:check` clean.

### Task 4: Update `apps/web/.env.example` header

- **File**: `apps/web/.env.example`
- **Action**: UPDATE
- **Implement**: Prepend a short header (above the existing Clerk block at line 1) that explains the env-injection model:
  ```
  # ─────────────────────────────────────────────────────────────────────────────
  # Local dev:   copy this file to .env.local and fill in values
  # Vercel:      env vars are configured per environment (Production / Preview /
  #              Development) in the Vercel project settings; .env files are
  #              .gitignored and never deployed. See docs/general/DEPLOYMENT.md.
  # Precedence:  scripts/with-env.mjs only fills missing keys, so Vercel-injected
  #              values take precedence over any .env* file.
  # ─────────────────────────────────────────────────────────────────────────────

  ```
  Do NOT change any of the existing variable blocks — they're correct and already documented per service.
- **Mirror**: existing comment style in `apps/web/.env.example:36-44` (multi-line `#` blocks).
- **Validate**: visual inspection; `pnpm format:check` ignores `.env.example` so no formatter conflict.

### Task 5: Update `AGENTS.md`

- **File**: `AGENTS.md`
- **Action**: UPDATE
- **Implement**: Add one short paragraph to the **Build, Test, and Development Commands** section (after line 26, the Node/pnpm-version line) OR a new bullet under **Project Structure & Module Organization** referencing the new docs. Pick one:
  - In **Project Structure & Module Organization** at line 12, add a bullet:
    `- docs/general/DEPLOYMENT.md: Vercel deployment and per-environment env-var setup (see ADR 0003).`
  - Keep it to a single line. Do not duplicate runbook content.
- **Mirror**: existing bullet style at `AGENTS.md:9-12`.
- **Validate**: `pnpm format:check` clean; visual inspection.

### Task 6: Operational checklist (NOT committed; performed by the developer once)

These steps are not code — record them as the closing section of the PR description so the reviewer can confirm they're done:

- [ ] Vercel project created and linked to the GitHub repo.
- [ ] Production env vars set in Vercel for: Clerk live keys, Neon `main` branch URLs, Upstash prod DB, R2/S3 prod bucket.
- [ ] Preview env vars set for: Clerk test keys, Upstash preview DB, R2/S3 preview bucket. Neon-Vercel integration installed and configured to inject `DATABASE_URL`/`DATABASE_URL_UNPOOLED` per branch.
- [ ] Development env vars left blank in Vercel (developers use `.env.local`).
- [ ] Test PR opened → preview URL appeared as a check → all three `/api/health/*` endpoints returned `{"ok":true}`.
- [ ] Test PR merged → Production deploy succeeded → all three health endpoints returned `{"ok":true}` against production.
- [ ] From the Production deploy, confirmed Clerk publishable key is `pk_live_*`; from Preview, confirmed it's `pk_test_*`.

This list is the literal evidence that LEX-68's three acceptance criteria are satisfied.

---

## Validation

```bash
# What CI / Vercel will run (verify locally first)
pnpm install --frozen-lockfile
pnpm --filter web build

# Static checks must remain green
pnpm typecheck
pnpm lint
pnpm format:check

# Existing service smoke tests still pass when env is configured
pnpm --filter @veritasee/db test     2>&1 | tail -3
pnpm --filter @veritasee/redis test  2>&1 | tail -3
pnpm storage:test                    2>&1 | tail -3

# Live deploy verification (after the operational checklist in Task 6 is done)
# These run against URLs Vercel posts; capture the URLs from the PR check.
curl -fsS https://<preview-url>/api/health/db
curl -fsS https://<preview-url>/api/health/redis
curl -fsS https://<preview-url>/api/health/storage
curl -fsS https://<prod-url>/api/health/db
curl -fsS https://<prod-url>/api/health/redis
curl -fsS https://<prod-url>/api/health/storage
```

No new test command. The existing per-package vitest suites stay green; the `pnpm build` step proves the Vercel build will succeed.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Vercel build fails on workspace TS imports because `transpilePackages` is unset | If observed, add `transpilePackages: ['@veritasee/db', '@veritasee/redis', '@veritasee/storage']` to `apps/web/next.config.ts`. Local `pnpm build` passes today, so Vercel should too — but the loop is short. |
| AWS SDK v3 (used by `packages/storage`) bloats the Edge bundle and breaks build size limits | All routes that import `@veritasee/storage` already pin `runtime = 'nodejs'` (see `apps/web/src/app/api/health/storage/route.ts:1-4`). Audit before adding any new route that imports the package. |
| Neon-Vercel integration injects env vars that conflict with hand-set Preview env vars | The runbook explicitly says: do not also set static Preview `DATABASE_URL` values when the integration is installed — the integration overrides per-deploy. |
| Shared preview Upstash and bucket allow PR-to-PR clobber | Accepted at v1; namespacing by `VERCEL_GIT_COMMIT_REF` is deferred until first observed conflict. ADR 0003 records this. |
| Production secrets leaked into Preview environment by accident | Vercel's env-var scoping (Production / Preview / Development checkboxes) is the authoritative gate. The runbook walks through scoping each variable explicitly. Reviewer checks the Vercel env-var screenshot in the PR. |
| `vercel.json` `installCommand` `--frozen-lockfile` fails on lockfile drift after dependency changes | Surfacing the failure is the point; fix it by running `pnpm install` locally and committing the updated lockfile. |
| Operational steps in Task 6 are not committed to the repo so they're easy to skip | The PR description must contain the checked checklist before merge. ADR 0003 + DEPLOYMENT.md ensure the steps are discoverable for the next contributor. |
| `vercel dev` confusion (developers expect Vercel to inject env locally) | DEPLOYMENT.md FAQ entry calls this out explicitly; canonical local flow stays `pnpm dev` + `.env.local`. |

---

## Acceptance Criteria

- [ ] `vercel.json` exists at the repo root with framework/install/build/output pinned.
- [ ] `docs/adr/0003-vercel-deployment.md` exists and follows the MADR-lite contract from `docs/adr/README.md`.
- [ ] `docs/general/DEPLOYMENT.md` exists with the env-var matrix, the verification checklist, and the rollback procedure.
- [ ] `apps/web/.env.example` has a header explaining local-vs-Vercel env-var sourcing and the `with-env.mjs` precedence rule.
- [ ] `AGENTS.md` references the new deployment doc.
- [ ] `pnpm install --frozen-lockfile && pnpm --filter web build` succeeds locally with no new warnings.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.
- [ ] Operational checklist in Task 6 is completed and recorded in the PR description.
- [ ] **LEX-68 AC #1**: PR preview URL is posted as a GitHub check (verified on the PR for this issue itself).
- [ ] **LEX-68 AC #2**: merging to `main` triggers a successful production deploy (verified post-merge).
- [ ] **LEX-68 AC #3**: env vars are scoped per environment in Vercel; Production uses `pk_live_*`, Preview uses `pk_test_*`, the three managed services point at distinct prod vs preview resources.
