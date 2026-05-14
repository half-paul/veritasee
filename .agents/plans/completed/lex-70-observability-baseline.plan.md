# Plan: Logging, error reporting, and metrics baseline

## Summary

Wire a v1 observability baseline into `apps/web` so every API request emits a structured JSON log line (route, method, status, latency_ms), every thrown error reaches a hosted error reporter (Sentry), and per-request latency is captured in a form that Vercel/Sentry can compute P95 from downstream. Implementation is intentionally thin: one new `apps/web/src/lib/observability/` module with a `logger` and a `withObservability()` route-handler wrapper, plus `@sentry/nextjs` initialised via `instrumentation.ts`. No new workspace package; matches "single Next.js API surface" guidance in [docs/general/SYSTEM-OVERVIEW.md](../../docs/general/SYSTEM-OVERVIEW.md) and avoids premature abstraction.

## User Story

As an operator
I want structured logs, error capture, and latency telemetry on every API route
So that PRD §6 SLOs (read P95 ≤ 2.5s cached / 5s cold; 99.5% read-path availability) can be measured and alerted, and unhandled errors surface in a single triage queue.

## Metadata

| Field            | Value                                                                                |
| ---------------- | ------------------------------------------------------------------------------------ |
| Type             | NEW_CAPABILITY                                                                       |
| Complexity       | MEDIUM                                                                               |
| Systems Affected | `apps/web` route handlers, middleware, Next.js instrumentation, Vercel env, Sentry   |
| Linear Issue     | LEX-70 (inferred from chronology after LEX-69; corresponds to VS-007 in PRD-linear-issues.md:127–137) |

---

## Acceptance Criteria (from VS-007)

- [ ] Given a thrown error, when it reaches the API boundary, then it is reported (Sentry or equivalent).
- [ ] Given an HTTP request, when handled, then a structured log line includes route, status, latency.
- [ ] Given the read path, when serving requests, then P95 latency is exported as a metric.

---

## Approach & Design Decisions

### Why Sentry (not OpenTelemetry / pino + custom collector)

- **Sentry has a first-class Next.js SDK** (`@sentry/nextjs`) that auto-wires the App Router, route handlers, edge runtime, and middleware via `instrumentation.ts`. PRD §6 line 161 names "Sentry or equivalent"; the ADR will record the choice.
- OTel + a self-hosted collector multiplies infra surface area we explicitly defer (`docs/PRD.md` §6 keeps scope tight; ADR 0003 §Decision favours managed services).
- Sentry **Performance / Tracing** also gives us P95 latency dashboards out of the box, satisfying AC #3 without standing up Prometheus.

### Why a route-handler wrapper, not middleware-only

`apps/web/src/middleware.ts:5-7` runs on the **edge** runtime by default and only sees the request — it cannot observe the downstream handler's response status or end timestamp without rewriting the response stream. A small `withObservability(handler)` HOF wrapping each route handler is:

- explicit about which routes are instrumented (matches the "no hidden magic" tone of `packages/storage/src/objects.ts:1-47`),
- runtime-agnostic (works on both `nodejs` and edge route handlers),
- compatible with the existing per-route `runtime = 'nodejs'` declarations (`apps/web/src/app/api/health/storage/route.ts:4`).

Sentry's `@sentry/nextjs` SDK auto-captures uncaught exceptions in route handlers regardless, but the wrapper gives us **structured request logs** and a single place to also call `Sentry.captureException` so logs and Sentry events share the same `request_id`.

### Why "structured logs to stdout" is sufficient for metrics

Vercel captures stdout into its log drain. JSON lines containing `event:"request"`, `route`, `status`, `duration_ms` are queryable in Vercel Logs and exportable to any drain (Datadog, Axiom, BetterStack). Sentry Performance separately captures span durations; either path yields P95. We don't run our own Prometheus.

### What we are NOT doing in this issue

- No request-body or response-body logging (PII risk; defer until §15 data-residency work).
- No custom metrics endpoint, no Prometheus scrape, no OTel exporter.
- No log sampling (volumes are negligible at v1).
- No client-side error capture beyond what `@sentry/nextjs` enables by default in `sentry.client.config.ts`.
- No SLO dashboards or alert routing — that's an ops follow-up once data is flowing.

---

## Patterns to Follow

