# Code Review: LEX-72 Proxy Response Cache Plan

**Scope**: `.agents/plans/lex-72-proxy-response-cache.plan.md`
**Recommendation**: **NEEDS WORK** — solid foundation with one HIGH issue and several internal contradictions to resolve before implementation.

## Summary

The plan proposes a Redis-backed `proxy:cache:v1:*` module under `apps/web/src/lib/proxy-cache/` plus a `/api/health/proxy-cache` round-trip endpoint, designed to feed the upcoming LEX-71 proxy fetcher. The design is well-grounded in real codebase patterns, cites accurate PRD requirements, and honestly scopes acceptance criteria that depend on LEX-71. The main issues are internal contradictions in the oversize-payload handling (logging vs. silent skip, void return vs. observable skip) and a few correctness concerns around byte vs. char measurement, race conditions, and the health endpoint's write surface.

All cited file paths and PRD sections were verified against the codebase. `pnpm typecheck` and `pnpm lint` both pass on the current branch (the plan introduces no code yet).

## Issues Found

### Critical
None.

### High Priority

**H1. Internal contradiction: `setCached` oversize skip is silent AND logged — pick one.**

Three sections of the plan say different things about what happens when `payload.length > 900_000`:

- §2 says: *"return null on `setCached`... Logged via `logger.warn('proxy_cache_skip_oversize', …)`."*
- §9 says: *"The cache module itself does **no** request-scoped logging — it's a pure utility. If LEX-71 wants hit/miss metrics, it emits them at the call site."*
- Task 3 says: *"if `entry.payload.length > 900_000` ... `return` without writing"* — no return value to signal the skip, no log.
- Risks table says: *"Logged at the call site by LEX-71."* — but Task 3 returns `Promise<void>`, so the call site has no way to know whether a write happened.

**Net effect:** as specified in Task 3, oversize payloads vanish silently. LEX-71 cannot emit the skip-oversize counter the Risks table promises because the function returns `void`.

**Recommendation:** Change `setCached` return type to `Promise<{ written: boolean }>` (or `Promise<boolean>`), and pick one log site — either inside `setCached` (simplest, accept the §9 exception for this one warn-level event) or strictly at the call site in LEX-71 (then Task 3 must return the boolean). Update §2, §9, Task 3, and the Risks table to agree.

### Medium Priority

**M1. Size guard uses `string.length` (UTF-16 code units) but the limit is in bytes.**

Task 3: `if (entry.payload.length > 900_000)`. JS string `length` counts UTF-16 code units, not UTF-8 bytes. ASCII content is ~1:1, but CJK encyclopedia articles are typically 1 char → 3 bytes UTF-8 → still 1 code unit. So a 900 KB-char Chinese Wikipedia article could be ~2.7 MB on the wire — well past Upstash's 1 MB REST limit.

**Recommendation:** Measure bytes: `Buffer.byteLength(entry.payload, 'utf8')` or `new TextEncoder().encode(entry.payload).length`. Account for JSON envelope overhead (~30–50 bytes for the wrapping `CachedProxyResponse` JSON; 950 KB body budget is a safer ceiling).

**M2. `getCached` "falsy" wording will lead to a bug.**

Task 3: *"returns the value or `null` if missing/falsy."* `@upstash/redis` returns `null` only when the key is absent. A `?` coalesce is correct; a `||` would also collapse legitimately empty values. Given the plan's wording, an implementer might write `return result || null` and inadvertently treat any falsy stored value as a miss. Sanitized HTML is unlikely to be `0` or `""`, but the principle of clarity matters.

**Recommendation:** Restate as *"returns the parsed entry, or `null` when the key is absent. Use `result ?? null`, not `||`."*

**M3. Health endpoint performs a Redis write on every unauthenticated GET.**

§8 / Task 6 places `/api/health/proxy-cache` alongside the other health routes, which AGENTS.md / prior PRs treat as open monitoring endpoints. But unlike `/api/health/redis` (a `ping()` — no write), this endpoint always does `SET` + `GET` + `TTL` + `DEL`. An attacker hitting this endpoint imposes Upstash write QPS cost (Upstash bills per request); a scraper hammering it could drive up the bill.

**Recommendation:** Either (a) gate the endpoint behind a header secret (`x-health-token` matching an env var), (b) document the per-call cost and add it to the deploy runbook, or (c) make the round-trip part opt-in via `?write=1` and default the public GET to a `ping`-only check.

**M4. `getCachedFresh` invalidation race not acknowledged.**

§3 / Task 4: when `expectedRevisionHash` mismatches, `await invalidateCached(...)` and return `null`. If a concurrent request has just `setCached` a fresh entry between the get and the del, the del wipes that fresh entry too. Worst case is one extra origin fetch, which is acceptable, but the plan claims `getCachedFresh` is a one-call convenience — the race makes it occasionally indistinguishable from the two-call form.

**Recommendation:** Add one sentence to §3 noting the race and that it's bounded to "at worst one extra origin re-fetch", so LEX-71 doesn't lean on `getCachedFresh` as if it were atomic.

**M5. Cache module's failure semantics for infrastructure errors are undocumented.**

Task 3's functions call `getRedis().get/set/del()` without try/catch. If Upstash is unreachable, the call throws and the error propagates to LEX-71. That's the right *behavior* (fail open: LEX-71 should fall back to origin on cache error), but the plan never says so. The "Integration Contract for LEX-71" snippet doesn't wrap `getCached` in a try/catch — copy-paste implementers will silently leak Redis errors as 500s on the proxy route.

**Recommendation:** Add a contract note: *"The cache module returns `null` on cache miss and **throws on infrastructure failure**. Callers in LEX-71 should `try/catch` and fall back to origin fetch on throw — a Redis outage must not take down the proxy route."* Reflect this in the §"Integration Contract for LEX-71" code sample.

