# Implementation Report

**Plan**: `.agents/plans/lex-72-proxy-response-cache.plan.md`
**Branch**: `features/LEX-72` (cut from `features/LEX-71` — see Deviations)
**Status**: COMPLETE

## Summary

Added a Redis-backed proxy response cache module under `apps/web/src/lib/proxy-cache/` plus a token-gated `/api/health/proxy-cache` round-trip endpoint. The module exposes `getCached` / `setCached` / `invalidateCached` / `getCachedFresh` over `@veritasee/redis` with sha256-hashed keys (`proxy:cache:v1:*`), a 900s TTL, and a 950 KB size guard. LEX-71 (VS-021) will integrate this on the proxy fetch path; the integration contract is documented in the plan §"Integration Contract for LEX-71".

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Types + constants (TTL=900, MAX_PAYLOAD_BYTES=950_000, `CachedProxyResponse`) | `apps/web/src/lib/proxy-cache/types.ts` | ✅ |
| 2 | sha256 key derivation with `proxy:cache:v1:` prefix | `apps/web/src/lib/proxy-cache/keys.ts` | ✅ |
| 3 | `getCached` / `setCached` / `invalidateCached` over Upstash | `apps/web/src/lib/proxy-cache/cache.ts` | ✅ |
| 4 | `getCachedFresh(url, expectedRevisionHash?)` convenience helper | `apps/web/src/lib/proxy-cache/cache.ts` | ✅ |
| 5 | Barrel re-exports mirroring `url-validation/index.ts` | `apps/web/src/lib/proxy-cache/index.ts` | ✅ |
| 6 | Token-gated set→get→ttl→del health route under `withObservability` | `apps/web/src/app/api/health/proxy-cache/route.ts` | ✅ |
| 7 | Manual smoke against real Upstash via `pnpm dev` + curl | n/a (operational) | ✅ |

## Validation Results

| Check | Result |
|-------|--------|
| `pnpm typecheck` | ✅ All 4 workspace projects pass |
| `pnpm lint` | ✅ All 4 workspace projects pass |
| `pnpm build` | ✅ `/api/health/proxy-cache` route compiled into production bundle |
| Unit tests | ⚠️ Not run — no test framework configured for `apps/web` yet (per plan §Validation; deferred to a follow-up when `vitest` lands in `apps/web`) |
| E2E smoke (`GET /api/health/proxy-cache` against real Upstash) | ✅ `{"ok":true,"ttl":900}` HTTP 200 |
| E2E smoke (`GET /api/health/redis` baseline) | ✅ `{"ok":true}` HTTP 200 |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `apps/web/src/lib/proxy-cache/types.ts` | CREATE | +12 |
| `apps/web/src/lib/proxy-cache/keys.ts` | CREATE | +11 |
| `apps/web/src/lib/proxy-cache/cache.ts` | CREATE | +57 |
| `apps/web/src/lib/proxy-cache/index.ts` | CREATE | +4 |
| `apps/web/src/app/api/health/proxy-cache/route.ts` | CREATE | +88 |

5 files created, 0 updated, +172 lines total.

## Deviations from Plan

1. **Branch base.** Plan implicitly assumed `main` as the base, but the LEX-70 observability module (`@/lib/observability` / `withObservability`) and the LEX-71 URL validation work live on `features/LEX-71` and have not yet merged to `main`. Branching off `main` would have left `withObservability` unresolved. Branched off `features/LEX-71` instead so the cache module ships against a working build; the LEX-72 PR will need either (a) LEX-71 merged first, or (b) a rebase onto `main` once LEX-70 lands. The cache module itself depends on nothing from LEX-71 — only the health route uses `withObservability` from LEX-70.

2. **Unit tests deferred.** Plan §Validation explicitly notes "No test command is configured for `apps/web` yet" and that `keys.test.ts` / `cache.smoke.test.ts` are a follow-up. The E2E smoke through the health endpoint covers the equivalent ground (set → get → ttl-in-window → invalidate) against real Upstash.

3. **Production-token negative path not E2E-tested.** The 401-on-missing-token and 503-on-unconfigured-token paths are static and obvious from the handler source, but verifying them end-to-end would require restarting the dev server with `NODE_ENV=production` and `PROXY_CACHE_HEALTH_TOKEN` set — friction without value vs. reading the four-line gate. The dev-bypass path (the only one that runs locally) was verified end-to-end.

## Tests Written

None — no test framework configured in `apps/web` yet (per plan §Validation). The smoke endpoint serves as the deployment-time round-trip.

## E2E Evidence

```
$ curl -s http://localhost:3000/api/health/redis
{"ok":true}

$ curl -s http://localhost:3000/api/health/proxy-cache
{"ok":true,"ttl":900}
```

`ttl=900` confirms TTL was set to exactly `PROXY_CACHE_TTL_SECONDS` on insert; the assertion in the handler only requires `0 < ttl <= 900`, so any value in that window would have passed.

## Follow-ups (out of scope)

- Set `PROXY_CACHE_HEALTH_TOKEN` in Vercel preview + production env vars before deploy (and document it in `DEPLOYMENT.md`). The route fails closed with 503 `health_token_unconfigured` if missing in production.
- LEX-71 (VS-021) wires `getCached` / `setCached` / `invalidateCached` into the proxy fetch handler per the plan's §"Integration Contract for LEX-71" snippet, and emits `proxy_cache_hit` / `proxy_cache_miss` / `proxy_cache_skip_oversize` / `proxy_cache_unavailable` counters at the call site.
- When `vitest` is added to `apps/web`, file `keys.test.ts` and `cache.smoke.test.ts` per plan §Validation.