### Naming & module layout — mirror `packages/storage/src/`

```ts
// SOURCE: packages/storage/src/index.ts (barrel)
// SOURCE: packages/storage/src/objects.ts:1-10 (named exports, no default)
// SOURCE: packages/storage/src/env.ts:1-10 (requireEnv / optionalEnv)
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
```

Apply the same shape under `apps/web/src/lib/observability/`: small files, named exports, no default exports, lazy initialisation of any singleton.

### Route handler shape — keep the existing try/catch contract

```ts
// SOURCE: apps/web/src/app/api/health/redis/route.ts:7-18
export async function GET() {
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
```

After the change, the wrapper invokes the handler and emits the log line — the handler's internal try/catch stays unchanged. We do not refactor existing routes' error shapes.

### Env-var hygiene — match `apps/web/.env.example`

```
# SOURCE: apps/web/.env.example:1-9 (header comment style + Vercel precedence note)
# SOURCE: apps/web/.env.example:13-14 (KEY=value pattern)
```

Add the Sentry vars with the same header, comment block, and per-environment guidance as Clerk / Postgres / Redis blocks.

### Verification commands — from AGENTS.md

```bash
# SOURCE: AGENTS.md:19-26 + AGENTS.md:37
pnpm lint
pnpm typecheck
pnpm build
```

---

## Files to Change

