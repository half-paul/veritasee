# ADR 0001 — Managed Auth Provider: Clerk

- **Status:** Accepted
- **Date:** 2026-04-29
- **Linear:** LEX-64

## Context

Veritasee Override needs end-user authentication for Contributors, Moderators, and Admins (PRD §3). Readers are anonymous and never authenticate. The v1 architecture is a single Next.js App Router application backed by managed services; we explicitly do not want to own password storage, MFA, or session-token security.

We need a managed auth provider that:

1. Integrates cleanly with Next.js 15 App Router (middleware, server components, route handlers).
2. Lets us attach our four PRD roles (Reader / Contributor / Moderator / Admin) to user identity without standing up a separate authorization service at v1.
3. Has a free or low-cost tier sufficient for closed-beta usage (target ≤10k MAU through v1.1).
4. Has a bounded migration path so vendor swap, if it becomes necessary, does not require rebuilding the application.

## Decision

We adopt **Clerk** (`@clerk/nextjs` v6+) as the managed auth provider for v1.

- The App Router app uses `clerkMiddleware` to protect authenticated routes (`/dashboard`, `/api/me`, future authoring/moderation routes). Reader-facing public routes are not protected.
- Server-side identity reads use `auth()` and `currentUser()` from `@clerk/nextjs/server`.
- PRD roles are stored on Clerk's `publicMetadata.role` and exposed via session claims. A small `resolveRole()` helper coerces the claim into the `Role` union and falls back to `contributor` when unset.
- Sign-in / sign-up use Clerk's prebuilt `<SignIn />` / `<SignUp />` components mounted at `/sign-in/[[...sign-in]]` and `/sign-up/[[...sign-up]]`.
- When the application's own Postgres `users` table lands (future issue), we will mirror Clerk's `userId` as `external_id` so domain data references a stable internal id, not the vendor's id directly.

## Consequences

**Easier**

- Sign-in, sign-up, MFA, password reset, session management, and a hosted UI are available on day one.
- Role-based authorization decisions can read a single session claim; no separate policy service.
- The team never stores or rotates user passwords.

**Harder / Constrained**

- We depend on Clerk's availability and pricing. If Clerk has an outage, contributors cannot sign in (Readers are unaffected).
- Switching providers later requires replacing `clerkMiddleware`, the `auth()` reads, and the sign-in/sign-up components. We accept this surface area as bounded.
- Clerk is a smaller vendor than Auth0; if enterprise SSO or specific compliance regimes (e.g., FedRAMP) become a hard requirement post-v1.2, we re-evaluate.

## Cost Model

Snapshot dated 2026-04:

- **Free tier:** 10,000 monthly active users, all core auth features, prebuilt components.
- **Pro tier:** ~$25/month base + per-MAU above the free quota; adds advanced organizations and SSO connections.
- **Enterprise SSO / SAML:** quoted per contract.

Closed-beta scope is well inside the free tier. We will revisit at v1.2 once contributor authoring is open to the public.

## RBAC Mapping

PRD §3 roles map onto Clerk session metadata as follows:

| PRD Role | Clerk Source | Notes |
|----------|--------------|-------|
| Reader | (none — anonymous) | No session is required. Public Reader routes are not behind middleware. |
| Contributor | `publicMetadata.role = "contributor"` | Default for newly signed-up users. |
| Moderator | `publicMetadata.role = "moderator"` | Promoted manually via Clerk dashboard or admin tooling. |
| Admin | `publicMetadata.role = "admin"` | Reserved for the operations team. |

`resolveRole()` validates the claim and returns `contributor` for unknown / missing values so a malformed claim never silently grants elevated access.

## Migration Path

If we move off Clerk:

1. Export users via Clerk's Backend API (`/v1/users`).
2. Import into the replacement provider, preserving email and external id.
3. Mirror the new provider's stable id into our `users.external_id` column.
4. Replace `apps/web/src/middleware.ts`, `apps/web/src/app/api/me/route.ts`, and the `<SignIn/>` / `<SignUp/>` route components with vendor equivalents.

Domain code (corrections, moderation, AI verification) references the internal `users.id`, not the Clerk id, so the migration surface stays in the auth slice.

## Alternatives Considered

### Auth0

Mature, larger vendor, generous free tier (25k MAU). Rejected for v1 because:

- App Router integration is more configuration-heavy and lags Clerk's first-class primitives.
- Time-to-running for protected routes + `/me` is materially longer.
- We do not yet need Auth0's enterprise SSO depth; PRD scope is closed beta.

### Self-hosted (NextAuth / Auth.js + custom DB)

Rejected: explicitly violates the "use managed services" principle in `docs/general/SYSTEM-OVERVIEW.md`. Reintroduces password storage and session-cookie security as our problem.

### Supabase Auth

Viable but couples auth to a specific DB vendor. We want auth to remain independent of the eventual Postgres host so we can change either without changing the other.

## Security Posture

- No password material is stored in our systems.
- Clerk handles MFA enrollment, password reset flows, and session-cookie hardening.
- Session is conveyed via the `__session` cookie set on the Clerk Frontend API domain; Next.js middleware validates it on every protected request.
- Role elevation requires a Clerk dashboard change (or future admin-tool action that calls the Clerk Backend API); it cannot be self-assigned by a signed-in user.
