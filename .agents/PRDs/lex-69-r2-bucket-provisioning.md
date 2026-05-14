# PRD — Object storage provisioning (Cloudflare R2 or AWS S3)

- **Linear:** LEX-69 (placeholder — confirm next free ID)
- **Owner:** Paul
- **Status:** Draft
- **Date:** 2026-05-13
- **Related:** [ADR 0003](../../docs/adr/0003-vercel-deployment.md), [DEPLOYMENT.md §Object store](../../docs/general/DEPLOYMENT.md#object-store-r2-or-aws-s3), LEX-67 (storage package), LEX-68 (Vercel deploy)

---

## 1. Background

LEX-67 shipped an S3-compatible storage package ([`@veritasee/storage`](../../packages/storage/)) written against an `S3_ENDPOINT` env var rather than the AWS default, so the same code path serves both **AWS S3** and **Cloudflare R2**. ADR 0003 §Decision favors R2 (zero egress, free tier covers v1) but explicitly keeps the door open to S3. PRD §14.1 and §17 require per-environment isolation of stored objects.

This PRD covers the operational provisioning to stand up object storage across the three Vercel environments defined in ADR 0003, with detailed steps for **both providers** so an operator can pick either path. **No application code changes are required for either provider.**

Recommendation: **default to R2** unless a v1-blocking requirement (deep AWS integration, S3 Object Lock, Lambda triggers) forces S3.

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Stand up three isolated buckets, one per Vercel environment (Production, Preview, Development), on the chosen provider.
- Issue one scoped credential pair per bucket and wire it into the matching Vercel environment scope.
- Apply the existing `snapshots/unanchored/` 24-hour expiry lifecycle rule to every bucket.
- Verify end-to-end via the existing `/api/health/storage` route and the storage smoke test.
- Document the provider-specific steps in [DEPLOYMENT.md](../../docs/general/DEPLOYMENT.md) so the runbook is self-contained.

### 2.2 Non-Goals

- Per-PR buckets. ADR 0003 explicitly defers this; the shared preview bucket is the accepted compromise.
- Public-domain object serving (custom domain on a bucket). Snapshots use presigned URLs.
- Cross-region replication or backup.
- Migrating any pre-existing data — none exists yet.
- Changes to `@veritasee/storage` source or to `apps/web` route handlers.

---

## 3. Environments & Resource Map

Mirrors the per-environment table in ADR 0003 §Decision.

| Vercel env  | Trigger        | Bucket name (suggested) | Credential scope     | Where creds live                              |
| ----------- | -------------- | ----------------------- | -------------------- | --------------------------------------------- |
| Production  | push to `main` | `veritasee-prod`        | `veritasee-prod`     | Vercel env vars, scope = Production           |
| Preview     | every PR       | `veritasee-preview`     | `veritasee-preview`  | Vercel env vars, scope = Preview              |
| Development | local only     | `veritasee-dev`         | `veritasee-dev`      | `apps/web/.env.local` (and optionally Vercel) |

**Each environment gets its own credential pair scoped to its own bucket.** Sharing credentials across environments would defeat the isolation requirement and is non-negotiable.

---

## 4. Configuration Contract

The five (six with `S3_FORCE_PATH_STYLE`) env var keys are fixed by [`packages/storage/src/client.ts:16-32`](../../packages/storage/src/client.ts#L16-L32). The **values** differ per provider:

| Key                    | Cloudflare R2                                            | AWS S3                                                |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| `S3_ENDPOINT`          | `https://<account-id>.r2.cloudflarestorage.com`          | `https://s3.<region>.amazonaws.com`                   |
| `S3_REGION`            | `auto`                                                   | actual AWS region, e.g. `us-east-1`                   |
| `S3_ACCESS_KEY_ID`     | per-token (one per bucket)                               | per-IAM-user (one per bucket) or temporary STS creds  |
| `S3_SECRET_ACCESS_KEY` | per-token; shown once at creation                        | per-IAM-user; shown once at creation                  |
| `S3_BUCKET`            | `veritasee-prod` / `veritasee-preview` / `veritasee-dev` | same                                                  |
| `S3_FORCE_PATH_STYLE`  | `true` (required)                                        | unset, or `false` (virtual-hosted-style is preferred) |

Vercel-injected values take precedence over `.env*` files per [`scripts/with-env.mjs:17,42`](../../scripts/with-env.mjs).

---

## 5. Setup — Cloudflare R2

Why R2: zero egress, free tier covers v1 (10 GB storage, 1M Class A ops, 10M Class B ops / month), API surface is S3-compatible including `PutBucketLifecycleConfiguration` (see [`lifecycle.ts:1-9`](../../packages/storage/src/lifecycle.ts#L1-L9)).

### 5.1 Enable R2 on the Cloudflare account

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (or create an account).
2. Left sidebar → **R2 Object Storage** → **Enable R2**. A payment method is required even for the free tier.
3. Note your **Account ID** (right sidebar on any R2 page, or top-right of the dashboard). Same Account ID is used for all three environments. The endpoint URL is `https://<account-id>.r2.cloudflarestorage.com`.

### 5.2 Create three buckets

In **R2 → Create bucket**, create each of the following:

| Bucket name           | Default storage class | Location  |
| --------------------- | --------------------- | --------- |
| `veritasee-prod`      | Standard              | Automatic |
| `veritasee-preview`   | Standard              | Automatic |
| `veritasee-dev`       | Standard              | Automatic |

Skip jurisdiction selection unless a data-residency requirement applies. Do not enable public access.

### 5.3 Create one scoped API token per bucket

For each bucket:

1. **R2 → Manage R2 API Tokens → Create API Token**.
2. **Permissions**: `Object Read & Write`.
3. **Specify bucket**: pick the single bucket this token is for (e.g. `veritasee-prod`).
4. **TTL**: leave as forever, or set a rotation date.
5. Click **Create**. Cloudflare displays three values **once**:
   - Access Key ID → goes to `S3_ACCESS_KEY_ID`
   - Secret Access Key → goes to `S3_SECRET_ACCESS_KEY`
   - Endpoint → goes to `S3_ENDPOINT` (same for all three buckets)
6. Copy all three into a password manager immediately. They are not re-displayable; lost secrets require a new token.

Repeat for `veritasee-preview` and `veritasee-dev`. End state: three tokens, each scoped to one bucket.

### 5.4 Wire env vars into Vercel

Vercel project for `apps/web` → **Settings → Environment Variables**. For each environment scope, add the six keys with R2 values from §4. Critical: **uncheck the other scopes** when saving so credentials don't leak across environments.

```
S3_ENDPOINT          = https://<account-id>.r2.cloudflarestorage.com
S3_REGION            = auto
S3_ACCESS_KEY_ID     = <token access key id>
S3_SECRET_ACCESS_KEY = <token secret>
S3_BUCKET            = veritasee-prod    # or -preview / -dev
S3_FORCE_PATH_STYLE  = true
```

Add the Production set first, then Preview. For Development, either also add in Vercel scoped to Development (so `vercel env pull` works) or skip and rely on `apps/web/.env.local` only.

### 5.5 Local `.env.local`

In `apps/web/.env.local` (gitignored), add the **dev** token's values — same six keys — pointing at `veritasee-dev`.

### 5.6 Apply lifecycle rules

From the repo root, with the bucket-of-interest's credentials loaded (either in `.env.local` or exported in the shell):

```bash
pnpm --filter @veritasee/storage storage:apply-lifecycle
```

The script applies the `expire-unanchored-snapshots-24h` rule defined in [`lifecycle.ts:16-32`](../../packages/storage/src/lifecycle.ts#L16-L32). It is idempotent but **replaces the bucket's full rule set** ([`lifecycle.ts:7-9`](../../packages/storage/src/lifecycle.ts#L7-L9)) — fold any additional rules into the script before running.

Run once per bucket (three runs total). Verify in R2 dashboard → bucket → **Settings → Object lifecycle rules**.

---

## 6. Setup — AWS S3

Use S3 instead of R2 only when an AWS-native dependency (Lambda triggers, Athena over S3, S3 Object Lock, multi-region replication) is required. Otherwise R2 is preferred.

### 6.1 Prepare the AWS account

1. Sign in to the AWS account that will own the buckets. If using AWS Organizations, this should be a dedicated account, not the management account.
2. Pick a single region for all three buckets (e.g. `us-east-1`). Cross-region setups complicate lifecycle and IAM.
3. The endpoint is `https://s3.<region>.amazonaws.com` — note the region for the `S3_ENDPOINT` and `S3_REGION` values.

### 6.2 Create three buckets

Console → **S3 → Create bucket** (or `aws s3api create-bucket`). For each of the three:

| Bucket name           | Region          | Block Public Access | Versioning        | Default encryption       |
| --------------------- | --------------- | ------------------- | ----------------- | ------------------------ |
| `veritasee-prod`      | chosen region   | **All public access blocked** | Off (v1) | SSE-S3 (AES-256)         |
| `veritasee-preview`   | chosen region   | **All public access blocked** | Off       | SSE-S3 (AES-256)         |
| `veritasee-dev`       | chosen region   | **All public access blocked** | Off       | SSE-S3 (AES-256)         |

Bucket names are globally unique on AWS. If `veritasee-prod` is taken, append a short suffix (e.g. `veritasee-prod-c7a`) and update `S3_BUCKET` accordingly.

### 6.3 Create one IAM user (or role) per bucket with a scoped policy

For each bucket, create a dedicated IAM principal with an inline policy granting **only** the operations the app uses:

1. **IAM → Users → Create user** (programmatic access only, no console access). Name e.g. `veritasee-prod-storage`.
2. Attach an inline policy of the form:

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

   Replace `veritasee-prod` with the matching bucket name. Note: `PutBucketLifecycleConfiguration` is required to run the lifecycle script (§6.5); you may drop it after the one-time apply and re-attach when needed.
3. **IAM → Users → <user> → Security credentials → Create access key**. Capture the Access Key ID + Secret Access Key once; AWS will not show the secret again.
4. Repeat for `veritasee-preview` and `veritasee-dev`. End state: three IAM users, each scoped to one bucket.

Alternative for production: use **IAM Roles Anywhere** or short-lived STS credentials rotated via a secret manager. Out of scope for v1.

### 6.4 Wire env vars into Vercel

Vercel project for `apps/web` → **Settings → Environment Variables**. Per environment scope, add:

```
S3_ENDPOINT          = https://s3.<region>.amazonaws.com
S3_REGION            = <region>                          # e.g. us-east-1
S3_ACCESS_KEY_ID     = <IAM user access key>
S3_SECRET_ACCESS_KEY = <IAM user secret>
S3_BUCKET            = veritasee-prod                    # or -preview / -dev
# Leave S3_FORCE_PATH_STYLE UNSET for AWS S3.
```

Drop the dev IAM user's credentials into `apps/web/.env.local` for local development.

### 6.5 Apply lifecycle rules

Same script as R2:

```bash
pnpm --filter @veritasee/storage storage:apply-lifecycle
```

Run once per bucket with that bucket's credentials loaded. Verify in S3 console → bucket → **Management → Lifecycle rules**. After confirming, you may remove `PutBucketLifecycleConfiguration` from the IAM policy if you want a tighter principle-of-least-privilege.

---

## 7. Verification

For either provider, the verification path is identical:

1. **Local smoke**: `pnpm --filter @veritasee/storage test` against the dev bucket via `.env.local`.
2. **Preview deploy**: open any PR → wait for the Vercel preview → `curl -fsS https://<preview-url>/api/health/storage` returns `{"ok":true}`.
3. **Production deploy**: after merging to `main` → `curl -fsS https://<prod-url>/api/health/storage` returns `{"ok":true}`.
4. **Lifecycle visible** in the provider dashboard on all three buckets.
5. **Isolation spot-check** (one-time): upload a marker object to the preview bucket via the dashboard; confirm it does not appear in the prod or dev bucket listings.

---

## 8. Acceptance Criteria

- [ ] Three buckets exist on the chosen provider: `veritasee-prod`, `veritasee-preview`, `veritasee-dev` (or the suffixed equivalents if the unsuffixed names were taken on AWS).
- [ ] Each bucket has exactly one credential pair scoped to it; credentials are not shared across buckets.
- [ ] All three buckets show the lifecycle rule `expire-unanchored-snapshots-24h` (prefix `snapshots/unanchored/`, `Expiration.Days: 1`).
- [ ] `GET /api/health/storage` returns 200 on localhost (dev), the latest preview URL, and the prod URL.
- [ ] `pnpm --filter @veritasee/storage test` passes locally with dev credentials.
- [ ] The provider-specific steps land in [DEPLOYMENT.md §Object store](../../docs/general/DEPLOYMENT.md#object-store-r2-or-aws-s3).

---

## 9. Risks & Mitigations

| Risk                                                                | Mitigation                                                                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Credential lost between creation and entry into Vercel.             | Capture into a password manager during the same session; revoke and reissue if lost.                                                       |
| Wrong env scope on a Vercel env var leaks preview creds into prod.  | Vercel forces explicit scope checkboxes; verify with `vercel env ls` after each addition.                                                  |
| Lifecycle script run against the wrong bucket.                      | Confirm `S3_BUCKET` value before running. Idempotent; worst case is a no-op overwrite of an identical rule.                                |
| (R2) Class A operation costs spike on unexpected write traffic.     | Set a Cloudflare billing alert at $5/month. Free tier covers 1M Class A ops/month.                                                         |
| (S3) Egress costs spike on serving objects directly.                | Prefer presigned URLs from a CDN (CloudFront) over direct S3 origin reads. Out of scope for v1 since we use presigned URLs server-side.    |
| (S3) Public Access settings accidentally relaxed.                   | AWS Config rule "s3-bucket-public-access-prohibited" if available in the account; otherwise quarterly manual check.                        |
| Provider swap later requires re-uploading objects.                  | Objects are short-lived (lifecycle expires unanchored snapshots in 24h); a swap window during a low-traffic period has near-zero data risk. |

---

## 10. Open Questions

- Confirm the Linear ticket ID (this draft assumes `LEX-69`).
- Cloudflare billing alert threshold — suggest $5/month if R2 is chosen.
- For S3: do we want **AWS CloudTrail** S3 data events logged on these buckets? Default-off; only useful if compliance later requires object-level audit trails.
