# Deployment

Operational runbook for deploying `apps/web` to Vercel. See [ADR 0003](../adr/0003-vercel-deployment.md) for the _why_; this document covers the _how_.

## Overview

Three Vercel environments map to three triggers:

| Env         | Trigger                                                  | Source            |
| ----------- | -------------------------------------------------------- | ----------------- |
| Production  | push to `main`                                           | Vercel GitHub App |
| Preview     | every PR (push to any non-`main` branch with an open PR) | Vercel GitHub App |
| Development | `vercel dev` or local `pnpm dev`                         | developer machine |

The committed build contract lives in `vercel.json` at the repo root. Per-environment env vars live in the Vercel project settings.

## Prerequisites

- A Vercel team with permission to create projects.
- A GitHub repo connected to Vercel (install the Vercel GitHub App on the org/repo if it isn't already).
- Accounts on:
  - [Clerk](https://dashboard.clerk.com) — managed auth (ADR 0001).
  - [Neon](https://console.neon.tech) — managed Postgres (ADR 0002).
  - [Upstash](https://console.upstash.com) — managed Redis.
  - Cloudflare R2 or AWS S3 — object storage (PRD §14.1).

## One-time Vercel project setup

1. Vercel dashboard → **Add New… → Project → Import Git Repository** and select this repo.
2. **Root Directory**: leave at `.` (repo root). The committed `vercel.json` overrides framework / install / build / output.
3. Confirm pnpm is auto-detected. It is, via the root `packageManager` field at `package.json:5`.
4. Save the project without setting env vars yet. The first deploy will fail until env vars are populated — that is expected.

## Environment variable matrix

| Variable                                                                                                        | Production                               | Preview                                          | Development (local)                          |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                                                                             | `pk_live_*` (prod Clerk app)             | `pk_test_*` (preview Clerk app)                  | `pk_test_*` via `.env.local`                 |
| `CLERK_SECRET_KEY`                                                                                              | `sk_live_*` (prod Clerk app)             | `sk_test_*` (preview Clerk app)                  | `sk_test_*` via `.env.local`                 |
| `NEXT_PUBLIC_CLERK_*_URL`                                                                                       | as documented in `apps/web/.env.example` | same                                             | same                                         |
| `DATABASE_URL`                                                                                                  | Neon `main` branch pooled URL            | injected per-deploy by Neon ↔ Vercel integration | Neon dev branch via `.env.local`             |
| `DATABASE_URL_UNPOOLED`                                                                                         | Neon `main` branch unpooled URL          | injected per-deploy by Neon ↔ Vercel integration | Neon dev branch unpooled via `.env.local`    |
| `UPSTASH_REDIS_REST_URL`                                                                                        | prod Upstash DB                          | shared preview Upstash DB                        | shared dev Upstash DB via `.env.local`       |
| `UPSTASH_REDIS_REST_TOKEN`                                                                                      | prod Upstash DB token                    | shared preview Upstash DB token                  | shared dev Upstash DB token via `.env.local` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` / `S3_FORCE_PATH_STYLE` | prod bucket credentials                  | preview bucket credentials                       | dev bucket credentials via `.env.local`      |

### Provisioning steps

#### Clerk (Production)

1. Create a separate Clerk application for production at https://dashboard.clerk.com.
2. Copy `pk_live_*` and `sk_live_*` from **API keys**.
3. In Vercel → **Project → Settings → Environment Variables**, add both, scope = **Production only**.

#### Clerk (Preview + Development)

1. Use a separate Clerk application in test mode (do not reuse the prod app).
2. Copy `pk_test_*` and `sk_test_*` into Vercel scoped to **Preview + Development**.
3. Local developers also drop the same `pk_test_*` / `sk_test_*` into `apps/web/.env.local`.

#### Postgres — Production

1. In Neon, take the `main` branch's pooled and unpooled connection URLs.
2. Add `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (unpooled) to Vercel scoped to **Production**.

#### Postgres — Preview (Neon ↔ Vercel integration)

1. Vercel Marketplace → **Neon** → install into the project.
2. Configure it to "create a database branch per Preview deployment". This injects `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically into each Preview deploy.
3. **Do not** also set static Preview values for these variables — the integration overrides them per-deploy and a hand-set value will conflict on first deploy after install.

#### Postgres — Development

Developers set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `apps/web/.env.local` against a shared dev Neon branch. Do **not** populate Vercel's "Development" env scope unless you are running `vercel dev` against this project.

#### Upstash Redis

1. Create either two databases (one prod, one shared preview/dev) or three (prod, preview, dev) at https://console.upstash.com.
2. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Vercel, scoped to the matching environment(s).
3. Local developers drop the dev DB's URL/token into `apps/web/.env.local`.

#### Object store (R2 or AWS S3)

1. Provision a bucket in your provider per the env-var block in `apps/web/.env.example` (lines 36–48). Recommend per-environment buckets; if shared, namespace via path prefix.
2. Create an access-key pair scoped to the bucket.
3. Add `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` (and `S3_FORCE_PATH_STYLE=true` for R2) to Vercel, scoped to the matching environment.

## Verification

After populating env vars, verify each acceptance criterion:

### AC #1 — Preview URL on every PR

1. Open a small no-op PR (e.g., a comment-only docs change).
2. Within ~2 minutes, the PR's **Checks** tab shows a `Vercel` status with a clickable preview URL.
3. Visit the preview URL → load the home page.
4. Hit each health endpoint:
   - `curl -fsS https://<preview-url>/api/health/db`
   - `curl -fsS https://<preview-url>/api/health/redis`
   - `curl -fsS https://<preview-url>/api/health/storage`
5. All three return `{"ok":true}`.

### AC #2 — Production deploy on merge to `main`

1. Merge that PR.
2. Vercel project → **Deployments** tab shows a new Production build.
3. The production URL serves the merged change.
4. Re-run the three health endpoints against production:
   - `curl -fsS https://<prod-url>/api/health/db`
   - `curl -fsS https://<prod-url>/api/health/redis`
   - `curl -fsS https://<prod-url>/api/health/storage`
5. All three return `{"ok":true}`.

### AC #3 — Per-environment env-var isolation

1. From the Production deploy, view the page source — confirm `pk_live_*` is the publishable key (Clerk's publishable key is intentionally exposed in the bundle; it identifies the environment).
2. From a Preview deploy, view the page source — confirm `pk_test_*`.
3. In Vercel → Project Settings → Environment Variables, sanity-check that no `pk_live_*` / `sk_live_*` value has the **Preview** or **Development** scope checkbox set.

## Rollback

1. Vercel → **Deployments** tab.
2. Find the previous green Production deployment.
3. Click **⋯ → Promote to Production**.

Rollback is metadata-only and takes seconds; no rebuild required.

## FAQ

**Why isn't my new env var visible in a Preview build?**
Vercel injects env vars at build time. After adding a variable, redeploy (Deployments → ⋯ → Redeploy) for it to appear.

**Can I run `vercel dev`?**
Yes, but the canonical local flow is `pnpm dev` with `apps/web/.env.local`. `vercel dev` requires the **Development** env scope to be populated, which we leave blank by default.

**How do I rotate Clerk / Postgres / Redis / S3 keys?**
Update the value in Vercel's env-var settings, then redeploy. No code change is needed; `scripts/with-env.mjs` only fills missing keys, so Vercel-injected values always take precedence.

**Can I see what env vars a deploy used?**
Vercel → Deployment detail page → **Build Logs** lists which env-var groups were injected, but values are masked. To confirm a value, use the project Env Vars settings page.
