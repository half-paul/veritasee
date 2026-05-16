# Plan: Proxy Response Cache (Redis, 15 min, keyed by url + revision)

## Summary

Add a thin Redis-backed cache module that the upcoming proxy fetcher (VS-021 / LEX-71) will use
to memoize sanitized HTML responses. Cache entries live in Upstash Redis under
`proxy:cache:v1:{sha256(normalizedUrl)}` with a 900-second TTL, and the stored value carries the
`source_revision_hash` so consumers can detect drift (PRD §FR-VW-5) and explicitly invalidate.
Module lives in `apps/web/src/lib/proxy-cache/` next to `url-validation/`, follows the existing
`@veritasee/redis` access pattern (`getRedis()` + lazy singleton), and ships with a thin
`/api/health/proxy-cache` round-trip endpoint that exercises set → get → TTL-check → del so the
behavior can be validated in production before VS-021 wires it up to the real fetch path.

## User Story

As the proxy fetch pipeline
I want a 15-minute response cache keyed by URL with revision-tagged entries
So that repeated reads of the same article skip the origin fetch + sanitize cost, while a
detected source revision change still forces a fresh fetch (PRD §FR-VW-2, §FR-VW-6).

## Metadata

| Field            | Value                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Type             | NEW_CAPABILITY                                                                                                       |
| Complexity       | SMALL                                                                                                                |
| Systems Affected | `apps/web` (new lib module, new health route), Upstash Redis (read/write under `proxy:cache:v1:*`)                   |
| Linear Issue     | LEX-72 — VS-022 "Proxy response cache (Redis, 15 min, keyed by url+revision)"                                        |
| Spec sources     | `docs/PRD.md` §FR-VW-2, §FR-VW-5, §6 (Read P95), §14.1 (Snapshot retention — hot-cache tier)                         |
| Depends on       | LEX-66 (VS-004 Upstash provisioned — **Done**), LEX-71 (VS-021 proxy fetcher — **Backlog**; required for end-to-end AC) |

---

## Acceptance Criteria (verbatim from VS-022)

- [ ] Given a cache miss, when proxying, then the fetched, sanitized payload is stored with TTL=900s. *(For payloads within the 950 KB UTF-8 byte budget; oversize payloads are deliberately skipped per §2 and `setCached` returns `false`. The warm tier (LEX-76) handles larger blobs.)*
- [ ] Given a cache hit, when re-requested within 15 min, then the response is served without origin fetch.
- [ ] Given source revision change, when detected, then cache key invalidates.

Implied / derived:

- [ ] Cache entry carries the `revisionHash` so VS-021 can detect drift without an extra read.
- [ ] `getCached` / `setCached` / `invalidateCached` are pure with respect to inputs (idempotent).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass at the repo root.
- [ ] `GET /api/health/proxy-cache` returns 200 with a set→get→ttl→del round-trip result on a healthy Upstash; 503 otherwise.

> The first three AC are behavioral and require VS-021 (LEX-71) to wire the cache into the
> real proxy fetch path. The module shipped by LEX-72 must expose an integration contract
> that makes ticking them mechanical in LEX-71's PR.

---

## Approach & Design Decisions

### 1. Key shape — `proxy:cache:v1:{sha256(normalizedUrl)}`, NOT `proxy:cache:v1:{url}`

Two reasons to hash:

1. **URL length / control bytes.** `validateUrl` accepts up to 2 KB URLs (`MAX_URL_LENGTH = 2048`,
   see `apps/web/src/lib/url-validation/types.ts:1`). Upstash keys are not size-limited in
   practice but inlining the raw URL bloats every key and risks colon-collision with the
   namespace separator.
2. **Stable shape for ops.** A fixed-width hash makes `SCAN MATCH proxy:cache:v1:*` cheap and
   predictable, and lets us see traffic shape without log-scraping URLs.

The `v1` suffix is the schema version for the **value** (see §2). If we ever change the value
shape — e.g. split payload into headers + body, or add language detection — we bump to `v2`
and the old keys age out naturally inside 15 minutes.