| File                                                       | Action | Purpose                                                                                          |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `apps/web/package.json`                                    | UPDATE | Add `@sentry/nextjs` dependency.                                                                 |
| `apps/web/src/lib/observability/logger.ts`                 | CREATE | Structured JSON logger (`logger.info`, `logger.warn`, `logger.error`).                           |
| `apps/web/src/lib/observability/withObservability.ts`      | CREATE | HOF that wraps a route handler: records start, captures Sentry exceptions, emits request log.   |
| `apps/web/src/lib/observability/index.ts`                  | CREATE | Barrel export.                                                                                   |
| `apps/web/src/lib/observability/env.ts`                    | CREATE | `optionalEnv` for `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`.                  |
| `apps/web/instrumentation.ts`                              | CREATE | Next.js instrumentation hook: dynamic-imports `sentry.server.config.ts` / `sentry.edge.config.ts`. |
| `apps/web/sentry.server.config.ts`                         | CREATE | Sentry init for the Node runtime (DSN, environment, tracesSampleRate).                           |
| `apps/web/sentry.edge.config.ts`                           | CREATE | Sentry init for the edge runtime.                                                                |
| `apps/web/sentry.client.config.ts`                         | CREATE | Sentry init for the browser (DSN from `NEXT_PUBLIC_SENTRY_DSN`).                                 |
| `apps/web/next.config.ts`                                  | UPDATE | Wrap export with `withSentryConfig()` for source-map upload + tunnel route.                      |
| `apps/web/src/middleware.ts`                               | UPDATE | Generate/forward `x-request-id` header so it appears in handler logs and Sentry events.          |
| `apps/web/src/app/api/me/route.ts`                         | UPDATE | Wrap `GET` with `withObservability('GET /api/me', …)`.                                           |
| `apps/web/src/app/api/health/db/route.ts`                  | UPDATE | Wrap `GET`.                                                                                      |
| `apps/web/src/app/api/health/redis/route.ts`               | UPDATE | Wrap `GET`.                                                                                      |
| `apps/web/src/app/api/health/storage/route.ts`             | UPDATE | Wrap `GET`.                                                                                      |
| `apps/web/.env.example`                                    | UPDATE | Add `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` blocks.    |
| `docs/general/DEPLOYMENT.md`                               | UPDATE | New §Sentry section: one project per environment, env var matrix row, auth-token note.           |
| `docs/adr/0004-observability-baseline.md`                  | CREATE | Record the Sentry-over-OTel decision and the "log to stdout, P95 in Sentry" v1 stance.           |
| `docs/adr/README.md`                                       | UPDATE | (No-op if list isn't enumerated; verify and add 0004 link if convention is to list ADRs.)        |

---

## Dependency Order

1. Logger + env helpers + `withObservability` (no external deps — can compile against current tree).
2. Add `@sentry/nextjs` dep and Sentry config files; wire `instrumentation.ts` and `next.config.ts`.
3. Update middleware to mint `x-request-id`.
4. Wrap each existing API route handler.
5. Env / docs / ADR updates.
6. Verify build, lint, typecheck.

---

## Risks & Mitigations

| Risk                                                                                                                                                              | Mitigation                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sentry/nextjs` adds bundle weight / cold-start latency on edge.                                                                                                  | Use the `instrumentation.ts` pattern (Next.js 15 supports per-runtime config) and set `tracesSampleRate: 0.2` initially; reassess after a week of data.     |
| Sentry not configured in dev → noisy console errors or failed init.                                                                                                | Guard each `Sentry.init` with `if (!process.env.SENTRY_DSN) return;` — matches the lazy-env pattern in `packages/storage/src/client.ts:17-20`.               |
| `withSentryConfig` mutating `next.config.ts` interferes with future config (Turbopack, headers).                                                                   | Keep the wrap minimal: `withSentryConfig(nextConfig, { silent: true, org, project })`. Document in ADR 0004 so the next config edit knows where to splice.  |
| Request logs leak query strings containing tokens.                                                                                                                 | Log `req.nextUrl.pathname` only, never `req.nextUrl.search`. Add a comment in `withObservability.ts` enforcing this.                                        |
| Edge runtime can't use Node `process.hrtime` for timing.                                                                                                           | Use `performance.now()` — available in both Node and edge runtimes since Next.js 13.                                                                        |
| Wrapping every handler is mechanical churn; future routes might forget the wrap.                                                                                   | Document the wrapper in `apps/web/AGENTS.md` (if it exists) or add a one-liner under `## Coding Style & Naming Conventions` of root `AGENTS.md` in a follow-up. This issue does not force it. |
| Sentry source-map upload requires `SENTRY_AUTH_TOKEN` in Vercel build env; missing token would fail the build.                                                     | `withSentryConfig({ silent: true })` + opt-in via `SENTRY_AUTH_TOKEN` presence. Document the required Vercel env scope (build-only) in DEPLOYMENT.md.       |
| Per-environment Sentry projects are not free past hobby tier; preview deploys could burn the events quota.                                                         | Default `SENTRY_ENVIRONMENT=preview` to a `tracesSampleRate` of `0.05` in `sentry.server.config.ts` based on `process.env.VERCEL_ENV`. Note in DEPLOYMENT.md. |
| Uptime probes against `/api/health/*` would create one Sentry trace per request and burn quota disproportionately.                                                 | `tracesSampler` in Tasks 6–7 returns `0` for any URL containing `/api/health/`. Structured request logs still fire so up/down is queryable in Vercel logs.    |
| P95 metric AC requires a *metric*, not just logs.                                                                                                                  | Sentry Performance's auto-instrumented spans satisfy AC #3 (P95 visible per route in the Sentry Performance dashboard). Document the dashboard link in ADR 0004. |

---

## Tasks

Execute in order. Each task is atomic and verifiable with `pnpm typecheck` (and `pnpm lint` after the final task).

### Task 1: Add observability env helpers

- **File**: `apps/web/src/lib/observability/env.ts`
- **Action**: CREATE
- **Implement**:
  - Re-export pattern from `packages/storage/src/env.ts:1-10`, but the only required env is none — observability must degrade gracefully if DSN is absent.
  - Export `optionalEnv(name: string): string | undefined` (mirror existing helper).
  - Export `getSentryEnvironment(): string` returning `process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development'`.
- **Mirror**: `packages/storage/src/env.ts:1-10`
- **Validate**: `pnpm typecheck`

### Task 2: Create structured JSON logger

- **File**: `apps/web/src/lib/observability/logger.ts`
- **Action**: CREATE
- **Implement**:
  - One file, no deps. Export `logger.info(msg, fields)`, `logger.warn(...)`, `logger.error(...)`.
  - Each call emits a single JSON line to `console.log` (info/warn) or `console.error` (error) with fields: `{ ts, level, msg, ...fields }`.
  - `ts` is `new Date().toISOString()`.
  - Never log `req.nextUrl.search` (enforced by convention; comment at the top of the file states "callers must pass `pathname` only, not `search`").
- **Mirror**: short-file convention from `packages/storage/src/env.ts` and `packages/storage/src/objects.ts:1-20`
- **Validate**: `pnpm typecheck`

### Task 3: Create `withObservability` route-handler wrapper

- **File**: `apps/web/src/lib/observability/withObservability.ts`
- **Action**: CREATE
- **Implement**:
  - Signature: `withObservability<TArgs extends unknown[]>(handler: (req: NextRequest, ...args: TArgs) => Promise<Response>): (req: NextRequest, ...args: TArgs) => Promise<Response>`.
  - On invocation:
    1. `const start = performance.now();`
    2. `const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();`
    3. `const method = req.method; const route = req.nextUrl.pathname;`
    4. `try { const res = await handler(req, ...args); logger.info('request', { event: 'request', method, route, status: res.status, duration_ms: performance.now() - start, request_id: requestId }); return res; }`
    5. `catch (err) { const duration_ms = performance.now() - start; logger.error('request_error', { event: 'request', method, route, status: 500, duration_ms, request_id: requestId, err: err instanceof Error ? err.message : String(err) }); Sentry.captureException(err, { tags: { route, request_id: requestId } }); throw err; }`
  - The label string is derived from `req.method` and `req.nextUrl.pathname` — no separate `name` parameter (avoids drift between handler identity and the literal passed at the call site).
  - Re-throw after capture so Next.js still returns its standard 500 (or the per-route try/catch handles it). Do NOT swallow errors.
- **Mirror**: error-handling style from `apps/web/src/app/api/health/storage/route.ts:12-24` (use `err instanceof Error`)
- **Validate**: `pnpm typecheck`

### Task 4: Create observability barrel export

- **File**: `apps/web/src/lib/observability/index.ts`
- **Action**: CREATE
- **Implement**: `export { logger } from './logger'; export { withObservability } from './withObservability'; export { getSentryEnvironment } from './env';`
- **Mirror**: `packages/storage/src/index.ts`
- **Validate**: `pnpm typecheck`

### Task 5: Add `@sentry/nextjs` dependency

- **File**: `apps/web/package.json`
- **Action**: UPDATE
- **Implement**: Add `"@sentry/nextjs": "^8.40.0"` to `dependencies`. Run `pnpm install` from repo root.
- **Mirror**: dep-add style from `apps/web/package.json:12-20`
- **Validate**: `pnpm install` succeeds; `pnpm typecheck`

### Task 6: Sentry server config

- **File**: `apps/web/sentry.server.config.ts`
- **Action**: CREATE
- **Implement**:
  - `import * as Sentry from '@sentry/nextjs';`
  - Guard: `if (!process.env.SENTRY_DSN) return;` (wrap init in an `if` so absent DSN is silent — required for local dev).
  - ```ts
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: getSentryEnvironment(),
      tracesSampler: (ctx) => {
        const url = ctx.normalizedRequest?.url ?? '';
        if (url.includes('/api/health/')) return 0;
        return process.env.VERCEL_ENV === 'production' ? 0.2 : 0.05;
      },
    });
    ```
  - The `tracesSampler` drops health-route traces so uptime probes don't burn Sentry quota. Health routes still produce structured request logs (AC #2) via `withObservability`.
- **Mirror**: lazy-env pattern from `packages/storage/src/client.ts:17-20`
- **Validate**: `pnpm typecheck`

### Task 7: Sentry edge config

- **File**: `apps/web/sentry.edge.config.ts`
- **Action**: CREATE
- **Implement**: Same body as Task 6 (including the `tracesSampler` health-route exclusion) but the file exists separately so Next.js can apply it to the edge runtime.
- **Mirror**: `apps/web/sentry.server.config.ts`
- **Validate**: `pnpm typecheck`

### Task 8: Sentry client config

- **File**: `apps/web/sentry.client.config.ts`
- **Action**: CREATE
- **Implement**:
  - Use `process.env.NEXT_PUBLIC_SENTRY_DSN`.
  - `Sentry.init({ dsn, environment, tracesSampleRate, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 });` — replays explicitly off; revisit later.
- **Mirror**: previous configs
- **Validate**: `pnpm typecheck`

### Task 9: Instrumentation hook

- **File**: `apps/web/instrumentation.ts`
- **Action**: CREATE
- **Implement**:
  - Exact pattern Next.js docs prescribe:
    ```ts
    export async function register() {
      if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('./sentry.server.config');
      }
      if (process.env.NEXT_RUNTIME === 'edge') {
        await import('./sentry.edge.config');
      }
    }
    export const onRequestError = Sentry.captureRequestError;
    ```
  - Import `Sentry` at the top: `import * as Sentry from '@sentry/nextjs';`
- **Validate**: `pnpm typecheck`

### Task 10: Wrap `next.config.ts` with `withSentryConfig`

- **File**: `apps/web/next.config.ts`
- **Action**: UPDATE
- **Implement**:
  - Keep the existing `nextConfig` object.
  - At the bottom: `export default withSentryConfig(nextConfig, { silent: !process.env.CI, org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, widenClientFileUpload: true, tunnelRoute: '/monitoring', disableLogger: true });`
  - Import: `import { withSentryConfig } from '@sentry/nextjs';`
- **Mirror**: existing minimal config style (`apps/web/next.config.ts:1-7`)
- **Validate**: `pnpm typecheck && pnpm build`

### Task 11: Mint and propagate `x-request-id` in middleware

- **File**: `apps/web/src/middleware.ts`
- **Action**: UPDATE
- **Implement**:
  - Replace the middleware body so the Clerk gate runs first, then the request id is minted and **propagated to downstream handlers via `NextResponse.next({ request: { headers } })`**. Mutating `req.headers` in-place does NOT forward the header in Next.js App Router — the cloned-headers + `NextResponse.next` pattern is required.
    ```ts
    import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
    import { NextResponse } from 'next/server';

    const isProtected = createRouteMatcher(['/dashboard(.*)']);

    export default clerkMiddleware(async (auth, req) => {
      if (isProtected(req)) await auth.protect();
      const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set('x-request-id', requestId);
      return NextResponse.next({ request: { headers: requestHeaders } });
    });

    export const config = {
      matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
    };
    ```
  - Do not change the matcher or the Clerk gate logic.
  - `withObservability` still keeps its own `?? crypto.randomUUID()` fallback so the wrapper degrades gracefully if a future code path bypasses middleware.
- **Mirror**: existing middleware (`apps/web/src/middleware.ts:1-11`)
- **Validate**: `pnpm typecheck`

### Task 12: Wrap `/api/me`

- **File**: `apps/web/src/app/api/me/route.ts`
- **Action**: UPDATE
- **Implement**:
  - Convert `export async function GET()` → keep handler logic, rename to `async function handler(_req: NextRequest)`, then `export const GET = withObservability(handler);`
  - Import `withObservability` from `@/lib/observability` and `NextRequest` from `next/server`.
- **Mirror**: `apps/web/src/app/api/me/route.ts:1-19`
- **Validate**: `pnpm typecheck`

### Task 13: Wrap `/api/health/db`

- **File**: `apps/web/src/app/api/health/db/route.ts`
- **Action**: UPDATE
- **Implement**: same wrap as Task 12 — `export const GET = withObservability(handler);`. Health-route Sentry traces are filtered out by the `tracesSampler` in Tasks 6–7, but the structured request log still fires.
- **Mirror**: Task 12
- **Validate**: `pnpm typecheck`

### Task 14: Wrap `/api/health/redis`

- **File**: `apps/web/src/app/api/health/redis/route.ts`
- **Action**: UPDATE
- **Implement**: same wrap as Task 13.
- **Mirror**: Task 12
- **Validate**: `pnpm typecheck`

### Task 15: Wrap `/api/health/storage`

- **File**: `apps/web/src/app/api/health/storage/route.ts`
- **Action**: UPDATE
- **Implement**: same wrap as Task 13. Keep the `HttpAwareError` interface and the existing 503 mapping inside the handler — the wrapper only logs and re-throws on uncaught errors.
- **Mirror**: Task 12
- **Validate**: `pnpm typecheck`

### Task 16: Document env vars in `.env.example`

- **File**: `apps/web/.env.example`
- **Action**: UPDATE
- **Implement**: Append a Sentry block in the same comment-block style as the Clerk / Postgres / Redis sections. Vars:
  - `SENTRY_DSN=` (server)
  - `NEXT_PUBLIC_SENTRY_DSN=` (client)
  - `SENTRY_ENVIRONMENT=` (optional override; falls back to `VERCEL_ENV`)
  - `SENTRY_ORG=`
  - `SENTRY_PROJECT=`
  - `SENTRY_AUTH_TOKEN=` (build-time only — for source-map upload)
  - Comment that all are optional in local dev; production builds without a DSN simply skip init.
- **Mirror**: `apps/web/.env.example:11-34` (Clerk block) and the Postgres/Redis blocks for style.
- **Validate**: `pnpm format:check` (file is formatted by Prettier).

### Task 17: Extend DEPLOYMENT.md

- **File**: `docs/general/DEPLOYMENT.md`
- **Action**: UPDATE
- **Implement**:
  - Add a `## Sentry` section after the existing object-store section.
  - Cover: one Sentry project per environment (prod / preview / dev) **or** a single project with `SENTRY_ENVIRONMENT` tagging — recommend the latter for v1 cost reasons (note quota implications).
  - Add an env-var matrix row mirroring the existing table.
  - Note `SENTRY_AUTH_TOKEN` is build-time scope only.
- **Mirror**: object-store section style added in commit `282ecb6` (LEX-69).
- **Validate**: `pnpm format:check` (markdown formatted by Prettier).

### Task 18: Write ADR 0004 — observability baseline

- **File**: `docs/adr/0004-observability-baseline.md`
- **Action**: CREATE
- **Implement**:
  - MADR-lite shape per `docs/adr/README.md:5-13`.
  - **Status**: Accepted. **Date**: today (resolve absolute). **Linear**: LEX-70.
  - **Context**: PRD §6 SLO targets; absence of any existing instrumentation; managed-service preference from ADR 0003.
  - **Decision**: `@sentry/nextjs` for errors + tracing; structured JSON logs to stdout via `lib/observability/logger.ts`; route-handler wrapper `withObservability` for the request log line; no OTel collector, no Prometheus.
  - **Consequences**: Vendor lock-in on Sentry SDK (cheap to undo); P95 visible in Sentry Performance dashboard; no custom metrics endpoint in v1.
  - **Alternatives**: OpenTelemetry + Tempo/Grafana (rejected: infra overhead); pino + Logflare (rejected: still need separate error reporter).
- **Mirror**: `docs/adr/0003-vercel-deployment.md:1-40`
- **Validate**: `pnpm format:check`

### Task 19: Full verification pass

- **File**: n/a
- **Action**: Run the full required-verification set from `AGENTS.md:37`.
- **Validate**:
  ```bash
  pnpm lint
  pnpm typecheck
  pnpm build
  ```
- **Acceptance**: all three exit zero. Spot-check that an intentionally thrown error in a scratch route triggers a Sentry event in dev (if DSN is configured locally) and produces a `request_error` log line; remove the scratch route before commit.

---

## Validation

```bash
# Required by AGENTS.md:37
pnpm lint
pnpm typecheck
pnpm build

# Manual smoke (with a dev Sentry DSN configured in .env.local):
pnpm dev
# In another shell:
curl -s http://localhost:3000/api/health/redis | jq
# → confirm a JSON line in the dev-server stdout with event:"request", route, status, duration_ms.

# Confirm error path:
# Temporarily replace api/health/redis handler body with `throw new Error('smoke')`,
# hit the route, confirm:
#   1. console emits a `request_error` JSON line with duration_ms and request_id.
#   2. Sentry dashboard shows the captured exception tagged with route + request_id.
# Revert the scratch change before commit.
```

No test command is configured for `apps/web` yet (AGENTS.md:36). The verification set is the contract.

---

## Acceptance Criteria

- [ ] All tasks completed in order.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.
- [ ] A request to any wrapped API route emits a single-line JSON log with `event: "request"`, `route`, `method`, `status`, `duration_ms`, `request_id` (AC #2).
- [ ] A thrown error inside any wrapped route is captured by Sentry with the route tag (AC #1).
- [ ] `withObservability` records latency via `performance.now()` so per-route P95 is computable in Sentry Performance or via downstream log aggregation (AC #3).
- [ ] `.env.example`, `DEPLOYMENT.md`, and `docs/adr/0004-observability-baseline.md` document the new env vars and decision.
- [ ] No changes to error-response shape from existing routes — try/catch contracts in `api/health/*` and `api/me` remain intact.
- [ ] No new workspace package created (single Next.js API surface preserved per SYSTEM-OVERVIEW.md).
