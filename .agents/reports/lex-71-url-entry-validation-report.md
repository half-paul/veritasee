# Implementation Report — LEX-71: URL Entry + Scheme/Length/Denylist/SSRF Validation

**Plan**: `.agents/plans/lex-71-url-entry-validation.plan.md` (archived to `.agents/plans/completed/`)
**Branch**: `features/LEX-71` (branched from `features/LEX-70` because LEX-70 ships the `withObservability` HOF and logger this work depends on; LEX-70 is not yet merged to `main`)
**Status**: COMPLETE

## Summary

Adds `POST /api/proxy/validate` and a `<UrlEntryForm />` on `/dashboard`. The endpoint
enforces FR-VW-1's four guards — HTTPS-only scheme, ≤2048-char length, configurable
hostname denylist, and an SSRF guard that DNS-resolves the host and rejects any IPv4/IPv6
address not classified as `unicast` by `ipaddr.js`. Auth-gated with Clerk (mirrors
`/api/me`), instrumented with `withObservability`, and rejects emit a single
`url_validation_reject` warn log line with `code`, `hostname`, `url_length`, `user_id`,
and `request_id` — never the raw URL or query string.

## Tasks Completed

| #  | Task                                            | File                                                      | Status |
| -- | ----------------------------------------------- | --------------------------------------------------------- | ------ |
| 1  | Add `ipaddr.js` dependency                      | `apps/web/package.json`, `pnpm-lock.yaml`                 | ✅     |
| 2  | Discriminated-union types + `MAX_URL_LENGTH`    | `apps/web/src/lib/url-validation/types.ts`                | ✅     |
| 3  | Denylist (seed + env extras, memo, suffix match)| `apps/web/src/lib/url-validation/denylist.ts`             | ✅     |
| 4  | `isPrivateAddress` (ipaddr.js range + v4-mapped)| `apps/web/src/lib/url-validation/privateIp.ts`            | ✅     |
| 5  | `resolveHost` (dns.lookup all, IP literal skip) | `apps/web/src/lib/url-validation/resolveHost.ts`          | ✅     |
| 6  | `validateUrl` orchestrator                      | `apps/web/src/lib/url-validation/validateUrl.ts`          | ✅     |
| 7  | Barrel export                                   | `apps/web/src/lib/url-validation/index.ts`                | ✅     |
| 8  | API route (auth gate, body parse, log, map)     | `apps/web/src/app/api/proxy/validate/route.ts`            | ✅     |
| 9  | `<UrlEntryForm />` client component             | `apps/web/src/app/dashboard/components/UrlEntryForm.tsx`  | ✅     |
| 10 | Render form on `/dashboard`                     | `apps/web/src/app/dashboard/page.tsx`                     | ✅     |
| 11 | Document `URL_DENYLIST_EXTRA` in env example    | `apps/web/.env.example`                                   | ✅     |
| 12 | Full validation                                 | n/a                                                       | ✅     |

## Validation Results

| Check                       | Command                                            | Result                                    |
| --------------------------- | -------------------------------------------------- | ----------------------------------------- |
| Type check                  | `pnpm typecheck`                                   | ✅ all packages clean                     |
| Lint                        | `pnpm lint`                                        | ✅ no warnings                            |
| Production build            | `pnpm build`                                       | ✅ `/api/proxy/validate` + `/dashboard` compile |
| Workspace tests             | `pnpm -r test`                                     | ✅ 5 passed (db: 1, redis: 2, storage: 2) |
| E2E — `validateUrl` matrix  | `tsx /tmp/lex71-smoke.ts` (11 cases)               | ✅ 11/11 (after IPv6-bracket fix)         |
| E2E — HTTP 401 no-auth path | `curl POST /api/proxy/validate`                    | ✅ 401 + `{"code":"unauthenticated"}`     |

### E2E matrix

```
PASS | valid https                  | exp: ok              | got: ok
PASS | AC1 non-https                | exp: invalid_scheme  | got: invalid_scheme
PASS | AC3 > 2048                   | exp: too_long        | got: too_long
PASS | AC2 denylisted (host)        | exp: denylisted      | got: denylisted
PASS | AC2 denylisted (subdomain)   | exp: denylisted      | got: denylisted
PASS | AC4 literal IPv4 priv        | exp: private_ip      | got: private_ip
PASS | AC4 IPv6 loopback            | exp: private_ip      | got: private_ip
PASS | AC4 IPv4-mapped IPv6         | exp: private_ip      | got: private_ip
PASS | AC4 link-local AWS meta      | exp: denylisted      | got: denylisted
PASS | invalid URL                  | exp: invalid_url     | got: invalid_url
PASS | empty input                  | exp: invalid_url     | got: invalid_url
```

