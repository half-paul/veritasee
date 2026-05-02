# Plan: Provision S3-compatible object store

## Summary

Add a new `packages/storage` workspace package that wraps the AWS SDK v3 S3 client (`@aws-sdk/client-s3`) behind a lazy-initialized Proxy, mirroring the existing `packages/redis` and `packages/db` wrappers. The package targets any S3-compatible backend (Cloudflare R2 or AWS S3 per PRD §17) by exposing `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, and an optional `S3_FORCE_PATH_STYLE` flag (required for R2). Surface required env vars via `requireEnv`, expose typed `putObject` / `getObject` / `deleteObject` helpers and the raw client, add a Vitest smoke test (PUT / GET / DELETE roundtrip) gated on env, and add `/api/health/storage` to `apps/web` mirroring `/api/health/db` and `/api/health/redis`. Provide a small `scripts/apply-lifecycle.ts` runner that applies a bucket lifecycle policy expiring the `snapshots/unanchored/` prefix at 24h, satisfying the second LEX-67 acceptance criterion. Bucket provisioning itself (creating the R2 or S3 bucket, IAM keys) is performed by the developer in the provider console; the code only consumes the URL/keys/bucket name.

## User Story

As a developer
I want an S3-compatible object-store client backed by R2 or AWS S3 with a lifecycle policy applied
So that we can persist anchored and unanchored snapshots per PRD §14.1 and unblock VS-026 (snapshot persistence).

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | LOW |
| Systems Affected | new `packages/storage`, `apps/web` (health route, dep), root scripts, env config, AGENTS.md |
| Linear Issue | LEX-67 (VS-005) |

---

## Patterns to Follow

### Lazy Proxy client (mirror `packages/redis/src/client.ts`)

```ts
// SOURCE: packages/redis/src/client.ts:1-20
import { Redis } from '@upstash/redis';
import { requireEnv } from './env';

let cached: Redis | undefined;

export function getRedis(): Redis {
  if (!cached) {
    cached = new Redis({
      url: requireEnv('UPSTASH_REDIS_REST_URL'),
      token: requireEnv('UPSTASH_REDIS_REST_TOKEN'),
    });
  }
  return cached;
}

export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop, receiver) {
    return Reflect.get(getRedis() as object, prop, receiver);
  },
});
```

### Required-env helper (mirror `packages/redis/src/env.ts`)

```ts
// SOURCE: packages/redis/src/env.ts:1-5
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
```

### Health-check route (mirror `apps/web/src/app/api/health/db/route.ts`)

```ts
// SOURCE: apps/web/src/app/api/health/db/route.ts:1-19
import { NextResponse } from 'next/server';
import { getDb, sql } from '@veritasee/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    const ok = Array.isArray(rows) ? rows[0]?.ok === 1 : (rows as { rows: { ok: number }[] }).rows?.[0]?.ok === 1;
    if (!ok) return NextResponse.json({ ok: false }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}
```

### Env-gated live smoke test (mirror `packages/redis/test/smoke.test.ts`)

```ts
// SOURCE: packages/redis/test/smoke.test.ts:1-32
import { afterAll, describe, expect, it } from 'vitest';
import { getRedis } from '../src';

const url = process.env['UPSTASH_REDIS_REST_URL'];
const token = process.env['UPSTASH_REDIS_REST_TOKEN'];