**Reading the PRD literally.** §FR-VW-2 says "keyed by `(url, source-revision)`". We do **not**
include `revisionHash` in the Redis key because the caller doesn't know the revision until
**after** the origin fetch. Embedding it would force a two-call flow (read latest revision,
then look up cache), which negates the cache. Instead, the key is URL-only and the value
carries `revisionHash`; revision change is handled by §3 below. This matches PRD §14.1's
description of the hot tier as "proxy-cache only, no correction attached".

**Normalization is browser-identity, not article-identity.** The "URL" we hash is
`validateUrl`'s `normalizedUrl` — the result of WHATWG `URL.toString()` after scheme/length/
denylist checks. That means `https://example.com/foo` and `https://example.com/foo/` produce
**different cache keys**, even though both may resolve to the same encyclopedia article.
We accept this hit-rate cost for v1: the cache mirrors what the user typed, no canonicalization
is promised. A future iteration could add per-host canonicalization rules (e.g. trailing-slash
fold for Wikipedia) — out of scope here.

### 2. Value shape — single JSON object

```ts
export type CachedProxyResponse = {
  url: string;            // normalized URL (from validateUrl)
  revisionHash: string;   // sha256(normalized_text), source of FR-VW-5 anchoring
  fetchedAt: string;      // ISO 8601, set at cache insert time
  payload: string;        // sanitized HTML (post-DOMPurify, post-header-strip per LEX-71)
  contentType?: string;   // origin Content-Type, default 'text/html; charset=utf-8'
};
```

Stored via `redis.set(key, value, { ex: 900 })`. `@upstash/redis` REST client JSON-encodes
non-string arguments to `set` and JSON-decodes them back through the typed generic on `get<T>`
(documented in `@upstash/redis` README; the smoke test at `packages/redis/test/smoke.test.ts:22`
exercises the string-payload form, so this behavior should be confirmed via a one-time manual
round-trip during Task 7).

**Size budget.** Upstash REST has a 1 MB request limit; sanitized HTML for a typical
encyclopedia article is < 200 KB. We don't compress at this tier — that's the **warm** (R2/S3)
tier's job per PRD §14.1 ("zstd level 6"). If a fetched payload's UTF-8 byte length exceeds
the budget (see Task 3) we **skip the cache** and `setCached` returns `false`; LEX-71 logs
the skip at the call site where it has full request context (see §9). The cache module
itself never logs.

### 3. Revision invalidation — caller-driven, not key-embedded

Contract for VS-021:

```ts
const cached = await getCached(normalizedUrl);
if (cached) {
  const currentRevision = await peekRevision(normalizedUrl); // VS-021's job
  if (currentRevision === cached.revisionHash) {
    return serve(cached);                                    // AC #2: hit, no origin fetch
  }
  await invalidateCached(normalizedUrl);                     // AC #3: drift → invalidate
}
const fresh = await fetchAndSanitize(normalizedUrl);          // origin round-trip
await setCached(normalizedUrl, fresh);                        // AC #1: TTL=900s
return serve(fresh);
```

A `getCachedFresh(normalizedUrl, expectedRevisionHash?)` convenience helper is provided so the
common path collapses to one call:

- `expectedRevisionHash` omitted → behaves like `getCached`.
- `expectedRevisionHash` provided and matches → returns the entry.
- Mismatch → calls `invalidateCached` and returns `null` (single round-trip on the read side
  if VS-021 can derive the expected hash cheaply; otherwise it still uses the two-step form
  above).

**Invalidation race.** Between `getCached` and `invalidateCached` inside `getCachedFresh`, a
concurrent request may have just written a fresh entry — the subsequent `del` will wipe that
fresh entry too. Worst case is **one extra origin re-fetch** by whichever request wins; the
data correctness invariant (never serve drift) is preserved. We deliberately do not use
Redis CAS / WATCH here — the cost of one extra fetch is far below the complexity cost of
making this atomic, and the race window is narrow (single Upstash RTT).

LEX-71 chooses the form that fits its drift-detection strategy; LEX-72 just exposes both.

### 4. Module location — `apps/web/src/lib/proxy-cache/`, NOT a new package

