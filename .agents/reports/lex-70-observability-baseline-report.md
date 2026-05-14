# Implementation Report — LEX-70 observability baseline

**Plan**: `.agents/plans/lex-70-observability-baseline.plan.md`
**Branch**: `features/LEX-70`
**Status**: ✅ COMPLETE

## Summary

Wired `@sentry/nextjs` for error reporting + tracing, added a structured JSON request logger and a `withObservability` route-handler wrapper, and propagated `x-request-id` through Clerk middleware. Every wrapped API route now emits a single JSON line per request containing `route`, `method`, `status`, `duration_ms`, and `request_id`; uncaught handler errors are sent to Sentry tagged with `route` + `request_id`. Health-route Sentry traces are dropped via `tracesSampler` to protect quota, while structured logs still fire for ops visibility.

End-to-end verified locally: all 4 wrapped routes produced the expected log line with a propagated `x-request-id` header, and an intentional throw triggered the `request_error` log + Sentry capture path.

## Tasks Completed

| #  | Task                                                  | File(s)                                              | Status |
| -- | ----------------------------------------------------- | ---------------------------------------------------- | ------ |
| 1  | env helpers (`optionalEnv`, `getSentryEnvironment`)   | `apps/web/src/lib/observability/env.ts`              | ✅     |
| 2  | structured JSON logger                                | `apps/web/src/lib/observability/logger.ts`           | ✅     |
| 3  | `withObservability` route-handler wrapper             | `apps/web/src/lib/observability/withObservability.ts`| ✅     |
| 4  | barrel export                                         | `apps/web/src/lib/observability/index.ts`            | ✅     |
| 5  | add `@sentry/nextjs` dep                              | `apps/web/package.json` + `pnpm-lock.yaml`           | ✅     |
| 6  | Sentry server config (incl. health-route `tracesSampler`) | `apps/web/sentry.server.config.ts`               | ✅     |
| 7  | Sentry edge config                                    | `apps/web/sentry.edge.config.ts`                     | ✅     |
| 8  | Sentry client config (as `instrumentation-client.ts`) | `apps/web/instrumentation-client.ts`                 | ✅     |
| 9  | Next.js `instrumentation.ts` + `onRequestError`       | `apps/web/instrumentation.ts`                        | ✅     |
| 10 | wrap `next.config.ts` with `withSentryConfig`         | `apps/web/next.config.ts`                            | ✅     |
| 11 | mint + propagate `x-request-id` in middleware         | `apps/web/src/middleware.ts`                         | ✅     |
| 12 | wrap `/api/me`                                        | `apps/web/src/app/api/me/route.ts`                   | ✅     |
| 13 | wrap `/api/health/db`                                 | `apps/web/src/app/api/health/db/route.ts`            | ✅     |
| 14 | wrap `/api/health/redis`                              | `apps/web/src/app/api/health/redis/route.ts`         | ✅     |
| 15 | wrap `/api/health/storage`                            | `apps/web/src/app/api/health/storage/route.ts`       | ✅     |
| 16 | Sentry env vars in `.env.example`                     | `apps/web/.env.example`                              | ✅     |
| 17 | `## Sentry` section in DEPLOYMENT.md                  | `docs/general/DEPLOYMENT.md`                         | ✅     |
| 18 | ADR 0004 — observability baseline                     | `docs/adr/0004-observability-baseline.md`            | ✅     |
| 19 | full verification (`lint` / `typecheck` / `build`)    | n/a                                                  | ✅     |

## Validation Results

| Check      | Result | Notes                                                                                                  |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Typecheck  | ✅     | `pnpm typecheck` — all 4 workspace projects pass.                                                       |
| Lint       | ✅     | `pnpm lint` — 0 errors, 0 warnings. (Added `argsIgnorePattern: '^_'` to apps/web ESLint config.)        |
| Build      | ✅     | `pnpm build` — Next.js production build succeeds. 9 routes generated.                                   |
| Tests      | N/A    | `apps/web` still has no test runner configured (`AGENTS.md:36`); per project policy, the verification triple is the contract. |
| E2E manual | ✅     | Dev server + curl against all 4 wrapped routes — structured log line emitted with propagated `request_id`. Intentional throw produced `request_error` log + `Sentry.captureException` call path. |

### E2E evidence (captured from dev-server stdout)

