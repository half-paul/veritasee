# Implementation Report

**Plan**: `.agents/plans/completed/lex-64-managed-auth.plan.md`
**Branch**: `features/LEX-64`
**Status**: COMPLETE (E2E pending real Clerk dev keys)

## Summary

Adopted Clerk as the managed auth provider for `apps/web`. Wired `clerkMiddleware` to protect `/dashboard` and `/api/me`, wrapped the App Router tree in `<ClerkProvider>` with a header showing `<SignInButton>` / `<UserButton>`, added Clerk-hosted `/sign-in` and `/sign-up` catch-all routes, implemented `/api/me` returning `{ id, email, role }`, and a protected `/dashboard` page. Roles are resolved from `sessionClaims.metadata.role` via a typed `resolveRole()` helper that defaults to `contributor`. ADR 0001 captures the decision, cost model, RBAC mapping, security posture, and migration path.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | ADR + ADR README | `docs/adr/0001-managed-auth.md`, `docs/adr/README.md` | OK |
| 2 | Add `@clerk/nextjs` dependency | `apps/web/package.json`, `pnpm-lock.yaml` | OK |
| 3 | `.env.example` for Clerk vars | `apps/web/.env.example` | OK |
| 4 | Roles helper | `apps/web/src/lib/auth/roles.ts` | OK |
| 5 | Middleware | `apps/web/src/middleware.ts` | OK |
| 6 | `<ClerkProvider>` + header | `apps/web/src/app/layout.tsx` | OK |
| 7 | Sign-in / sign-up routes | `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`, `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx` | OK |
| 8 | `/api/me` route | `apps/web/src/app/api/me/route.ts` | OK |
| 9 | Protected `/dashboard` page | `apps/web/src/app/dashboard/page.tsx` | OK |
| 10 | Manual E2E | n/a | DEFERRED (see below) |

## Validation Results

| Check | Result |
|-------|--------|
| `pnpm install` | OK |
| `pnpm --filter web typecheck` | OK |
| `pnpm --filter web lint` | OK |
| `pnpm --filter web build` | OK (with placeholder Clerk keys in gitignored `apps/web/.env.local`) |
| Tests | None — no test runner configured in repo yet (plan acknowledged this; no meaningful new logic beyond `resolveRole`, which is a pure 3-line guard) |

## Files Changed

| File | Action |
|------|--------|
| `docs/adr/README.md` | CREATE |
| `docs/adr/0001-managed-auth.md` | CREATE |
| `apps/web/.env.example` | CREATE |
| `apps/web/.env.local` | CREATE (gitignored — placeholder keys for local build only) |
| `apps/web/package.json` | UPDATE (add `@clerk/nextjs ^6.0.0`) |
| `apps/web/src/lib/auth/roles.ts` | CREATE |
| `apps/web/src/middleware.ts` | CREATE |
| `apps/web/src/app/layout.tsx` | UPDATE (ClerkProvider + auth header) |
| `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx` | CREATE |
| `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx` | CREATE |
| `apps/web/src/app/api/me/route.ts` | CREATE |
| `apps/web/src/app/dashboard/page.tsx` | CREATE |

## Deviations from Plan

- **Task 4 — `tsconfig.json`:** Plan flagged the `@/*` alias as possibly missing. It was already present in `apps/web/tsconfig.json`; no change needed.
- **`.gitignore`:** Already excludes `.env.local` and `.env*.local` patterns from prior bootstrap. No update required.
- **`next.config.ts`:** Plan listed a possible no-op update. No changes were needed; build succeeds with default config.
- **Build-time keys:** The Next.js production build prerenders the App Router tree under `<ClerkProvider>`, which throws if `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is missing. To complete the `pnpm build` validation locally, `apps/web/.env.local` was populated with format-valid placeholder keys. The file is gitignored; only `.env.example` is tracked.
- **Task 10 — Manual E2E:** Cannot be exercised end-to-end with placeholder keys (Clerk's frontend API rejects the dummy domain). To run the full flow, drop real Clerk **Development** publishable + secret keys into `apps/web/.env.local`, then walk:
  1. Visit `/dashboard` while signed out → redirects to `/sign-in?redirect_url=...`.
  2. Sign in via the `<SignIn />` widget → `__session` cookie is set → `/dashboard` renders email + role.
  3. `curl -b cookies.txt http://localhost:3000/api/me` returns `{ user: { id, email, role } }`; without cookie returns 401.
  Code paths for all three ACs are wired and pass typecheck/lint/build; no implementation gap blocks the manual run.

## Tests Written

None. No test framework is configured in `apps/web` yet. The only new pure logic is `resolveRole()` (a 3-line discriminator). When a test runner lands (likely via a future infra issue), add a unit test asserting each valid role passes through and that unknown / missing values fall back to `contributor`.

## Acceptance Criteria

- [x] LEX-64 AC #1 — ADR `docs/adr/0001-managed-auth.md` documents provider, cost model, migration path.
- [x] LEX-64 AC #2 — `/api/me` returns the authenticated user (code wired; verified via build + types; runtime verification needs real Clerk keys).
- [x] LEX-64 AC #3 — `/dashboard` is matched by `clerkMiddleware` `auth.protect()` and redirects unauthenticated requests to `/sign-in`.
- [x] `pnpm --filter web typecheck`, `lint`, `build` all pass.
- [x] No secrets committed; only `.env.example` is tracked.