AGENTS.md guidance: "packages is for shared libraries only when the need is genuinely cross-app
or cross-surface." Only the Next.js app reads/writes this cache for v1 — the browser
extension takes a different code path (queries `/api/overrides` per PRD §FR-VW-2), and snapshot
persistence (LEX-76) writes to object storage, not Redis. Putting the module under
`apps/web/src/lib/proxy-cache/` mirrors the existing `apps/web/src/lib/url-validation/` shape:

- `types.ts` — `CachedProxyResponse`, `PROXY_CACHE_TTL_SECONDS = 900`, `MAX_PAYLOAD_BYTES = 950_000`.
- `keys.ts` — `proxyCacheKey(url)` pure function.
- `cache.ts` — `getCached`, `setCached`, `invalidateCached`, `getCachedFresh`.
- `index.ts` — barrel re-exports.

If a second consumer ever lands (extension service, background reaper, etc.), extracting to
`packages/proxy-cache` is mechanical — internal API is already pure functions over Redis.

### 5. Redis client access — `getRedis()`, not `redis` proxy

`packages/redis/src/client.ts:6-14` exposes both `getRedis()` (explicit) and `redis` (lazy
`Proxy`). Existing call sites (`apps/web/src/app/api/health/redis/route.ts:10`) use `getRedis()`.
We follow the same convention: it's clearer in stack traces and avoids the proxy-trap overhead
on every method access.

### 6. TTL constant — defined once, in `types.ts`

`PROXY_CACHE_TTL_SECONDS = 900` is the contract from VS-022. It lives in `types.ts` so tests,
the health endpoint, and any future eviction tool can import the same constant. Upstash's
`set(..., { ex: 900 })` is the established TTL pattern (`packages/redis/test/smoke.test.ts:22`).

### 7. Hashing — `node:crypto.createHash('sha256')`, not a userland lib

The validation module (`apps/web/src/lib/url-validation/resolveHost.ts`) already uses Node
built-ins (`node:dns`) without adding npm deps. SHA-256 over a 2 KB URL is microseconds and
needs no library. Set `export const runtime = 'nodejs'` on any route that uses the module so
the Edge runtime's crypto surface differences don't bite us.

### 8. Health endpoint — `/api/health/proxy-cache`, gated by header token

A round-trip smoke endpoint at `apps/web/src/app/api/health/proxy-cache/route.ts`:

1. **Auth gate FIRST.**
   - In production (`process.env.NODE_ENV === 'production'`): require `PROXY_CACHE_HEALTH_TOKEN`
     to be set; if unset return 503 `{ ok: false, error: 'health_token_unconfigured' }`
     (fail closed — the route is never open by accident). Then compare to
     `req.headers.get('x-health-token')` with `crypto.timingSafeEqual`; mismatch or missing
     → 401 `{ ok: false }`.
   - In dev/preview: if the env var is set, enforce it the same way; if unset, skip the gate
     so `pnpm dev` smoke (Task 7) still works without local config.
