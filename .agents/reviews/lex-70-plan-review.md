# Code Review: LEX-70 plan — observability baseline

**Scope**: `.agents/plans/lex-70-observability-baseline.plan.md` (planning document; no code written yet)
**Recommendation**: **NEEDS WORK** — 1 high-priority fix before `/implement`, plus a handful of medium tightenings.

## Summary

The plan is well-structured, follows the project's "small files, named exports, lazy env" conventions, and correctly identifies the Sentry-over-OTel tradeoff for v1. However, **Task 11's middleware header-propagation pattern is wrong** (a known Next.js gotcha) and will silently fail to forward `x-request-id` to downstream handlers. There are also a few Sentry-config quirks worth tightening before code is written, since the cost of fixing them in the plan is near-zero compared to discovering them mid-implementation.

The plan correctly cites the Linear/VS inference, the verification commands, the existing route inventory, and the lazy-env pattern. File:line references I spot-checked (`packages/storage/src/env.ts:1-10`, `apps/web/src/middleware.ts:1-11`, `AGENTS.md:37`) all match the working tree.

## Issues Found

### Critical
None.

### High Priority

**H1. Middleware `req.headers.set()` does not propagate to downstream handlers (Task 11).**

The plan instructs:

```ts
const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
req.headers.set('x-request-id', requestId);
```

In Next.js App Router, mutating `req.headers` in middleware **does not forward** the new header to route handlers. The Next.js documented pattern is to clone headers and pass them via `NextResponse.next({ request: { headers } })`. The current middleware (`apps/web/src/middleware.ts:5-7`) doesn't explicitly return `NextResponse.next()` because `clerkMiddleware` handles the return implicitly — so the plan's mutation has no effect on what handlers receive.

Result: `withObservability` will always fall through to its `crypto.randomUUID()` fallback. The middleware-minted ID is dead code, and any future middleware-level logging cannot share a `request_id` with the handler log line.