### Suggestions

**S1. TTL assertion window is too tight for cold-start latency.**

§8 / Task 6: `ttl > PROXY_CACHE_TTL_SECONDS - 10 && ttl <= PROXY_CACHE_TTL_SECONDS`, i.e. `(890, 900]`. Vercel cold-start + Upstash REST round-trip can exceed 10s on a serverless cold path. A spurious 503 here would page on-call for no reason.

**Recommendation:** Widen to `ttl > 0 && ttl <= PROXY_CACHE_TTL_SECONDS` — the assertion's goal is "TTL was set, not unbounded", not "round-trip was fast".

**S2. Cite-accuracy nits.**

- §"Patterns to Follow" cites `apps/web/src/app/api/health/redis/route.ts:9` for the `getRedis()` pattern; the import is on line 2 and the call on line 10. Minor; not misleading.
- §2 cites `packages/redis/test/smoke.test.ts:22` for JSON-encoding behavior of `get<T>()`, but the smoke test only stores a plain string `'ok'` — it does not exercise JSON round-tripping. The Upstash REST client *does* JSON-encode/decode automatically, but the referenced line doesn't prove it. Either swap the citation to the `@upstash/redis` README/types, or note that the behavior was verified out-of-band.
- §1 cites `apps/web/src/lib/url-validation/types.ts:1` for `MAX_URL_LENGTH = 2048` — verified ✓.

**S3. URL normalization across cache keys.**

The cache key is `sha256(normalizedUrl)` where `normalizedUrl` comes from `validateUrl` (which uses WHATWG `URL.toString()`). That means `https://example.com/foo` and `https://example.com/foo/` produce different cache keys — same article, two cache entries, half the hit rate. The plan should explicitly note this is acceptable for v1 (mirrors browser identity, no canonicalization promised) so the hit-rate observation doesn't surprise LEX-71.

**S4. AC #1 wording vs. oversize skip.**

VS-022 AC #1 says *"the fetched, sanitized payload is stored with TTL=900s"* unconditionally. The plan's `setCached` skips for `> 900 KB`. Worth adding a one-line note to the AC checklist: *"AC #1 holds for payloads within the 900 KB byte budget; oversize payloads are skipped per §2."*

**S5. Schema version mid-deploy.**

§"Risks" notes that bumping `v1` → `v2` lets old keys age out in 15 min. During a rolling deploy, the new pods write `v2:*` while old pods still read `v1:*` (and vice versa). Worth one sentence acknowledging the transient inconsistency is bounded to one cache TTL and presents only as extra origin fetches.

**S6. Test follow-ups are correctly scoped as out-of-band.**

§"Validation" defers `keys.test.ts` and `cache.smoke.test.ts` until vitest lands in `apps/web`. Consistent with AGENTS.md ("No dedicated test framework is configured yet"). ✓

## Validation Results

| Check | Status | Notes |
|-------|--------|-------|
| Type Check (`pnpm typecheck`) | PASS | Baseline — plan introduces no code |
| Lint (`pnpm lint`) | PASS | Baseline |
| Tests | N/A | No framework in `apps/web` per AGENTS.md |
| Path/cite accuracy | PASS (with §S2 nits) | All cited files exist; line numbers approximate but not misleading |
| PRD references | PASS | §FR-VW-2, §FR-VW-5, §FR-VW-6, §14.1 all verified |

## What's Good

- **Honest AC scoping.** The plan explicitly states three of the four VS-022 ACs depend on LEX-71 and identifies the building-block AC (TTL=900s round-trip) it *can* close on its own. This is exactly the right framing for a dependency-blocked ticket.
- **Integration Contract section.** The §"Integration Contract for LEX-71" snippet is unusually clear — it pre-commits to a stable API surface and gives LEX-71 a copy-paste call site. Minor improvement: wrap it in try/catch (M5).
- **Key-vs-value schema versioning.** §1's separation of "URL-only key, revision in value" is well-reasoned and avoids the two-call lookup trap. The §"Risks" entry on `v1` → `v2` migration shows the consequences were thought through.
- **Module location decision.** §4's justification for `apps/web/src/lib/proxy-cache/` over `packages/proxy-cache` is grounded in AGENTS.md and the actual shape of v1 consumers (only Next.js app). Correct call.
- **Pattern mirroring.** Each new file maps to a verified existing exemplar (`url-validation/types.ts`, `url-validation/privateIp.ts`, `health/redis/route.ts`, `redis/test/smoke.test.ts`). Implementer has minimal degrees of freedom — good for consistency.
- **`.test` TLD for health-check sentinel.** `https://veritasee.test/__healthcheck__` uses an RFC 2606 reserved TLD, so it can never collide with a real fetched URL. Subtle but correct.
- **No new dependencies.** §10 confirms `node:crypto` + already-present `@upstash/redis`. ✓

## Recommendation

**Address before implementing:**

1. Resolve the H1 contradiction by deciding whether `setCached` logs the oversize skip itself or returns a status the caller logs. Update §2, §9, Task 3, and the Risks table together so they agree.
2. Switch the size guard to byte length (M1) and pick a budget that includes JSON envelope overhead.
3. Decide on the health endpoint's authentication posture (M3) — either gate it or document the per-call Upstash cost in the deploy notes.
4. Tighten the `getCached` "falsy → null" wording to "nullish only" (M2).
5. Add the infrastructure-failure semantics + try/catch to the Integration Contract (M5) and call out the `getCachedFresh` race (M4).

The Suggestions are polish — fine to address inline during implementation or in a follow-up.

Once the H1/M-tier items are reconciled, this plan is ready to execute. The design itself is sound and the scope is appropriately small.