```
{"ts":"2026-05-14T06:01:16.836Z","level":"info","msg":"request","event":"request","method":"GET","route":"/api/health/redis","status":200,"duration_ms":489.7,"request_id":"test-redis-001"}
{"ts":"2026-05-14T06:01:19.791Z","level":"info","msg":"request","event":"request","method":"GET","route":"/api/health/storage","status":200,"duration_ms":168.5,"request_id":"test-storage-001"}
{"ts":"2026-05-14T06:01:20.833Z","level":"info","msg":"request","event":"request","method":"GET","route":"/api/health/db","status":200,"duration_ms":623.6,"request_id":"test-db-001"}
{"ts":"2026-05-14T06:01:21.300Z","level":"info","msg":"request","event":"request","method":"GET","route":"/api/me","status":401,"duration_ms":3.9,"request_id":"test-me-001"}
{"ts":"2026-05-14T06:02:00.923Z","level":"error","msg":"request_error","event":"request","method":"GET","route":"/api/smoke-error","status":500,"duration_ms":0.06,"request_id":"smoke-err-002","err":"smoke-error-for-observability-verification"}
```

Each line confirms a separate AC:
- **AC #2** (structured log per request) — every line has `event`, `route`, `method`, `status`, `duration_ms`.
- **Middleware header propagation** — `request_id` matches the `x-request-id` header sent by `curl` for each call.
- **AC #3** (P95 computable) — `duration_ms` is the queryable field; Sentry Performance also surfaces P95 per route once a DSN is configured.
- **AC #1** (errors reported) — the smoke route emitted `level: error`, `msg: "request_error"`, and the wrapper invoked `Sentry.captureException`. Local dev had no `SENTRY_DSN` so the SDK init was skipped (by design — guard at `sentry.server.config.ts:4`) and `captureException` was a no-op; production verification requires a DSN.

## Files Changed

| File                                                        | Action | Lines (approx) |
| ----------------------------------------------------------- | ------ | -------------- |
| `apps/web/src/lib/observability/env.ts`                     | CREATE | +9             |
| `apps/web/src/lib/observability/logger.ts`                  | CREATE | +35            |
| `apps/web/src/lib/observability/withObservability.ts`       | CREATE | +47            |
| `apps/web/src/lib/observability/index.ts`                   | CREATE | +3             |
| `apps/web/sentry.server.config.ts`                          | CREATE | +14            |
| `apps/web/sentry.edge.config.ts`                            | CREATE | +14            |
| `apps/web/instrumentation-client.ts`                        | CREATE | +10            |
| `apps/web/instrumentation.ts`                               | CREATE | +10            |
| `docs/adr/0004-observability-baseline.md`                   | CREATE | +60            |
| `apps/web/package.json`                                     | UPDATE | +1             |
| `apps/web/eslint.config.mjs`                                | UPDATE | +8             |
| `apps/web/next.config.ts`                                   | UPDATE | +8/-1          |
| `apps/web/src/middleware.ts`                                | UPDATE | +5/-1          |
| `apps/web/src/app/api/me/route.ts`                          | UPDATE | +6/-1          |
| `apps/web/src/app/api/health/db/route.ts`                   | UPDATE | +10/-7         |
| `apps/web/src/app/api/health/redis/route.ts`                | UPDATE | +6/-3          |
| `apps/web/src/app/api/health/storage/route.ts`              | UPDATE | +6/-3          |
| `apps/web/.env.example`                                     | UPDATE | +21            |
| `docs/general/DEPLOYMENT.md`                                | UPDATE | +28            |
| `pnpm-lock.yaml`                                            | UPDATE | (regenerated)  |

**Net code**: 11 files created, 9 files updated (excluding lockfile).

## Post-Implementation: Sentry SDK Skill Alignment