**Fix**: replace Task 11's body with the canonical propagation pattern:

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
```

Update Task 11's "Implement" block accordingly.

### Medium Priority

**M1. Wrapping `/api/health/*` routes will burn Sentry trace quota on monitoring probes.**

Every uptime/Vercel check that hits `/api/health/db`, `/api/health/redis`, `/api/health/storage` will create a Sentry transaction at `tracesSampleRate: 0.2`. Health checks are typically high-frequency and low-information. The plan does not exclude them.

**Fix**: in Tasks 6–7 (Sentry server/edge configs), add a `tracesSampler` that drops health routes:

```ts
Sentry.init({
  // ...
  tracesSampler: (ctx) => {
    const path = ctx.normalizedRequest?.url ?? ctx.request?.url ?? '';
    if (path.includes('/api/health/')) return 0;
    return process.env.VERCEL_ENV === 'production' ? 0.2 : 0.05;
  },
});
```

Or, simpler: don't wrap health routes with `withObservability` (skip Tasks 13–15) since their value is binary up/down, not P95 latency. The plan's AC #3 ("read path") doesn't include health checks, so leaving them un-wrapped is defensible.

**M2. `withObservability(name, handler)` — the `name` parameter is redundant.**

Every call site passes a string like `'GET /api/me'`, but the wrapper already reads `req.method` and `req.nextUrl.pathname`. The duplicate increases drift risk (handler moved, name not updated) and forces every wrapped route to remember the string.

**Fix**: drop `name`. Compute the label inside the wrapper as `${req.method} ${req.nextUrl.pathname}`. Tasks 12–15 simplify to `export const GET = withObservability(handler);`.

**M3. AC #3 wording vs. Sentry Performance — clarify scope in the ADR.**

VS-007 AC #3 reads "P95 latency is **exported** as a metric." Sentry Performance is a hosted dashboard, not an OTel-style exported metric. The plan acknowledges this implicitly in the Risks table but doesn't make the interpretation explicit.

**Fix**: in Task 18 (ADR 0004), add an explicit sentence: *"We interpret 'exported as a metric' to mean 'computable in Sentry Performance and via Vercel log drain queries against the `duration_ms` field'. If a future requirement demands a true OTel metrics endpoint, this ADR is superseded."* This documents the call so the next reviewer doesn't re-litigate it.

**M4. Plan attributes "single Next.js API surface" to SYSTEM-OVERVIEW.md, but that phrase isn't there.**

I read `docs/general/SYSTEM-OVERVIEW.md` start-to-finish: the phrase doesn't appear. It originates from the `/plan` command's "Align with Project Architecture" section, not the system overview. Minor citation accuracy.

**Fix**: in the Plan Summary, replace "matches the 'single Next.js API surface' guidance in `docs/general/SYSTEM-OVERVIEW.md`" with "matches the v1 single-Next.js-surface direction in `docs/PRD.md` §7 (Architecture)". PRD §7 lines 170+ describe the architecture as a single API Gateway, which is the closest first-party source.

### Suggestions (Low Priority)

**L1. Task 5: use `pnpm add` instead of hand-editing `package.json`.**
`pnpm add -D` / `pnpm add` updates `pnpm-lock.yaml` atomically. Hand-editing then running `pnpm install` works but is a pattern the repo doesn't otherwise use. (See `apps/web/package.json` — all deps were added via `pnpm add`.)

**L2. Task 8: replay sample rates without `Sentry.replayIntegration()` are no-ops.**
`replaysSessionSampleRate: 0` / `replaysOnErrorSampleRate: 0` are silently ignored if the replay integration isn't registered. Either register it (and pay the bundle cost) or remove the lines. For v1, remove them — the comment `// replays explicitly off` is misleading because they were never on.

**L3. `tunnelRoute: '/monitoring'` (Task 10) adds an unlisted route.**
Sentry's tunnel route bypasses adblockers by proxying SDK requests through the app. It creates a new dynamic route at `/monitoring/*`. Not a problem today, but worth listing in the new "Files to Change" table as a side effect, or in the ADR, so future readers don't see mystery traffic at that path.

**L4. Pin Sentry version more precisely or document the choice.**
`^8.40.0` accepts any 8.x. Sentry's SDK has shipped breaking changes between minors before. Either pin to `~8.40.0` or note in the ADR that we accept 8.x minor drift.

**L5. Streaming responses are out of scope today, but worth a one-line note.**
`await handler()` resolves when the `Response` object is created — for a `Response` carrying a `ReadableStream`, that's well before the body finishes. `duration_ms` would then represent TTFB, not stream completion. None of today's routes stream, but Phase 1 proxy work (VS-021) will. Add to the Risks table.

**L6. Task 9: `import * as Sentry from '@sentry/nextjs'` at top of `instrumentation.ts` will pull the Sentry runtime into every request.**
Sentry's docs recommend importing only inside the runtime branch:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  // ...
}
export { captureRequestError as onRequestError } from '@sentry/nextjs';
```

The re-export keeps the named import lazy on serverless cold start. Minor — but it's the documented pattern.

**L7. ADR 0004 file should be linked from `docs/adr/README.md`?**
README.md (lines 1–14) describes the ADR format but doesn't enumerate ADRs. So no update is required — the plan correctly notes this in the Files-to-Change table. Verified, no change needed.

## What's Good

- **Correct inference of LEX-70 from chronology**, with the call clearly flagged in metadata so reviewers can sanity-check.
- **Module layout mirrors `packages/storage/src/`** — small files, named exports, no default exports, lazy env. Consistent with the rest of the codebase.
- **Try/catch contracts of existing routes preserved**. The wrapper is a safety net, not a refactor — this minimises blast radius.
- **`performance.now()` selected over `process.hrtime`** to keep edge-runtime compatibility. Good catch.
- **No new workspace package proposed.** Aligns with the "don't add abstraction beyond what the task requires" guidance.
- **Verification commands** (`pnpm lint && pnpm typecheck && pnpm build`) match `AGENTS.md:37` exactly.
- **Risks section is thorough** — bundle weight, missing DSN, build-time auth token, preview env quotas all called out.
- **ADR planned, not skipped.** Continues the project's pattern of recording each foundation decision (0001 auth, 0002 ORM, 0003 deploy, 0004 observability).
- **No tests planned, with justification.** AGENTS.md:36 confirms `apps/web` has no test runner yet; treating lint+typecheck+build as the contract is the project's stated norm.

## Validation Results

| Check        | Status | Notes                                                    |
| ------------ | ------ | -------------------------------------------------------- |
| Type Check   | N/A    | Plan document; no code yet.                              |
| Lint         | N/A    | Plan document; no code yet.                              |
| Tests        | N/A    | No test framework in `apps/web`; AGENTS.md:36 confirms.  |
| File:line refs spot-checked | PASS | `packages/storage/src/env.ts:1-10`, `apps/web/src/middleware.ts:1-11`, `apps/web/src/app/api/health/storage/route.ts:7-24`, `AGENTS.md:37`, `docs/adr/README.md:5-13` all match working tree. |
| Path alias `@/*` exists | PASS | Confirmed at `apps/web/tsconfig.json:9-11`. |
| Sentry 8.x API correctness | PASS (with L6) | `instrumentation.ts`, `withSentryConfig`, `Sentry.captureRequestError` are correct for Sentry 8 + Next.js 15.1.6. |

## Recommendation

**Fix H1 (middleware header propagation) and at least M1+M2 before running `/implement`.** Those three changes are pure edits to the plan, take five minutes, and prevent rework during implementation. M3, M4, and the L-items can be folded in opportunistically or left as known follow-ups.

After the edits, the plan is ready for execution.