describe('upstash redis smoke', () => {
  if (!url || !token) {
    console.warn('UPSTASH_REDIS_REST_URL/_TOKEN unset — skipping redis smoke test');
    it.skip('SET/GET/EXPIRE roundtrip (skipped: no upstash env)', () => {});
    return;
  }

  const key = `veritasee:smoke:${Date.now()}`;
  const client = getRedis();

  afterAll(async () => {
    await client.del(key);
  });

  it('SET with EXPIRE then GET returns the value', async () => {
    await client.set(key, 'ok', { ex: 60 });
    const value = await client.get<string>(key);
    expect(value).toBe('ok');
  });
});
```

### Workspace package wiring (mirror `packages/redis/package.json`)

```json
// SOURCE: packages/redis/package.json:1-25
{
  "name": "@veritasee/redis",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "node ../../scripts/with-env.mjs eslint .",
    "typecheck": "node ../../scripts/with-env.mjs tsc --noEmit",
    "test": "node ../../scripts/with-env.mjs vitest run"
  },
  "dependencies": { "@upstash/redis": "^1.34.0" },
  "devDependencies": { "@types/node": "^22.10.5", "eslint": "^9.18.0", "typescript": "^5.7.3", "vitest": "^2.1.0" }
}
```

### Root script delegation (mirror root `package.json`)

```json
// SOURCE: package.json:13 (root)
"redis:test": "node scripts/with-env.mjs pnpm --filter @veritasee/redis test"
```

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `packages/storage/package.json` | CREATE | Workspace package manifest, `@aws-sdk/client-s3` dep |
| `packages/storage/tsconfig.json` | CREATE | Extends `tsconfig.base.json` |
| `packages/storage/vitest.config.ts` | CREATE | Vitest config (20s timeout, `test/**/*.test.ts`) |
| `packages/storage/eslint.config.mjs` | CREATE | Empty ignore-only config to mirror `packages/redis` |
| `packages/storage/src/env.ts` | CREATE | `requireEnv` / `optionalEnv` helpers |
| `packages/storage/src/load-env.ts` | CREATE | `loadEnv()` for direct `tsx` script invocation (mirrors `packages/db/src/load-env.ts`) |
| `packages/storage/src/client.ts` | CREATE | Lazy Proxy wrapping AWS SDK `S3Client` |
| `packages/storage/src/objects.ts` | CREATE | Thin `putObject` / `getObject` / `deleteObject` helpers (Buffer/string in, body bytes out) |
| `packages/storage/src/lifecycle.ts` | CREATE | `applyUnanchoredLifecycle()` — `PutBucketLifecycleConfiguration` for `snapshots/unanchored/` 24h expiry |
| `packages/storage/src/index.ts` | CREATE | Barrel re-exports (`s3`, `getS3`, helpers, types) |
| `packages/storage/scripts/apply-lifecycle.ts` | CREATE | One-shot runner that calls `applyUnanchoredLifecycle()` (mirrors `packages/db/scripts/migrate.ts` shape) |
| `packages/storage/test/smoke.test.ts` | CREATE | Live PUT/GET/DELETE smoke test, env-gated |
| `apps/web/package.json` | UPDATE | Add `"@veritasee/storage": "workspace:*"` dependency |
| `apps/web/src/app/api/health/storage/route.ts` | CREATE | Health probe via `HeadBucketCommand` |
| `apps/web/.env.example` | UPDATE | Document `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE` |
| `package.json` (root) | UPDATE | Add `storage:test` and `storage:apply-lifecycle` scripts |
| `AGENTS.md` | UPDATE | Brief note documenting `packages/storage` and required env vars |
| `pnpm-lock.yaml` | UPDATE (auto) | Regenerated by `pnpm install` |

No changes to `pnpm-workspace.yaml` (already globs `packages/*`).

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Create `packages/storage` manifest and configs

- **Files**: `packages/storage/package.json`, `packages/storage/tsconfig.json`, `packages/storage/vitest.config.ts`, `packages/storage/eslint.config.mjs`
- **Action**: CREATE
- **Implement**:
  - `package.json`: `name: "@veritasee/storage"`, `private: true`, `type: "module"`, `main`/`types`: `./src/index.ts`, `exports: { ".": "./src/index.ts" }`. Scripts (lint, typecheck, test) wrapped with `node ../../scripts/with-env.mjs`. Add an extra script `storage:apply-lifecycle: "node ../../scripts/with-env.mjs tsx scripts/apply-lifecycle.ts"`. Dependency: `@aws-sdk/client-s3` (`^3.700.0` or current). Dev deps mirror `packages/db`: `@types/node`, `eslint`, `tsx`, `typescript`, `vitest`.
  - `tsconfig.json`: mirror `packages/db/tsconfig.json` (extends `../../tsconfig.base.json`, `outDir: dist`, `noEmit: true`, `types: ["node"]`). **Include `scripts/**/*` in `include`** (not just `src/**/*`, `test/**/*`, `vitest.config.ts`) so the `apply-lifecycle.ts` runner is type-checked. Final `include`: `["src/**/*", "scripts/**/*", "test/**/*", "vitest.config.ts"]`. Do NOT copy `packages/redis/tsconfig.json` — it omits `scripts/**/*` because the redis package has no scripts.
  - `vitest.config.ts`: copy `packages/redis/vitest.config.ts:1-8` (20s timeout, `test/**/*.test.ts`).
  - `eslint.config.mjs`: copy `packages/redis/eslint.config.mjs:1-5` (single ignore block).
- **Mirror**: `packages/redis/package.json` (manifest shape), `packages/db/tsconfig.json` (tsconfig — includes `scripts/**/*`), `packages/redis/vitest.config.ts` (vitest), `packages/redis/eslint.config.mjs` (eslint ignore-only), `packages/db/package.json` (for `tsx` runner script shape)
- **Validate**: `pnpm install` resolves cleanly; lockfile updates with the new package and `@aws-sdk/client-s3`.

### Task 2: Add `requireEnv` helper

- **File**: `packages/storage/src/env.ts`
- **Action**: CREATE
- **Implement**: One exported function `requireEnv(name: string): string` that throws `Missing required env: <name>` when unset. Also export a small `optionalEnv(name: string): string | undefined` helper since `S3_FORCE_PATH_STYLE` is optional.
- **Mirror**: `packages/redis/src/env.ts`
- **Validate**: `pnpm --filter @veritasee/storage typecheck` (will pass after Task 3).

### Task 2b: Add `loadEnv` helper for direct script invocation

- **File**: `packages/storage/src/load-env.ts`
- **Action**: CREATE
- **Implement**: Mirror `packages/db/src/load-env.ts` line-for-line. Walks the same env files (`.env`, `.env.local`, `apps/web/.env`, `apps/web/.env.local`) and populates `process.env` with any missing keys. Required so that `tsx packages/storage/scripts/apply-lifecycle.ts`, when invoked directly (not through `with-env.mjs`), still picks up bucket creds — same defensive belt-and-braces as `packages/db/scripts/migrate.ts:1-7`.
- **Mirror**: `packages/db/src/load-env.ts` (verbatim copy is fine; the file has no package-specific state)
- **Validate**: `pnpm --filter @veritasee/storage typecheck`.

### Task 3: Implement lazy Proxy S3 client

- **File**: `packages/storage/src/client.ts`
- **Action**: CREATE
- **Implement**:
  - Import `S3Client` from `@aws-sdk/client-s3`.
  - `let cached: S3Client | undefined`.
  - `export function getS3(): S3Client` — on first call, construct via:
    ```
    new S3Client({
      region: requireEnv('S3_REGION'),
      endpoint: requireEnv('S3_ENDPOINT'),
      credentials: {
        accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: optionalEnv('S3_FORCE_PATH_STYLE') === 'true',
    })
    ```
  - `export const s3: S3Client = new Proxy({} as S3Client, { get(_, prop, receiver) { return Reflect.get(getS3() as object, prop, receiver); } })`.
  - Also export `export function getBucket(): string { return requireEnv('S3_BUCKET'); }` so callers don't repeat the env name.
  - Do NOT validate env at module import — only on first use, matching `packages/redis` and `packages/db`.
- **Mirror**: `packages/redis/src/client.ts:1-20`
- **Validate**: `pnpm --filter @veritasee/storage typecheck`.

### Task 4: Add object helpers

- **File**: `packages/storage/src/objects.ts`
- **Action**: CREATE
- **Implement**: Small async helpers wrapping the SDK so callers don't import command classes everywhere:
  - `putObject(key: string, body: Uint8Array | string, opts?: { contentType?: string; cacheControl?: string }): Promise<void>` — uses `PutObjectCommand` with `Bucket: getBucket()`.
  - `getObject(key: string): Promise<Uint8Array>` — uses `GetObjectCommand`; reads `response.Body` via `transformToByteArray()`.
  - `deleteObject(key: string): Promise<void>` — uses `DeleteObjectCommand`.
  - All helpers call `getS3().send(...)` (lazy client). No retry/backoff — leave SDK defaults.
- **Mirror**: shape of `packages/db/src/client.ts:11-17` (lazy `send`-style call); the SDK command pattern is documented in `@aws-sdk/client-s3` README.
- **Validate**: `pnpm --filter @veritasee/storage typecheck`.

### Task 5: Add lifecycle helper + bootstrap script

- **Files**: `packages/storage/src/lifecycle.ts`, `packages/storage/scripts/apply-lifecycle.ts`
- **Action**: CREATE
- **Implement**:
  - `lifecycle.ts`: export `async function applyUnanchoredLifecycle(): Promise<void>` that calls `PutBucketLifecycleConfigurationCommand` on `getBucket()` with a single `Rule`:
    - `ID: 'expire-unanchored-snapshots-24h'`
    - `Status: 'Enabled'`
    - `Filter: { Prefix: 'snapshots/unanchored/' }`
    - `Expiration: { Days: 1 }` (S3 / R2 minimum granularity for object lifecycle expiration is 1 day, which satisfies the AC's "24h expiry").
  - `scripts/apply-lifecycle.ts`: tsx-runnable file. **Imports `loadEnv` from `../src/load-env` and calls `loadEnv()` BEFORE any other import that touches `process.env`** (mirrors `packages/db/scripts/migrate.ts:1-7`). Then imports `applyUnanchoredLifecycle` from `../src/lifecycle`, awaits it, logs `Applied lifecycle: snapshots/unanchored/ → expire after 1 day`, exits non-zero on error. The `loadEnv()` call is defensive: when invoked via `pnpm storage:apply-lifecycle` the `with-env.mjs` wrapper has already populated env, but a developer running `tsx packages/storage/scripts/apply-lifecycle.ts` directly should also work.
  - Note in a one-line comment that R2 supports `PutBucketLifecycleConfiguration` (S3 API surface), so this works against R2 and AWS S3 unchanged.
- **Mirror**: `packages/db/scripts/migrate.ts` (script shape), `packages/db/package.json:17` (`db:migrate` runner pattern)
- **Validate**: `pnpm --filter @veritasee/storage typecheck`. Manual: with valid env, `pnpm storage:apply-lifecycle` returns success; re-running is idempotent (S3 / R2 replace the configuration in place).

### Task 6: Add barrel export

- **File**: `packages/storage/src/index.ts`
- **Action**: CREATE
- **Implement**: Re-export `s3`, `getS3`, `getBucket` from `./client`; `putObject`, `getObject`, `deleteObject` from `./objects`; `applyUnanchoredLifecycle` from `./lifecycle`. Re-export the `S3Client` type from `@aws-sdk/client-s3`. Do not re-export `requireEnv` (internal).
- **Mirror**: `packages/redis/src/index.ts:1-2`
- **Validate**: `pnpm --filter @veritasee/storage typecheck`.

### Task 7: Add live PUT/GET/DELETE smoke test

- **File**: `packages/storage/test/smoke.test.ts`
- **Action**: CREATE
- **Implement**:
  - Import `afterAll, describe, expect, it` from `vitest`; import `putObject, getObject, deleteObject` from `../src`.
  - Read `process.env['S3_ENDPOINT']`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`. If any unset, log warning and use `it.skip(...)`, return.
  - Use a unique key under the unanchored prefix (so an accidental leak is auto-cleaned by the lifecycle): `snapshots/unanchored/smoke-${Date.now()}.txt`.
  - `afterAll`: `await deleteObject(key)` (best-effort).
  - Test 1: `putObject(key, 'ok', { contentType: 'text/plain' })` then `getObject(key)` and assert the decoded UTF-8 string equals `'ok'`.
  - Test 2: `deleteObject(key)` then `getObject(key)` and expect it to throw (NoSuchKey). Use `await expect(getObject(key)).rejects.toThrow()`.
- **Mirror**: `packages/redis/test/smoke.test.ts:1-32` (env-gated `it.skip` pattern, unique-key cleanup)
- **Validate**: `pnpm --filter @veritasee/storage test` — passes when env set, skips cleanly otherwise.

### Task 8: Document env vars

- **File**: `apps/web/.env.example`
- **Action**: UPDATE
- **Implement**: Append a new section after the Upstash block:
  ```
  # Object storage (S3-compatible: Cloudflare R2 or AWS S3) — see PRD §14.1, §17
  # Provision a bucket in your provider, then create an access-key pair scoped
  # to that bucket. For Cloudflare R2, set S3_FORCE_PATH_STYLE=true and use the
  # R2 S3 API endpoint (https://<account>.r2.cloudflarestorage.com) with region
  # "auto". For AWS S3, leave S3_FORCE_PATH_STYLE unset and use the standard
  # regional endpoint.
  S3_ENDPOINT=
  S3_REGION=
  S3_ACCESS_KEY_ID=
  S3_SECRET_ACCESS_KEY=
  S3_BUCKET=
  # Required for Cloudflare R2; leave unset for AWS S3.
  S3_FORCE_PATH_STYLE=
  ```
- **Mirror**: existing block style in `apps/web/.env.example` (Postgres / Upstash blocks)
- **Validate**: visual inspection.

### Task 9: Wire `apps/web` to consume the package

- **File**: `apps/web/package.json`
- **Action**: UPDATE
- **Implement**: Add `"@veritasee/storage": "workspace:*"` to `dependencies`, alphabetized after `@veritasee/redis`.
- **Mirror**: existing `@veritasee/redis` and `@veritasee/db` entries
- **Validate**: `pnpm install`; `pnpm --filter web typecheck`.

### Task 10: Add `/api/health/storage` route

- **File**: `apps/web/src/app/api/health/storage/route.ts`
- **Action**: CREATE
- **Implement**:
  - Same exports as DB / Redis health routes (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`).
  - `GET` handler: import `getS3, getBucket` from `@veritasee/storage` and `HeadBucketCommand` from `@aws-sdk/client-s3`. Call `await getS3().send(new HeadBucketCommand({ Bucket: getBucket() }))`. On success, return `{ ok: true }`. On error, return `{ ok: false, error: message }` with status 503.
  - Identical response shape to DB route to keep `/api/health/*` uniform.
- **Mirror**: `apps/web/src/app/api/health/db/route.ts:1-19`
- **Validate**: `pnpm build`; manual `curl localhost:3000/api/health/storage` returns `{"ok":true}` when env set against a real bucket.

### Task 11: Add root convenience scripts

- **File**: `package.json` (root)
- **Action**: UPDATE
- **Implement**: Add two scripts alphabetically grouped with `redis:test`:
  - `"storage:test": "node scripts/with-env.mjs pnpm --filter @veritasee/storage test"`
  - `"storage:apply-lifecycle": "node scripts/with-env.mjs pnpm --filter @veritasee/storage storage:apply-lifecycle"`
- **Mirror**: existing `redis:test` line in root `package.json:13`
- **Validate**: `pnpm storage:test` runs the package vitest; `pnpm storage:apply-lifecycle` runs the bootstrap script.

### Task 12: Document the package in AGENTS.md

- **File**: `AGENTS.md`
- **Action**: UPDATE
- **Implement**: In the existing packages bullet (the line that already mentions `@veritasee/db` and `@veritasee/redis`), append: `@veritasee/storage` wraps an S3-compatible object store (Cloudflare R2 or AWS S3) for snapshot and reference-asset persistence per PRD §14.1; requires `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` (and `S3_FORCE_PATH_STYLE=true` for R2). Keep it to one or two lines.
- **Validate**: visual inspection.

---

## Validation

```bash
# Install workspace deps (lockfile regen for @aws-sdk/client-s3)
pnpm install

# Type check (all workspaces)
pnpm typecheck

# Lint
pnpm lint

# Build (apps/web must build with new import surface)
pnpm build

# Storage smoke test (requires S3_* env in .env.local against a real bucket)
pnpm storage:test

# Apply the unanchored 24h lifecycle once per bucket (idempotent)
pnpm storage:apply-lifecycle

# Existing checks must remain green
pnpm --filter @veritasee/db test
pnpm --filter @veritasee/redis test

# Manual: dev server + health probes
pnpm dev
# curl http://localhost:3000/api/health/db      -> {"ok":true}
# curl http://localhost:3000/api/health/redis   -> {"ok":true}
# curl http://localhost:3000/api/health/storage -> {"ok":true}
```

---

## Risks

| Risk | Mitigation |
|------|------------|
| AWS SDK v3 module is heavy and may bloat Edge bundles | Health route pins `runtime = 'nodejs'`; the package is only imported by Node-runtime routes/handlers. Document this constraint in `client.ts`. |
| Cloudflare R2 needs `forcePathStyle: true`; AWS S3 does not | Read `S3_FORCE_PATH_STYLE` env var and forward to `S3Client` config; documented in `.env.example`. |
| Lifecycle minimum granularity is **1 day**, not literal 24 hours | S3 / R2 lifecycle expiration is day-bucketed; "24h expiry" in the AC is satisfied by `Expiration.Days = 1`. Note this in `lifecycle.ts` comment. |
| Bucket provisioning + IAM keys are operational, not code | Plan documents env var shape and references the provider console; the lifecycle bootstrap script applies the **policy** but not the bucket itself. |
| Smoke test fails in CI without bucket creds | Use the same env-gated `it.skip` pattern as `packages/redis/test/smoke.test.ts`; tests skip cleanly when vars unset. |
| Module-level env validation would crash apps/web build | Use lazy Proxy + first-call validation (matches `packages/redis` and `packages/db`), so `pnpm build` succeeds without secrets. |
| Test objects could leak if delete fails | Place test keys under `snapshots/unanchored/` so the lifecycle policy auto-evicts orphans within 24h. |
| `pnpm-lock.yaml` churn | Run `pnpm install` once and commit the updated lockfile alongside source. |

---

## Acceptance Criteria

- [ ] `packages/storage` exists, exports `s3` (Proxy), `getS3()`, `getBucket()`, `putObject` / `getObject` / `deleteObject`, and `applyUnanchoredLifecycle()`.
- [ ] `apps/web` depends on `@veritasee/storage` via `workspace:*`.
- [ ] `/api/health/storage` returns `{"ok":true}` against a live bucket.
- [ ] `pnpm storage:test` runs PUT/GET/DELETE end-to-end and passes (skips cleanly when env unset). **Maps to LEX-67 AC #1.**
- [ ] `pnpm storage:apply-lifecycle` configures `snapshots/unanchored/` to expire at 1 day; verified via the provider console or a re-run that returns the same config. **Maps to LEX-67 AC #2.**
- [ ] `apps/web/.env.example` documents `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, and `S3_FORCE_PATH_STYLE`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` all succeed.
- [ ] Follows existing patterns (lazy Proxy client, `requireEnv`, env-gated vitest, `with-env.mjs` wrapper, tsx runner script).
