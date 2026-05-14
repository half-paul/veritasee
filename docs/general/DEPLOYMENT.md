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

The storage package (`@veritasee/storage`) speaks the S3 API and works against either provider with no code changes. Spec lives in [.agents/PRDs/lex-69-r2-bucket-provisioning.md](../../.agents/PRDs/lex-69-r2-bucket-provisioning.md); operational steps follow.

**Recommendation: Cloudflare R2** (zero egress, free tier covers v1). Pick AWS S3 only if an AWS-native dependency (Lambda triggers, Athena, Object Lock, multi-region replication) is required.

In both cases the env-var keys are identical — the **values** differ:

| Key                    | Cloudflare R2                                            | AWS S3                                                |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| `S3_ENDPOINT`          | `https://<account-id>.r2.cloudflarestorage.com`          | `https://s3.<region>.amazonaws.com`                   |
| `S3_REGION`            | `auto`                                                   | actual AWS region, e.g. `us-east-1`                   |
| `S3_ACCESS_KEY_ID`     | per-token (one per bucket)                               | per-IAM-user (one per bucket)                         |
| `S3_SECRET_ACCESS_KEY` | per-token; shown once at creation                        | per-IAM-user; shown once at creation                  |
| `S3_BUCKET`            | `veritasee-prod` / `veritasee-preview` / `veritasee-dev` | same                                                  |
| `S3_FORCE_PATH_STYLE`  | `true` (required)                                        | unset or `false`                                      |

Provision **three buckets, one per environment**, with a dedicated credential pair scoped to each. Sharing credentials across environments defeats isolation and is non-negotiable.

##### Path A — Cloudflare R2

