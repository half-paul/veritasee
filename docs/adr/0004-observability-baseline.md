# ADR 0004 — Observability baseline (Sentry + structured stdout logs)

- **Status:** Accepted
- **Date:** 2026-05-13
- **Linear:** LEX-70

## Context

PRD §6 sets concrete SLOs the v1 platform has to be able to measure:

- Read P95 latency ≤ 2.5s cached, ≤ 5s cold (proxy); ≤ 200ms for extension API lookup.
- AI call P95 ≤ 12s for Fast Check; ≤ 45s for Academic.
- Availability 99.5% monthly for the read path; 99.0% for AI verify.

Until this issue, `apps/web` had **no instrumentation**: zero `console.log`/`console.error` calls in route handlers, no Sentry, no OpenTelemetry, no `instrumentation.ts`. We needed three things in place before Phase 1 (proxy viewer) lands:

1. A single error-reporting queue so unhandled exceptions surface in one place.
2. A structured per-request log line containing route, status, and latency.
3. A way to compute P95 latency per route.

[ADR 0003](./0003-vercel-deployment.md) §Decision establishes a strong preference for managed services over self-hosted infrastructure to keep the v1 operational surface small. Any decision here should follow the same logic unless the cost is unambiguously worth it.

## Decision

We adopt a **three-piece observability baseline** in `apps/web` only — no new workspace package, no separate observability service. Implementation follows the official [Sentry Next.js SDK skill](https://github.com/getsentry/sentry-for-ai/blob/main/skills/sentry-nextjs-sdk/SKILL.md).

1. **Error reporting via `@sentry/nextjs`.** Initialised through Next.js 15's `instrumentation.ts` hook with per-runtime configs (`sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation-client.ts` — the Next.js 15.3+ replacement for `sentry.client.config.ts`). `Sentry.captureRequestError` is exported from `instrumentation.ts` so the Next.js 15 `onRequestError` hook captures handler errors automatically. `app/global-error.tsx` captures App-Router React render errors that escape route boundaries. Session Replay is enabled per the Sentry skill's user-facing-app recommendation (10% of all sessions, 100% of error sessions).

2. **Structured JSON logs to stdout.** A small `apps/web/src/lib/observability/logger.ts` emits one JSON line per call with fields `{ ts, level, msg, ...fields }`. Vercel captures stdout into its log drain, so every line is queryable in the Vercel dashboard and exportable to any log sink (Datadog, Axiom, BetterStack) via a drain.

3. **Per-request log + tracing via a route-handler wrapper.** `withObservability(handler)` records `performance.now()` at entry and at response, then logs `{ event: 'request', method, route, status, duration_ms, request_id }`. On uncaught error it also calls `Sentry.captureException` (defence-in-depth; `@sentry/nextjs`'s auto-capture would catch it anyway) and re-throws. Middleware mints `x-request-id` and forwards it via `NextResponse.next({ request: { headers } })` so logs and Sentry events share a correlation id.

**Interpretation of VS-007 AC #3.** The acceptance criterion reads "P95 latency is exported as a metric". We interpret this as: P95 is computable from data we emit. Two paths satisfy this without standing up extra infrastructure:

- Sentry Performance auto-instruments spans for every traced request (sampled per `tracesSampler`) and renders P95 per route in the Sentry Performance dashboard.
- The structured `duration_ms` field is queryable in Vercel logs via the log-drain UI or any downstream aggregator.

If a future requirement demands a true OpenTelemetry metrics endpoint (Prometheus scrape, OTLP push), this ADR is superseded.

## Consequences

**Easier**

- Unhandled errors land in one queue, tagged with `route`, `request_id`, and `environment`.
- Every API request emits a single structured line — no parsing free-form text.
- P95 latency is visible per route in Sentry Performance without standing up Prometheus or an OTel collector.
- `/api/health/*` probes are excluded from Sentry traces via `tracesSampler`, so uptime monitoring doesn't burn trace quota. Their structured log line still fires.
- Health-check and route-wrapping pattern composes naturally into the Phase 1 proxy work — `withObservability` is runtime-agnostic and works for both `nodejs` and `edge` route handlers.

**Harder / constrained**

- **PII flows to Sentry.** `sendDefaultPii: true` is set in all three runtime configs per the Sentry skill default. Sentry receives request IP, headers, and (where the SDK auto-attaches) request body and cookies. Acceptable for v1 — Veritasee does not yet store sensitive user data beyond Clerk identity — but revisit when BYO-AI-key tenant isolation (PRD §6 line 166) lands. If we need to redact, the path is `beforeSend` / `beforeBreadcrumb` hooks in the per-runtime configs, or `sendDefaultPii: false` with explicit `Sentry.setUser` calls.
- Vendor coupling to Sentry. The wrapper imports `@sentry/nextjs` directly, and the per-runtime config files are Sentry-specific. Mitigation: the call sites only depend on `withObservability`, so swapping Sentry for an alternative is a single-file edit. Acceptable for v1.
- `withSentryConfig` wraps `next.config.ts`, so any future Next.js config change must keep the wrap or move it deliberately. Documented at the export line.
- Streaming responses are out of scope today (no streaming routes yet), but `await handler()` resolves at response-object creation, not body completion — `duration_ms` would represent time-to-first-byte for a `ReadableStream` body. The Phase 1 proxy work (VS-021) will need a streaming-aware variant.
- Build-time `SENTRY_AUTH_TOKEN` is required for source-map upload; missing it is non-fatal (`silent: !process.env.CI`) but you lose readable stack traces in production until set.

## Alternatives

**OpenTelemetry + a self-hosted collector (rejected).** OTel gives us provider-agnostic instrumentation and a clean migration path. The cost is a collector to run, sinks to wire up, and a sampling/storage policy to maintain. For a v1 with ~zero traffic and no ops team, this is significant overhead. Re-evaluate once we have multi-service deployments or a hard "no vendor lock-in" requirement.

**pino + Logflare/Axiom (rejected as the *whole* solution).** pino is a fine logger and we considered it for the JSON-line emitter, but it does not satisfy the error-reporting AC by itself — we'd still need a separate error reporter. The two-tool option (pino + Sentry) wins nothing meaningful over (`console.log` JSON + Sentry) for v1; we'd just be adding a dep to format an object we already format.

**Vercel Speed Insights / Web Analytics (rejected as the *whole* solution).** Speed Insights captures Real User Monitoring on the browser side and gives us page-level performance. It does not capture server-side error events or per-route handler latency. Useful complement later; not a substitute for Sentry.

**A `@veritasee/observability` workspace package (rejected for now).** The codebase convention from `packages/storage` and `packages/redis` is to extract a workspace package only when the code is genuinely shared. Observability is consumed only by `apps/web`. When the browser extension lands (PRD §1, §13), if it needs the same logger we'll lift this module into a package then.