### Live request log sample

`POST /api/proxy/validate` without a Clerk session produced the expected
`withObservability` request log line:

```json
{"ts":"2026-05-14T22:51:19.024Z","level":"info","msg":"request","event":"request","method":"POST","route":"/api/proxy/validate","status":401,"duration_ms":6.7,"request_id":"b3bc7bb7-…"}
```

(The `url_validation_reject` warn line cannot be triggered without an authenticated
session; covered indirectly by the `validateUrl` unit matrix above, which exercises
every `code` value the route would log.)

## Files Changed

| File                                                                  | Action | Notes                                                    |
| --------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `apps/web/package.json`                                               | UPDATE | `+ipaddr.js@^2.4.0`                                      |
| `pnpm-lock.yaml`                                                      | UPDATE | regenerated                                              |
| `apps/web/src/lib/url-validation/types.ts`                            | CREATE | 18 lines                                                 |
| `apps/web/src/lib/url-validation/denylist.ts`                         | CREATE | 42 lines                                                 |
| `apps/web/src/lib/url-validation/privateIp.ts`                        | CREATE | 21 lines                                                 |
| `apps/web/src/lib/url-validation/resolveHost.ts`                      | CREATE | 22 lines                                                 |
| `apps/web/src/lib/url-validation/validateUrl.ts`                      | CREATE | 84 lines                                                 |
| `apps/web/src/lib/url-validation/index.ts`                            | CREATE | 10 lines                                                 |
| `apps/web/src/app/api/proxy/validate/route.ts`                        | CREATE | 73 lines                                                 |
| `apps/web/src/app/dashboard/components/UrlEntryForm.tsx`              | CREATE | 99 lines                                                 |
| `apps/web/src/app/dashboard/page.tsx`                                 | UPDATE | renders `<UrlEntryForm />` in a new `<section>`          |
| `apps/web/.env.example`                                               | UPDATE | adds `URL_DENYLIST_EXTRA` block                          |

## Deviations from Plan

1. **IPv6 hostname brackets.** During the smoke run, `https://[::1]/` and
   `https://[::ffff:10.0.0.1]/` initially returned `dns_failure`, not `private_ip`. Root
   cause: WHATWG `URL.hostname` preserves the surrounding `[...]` on IPv6 literals, so
   `ipaddr.isValid('[::1]')` is `false` and the path falls through to a DNS lookup that
   then fails. Fixed in `validateUrl.ts` by stripping the brackets before the
   denylist/resolve/private-IP checks. The result `hostname` is the bare form
   (`::1`), which is what the SSRF guard actually evaluated and what we want to surface
   in logs. Comment in the source explains the WHATWG-spec rationale.
2. **`privateIp.ts` shape.** Dropped the empty placeholder
   `PRIVATE_IPV4_RANGES: ReadonlyArray<...>` from the plan's sketch — it was unused and
   would have been an ESLint `no-unused-vars` failure. The check reduces to
   `addr.range() !== 'unicast'` (with v4-mapped-v6 unwrap and fail-closed on parse
   error), which is what the plan describes in prose.
3. **No `app/web` Vitest** — plan acknowledged this; relied on the manual `tsx`-driven
   matrix at `/tmp/lex71-smoke.ts` (deleted after the run) for the validation gate.
   Adding a Vitest setup for `apps/web` remains a follow-up issue.
4. **Branch base.** Plan said "On main, clean: create branch." Current `main` does not
   include LEX-70 yet, and LEX-71 imports `withObservability` and the logger added in
   LEX-70. Branched `features/LEX-71` off `features/LEX-70` rather than `main`. PR for
   LEX-71 should be opened after LEX-70 is merged so the diff is minimal.

## Tests Written

None as automated unit tests — `apps/web` has no test framework configured (plan §10).
Behaviour was verified via an out-of-tree `tsx` matrix (11 cases, see E2E section). A
follow-up issue should introduce Vitest to `apps/web` and convert the matrix into
checked-in unit tests for `validateUrl`, `isPrivateAddress`, and `isDenylisted`.

## Acceptance Criteria

- [x] AC1 — non-HTTPS → 400 `invalid_scheme`
- [x] AC2 — denylisted host → 403 `denylisted` + `url_validation_reject` warn log
- [x] AC3 — URL > 2048 chars → 400 `too_long`
- [x] AC4 — internal-IP host (literal IPv4, IPv6 loopback, IPv4-mapped IPv6, RFC1918) → 403 `private_ip`
- [x] Unauth POST → 401 `unauthenticated`
- [x] `URL_DENYLIST_EXTRA` documented in `apps/web/.env.example`
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm build` green from repo root
- [x] No raw URLs or query strings in log output (only `hostname` + `url_length`)
