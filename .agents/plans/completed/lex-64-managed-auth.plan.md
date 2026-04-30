# Plan: Choose & integrate managed auth (Clerk)

## Summary

Adopt **Clerk** as the managed auth provider for Veritasee Override and wire it into `apps/web` so protected routes redirect to sign-in, valid credentials issue a session cookie, and `/api/me` returns the authenticated user. Decision and rationale are captured in an ADR before any code change. The integration uses `@clerk/nextjs` v6+ with the App Router middleware, scoping RBAC roles (Reader/Contributor/Moderator/Admin) onto Clerk session claims via `publicMetadata.role`.

## User Story

As an admin, I want managed auth so contributors and moderators sign in safely without us owning password storage.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `apps/web` (App Router, middleware, env), `docs/adr` (new) |
| Linear Issue | LEX-64 |

## Recommendation Rationale (for the ADR)

**Choose Clerk over Auth0** for v1:

- **Next.js fit.** `@clerk/nextjs` ships first-class App Router primitives (`clerkMiddleware`, `auth()`, `<ClerkProvider>`, prebuilt `<SignIn/>`/`<SignUp/>` route components). Auth0's Next.js SDK works but is more configuration-heavy and lags App Router primitives.
- **Time-to-running.** Clerk gets sign-in + protected routes + `/me` in <1 day; Auth0 typically needs custom callback wiring + JWT validation helpers.
- **RBAC.** PRD roles (Reader/Contributor/Moderator/Admin) map cleanly onto Clerk `publicMetadata.role` exposed via session claims; no extra rules engine needed at v1. Reader is anonymous (no session) per PRD §3.
- **Cost.** Clerk free tier covers ≤10k MAU, sufficient through v1/v1.1 closed-beta scope. Auth0 free tier is 25k MAU but with fewer prebuilt UI features. Cost will be re-evaluated at v1.2 once contributor authoring is open.
- **Migration path.** Both vendors expose user export via Backend API. ADR documents that switching cost is bounded: replace `@clerk/nextjs` middleware + `auth()` reads with vendor equivalents; user identity travels via stable `external_id` we mirror into our Postgres `users` table when LEX-XX (DB schema) lands.

**Tradeoff accepted:** Clerk is a smaller vendor than Auth0; if enterprise SSO/compliance becomes a hard requirement post-v1.2, we re-evaluate.

---

## Patterns to Follow

The repo is a fresh Next.js 15 App Router scaffold; there are no prior auth patterns to mirror. We follow Clerk's official Next.js App Router integration (docs current as of 2026-04). Snippets below are the canonical shape we will apply.

### Root provider (App Router)

```tsx
// SOURCE: clerk docs — apps/web/src/app/layout.tsx (target)
import { ClerkProvider } from '@clerk/nextjs';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

### Middleware (protected matcher)

```ts
// SOURCE: clerk docs — apps/web/src/middleware.ts (target)
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtected = createRouteMatcher(['/dashboard(.*)', '/api/me']);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
};
```

### Server-side identity read (`/api/me`)

```ts
// SOURCE: clerk docs — apps/web/src/app/api/me/route.ts (target)
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { resolveRole } from '@/lib/auth/roles';

