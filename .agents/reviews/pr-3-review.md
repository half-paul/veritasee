# Code Review: PR #3 — LEX-64 Integrate Clerk managed auth

**Scope**: PR #3 (`features/LEX-64` → `main`)
**Recommendation**: NEEDS WORK

## Summary

PR adopts Clerk (`@clerk/nextjs` v6) for managed auth across `apps/web`: middleware-protected `/dashboard` + `/api/me`, Clerk-hosted sign-in/up routes, `<ClerkProvider>` + auth header in root layout, a typed `resolveRole()` helper, and ADR 0001. The implementation tracks the plan closely and the code is small, focused, and idiomatic. Two correctness concerns warrant fixes before merge: (1) Clerk session claims do not surface `publicMetadata` by default — `resolveRole()` will silently always return `contributor` unless a session-token template is configured, and (2) `auth.protect()` on `/api/me` returns 404 for unauthenticated API requests in Clerk v6, contradicting the AC and route handler that expect 401.

## Issues Found

### Critical
None.

### High Priority

**1. Session-token template required for `resolveRole()` to ever return a non-default role**
`apps/web/src/lib/auth/roles.ts:8` reads `claims?.metadata?.role`. By default, Clerk's session claims do **not** include `publicMetadata`. Roles will only flow through if the Clerk dashboard's session token is customised with something like `{ "metadata": "{{user.public_metadata}}" }`. As shipped, every signed-in user resolves to `contributor` regardless of their actual `publicMetadata.role`.
- Recommendation: document the required session-token template in `apps/web/.env.example` and ADR 0001 (Operational Setup section), or fall back to fetching `currentUser().publicMetadata.role` server-side as a safety net. At minimum add a one-line operator note to the ADR's Consequences/Setup section.

**2. `auth.protect()` returns 404 (not 401) for unauthenticated API routes**
`apps/web/src/middleware.ts:3` includes `/api/me` in `isProtected`. In Clerk v6 middleware, `auth.protect()` redirects page routes to sign-in but responds with 404 for API routes (intentional, to avoid leaking endpoint existence). This means the `/api/me` 401 branch in `apps/web/src/app/api/me/route.ts:7-9` is unreachable — and PR test plan / AC #2 ("401 otherwise") will fail.
- Recommendation: remove `/api/me` from the protected matcher and let the route handler's own `if (!userId) return 401` enforce auth. Middleware would then only protect `/dashboard(.*)`. Alternatively call `auth.protect({ unauthenticatedUrl: ... })` only for page routes and keep API auth purely in the handler.

### Medium Priority

**3. Duplicated unsafe cast at every `auth()` call site**
`apps/web/src/app/api/me/route.ts:16` and `apps/web/src/app/dashboard/page.tsx:8` both pass `sessionClaims as { metadata?: { role?: unknown } } | null` to `resolveRole`. The cast contradicts `resolveRole`'s already-permissive `ClaimsLike` parameter — `sessionClaims` (typed as `JwtPayload | null`) is structurally assignable, the cast is unnecessary noise.
- Recommendation: drop the `as ...` casts; `resolveRole(sessionClaims)` should type-check directly given `ClaimsLike`. If TS complains, widen `ClaimsLike` rather than casting at the call site.

**4. ADR does not record session-token template requirement**
`docs/adr/0001-managed-auth.md` claims roles are "exposed via session claims" but does not mention the dashboard configuration step that makes that true. Future operators will hit issue #1 above.
- Recommendation: add a brief "Operational Setup" section listing the session-token template JSON.

### Suggestions

- `apps/web/src/app/api/me/route.ts`: response shape returns `{ user: null }` with 401 in the unreachable branch but `{ user: {...} }` in the success branch — fine, but if/when issue #2 is addressed, ensure the shape is stable for clients.
- `apps/web/.env.example` lists optional fallback redirect URLs but not `CLERK_JWT_KEY` (used if you choose networkless verification). Not required for v1; mention only if relevant.
- `apps/web/src/app/layout.tsx:38` missing trailing newline (per file display).
- `.agents/stories/PRD-linear-issues.md` is 698 lines and not strictly part of the LEX-64 deliverable — consider whether it belongs in this PR or a separate docs PR. Same question for the broad `.claude/commands/*` edits.

## Validation Results

| Check | Status |
|-------|--------|
| Type Check (`pnpm --filter web typecheck`) | PASS |
| Lint (`pnpm --filter web lint`) | PASS |
| Tests | N/A — no test runner configured |
| Build | Not run (requires real Clerk keys per implementation report) |

## What's Good

- Tight, well-scoped diff for the production code paths; the Clerk integration is canonical and matches v6 docs.
- `resolveRole()` is a clean discriminated guard with sensible default and pure logic — easy to unit test once a runner exists.
- ADR is thorough: alternatives, cost model, RBAC mapping, security posture, and migration path all present.
- `.env.example` is committed; `.env.local` is gitignored and not tracked. No secrets leaked.
- Plan, report, and PR description are tightly aligned and traceable to the LEX-64 ACs.

## Recommendation

NEEDS WORK. Fix issue #2 (move `/api/me` out of middleware-protected matcher) — without it AC #2 ("401 otherwise") fails. Fix or document issue #1 (session-token template) — without it, the role system is silently inert. Issues #3 and #4 are quick follow-ups that can ride along.