After the initial implementation, the user requested we follow [Sentry's official Next.js SDK skill](https://github.com/getsentry/sentry-for-ai/blob/main/skills/sentry-nextjs-sdk/SKILL.md) for completeness. Applied deltas:

| Change                                                                          | Skill section            | File(s)                                                            |
| ------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `sendDefaultPii: true` on all three runtimes                                    | "Sentry.init() Options"  | server/edge/client configs                                         |
| `enableLogs: true` (Sentry Logs product) on all three runtimes                  | Phase 2 recommendations  | server/edge/client configs                                         |
| `includeLocalVariables: true` on the Node runtime                               | Phase 3 server config    | `sentry.server.config.ts`                                          |
| Session Replay enabled (10% sessions, 100% error sessions)                      | Phase 2 user-facing app  | `instrumentation-client.ts`                                        |
| `Sentry.replayIntegration()` registered                                          | Troubleshooting          | `instrumentation-client.ts`                                        |
| `onRouterTransitionStart = Sentry.captureRouterTransitionStart` exported         | Phase 3 client config    | `instrumentation-client.ts`                                        |
| Explicit `authToken: process.env.SENTRY_AUTH_TOKEN` in `withSentryConfig`        | Source Maps Setup        | `next.config.ts`                                                   |
| `app/global-error.tsx` created (App-Router React render error capture)          | Phase 3 App Router       | `apps/web/src/app/global-error.tsx`                                |
| Middleware matcher excludes `/monitoring` (Sentry tunnel route)                  | "Exclude Tunnel Route"   | `apps/web/src/middleware.ts`                                       |
| `.gitignore` includes `.env.sentry-build-plugin`                                 | Source Maps Setup        | `.gitignore`                                                       |
| Trace sample rates aligned with skill (1.0 dev / 0.1 prod) — health-route exclusion preserved via `tracesSampler` | Phase 3 server config | server/edge configs                                                |

Bundle First Load JS grew 178 kB → 225 kB (+47 kB) from the Replay integration — expected per skill.

Build is now warning-free: the prior `disableLogger` deprecation, `sentry.client.config.ts` deprecation, and `global-error.tsx` recommendation warnings are all resolved.

## Deviations from Plan

1. **`@sentry/nextjs` resolved to `^10.53.1` instead of `^8.40.0`.** `pnpm add` picked up the latest. The Sentry 8 → 10 API for `instrumentation.ts`, `withSentryConfig`, `Sentry.captureRequestError`, and `tracesSampler` is unchanged in the ways we use it. Build and typecheck pass. No risk-table item triggered.

2. **`sentry.client.config.ts` migrated to `instrumentation-client.ts`** to match the Next.js 15.5+ convention (Sentry SDK emitted a deprecation warning otherwise). Both file names are still accepted by Sentry; the new name is the forward-compatible one. ADR 0004 references "client config" generically so the rename does not invalidate the doc.

3. **Removed `disableLogger: true` from `withSentryConfig` options** — Sentry deprecated the flag in v10 in favour of webpack's `treeshake.removeDebugLogging`. Default behaviour is acceptable for v1; revisit if Sentry's runtime logger becomes noisy.

4. **Added `argsIgnorePattern: '^_'` to `apps/web/eslint.config.mjs`.** Wrapping handlers introduces a `_req` parameter in handlers that don't use it (e.g., `/api/health/redis`). The `_`-prefix is the documented convention for "intentionally unused", and the project's previous ESLint config did not configure it. Single-rule addition, applied consistently going forward.

5. **`global-error.tsx` added in the post-implementation Sentry-skill pass.** Originally deferred (AC #1 specifies API boundary), but the Sentry skill includes it as part of standard App-Router setup. Added in `apps/web/src/app/global-error.tsx`. Captures React render errors in the root layout that would otherwise crash the page without reaching Sentry.

6. **Linear MCP not available in this environment.** Plan metadata names `LEX-70`. Without `mcp__linear__*` tools I could not move the issue or post the implementation comment automatically. Manual steps for the operator after PR is up:
   - Linear → LEX-70 → move to `In Review`.
   - Post comment summarising files changed and validation results (this report's URL once the branch is pushed).

## Tests Written

No new unit tests. Consistent with the plan and `AGENTS.md:36`: `apps/web` has no test runner configured yet. The verification contract is `pnpm lint && pnpm typecheck && pnpm build`, all of which pass. E2E was validated manually against a live dev server with curl (evidence above).

When a Vitest harness is added to `apps/web` (a future foundation issue, not LEX-70), the natural first tests are:
- `withObservability` — happy path emits `info`, thrown error emits `error` + invokes `Sentry.captureException`.
- `logger` — JSON structure and stream selection (`console.log` vs `console.error`).
- middleware — header propagation via `NextResponse.next({ request: { headers } })`.

## Follow-ups (not part of this issue)

- Provision a Sentry project and populate Vercel env vars (operational task; runbook is in `docs/general/DEPLOYMENT.md` § Sentry).
- Streaming-aware variant of `withObservability` when the proxy-viewer work (VS-021) lands — current wrapper measures TTFB for streaming responses, not stream-completion time. Documented in ADR 0004 § Consequences.
- Sentry's `disableLogger` replacement (`webpack.treeshake.removeDebugLogging`) if the SDK runtime logger becomes noisy in production.
- Revisit `sendDefaultPii: true` and consider redaction hooks once BYO-AI-key tenant isolation (PRD §6 line 166) lands. Documented in ADR 0004 § Consequences.
- Consider whether to wire `Sentry.logger.*` calls into the existing `lib/observability/logger.ts` so structured stdout logs also land in Sentry Logs (currently only Sentry SDK's own runtime logs flow via `enableLogs`).
