# Code Review: LEX-70 observability baseline

**Scope**: Unstaged + untracked changes on `features/LEX-70` — `@sentry/nextjs` integration, structured-log + `withObservability` wrapper, middleware `x-request-id` propagation, ADR 0004, DEPLOYMENT runbook section.
**Recommendation**: **APPROVE with minor follow-ups** — implementation cleanly matches the plan (and incorporated the high-priority middleware fix from `lex-70-plan-review.md`). All validation passes. A handful of medium/low items are worth tightening before this becomes the template the rest of the codebase copies.

## Summary

This change wires a v1 observability baseline into `apps/web` only: `@sentry/nextjs` v10 initialised via `instrumentation.ts` (server + edge + client), a small `lib/observability/` module exposing `logger` and `withObservability()`, an `x-request-id` minted in middleware and forwarded via `NextResponse.next({ request: { headers } })`, and four route handlers wrapped (`/api/me`, `/api/health/{db,redis,storage}`). It also adds `app/global-error.tsx`, ADR 0004, a Sentry section in `DEPLOYMENT.md`, and `.env.example` documentation.

The plan-review's H1 (middleware header propagation gotcha) was correctly applied in `apps/web/src/middleware.ts:6-12`. M1 (`tracesSampler` for `/api/health/*`) is present in both server and edge configs. M2 (drop the `name` parameter) was followed — `withObservability(handler)` derives the label from `req.method` + `req.nextUrl.pathname` inside the wrapper. Module layout mirrors `packages/storage/src/` as planned. Build, lint, typecheck all pass.

## Issues Found

### Critical

None.

### High Priority

None. The implementation matches the corrected plan, validation is green, and there are no functional regressions in existing routes (try/catch contracts preserved at `apps/web/src/app/api/health/{db,redis,storage}/route.ts`).

### Medium Priority

**M1. `Sentry.captureException` inside the wrapper double-captures with Next.js 15's `onRequestError` hook.**

`apps/web/instrumentation.ts:10` re-exports `captureRequestError as onRequestError`, which Next.js 15 invokes automatically for any uncaught error thrown from a route handler, middleware, or server action. The wrapper at `apps/web/src/lib/observability/withObservability.ts:41-43` *also* calls `Sentry.captureException(err, { tags: { route, request_id } })` and re-throws.

ADR 0004 line 31 labels this "defence-in-depth", and Sentry's built-in dedupe integration usually collapses two events for the same error reference. But the contract isn't airtight: a handler that wraps or re-throws (`throw new Error('wrap', { cause: err })`) will produce two distinct events, and the dedupe integration can be disabled in custom configs. Net effect on quota is small at v1; the bigger concern is that the wrapper's `tags` (`route`, `request_id`) are added by the wrapper path but **lost** when `onRequestError` fires first — leaving you with one tagged and one untagged event for the same incident, which is harder to triage than either path alone.

**Recommendation**: Pick one capture path. The simpler option is to drop `Sentry.captureException` from the wrapper and instead enrich the event in `onRequestError` via a wrapper around `captureRequestError`, or add a `beforeSend` hook in `sentry.server.config.ts` that pulls `route` / `request_id` from the active scope. Alternatively, set the tags on the active scope inside `withObservability` (`Sentry.getCurrentScope().setTags({ route, request_id })`) *before* `await handler()` so both capture paths produce equally-tagged events, and remove the explicit `captureException` call. Either way, document the chosen contract in ADR 0004 § Decision.

**M2. The `withObservability` wrapper measures TTFB on streaming responses; the ADR notes this but the wrapper itself has no guardrail.**

`apps/web/src/lib/observability/withObservability.ts:20` awaits `handler(...)` and records `duration_ms` at that point — for a `Response` carrying a `ReadableStream` body, that's well before the body finishes. ADR 0004 § Consequences line 55 calls this out and defers to the Phase 1 proxy work (VS-021), which is correct.

**Recommendation**: add a short comment at the `performance.now()` line pointing at ADR 0004's consequences entry, so the next reader doesn't have to spelunk to learn this is intentional. One line, e.g.:

```ts
// duration_ms = response-object-creation time; for streamed bodies this is TTFB,
// not stream completion. See docs/adr/0004-observability-baseline.md § Consequences.
```

**M3. `optionalEnv` is re-implemented and re-exported despite an identical helper already living at `packages/storage/src/env.ts:7-10`.**

`apps/web/src/lib/observability/env.ts:1-4` is a verbatim copy of `packages/storage/src/env.ts:7-10`, and `apps/web/src/lib/observability/index.ts:3` re-exports it. Two issues:

1. The duplicate violates DRY; if the helper's behaviour changes (e.g., trimming whitespace, treating `"undefined"` literally) the two will drift.
2. The barrel exports `optionalEnv` as a public API of the observability module, but nothing outside the module imports it (verified via `grep -rn "optionalEnv" apps/web/`). It's dead surface area.

**Recommendation**: either (a) lift the helper into a `@veritasee/env` package or into `apps/web/src/lib/env.ts` once a second consumer appears, or (b) drop `optionalEnv` from the observability barrel (it's only used internally by `getSentryEnvironment`) and add a one-liner comment in `env.ts` noting the deliberate duplication for now. (b) is the smaller change and matches the project's "extract a workspace package only when genuinely shared" stance in ADR 0004 line 66.

**M4. Health-route Sentry traces are dropped, but every health probe still mints a `crypto.randomUUID()` and emits a structured log line.**

The plan-review M1 flagged the trace-quota concern; the implementation correctly addresses it with a `tracesSampler` returning `0` for `/api/health/*`. Good.

However, health endpoints are typically polled at high frequency (Vercel/uptime monitor → 30s or 60s interval). Wrapping all three with `withObservability` means every probe produces:

- one `crypto.randomUUID()` in middleware,
- one cloned `Headers` object in middleware,
- one JSON log line through `console.log`.

At v1 traffic this is negligible. It's worth flagging because the same `withObservability` pattern is the template the rest of the codebase will copy from, and the health-route exclusion approach should be a documented option. The plan-review M1's alternative — "don't wrap health routes at all" — remains defensible.

**Recommendation**: leave the current wiring (the structured log is the most useful artefact for up/down visibility), but add a short note in ADR 0004 § Consequences or in `withObservability.ts` describing the cost model so future readers can decide. Optional; the wrapping is justifiable as-is.

### Suggestions (Low Priority)

**L1. ESLint `no-unused-vars` was downgraded to `warn` (`apps/web/eslint.config.mjs:14-19`).**

The added rule sets severity to `warn`. The previous configuration relied on `next/typescript`'s default, which (in eslint-config-next ≥15.x) also emits `warn`, so this is not a regression in practice. But the implementation report (§ Deviations from Plan, item 4) frames this as adding `argsIgnorePattern`; the severity change is implicit. Worth confirming in a one-liner comment that `warn` is intentional and matches the upstream default, so a future reader doesn't bump it to `error` thinking they're "tightening". Pure documentation hygiene.

**L2. `instrumentation-client.ts:18` registers `Sentry.replayIntegration()` unconditionally.**

The integration is registered even when `NEXT_PUBLIC_SENTRY_DSN` is set but `SENTRY_DSN` is unset (or vice versa). The `if (process.env.NEXT_PUBLIC_SENTRY_DSN)` guard on line 4 covers the case where neither DSN is set, so this is fine functionally. The cost is a +47 kB First Load JS bundle bump (224 kB → 225 kB shared, per `pnpm build` output and the report § Post-Implementation) that ships on every page regardless of whether replays are configured server-side. That bundle weight applies to all production users.

**Recommendation**: leave as-is for v1 (replays are explicitly opted-in via the skill and the cost is acknowledged), but the trade-off is worth a one-line note in ADR 0004 § Consequences: "Session Replay adds ~47 kB to the client bundle even when disabled at the project level." Already partially documented in the report; should make it to the ADR for permanence.

**L3. `sentry.server.config.ts:14` and `sentry.edge.config.ts:13` use `ctx.normalizedRequest?.url ?? ''`.**

`normalizedRequest` is Sentry 8+ context — works on v10. Worth a one-line code comment that the empty-string fallback is the "no URL → don't drop" default (which is the conservative choice for traces of background tasks / non-request transactions). Not a bug; small clarity win.

**L4. `withObservability.ts` accepts `RouteHandler<TArgs extends unknown[]>` but only the `NextRequest` signature is documented.**

The generic `...args: TArgs` lets it work for dynamic-segment route handlers receiving `{ params }` as the second arg. None of today's routes use dynamic segments, so the generic is purely future-proofing. Worth one comment line at the type definition (`apps/web/src/lib/observability/withObservability.ts:5-8`) noting "TArgs accommodates the `{ params }` context arg for dynamic-segment routes (App Router)". The codebase otherwise follows the "no comments unless WHY is non-obvious" rule from CLAUDE-style guidance — this one qualifies.

**L5. `app/global-error.tsx` imports `NextError` from `next/error` — a deprecated module in Next.js 15.**

`next/error` still works in Next.js 15.5 but is on the deprecation track in favour of the App Router's `error.tsx` / `not-found.tsx`. The Sentry skill recommends `next/error` for backward compatibility, so the choice is justifiable. Not a bug; flagging for future cleanup when the skill catches up.

**L6. ADR 0004 line 27 names "Session Replay enabled (10% sessions, 100% error sessions)" — verify against `instrumentation-client.ts:13-14`.**

The ADR text matches the config exactly. No issue; verified.

**L7. `apps/web/.env.example` Sentry block places `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` without per-line guidance.**

`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT` each get an inline comment explaining purpose; the last three are grouped without comments. The DEPLOYMENT.md table covers them, but readers who look at `.env.example` alone won't know `SENTRY_AUTH_TOKEN` is build-scope only. One extra line per var (or a single trailing comment "the three below are required only when you want source-map upload at build time") would close the gap.

## Validation Results

| Check       | Status | Notes                                                                              |
| ----------- | ------ | ---------------------------------------------------------------------------------- |
| Type Check  | PASS   | `pnpm typecheck` — all 4 workspace projects pass.                                  |
| Lint        | PASS   | `pnpm lint` — 0 errors, 0 warnings across the monorepo.                            |
| Build       | PASS   | `pnpm build` — Next.js 15.5.15 production build succeeds; 9 routes generated; First Load JS 225 kB shared (Sentry Replay accounts for the bump from 178 kB → 225 kB, documented). |
| Tests       | N/A    | `apps/web` has no test runner — `AGENTS.md:36` confirms the verification triple is the contract. |
| Spot-checks | PASS   | Re-verified file:line refs in the plan and plan-review (e.g. `packages/storage/src/env.ts:7-10`, `apps/web/src/middleware.ts:14-15`, `apps/web/src/app/api/health/storage/route.ts:8-11`). All match the working tree. |

## What's Good

- **Plan-review's H1 fix landed cleanly.** `apps/web/src/middleware.ts:9-11` uses the canonical `NextResponse.next({ request: { headers } })` propagation pattern. The middleware matcher (`apps/web/src/middleware.ts:15`) was correctly extended to exclude `/monitoring` for the Sentry tunnel route.
- **Module layout mirrors `packages/storage/src/`** — small files, named exports, no defaults. `apps/web/src/lib/observability/` contains four files totalling ~95 lines.
- **No new workspace package**, matching ADR 0004 § Alternatives line 66 ("extract only when genuinely shared").
- **Try/catch contracts in existing routes are preserved.** `apps/web/src/app/api/health/{db,redis,storage}/route.ts` still return `{ ok: false, error }` with status `503` from inner catches; the wrapper only logs on caught errors and adds a separate error path for uncaught ones.
- **`performance.now()` is used for latency** — works on both `nodejs` and `edge` runtimes, per the plan's Risks table.
- **Health routes excluded from Sentry traces** via `tracesSampler` (plan-review M1 resolution); their structured log line still fires, preserving up/down visibility.
- **Lazy SDK init.** Both server and edge configs guard on `process.env.SENTRY_DSN` so local dev with no DSN is silent — matches the `packages/storage/src/client.ts:17-20` lazy-env pattern cited in the plan.
- **`app/global-error.tsx` captures React render errors** outside the API boundary, picked up from the Sentry skill's "Phase 3 App Router" recommendation.
- **`.env.sentry-build-plugin` added to `.gitignore`** — prevents the Sentry build-plugin's local cache file from being committed.
- **ADR 0004 documents the call**, including the AC #3 interpretation ("P95 is *computable* from emitted data, not exported as an OTel metric"), which is exactly the disambiguation the plan-review M3 asked for.
- **DEPLOYMENT.md § Sentry** clearly explains the build-only scope for `SENTRY_AUTH_TOKEN` and the recommended one-project-with-environment-tags v1 stance.

## Recommendation

**Merge after addressing M1 (capture-path dedup) and the M2/M3/M4 follow-ups.** M1 is the only one that has any operational impact (potential double events, mismatched tagging across capture paths); the rest are documentation/clarity tightenings that compound as this observability module becomes the template for future routes.

None of the issues block merge if you want to land the baseline now and follow up. Recommended order of operations:

1. (Required) Pick a capture-path contract for M1 and document it in ADR 0004. Two-line code change + two-line ADR delta.
2. (Nice) Add the comments called for in M2, L3, L4 — < 10 lines total.
3. (Nice) Drop `optionalEnv` from the observability barrel re-export (M3.b) or leave a deliberate-duplication comment.
4. (Nice) Mention the +47 kB Replay bundle cost in ADR 0004 (L2).

Everything else can roll into the next observability touch (likely the streaming-aware variant for VS-021 proxy work, already flagged in ADR 0004 § Consequences).