export async function GET() {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ user: null }, { status: 401 });
  const user = await currentUser();
  return NextResponse.json({
    user: {
      id: userId,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      role: resolveRole(sessionClaims),
    },
  });
}
```

### Roles helper

```ts
// SOURCE: PRD §3 — apps/web/src/lib/auth/roles.ts (target)
export type Role = 'reader' | 'contributor' | 'moderator' | 'admin';
export const DEFAULT_ROLE: Role = 'contributor';
export function resolveRole(claims: { metadata?: { role?: string } } | null | undefined): Role {
  const r = claims?.metadata?.role;
  return r === 'admin' || r === 'moderator' || r === 'contributor' || r === 'reader' ? r : DEFAULT_ROLE;
}
```

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `docs/adr/0001-managed-auth.md` | CREATE | ADR documenting Clerk decision, cost, migration path (AC #1) |
| `docs/adr/README.md` | CREATE | Tiny ADR index so future ADRs have a home |
| `apps/web/package.json` | UPDATE | Add `@clerk/nextjs` dependency |
| `apps/web/.env.example` | CREATE | Document required Clerk env vars |
| `apps/web/src/middleware.ts` | CREATE | `clerkMiddleware` + protected matcher (AC #3) |
| `apps/web/src/app/layout.tsx` | UPDATE | Wrap tree in `<ClerkProvider>`, add header w/ `<UserButton/>` + `<SignedIn/>`/`<SignedOut/>` |
| `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx` | CREATE | Hosted Clerk sign-in component |
| `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx` | CREATE | Hosted Clerk sign-up component |
| `apps/web/src/app/dashboard/page.tsx` | CREATE | Protected page used to validate redirect (AC #3) |
| `apps/web/src/app/api/me/route.ts` | CREATE | `/me` endpoint returning user + role (AC #2) |
| `apps/web/src/lib/auth/roles.ts` | CREATE | `Role` type + `resolveRole` helper (PRD §3) |
| `apps/web/next.config.ts` | UPDATE (only if Clerk requires it; likely no-op) | Confirm no extra config needed |
| `.gitignore` | UPDATE | Ensure `.env.local` ignored (verify; add if missing) |

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Write ADR 0001 — Managed Auth

- **File**: `docs/adr/0001-managed-auth.md`, `docs/adr/README.md`
- **Action**: CREATE
- **Implement**: Standard ADR (Context / Decision / Consequences). Cover: chosen provider (Clerk), alternatives considered (Auth0), cost model (Clerk free tier ≤10k MAU; growth tier pricing snapshot dated 2026-04), RBAC mapping to PRD §3 roles via `publicMetadata.role`, anonymous Reader handling, migration path (mirror `external_id` into our future `users` table; vendor swap touches only `middleware.ts` + `auth()` reads), security posture (no password storage, MFA available, session cookie set by Clerk).
- **Mirror**: No prior ADR — follow MADR-lite structure documented inline in `docs/adr/README.md`.
- **Validate**: AC #1 met — reviewer can read provider/cost/migration in one file.

### Task 2: Add Clerk dependency

- **File**: `apps/web/package.json`
- **Action**: UPDATE
- **Implement**: Add `"@clerk/nextjs": "^6.0.0"` to `dependencies`. Run `pnpm install` from repo root.
- **Validate**: `pnpm install` succeeds; `pnpm-lock.yaml` updated.

### Task 3: Document required environment

- **File**: `apps/web/.env.example`
- **Action**: CREATE
- **Implement**: List `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=`, `CLERK_SECRET_KEY=`, plus optional `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard`. Verify `.env*.local` already gitignored by Next defaults; add to `.gitignore` if missing.
- **Validate**: `git status` shows no real env file tracked.

### Task 4: Add roles helper

- **File**: `apps/web/src/lib/auth/roles.ts`
- **Action**: CREATE
- **Implement**: Per snippet above. Export `Role`, `DEFAULT_ROLE`, `resolveRole`. Configure path alias `@/*` in `apps/web/tsconfig.json` if not already present (verify; current `tsconfig.json` is 353 bytes and may not include it — add `"paths": { "@/*": ["./src/*"] }` and `"baseUrl": "."` if absent).
- **Validate**: `pnpm --filter web typecheck`.

### Task 5: Add middleware

- **File**: `apps/web/src/middleware.ts`
- **Action**: CREATE
- **Implement**: Per snippet above. Protected matchers: `/dashboard(.*)`, `/api/me`. Default `config.matcher` excludes static assets and `_next`.
- **Validate**: `pnpm --filter web typecheck`. Manual: hitting `/dashboard` without a session redirects to `/sign-in?redirect_url=...` (AC #3).

### Task 6: Wrap app in ClerkProvider + header

- **File**: `apps/web/src/app/layout.tsx`
- **Action**: UPDATE
- **Implement**: Import `ClerkProvider`, `SignedIn`, `SignedOut`, `SignInButton`, `UserButton` from `@clerk/nextjs`. Wrap `<html>` in `<ClerkProvider>`. Add a minimal header inside `<body>` rendering `<SignedOut><SignInButton/></SignedOut>` and `<SignedIn><UserButton/></SignedIn>` so the auth state is visible during manual verification. Keep existing Tailwind classes.
- **Validate**: `pnpm --filter web build` succeeds.

### Task 7: Add sign-in / sign-up routes

- **File**: `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`, `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx`
- **Action**: CREATE
- **Implement**: Render `<SignIn />` and `<SignUp />` from `@clerk/nextjs` inside a centered Tailwind container. Catch-all segment is required by Clerk.
- **Validate**: Visiting `/sign-in` shows the Clerk widget. After signing in with a test user, browser holds a Clerk session cookie (`__session`).

### Task 8: Add `/api/me` route

- **File**: `apps/web/src/app/api/me/route.ts`
- **Action**: CREATE
- **Implement**: Per snippet above. Returns `{ user: { id, email, role } }` for authenticated requests, `{ user: null }` with 401 otherwise.
- **Validate**: `curl -b cookies.txt http://localhost:3000/api/me` after sign-in returns the user JSON; without cookie returns 401 (AC #2).

### Task 9: Add protected `/dashboard` page

- **File**: `apps/web/src/app/dashboard/page.tsx`
- **Action**: CREATE
- **Implement**: Server component. Reads `auth()`; renders a simple "Signed in as {email} — role: {role}" card. Middleware enforces the redirect; this page exists so the redirect has a real destination.
- **Validate**: Logged-out browser hitting `/dashboard` is redirected to `/sign-in` (AC #3).

### Task 10: Manual end-to-end verification

- **File**: n/a
- **Action**: Run dev server.
- **Implement**: `pnpm dev`. With Clerk dev keys in `apps/web/.env.local`, walk the three acceptance criteria:
  1. ADR present and reviewed.
  2. Sign in → Clerk session cookie present → `/api/me` returns user.
  3. Sign out → `/dashboard` redirects to `/sign-in`.
- **Validate**: All three ACs pass; capture findings in PR description.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Clerk session cookies not set on `localhost` due to domain mismatch | Use Clerk's "Development" instance; confirm Frontend API URL configured for localhost. |
| `tsconfig.json` lacks `@/*` alias, breaking imports | Task 4 verifies and adds the alias if missing. |
| Adding ClerkProvider triggers SSR hydration warnings | Provider is server-safe; keep it as the outermost wrapper around `<html>` per Clerk docs. |
| Future DB needs a stable user reference | ADR commits to mirroring Clerk `userId` as `external_id` when the users table lands; no DB work in this issue. |
| Vendor lock-in concern | ADR documents bounded migration surface (middleware + `auth()` reads). |
| Reader role is anonymous (PRD §3) | Middleware protects only authoring/moderation routes; Reader paths stay public. |

---

## Validation

```bash
# From repo root
pnpm install
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web build
# No test command configured yet — manual E2E per Task 10.
```

---

## Acceptance Criteria

- [ ] ADR `docs/adr/0001-managed-auth.md` documents provider, cost model, migration path (LEX-64 AC #1).
- [ ] Sign-in with valid credentials issues a Clerk session cookie and `/api/me` returns the user (LEX-64 AC #2).
- [ ] Unauthenticated request to `/dashboard` is redirected to `/sign-in` (LEX-64 AC #3).
- [ ] `pnpm --filter web typecheck`, `lint`, and `build` all pass.
- [ ] No secrets committed; only `.env.example` is tracked.