2. Builds a synthetic test entry under a sentinel URL `https://veritasee.test/__healthcheck__`.
3. `setCached` it.
4. `getCached` to verify the value round-trips.
5. `redis.ttl(proxyCacheKey(...))` to verify TTL is within `(0, 900]` (the AC's 900-second
   requirement; the assertion's goal is "TTL was set, not unbounded" — round-trip latency
   under cold-start can eat several seconds, so we don't tighten the lower bound).
6. `invalidateCached` to clean up.
7. Returns `{ ok: true, ttl }` on success, `{ ok: false, step, error }` with status 503 on
   failure.

This is the **deployment-time** validation for AC #1 (TTL=900s). It does NOT prove the
"during proxy" wiring — that's LEX-71's responsibility — but it proves the building block end
to end against real Upstash.

**Why gate this one when `/api/health/redis` is open?** That endpoint does a single `ping()`
(one Upstash REST request); this endpoint does `SET` + `GET` + `TTL` + `DEL` (four requests
per probe) and is a write surface. An unauthenticated GET would let anyone drive Upstash
billing and write-QPS. The token lives in Vercel env vars; ops configures monitors to send
`x-health-token`. Local dev can leave the var unset and use the manual smoke step (Task 7)
which is gated on `NODE_ENV !== 'production'`.

### 9. Observability + failure semantics

The health route uses `withObservability` so failures hit Sentry and structured logs
(`apps/web/src/lib/observability/withObservability.ts:30-43`). The cache module itself does
**no** request-scoped logging — it's a pure utility. If LEX-71 wants hit/miss metrics, it
emits them at the call site where it has the full request context. Critically: we never log
the cached payload or the raw URL beyond `pathname` (see logger doc comment in
`apps/web/src/lib/observability/logger.ts:1-4`).

**Failure semantics — the cache module is throw-on-infra-failure.** `getCached`,
`setCached`, `invalidateCached`, and `getCachedFresh` do **not** catch Upstash errors
internally. A connection failure, REST 5xx, or auth error from Upstash propagates as a thrown
exception. Rationale:

- A cache module that swallowed infra errors would silently degrade hit-rate to zero in an
  outage and emit no signal; the proxy route would still see "no cached entry" and re-fetch
  origin, which is the right behavior — but no alert fires.
- By throwing, LEX-71's call site can `try/catch` once and emit a `proxy_cache_unavailable`
  counter that Sentry will pick up via `withObservability`, while still falling back to
  origin fetch on the same code path that handles cache miss.

LEX-71's integration code therefore wraps every cache call in `try/catch` and treats any
thrown error as equivalent to a cache miss for serving purposes, but as an alert-worthy event
for observability purposes. See the §"Integration Contract for LEX-71" snippet.

### 10. No new dependencies

`@upstash/redis` is already in `packages/redis`. `node:crypto` is built-in. No DOMPurify or
sanitization libs land here — that's LEX-71.

---

## Patterns to Follow

### Module shape (mirror `url-validation/`)

```ts
// SOURCE: apps/web/src/lib/url-validation/index.ts:1-11
export { validateUrl } from './validateUrl';
export {
  DEFAULT_DENYLIST,
  clearDenylistCache,
  isDenylisted,
  loadDenylist,
} from './denylist';
export { isPrivateAddress } from './privateIp';
export { MAX_URL_LENGTH } from './types';
export type { ValidationError, ValidationOk, ValidationResult } from './types';
```

### Redis singleton access

```ts
// SOURCE: apps/web/src/app/api/health/redis/route.ts:1-22
import { NextResponse, type NextRequest } from 'next/server';
import { getRedis } from '@veritasee/redis';
import { withObservability } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(_req: NextRequest) {
  try {
    const reply = await getRedis().ping();
    if (reply !== 'PONG') return NextResponse.json({ ok: false }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}

export const GET = withObservability(handler);
```

### Upstash SET with EX + typed GET

```ts
// SOURCE: packages/redis/test/smoke.test.ts:18-31
const key = `veritasee:smoke:${Date.now()}`;
const client = getRedis();

await client.set(key, 'ok', { ex: 60 });
const value = await client.get<string>(key);
expect(value).toBe('ok');

const ttl = await client.ttl(key);
expect(ttl).toBeGreaterThan(0);
expect(ttl).toBeLessThanOrEqual(60);
```

### Discriminated result type (for the health route)

```ts
// SOURCE: apps/web/src/lib/url-validation/types.ts:3-18
export type ValidationError =
  | { code: 'invalid_url'; message: string }
  | { code: 'invalid_scheme'; message: string };
export type ValidationOk = { ok: true; normalizedUrl: string; hostname: string };
export type ValidationResult = ValidationOk | ({ ok: false } & ValidationError);
```

---

## Files to Change

| File                                                       | Action | Purpose                                                                                  |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `apps/web/src/lib/proxy-cache/types.ts`                    | CREATE | `CachedProxyResponse` type + `PROXY_CACHE_TTL_SECONDS` + `MAX_PAYLOAD_BYTES` constants.  |
| `apps/web/src/lib/proxy-cache/keys.ts`                     | CREATE | `proxyCacheKey(normalizedUrl)` — sha256-hash key derivation with stable `v1` prefix.     |
| `apps/web/src/lib/proxy-cache/cache.ts`                    | CREATE | `getCached`, `setCached`, `invalidateCached`, `getCachedFresh` over `@veritasee/redis`.  |
| `apps/web/src/lib/proxy-cache/index.ts`                    | CREATE | Barrel re-exports (mirrors `url-validation/index.ts`).                                   |
| `apps/web/src/app/api/health/proxy-cache/route.ts`         | CREATE | Set → get → ttl → del round-trip smoke endpoint, mirrors `/api/health/redis`.            |

**Env-var changes:**

- `PROXY_CACHE_HEALTH_TOKEN` — required in production environments. A long random string (≥ 32 hex chars) that callers of `/api/health/proxy-cache` must send in the `x-health-token` header. If unset in production, the route fails closed with 503. Add to Vercel project settings (preview + production) and to the deploy runbook entry for LEX-72. Local dev may leave it unset.

No other env-var changes (Upstash creds are already provisioned per LEX-66). No package.json changes.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Types + TTL + size constants

- **File**: `apps/web/src/lib/proxy-cache/types.ts`
- **Action**: CREATE
- **Implement**:
  - `export const PROXY_CACHE_TTL_SECONDS = 900;`
  - `export const MAX_PAYLOAD_BYTES = 950_000;` — leaves ~50 KB headroom inside Upstash's 1 MB request limit for the JSON envelope around the payload.
  - `export type CachedProxyResponse = { url: string; revisionHash: string; fetchedAt: string; payload: string; contentType?: string; };`
  - Single-line doc comment on `revisionHash` only — explain it's `sha256(normalized_text)` per PRD §FR-VW-5.
- **Mirror**: `apps/web/src/lib/url-validation/types.ts:1-18` — flat `export const` + `export type` shape, no class wrappers.
- **Validate**: `pnpm typecheck`

### Task 2: Key derivation

- **File**: `apps/web/src/lib/proxy-cache/keys.ts`
- **Action**: CREATE
- **Implement**:
  - `import { createHash } from 'node:crypto';`
  - Private constant `KEY_PREFIX = 'proxy:cache:v1:'`.
  - `export function proxyCacheKey(normalizedUrl: string): string` returning `${KEY_PREFIX}${sha256(normalizedUrl)}`.
  - One short comment explaining why we hash (URL length + namespace cleanliness, §1 above).
- **Mirror**: `apps/web/src/lib/url-validation/privateIp.ts` — pure function, no class, no side effects.
- **Validate**: `pnpm typecheck`

### Task 3: Get / set / invalidate

- **File**: `apps/web/src/lib/proxy-cache/cache.ts`
- **Action**: CREATE
- **Implement**:
  - `import { getRedis } from '@veritasee/redis';`
  - `import { proxyCacheKey } from './keys';`
  - `import { MAX_PAYLOAD_BYTES, PROXY_CACHE_TTL_SECONDS, type CachedProxyResponse } from './types';`
  - `export async function getCached(normalizedUrl: string): Promise<CachedProxyResponse | null>`
    - `const result = await getRedis().get<CachedProxyResponse>(proxyCacheKey(normalizedUrl)); return result ?? null;`
    - Use `??`, **not** `||`. `@upstash/redis` returns `null` only when the key is absent; the entry itself is a non-empty object and we must not collapse legitimate-but-falsy fields into a cache miss.
  - `export async function setCached(normalizedUrl: string, entry: CachedProxyResponse): Promise<boolean>`
    - Size guard FIRST: `const bytes = Buffer.byteLength(entry.payload, 'utf8'); if (bytes > MAX_PAYLOAD_BYTES) return false;` — `MAX_PAYLOAD_BYTES = 950_000` leaves ~50 KB headroom inside Upstash's 1 MB limit for the JSON envelope (`url` + `revisionHash` + `fetchedAt` + `contentType` + JSON delimiters ≈ < 4 KB in practice, padded heavily).
    - Otherwise: `await getRedis().set(proxyCacheKey(normalizedUrl), entry, { ex: PROXY_CACHE_TTL_SECONDS }); return true;`.
    - The cache module emits no logs (see §9). LEX-71 inspects the return value and emits `proxy_cache_skip_oversize` / `proxy_cache_write` counters at the call site.
  - `export async function invalidateCached(normalizedUrl: string): Promise<void>`
    - Calls `getRedis().del(proxyCacheKey(normalizedUrl))`.
  - **Failure semantics:** all three functions propagate Upstash errors (no internal try/catch). See §9 for rationale and the integration contract for the LEX-71 wrapping pattern.
- **Mirror**: `apps/web/src/app/api/health/redis/route.ts:10` for `getRedis()` access pattern; `packages/redis/test/smoke.test.ts:22-25` for `set({ ex })` + typed `get<T>()`.
- **Validate**: `pnpm typecheck`

### Task 4: Convenience helper `getCachedFresh`

- **File**: `apps/web/src/lib/proxy-cache/cache.ts` (append)
- **Action**: UPDATE (same file as Task 3)
- **Implement**:
  - `export async function getCachedFresh(normalizedUrl: string, expectedRevisionHash?: string): Promise<CachedProxyResponse | null>`
  - Reads via `getCached`; if `expectedRevisionHash` is omitted, returns the entry as-is.
  - If provided and matches → return entry.
  - If provided and mismatched → `await invalidateCached(normalizedUrl)` then return `null`.
- **Mirror**: discriminated-control-flow pattern from `apps/web/src/lib/url-validation/validateUrl.ts:46-83`.
- **Validate**: `pnpm typecheck`

### Task 5: Barrel re-export

- **File**: `apps/web/src/lib/proxy-cache/index.ts`
- **Action**: CREATE
- **Implement**:
  - `export { getCached, setCached, invalidateCached, getCachedFresh } from './cache';`
  - `export { proxyCacheKey } from './keys';`
  - `export { PROXY_CACHE_TTL_SECONDS, MAX_PAYLOAD_BYTES } from './types';`
  - `export type { CachedProxyResponse } from './types';`
- **Mirror**: `apps/web/src/lib/url-validation/index.ts:1-11`.
- **Validate**: `pnpm typecheck`

### Task 6: Health round-trip endpoint (gated by header token)

- **File**: `apps/web/src/app/api/health/proxy-cache/route.ts`
- **Action**: CREATE
- **Implement**:
  - `export const runtime = 'nodejs';` and `export const dynamic = 'force-dynamic';`.
  - Handler signature `async function handler(req: NextRequest): Promise<Response>`.
  - **Auth gate (first thing in the handler):**
    - `const expected = process.env.PROXY_CACHE_HEALTH_TOKEN;`
    - If `process.env.NODE_ENV === 'production'` and `!expected` → return `NextResponse.json({ ok: false, error: 'health_token_unconfigured' }, { status: 503 })`.
    - If `expected`: read `req.headers.get('x-health-token')`. Both buffers must be equal length for `crypto.timingSafeEqual`; pad/skip-compare safely. On mismatch or absence → `NextResponse.json({ ok: false }, { status: 401 })`.
    - If non-production AND `!expected` → fall through (dev convenience).
  - Synthetic URL: `const probeUrl = 'https://veritasee.test/__healthcheck__';`.
  - Build a tiny `CachedProxyResponse` (e.g. `payload: 'ok'`, `revisionHash: 'health'`, `fetchedAt: new Date().toISOString()`).
  - In a try/catch:
    1. `const written = await setCached(probeUrl, entry);` — assert `written === true`; otherwise 503 with `step: 'set'` (should never happen for a 2-byte payload, but it proves the return-value contract).
    2. `const got = await getCached(probeUrl);` — assert `got?.payload === 'ok'`; on mismatch return 503 with `step: 'get'`.
    3. `const ttl = await getRedis().ttl(proxyCacheKey(probeUrl));` — assert `ttl > 0 && ttl <= PROXY_CACHE_TTL_SECONDS`; mismatch → 503 with `step: 'ttl'`. (Lower bound loose because Vercel cold-start + Upstash REST round-trip can eat several seconds.)
    4. `await invalidateCached(probeUrl);`
    5. Return `NextResponse.json({ ok: true, ttl });`
  - Catch → `NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' }, { status: 503 });`
  - `export const GET = withObservability(handler);`
- **Mirror**: `apps/web/src/app/api/health/redis/route.ts:1-22` for structure; `apps/web/src/app/api/health/storage/route.ts` for the multi-step error-shaping pattern.
- **Validate**: `pnpm typecheck && pnpm lint && pnpm build`

### Task 7: Manual smoke (no test framework yet)

- **File**: n/a (operational)
- **Action**: VERIFY
- **Implement**: With `apps/web/.env.local` populated with valid Upstash creds (and `PROXY_CACHE_HEALTH_TOKEN` left unset locally so the dev-convenience bypass kicks in), run `pnpm dev` and hit `http://localhost:3000/api/health/proxy-cache` — expect `{ ok: true, ttl: <≤900 and > 0> }`. Hit `/api/health/redis` as a sanity baseline first. This closes AC #1 (TTL=900s) at the building-block level. AC #2 and AC #3 close in LEX-71's PR.
- **Production smoke** (after deploy): `curl -H "x-health-token: $PROXY_CACHE_HEALTH_TOKEN" https://<env>/api/health/proxy-cache` — expect 200; same call without the header → 401.
- **Validate**: `curl -s http://localhost:3000/api/health/proxy-cache | jq` returns `ok: true`.

---

## Integration Contract for LEX-71 (VS-021)

LEX-71's proxy fetch handler should follow this shape. Documented here so LEX-72 can ship with
a stable surface area.

```ts
// inside the LEX-71 proxy fetch handler
import {
  getCached,
  setCached,
  invalidateCached,
  type CachedProxyResponse,
} from '@/lib/proxy-cache';

// Cache reads must never take down the proxy route. Treat any thrown
// error as equivalent to a cache miss for serving purposes, but emit an
// observability signal so Upstash outages still alert.
let cached: CachedProxyResponse | null = null;
try {
  cached = await getCached(normalizedUrl);
} catch (err) {
  logger.warn('proxy_cache_unavailable', { op: 'get', err: err instanceof Error ? err.message : 'unknown' });
}

if (cached) {
  const currentRevision = await peekUpstreamRevision(normalizedUrl); // LEX-71 helper
  if (currentRevision === cached.revisionHash) {
    return new Response(cached.payload, {
      status: 200,
      headers: { 'content-type': cached.contentType ?? 'text/html; charset=utf-8' },
    });
  }
  try {
    await invalidateCached(normalizedUrl);
  } catch (err) {
    logger.warn('proxy_cache_unavailable', { op: 'del', err: err instanceof Error ? err.message : 'unknown' });
    // fall through — TTL will reap the stale entry within 15 min
  }
}

const { payload, revisionHash, contentType } = await fetchAndSanitize(normalizedUrl);
const entry: CachedProxyResponse = {
  url: normalizedUrl,
  revisionHash,
  fetchedAt: new Date().toISOString(),
  payload,
  contentType,
};
try {
  const written = await setCached(normalizedUrl, entry);
  if (!written) {
    logger.warn('proxy_cache_skip_oversize', { route, request_id });
  }
} catch (err) {
  logger.warn('proxy_cache_unavailable', { op: 'set', err: err instanceof Error ? err.message : 'unknown' });
}
return new Response(payload, {
  status: 200,
  headers: { 'content-type': contentType ?? 'text/html; charset=utf-8' },
});
```

LEX-71 emits `proxy_cache_hit` / `proxy_cache_miss` / `proxy_cache_skip_oversize` /
`proxy_cache_unavailable` counters at this call site. LEX-72 deliberately emits none of these —
the cache module is throw-on-infra-failure (see §9) and the call site holds the request
context needed for useful tags.

---

## Risks & Mitigations

| Risk                                                                                       | Mitigation                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cache poisoning** (attacker primes cache with a malicious payload before legit traffic). | The cache only stores **sanitized** payloads — sanitization happens in LEX-71 before `setCached`. The cache trusts its caller; the caller is the only code path that writes. No public write surface.                     |
| **Upstash request-size limit** trips on oversized payloads.                                | §2 size guard: `Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES (950_000)` → `setCached` returns `false` without writing. LEX-71 inspects the return value at the call site and emits a `proxy_cache_skip_oversize` counter. Warm tier (R2/S3, LEX-76) handles larger blobs. |
| **Revision drift goes undetected** (caller forgets to compare hashes).                     | `getCachedFresh(url, expectedHash)` is the safer path. Document in the JSDoc on `getCached` that the raw form requires the caller to compare `cached.revisionHash`.                                                       |
| **Key collision across schema versions** if we change the value shape later.               | `KEY_PREFIX = 'proxy:cache:v1:'` is the schema version. Bump to `v2:` if the value shape changes — old `v1:` entries age out inside 15 minutes. No migration step ever required. **Mid-deploy transient:** during a rolling Vercel deploy, new pods write `v2:*` while old pods still read `v1:*` (and vice versa) — the bounded effect is one cache-TTL window of extra origin fetches, no correctness impact. |
| **Health endpoint pollutes real cache traffic / drives Upstash billing.**                  | Two-layer mitigation: (1) sentinel URL `https://veritasee.test/__healthcheck__` (RFC 2606 reserved `.test` TLD) ensures the probe key never collides with real traffic, and the `del` step guarantees cleanup (TTL reaps anyway on failure). (2) Auth gate (§8 / Task 6) requires `x-health-token` matching `PROXY_CACHE_HEALTH_TOKEN` in production, so the four-request-per-probe write surface isn't exposed to anonymous callers. |
| **AC #2 / AC #3 cannot be fully ticked by LEX-72 alone.**                                  | Plan calls this out explicitly: behavioral AC are mechanical in LEX-71's PR. LEX-72 ships the building block + a deployment-time round-trip endpoint. LEX-71's plan should reference this contract section as its input.  |
| **DNS rebinding via cached URL** (covered in LEX-71, but: a cache hit means we re-serve the originally-fetched payload, NOT a fresh fetch — so the SSRF re-validation gap in LEX-71 also applies to cache hits).            | Out of scope here. Cache **stores already-sanitized** content; it does not re-fetch. Note in LEX-71 plan as a follow-up: the proxy fetch path must pin the resolved IP **per fetch**, regardless of cache hit/miss.        |

---

## Validation

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Build (full Next.js production build, exercises route compilation)
pnpm build

# Manual smoke (requires UPSTASH_REDIS_REST_URL/_TOKEN in apps/web/.env.local;
# leave PROXY_CACHE_HEALTH_TOKEN unset locally to use the dev-convenience bypass)
pnpm dev
# in another terminal:
curl -s http://localhost:3000/api/health/redis        # baseline connectivity
curl -s http://localhost:3000/api/health/proxy-cache  # set→get→ttl→del round-trip

# Production smoke (after deploy):
curl -H "x-health-token: $PROXY_CACHE_HEALTH_TOKEN" https://<env>/api/health/proxy-cache
```

No test command is configured for `apps/web` yet (AGENTS.md: "No dedicated test framework is
configured yet"). When `vitest` lands in `apps/web`, the natural follow-up tests are:

- `keys.test.ts` — `proxyCacheKey('a')` is stable and differs from `proxyCacheKey('b')`.
- `cache.smoke.test.ts` — set → get → ttl-in-window → invalidate (mirrors `packages/redis/test/smoke.test.ts`).

These can be filed as a follow-up issue once the framework is added; they are explicitly NOT
required to close LEX-72.

---

## Acceptance Criteria Checklist

- [ ] `apps/web/src/lib/proxy-cache/` module exists with the four files described.
- [ ] `apps/web/src/app/api/health/proxy-cache/route.ts` returns 200 with `0 < ttl ≤ 900` against a healthy Upstash when the auth gate is satisfied (token sent in production, bypass in dev).
- [ ] Without `x-health-token`, the production endpoint returns 401; with `PROXY_CACHE_HEALTH_TOKEN` unset in production, the endpoint returns 503 `{ error: 'health_token_unconfigured' }`.
- [ ] `PROXY_CACHE_HEALTH_TOKEN` is set in Vercel preview + production envs and documented in the deploy runbook.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm build` passes.
- [ ] Integration contract (this plan's "Integration Contract for LEX-71" section) is referenced from the LEX-71 plan or PR description before LEX-71 is implemented.
- [ ] (Deferred to LEX-71) Behavioral AC #1, #2, #3 verified end-to-end through `/api/proxy/fetch`.