1. **Enable R2.** [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage → Enable R2** (payment method required even on free tier). Note the **Account ID** in the right sidebar — same ID is used for all three environments.
2. **Create three buckets.** **R2 → Create bucket** for each of `veritasee-prod`, `veritasee-preview`, `veritasee-dev`. Default storage class Standard, no jurisdiction, no public access.
3. **Create one scoped API token per bucket.** **R2 → Manage R2 API Tokens → Create API Token**:
   - Permissions: `Object Read & Write`.
   - Specify bucket: pick the one bucket this token is for.
   - On submit, Cloudflare displays the Access Key ID, Secret, and Endpoint **once**. Copy into a password manager immediately. Repeat for the other two buckets.
4. **Add env vars in Vercel.** Project → **Settings → Environment Variables**. For each environment scope (Production, Preview, optionally Development), add the six keys from the R2 column above. Uncheck the other scopes on each save so credentials don't leak across environments.
5. **Local `.env.local`.** In `apps/web/.env.local`, set the same six keys to the **dev** token's values pointing at `veritasee-dev`.
6. **Apply lifecycle rules.** From repo root, with the bucket's credentials loaded:
   ```bash
   pnpm --filter @veritasee/storage storage:apply-lifecycle
   ```
   Run once per bucket. The script is idempotent but replaces the bucket's full rule set ([`lifecycle.ts:7-9`](../../packages/storage/src/lifecycle.ts#L7-L9)) — fold any extra rules into the script before running. Verify in R2 dashboard → bucket → **Settings → Object lifecycle rules**.

##### Path B — AWS S3

1. **Pick a region** (e.g. `us-east-1`). Use the same region for all three buckets.
2. **Create three buckets.** Console → **S3 → Create bucket** for each of `veritasee-prod`, `veritasee-preview`, `veritasee-dev`. Bucket names are globally unique on AWS — if a name is taken, append a short suffix and use it for `S3_BUCKET`. For each: **Block Public Access = all blocked**, **Versioning = off** (v1), **Default encryption = SSE-S3 (AES-256)**.
3. **Create one IAM user per bucket** with a scoped inline policy. IAM → Users → Create user (programmatic access only). Attach an inline policy of the form:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:PutObject",
           "s3:DeleteObject",
           "s3:ListBucket",
           "s3:GetBucketLifecycleConfiguration",
           "s3:PutBucketLifecycleConfiguration"
         ],
         "Resource": [
           "arn:aws:s3:::veritasee-prod",
           "arn:aws:s3:::veritasee-prod/*"
         ]
       }
     ]
   }
   ```
   Replace the bucket name per user. Then **Security credentials → Create access key** and capture the pair once.
4. **Add env vars in Vercel.** Per environment scope, add the six keys from the AWS S3 column above. Leave `S3_FORCE_PATH_STYLE` **unset**.
5. **Local `.env.local`.** Drop the dev IAM user's credentials into `apps/web/.env.local`.
6. **Apply lifecycle rules.** Same script:
   ```bash
   pnpm --filter @veritasee/storage storage:apply-lifecycle
   ```
   Run once per bucket. Verify in S3 console → bucket → **Management → Lifecycle rules**. After confirming, you may strip `PutBucketLifecycleConfiguration` from the IAM policy for tighter least-privilege.

#### Sentry — error reporting + tracing

Error capture and per-request latency tracing are wired via [`@sentry/nextjs`](https://docs.sentry.io/platforms/javascript/guides/nextjs/) per [ADR 0004](../adr/0004-observability-baseline.md). All Sentry env vars are optional in local dev — if `SENTRY_DSN` is unset the SDK init is skipped silently and the structured request logger still emits to stdout.

**Recommendation for v1: one Sentry project with `SENTRY_ENVIRONMENT` tagging** rather than one project per environment. Free-tier quotas are shared either way, and tag-based filtering in Sentry's UI is sufficient for v1 triage. Re-evaluate when error volume or per-team isolation requirements grow.

| Key                       | Production                                          | Preview                                 | Development (local)                     |
| ------------------------- | --------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `SENTRY_DSN`              | server DSN from the Sentry project                  | same (tags by `SENTRY_ENVIRONMENT`)     | optional; from `.env.local`             |
| `NEXT_PUBLIC_SENTRY_DSN`  | client DSN from the Sentry project                  | same                                    | optional; from `.env.local`             |
| `SENTRY_ENVIRONMENT`      | `production` (or leave unset; falls back to `VERCEL_ENV`) | `preview`                          | `development`                           |
| `SENTRY_ORG`              | Sentry org slug                                     | same                                    | unset                                   |
| `SENTRY_PROJECT`          | Sentry project slug                                 | same                                    | unset                                   |
| `SENTRY_AUTH_TOKEN`       | source-map upload token (Build scope only)          | same (Build scope only)                 | unset                                   |

**`SENTRY_AUTH_TOKEN` scope is Build-only.** In Vercel's env-var settings, uncheck **Preview Runtime** and **Production Runtime**; leave only the **Build** scope checked. The token is needed by `withSentryConfig` at build time to upload source maps and is never required at runtime. Exposing it at runtime would let any process read it via `process.env`, which is the opposite of what we want for an auth token.

**Trace sample rate.** `sentry.server.config.ts` and `sentry.edge.config.ts` apply a `tracesSampler` that drops `/api/health/*` probes (so uptime monitoring doesn't burn quota) and samples `0.2` in production / `0.05` in preview + development for everything else. Adjust these if Sentry quota becomes a constraint.

**Provisioning steps:**

1. Create a Sentry project at https://sentry.io (or your self-hosted instance). Pick the **Next.js** platform.
2. From Project → Settings → **Client Keys (DSN)**, copy the DSN. Use the same DSN for both `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (the SDK distinguishes runtimes; client-side bundles get `NEXT_PUBLIC_*` only).
3. From User Settings → **Auth Tokens**, create a token with `project:releases` scope. Copy `SENTRY_AUTH_TOKEN`.
4. In Vercel → Project → **Settings → Environment Variables**, add the six keys. Scope `SENTRY_AUTH_TOKEN` to **Build only** as noted above; scope all others to **Production + Preview**.
5. (Optional) drop `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` into `apps/web/.env.local` if you want local errors to land in Sentry too.
6. Verify: deploy, trigger an intentional error in a scratch API route, confirm the event lands in Sentry tagged with the matching `environment`.

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
