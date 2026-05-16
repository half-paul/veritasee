# Plan: URL Entry Form + Scheme/Length/Denylist/SSRF Validation (FR-VW-1)

## Summary

Add the first Phase 1 surface: a server-side URL validation endpoint plus a client form on the
authenticated dashboard. The endpoint enforces the four PRD §5.1 / FR-VW-1 guards — scheme
must be HTTPS, URL must be ≤ 2048 chars, host must not match a configurable denylist, and the
host's resolved IP(s) must not be RFC1918 / loopback / link-local / multicast / broadcast (SSRF
guard). Wraps the existing `withObservability` HOF so rejections flow through the structured
logger and Sentry, and reuses the Clerk `auth()` pattern from `/api/me`. No new validation
framework is introduced (we hand-roll type guards consistent with the rest of the codebase); we
add a single small dependency, `ipaddr.js`, only to range-check IPv4 + IPv6 addresses safely.

## User Story

As a contributor
I want a dashboard URL entry form that rejects bad/dangerous URLs at the API boundary
So that the proxy fetcher (VS-021 / LEX-72+) only ever sees normalized, externally-reachable HTTPS URLs and the system cannot be coerced into fetching internal infrastructure.

## Metadata

| Field            | Value                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Type             | NEW_CAPABILITY                                                                                                                 |
| Complexity       | MEDIUM                                                                                                                         |
| Systems Affected | `apps/web` (new API route, new lib module, new client form, dashboard page update, env example update)                         |
| Linear Issue     | LEX-71 (inferred — maps to story `VS-020 — URL entry form + scheme/length/denylist validation (FR-VW-1)`; Linear MCP was unavailable in the planning session, so the next-in-sequence mapping LEX-63→VS-001 … LEX-70→VS-007 → LEX-71→VS-020 was used. Verify on Linear before implementing.) |
| Spec sources     | `docs/PRD.md` §5.1 FR-VW-1; `.agents/stories/PRD-linear-issues.md:143-156`                                                     |

---

## Acceptance Criteria (verbatim from VS-020)

- [ ] Given a non-HTTPS URL, when submitted, then the API returns **400** with a clear message.
- [ ] Given a denylisted domain, when submitted, then **403** is returned **and the attempt is logged**.
- [ ] Given a URL > 2048 chars, when submitted, then **400** is returned.
- [ ] Given an internal-IP URL, when submitted, then it is **blocked (SSRF guard)**.

Implied / derived:

- [ ] Given a valid URL, when submitted, then **200** is returned with `{ ok: true, normalizedUrl, hostname }`.
- [ ] Given a request with no Clerk session, when submitted, then **401** is returned (mirrors `/api/me`).
- [ ] All rejections emit a `logger.warn` line with `event`, `code`, `hostname`, `request_id`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass at the repo root.

---

## Approach & Design Decisions

### 1. API path — `/api/proxy/validate` (not `/api/validate-url`)

VS-021 will add `/api/proxy/fetch` and VS-022 a cache; namespacing under `/api/proxy/` keeps the
proxy pipeline grouped. Mirrors how `/api/health/*` groups health checks.

### 2. Auth — gate the endpoint with Clerk `auth()`, copy the `/api/me` pattern

The dashboard is the only caller for v1; the future MV3 extension calls a different read-API
(`/api/overrides`, VS-033) and never POSTs URLs. Gating closes the open-internet attack surface.
The endpoint must check `auth()` explicitly because middleware only protects `/dashboard(.*)`,
not `/api/proxy/*` — see `apps/web/src/middleware.ts:4`.

```ts
// SOURCE: apps/web/src/app/api/me/route.ts:7-10
const { userId, sessionClaims } = await auth();
if (!userId) {
  return NextResponse.json({ user: null }, { status: 401 });
}
```

### 3. No validator framework (no `zod`)

A grep across `apps/web/` and `packages/*/package.json` returned zero hits for `zod`, `yup`,
`joi`, or `superstruct`. The codebase hand-rolls type guards (see request-body shape note
below). LEX-71 stays consistent: a 10-line `parseBody()` guard, no new dep for shape validation.

### 4. One new dependency: `ipaddr.js` (range checks only)

IPv6 range parsing is easy to get subtly wrong (ULA `fc00::/7`, link-local `fe80::/10`,
`::1`, `::ffff:10.x.x.x` IPv4-mapped). `ipaddr.js` is the de-facto Node library for this — zero
deps, ~30 KB, MIT, used by Express's `trust proxy` internals. Document in the plan and PR.

Alternative considered: hand-rolling. Rejected because IPv4-mapped IPv6 (`::ffff:192.168.1.1`)
must be detected as private; getting that right by hand is fragile. The cost of `ipaddr.js`
(one supply-chain dep, ~30 KB) is lower than the risk of a missed SSRF vector.

### 5. DNS resolution strategy

Use `dns.promises.lookup(host, { all: true, verbatim: true })` to get **all** A and AAAA records
in one call, then range-check each. If `host` already parses as an IP literal (`ipaddr.isValid`),
skip DNS and check the literal directly.

**Out of scope for LEX-71**: DNS-rebinding pinning during fetch. That belongs in VS-021 (the
fetcher), which must resolve once and connect to the exact resolved IP — a separate concern
from input validation. We document this gap explicitly in the risks section.

### 6. Denylist source — committed seed + env override

For v1 we ship a small `DEFAULT_DENYLIST` constant in code (curated by the project — empty
array is acceptable to start; we add Wikipedia/Britannica explicitly **not** as denied) plus
an env-var `URL_DENYLIST_EXTRA` (comma-separated hostnames) so ops can add domains without a
redeploy. Wildcard / suffix matching: a hostname is denied if it equals an entry OR ends with
`.${entry}`. External feed integration (Spamhaus / adult lists) is explicitly deferred to a
later issue per VS-020 Technical Notes ("configurable") — captured as a risk.

### 7. Runtime — `nodejs`, not edge

`dns.promises.lookup` is a Node built-in; the Edge Runtime ships a different DNS surface.
Set `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'` on the
route, matching every existing API route in the repo.

### 8. Response shape — flat, consistent with health checks plus a `code` field

Health routes return `{ ok: boolean, error?: string }`. This endpoint needs a machine-readable
reason so the form can render a localized/tailored message and ops can grep logs by code.
Extend (not replace) the shape with a flat `code` field:

| Status | Body                                                                                                                | When                                |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 200    | `{ ok: true, normalizedUrl: string, hostname: string }`                                                             | Passes all checks                   |
| 400    | `{ ok: false, code: 'invalid_body' \| 'invalid_url' \| 'invalid_scheme' \| 'too_long', error: string }`             | Malformed body, parse failure, non-HTTPS, > 2048 chars |
| 401    | `{ ok: false, code: 'unauthenticated', error: 'Sign-in required.' }`                                                | No Clerk session                    |
| 403    | `{ ok: false, code: 'denylisted' \| 'private_ip', error: string }`                                                  | Host on denylist / resolves private |
| 503    | `{ ok: false, code: 'dns_failure', error: 'Could not resolve host.' }`                                              | DNS lookup throws                   |

Flat `code` (not nested object) so existing log/Sentry tags read it uniformly.

### 9. Form lives on `/dashboard`

PRD §5.1 says "The dashboard accepts any HTTP(S) URL." The dashboard route is already
auth-protected by `apps/web/src/middleware.ts:4`. We extend the existing
`apps/web/src/app/dashboard/page.tsx` to render a new client component
`<UrlEntryForm />` below the existing user info card; no new route file needed.

### 10. Tests

`apps/web` has no test framework configured today (`packages/*` use Vitest, but the app
package does not — confirmed by exploration). Per AGENTS.md:37 the required verification set is
`pnpm lint`, `pnpm typecheck`, `pnpm build`. We add a follow-up risk noting the gap;
introducing Vitest to `apps/web` is its own issue (not LEX-71).

---

## Patterns to Follow

### API route shape + observability wrapper

```ts
// SOURCE: apps/web/src/app/api/health/db/route.ts:1-23
import { NextResponse, type NextRequest } from 'next/server';
import { getDb, sql } from '@veritasee/db';
import { withObservability } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(_req: NextRequest) {
  try {
    // ... logic ...
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}

export const GET = withObservability(handler);
```

### Auth gate (Clerk)

```ts
// SOURCE: apps/web/src/app/api/me/route.ts:1-10
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

async function handler(_req: NextRequest) {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  // ...
}
```

### Structured warn log (denylist / SSRF rejections)

```ts
// SOURCE: apps/web/src/lib/observability/withObservability.ts:17-26 (extracts request_id)
// + apps/web/src/lib/observability/logger.ts:21-27 (.warn signature)
logger.warn('url_validation_reject', {
  event: 'url_validation_reject',
  code: 'denylisted',           // or 'private_ip' | 'invalid_scheme' | 'too_long'
  hostname,
  url_length: rawUrl.length,
  request_id: req.headers.get('x-request-id') ?? undefined,
});
```

Note: do **not** log the full raw URL. We log `hostname` + `url_length` to avoid leaking
query strings (the logger module comment at
`apps/web/src/lib/observability/logger.ts:1-5` explicitly forbids logging search strings).

### Client component (form)

```tsx
// SOURCE: only existing client component pattern in apps/web — apps/web/src/app/global-error.tsx:1-6
'use client';

import { useState } from 'react';
// ... etc
```

Tailwind class style mirrors `apps/web/src/app/dashboard/page.tsx:13-15` (`rounded-lg`,
`border border-black/10`, `text-sm text-black/60`).

### Env var style

Mirror the comment-heavy block style of `apps/web/.env.example:30-43` (one paragraph per
section explaining purpose + caveats).

---

## Files to Change

| File                                                                  | Action | Purpose                                                                            |
| --------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `apps/web/package.json`                                               | UPDATE | Add `ipaddr.js` dep                                                                |
| `apps/web/src/lib/url-validation/types.ts`                            | CREATE | `ValidationOk`, `ValidationError`, `ValidationResult` discriminated union          |
| `apps/web/src/lib/url-validation/denylist.ts`                         | CREATE | `DEFAULT_DENYLIST`, `loadDenylist()` (merges env extras), `isDenylisted(host)`     |
| `apps/web/src/lib/url-validation/privateIp.ts`                        | CREATE | `isPrivateAddress(ip)` — wraps `ipaddr.js` range checks; covers RFC1918/loopback/link-local/multicast/broadcast/IPv4-mapped IPv6 |
| `apps/web/src/lib/url-validation/resolveHost.ts`                      | CREATE | `resolveHost(host)` — uses `dns.promises.lookup(host, { all: true })`              |
| `apps/web/src/lib/url-validation/validateUrl.ts`                      | CREATE | Pure orchestrator: scheme → length → parse → denylist → resolve → privateIp        |
| `apps/web/src/lib/url-validation/index.ts`                            | CREATE | Barrel export                                                                      |
| `apps/web/src/app/api/proxy/validate/route.ts`                        | CREATE | POST handler: parse body → auth gate → validateUrl → map result to response        |
| `apps/web/src/app/dashboard/components/UrlEntryForm.tsx`              | CREATE | Client form: input + submit + render error/success                                 |
| `apps/web/src/app/dashboard/page.tsx`                                 | UPDATE | Render `<UrlEntryForm />` below existing user card                                 |
| `apps/web/.env.example`                                               | UPDATE | Document `URL_DENYLIST_EXTRA` (optional)                                           |
| `pnpm-lock.yaml`                                                      | UPDATE | Regenerated by `pnpm install` after dep add                                        |

---

## Dependency Order

1. Add `ipaddr.js` dependency (Task 1)
2. Build the `lib/url-validation/*` module bottom-up: types → denylist → privateIp → resolveHost → validateUrl → index (Tasks 2–7)
3. Wire the API route (Task 8)
4. Build the client form (Task 9)
5. Embed it on the dashboard (Task 10)
6. Document env var (Task 11)
7. Validate (Task 12)

The pure-function modules (Tasks 2–6) have no inter-dependencies on each other except for the
final orchestrator `validateUrl.ts` (Task 6) which imports the previous four. Tasks 8–10
depend on the lib being complete.

---

## Risks & Mitigations

| Risk                                                                                                       | Mitigation                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DNS rebinding**: a host's IP can change between this validation pass and the later fetch (VS-021).        | Out of scope for LEX-71. Document in the API route file (top-of-file comment) and in the VS-021 plan: the fetcher must pin to the resolved IP at validation time or re-validate. |
| **IPv4-mapped IPv6** (`::ffff:10.0.0.1`) bypasses naive IPv4-only checks.                                   | Use `ipaddr.js` which exposes `.toIPv4Address()` on `ipv4Mapped` addresses; check both representations.                                                                          |
| **Public DNS resolver returns stale / poisoned results.**                                                   | Accept for v1 (Vercel uses a reliable resolver). Track as a known limitation in `docs/adr/` if it bites; not in this issue's scope.                                              |
| **Denylist is empty in v1 — feature ships but does nothing observable for the denylist AC.**                | The AC requires that *given* a denylisted domain, it's 403'd — we satisfy this with `URL_DENYLIST_EXTRA` env support and one or two seed entries (`localhost`, `metadata.google.internal`) to prove the code path. External feed integration is a separate issue. |
| **No app-layer tests in `apps/web`** — regressions in `validateUrl` are not caught by CI beyond typecheck.  | Note as follow-up. The lib is pure functions; converting to a Vitest setup later is mechanical. Risk accepted for this issue.                                                    |
| **Request body parsing without a schema lib** — easy to drift over time.                                    | Centralize in one `parseBody()` helper inside the route; keep the type guard < 15 lines. If this pattern repeats, the next issue should introduce a shared validator (or zod).   |
| **Edge runtime accidentally re-enabled** breaks `dns.promises.lookup`.                                      | `export const runtime = 'nodejs'` at the top of the route; comment explains why.                                                                                                 |
| **Misclassifying a public CDN as private** (false positive on AC).                                          | The private-IP list is closed: RFC1918, 127.0.0.0/8, 169.254.0.0/16, 224.0.0.0/4, 240.0.0.0/4, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`. Public CDN IPs do not fall in these. Unit-test boundaries (deferred until Vitest lands). |

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Add `ipaddr.js` dependency

- **File**: `apps/web/package.json`
- **Action**: UPDATE
- **Implement**:
  - From repo root run: `pnpm --filter ./apps/web add ipaddr.js`
  - Confirm `apps/web/package.json` `dependencies` now lists `"ipaddr.js": "^2.x"`.
  - `pnpm-lock.yaml` regenerates at root — commit both.
- **Mirror**: dep-add pattern from `LEX-67` (commit `a56f6ce`) — single dep, lockfile change.
- **Validate**: `pnpm install` clean; `pnpm typecheck` still passes (no usages yet).

### Task 2: Create `lib/url-validation/types.ts`

- **File**: `apps/web/src/lib/url-validation/types.ts`
- **Action**: CREATE
- **Implement**:
  - Export a discriminated union:
    ```ts
    export type ValidationError =
      | { code: 'invalid_body'; message: string }
      | { code: 'invalid_url'; message: string }
      | { code: 'invalid_scheme'; message: string }
      | { code: 'too_long'; message: string }
      | { code: 'denylisted'; message: string; hostname: string }
      | { code: 'private_ip'; message: string; hostname: string; address: string }
      | { code: 'dns_failure'; message: string; hostname: string };

    export type ValidationOk = {
      ok: true;
      normalizedUrl: string;
      hostname: string;
    };

    export type ValidationResult =
      | ValidationOk
      | ({ ok: false } & ValidationError);

    export const MAX_URL_LENGTH = 2048;
    ```
- **Mirror**: Type-only modules in `packages/db/src/schema/*` and the inline shape in `apps/web/src/lib/auth/roles.ts:1-3`.
- **Validate**: `pnpm typecheck` passes.

### Task 3: Create `lib/url-validation/denylist.ts`

- **File**: `apps/web/src/lib/url-validation/denylist.ts`
- **Action**: CREATE
- **Implement**:
  - `DEFAULT_DENYLIST: ReadonlyArray<string>` — initial seed:
    ```ts
    export const DEFAULT_DENYLIST = [
      'localhost',
      'metadata.google.internal',
      'metadata.aws.internal',
      '169.254.169.254',
    ] as const;
    ```
  - `loadDenylist(): ReadonlySet<string>` — reads `process.env.URL_DENYLIST_EXTRA` (CSV),
    trims, lowercases, dedupes with seed.
  - `isDenylisted(hostname: string, list: ReadonlySet<string>): boolean` — case-insensitive;
    matches exact host or any `*.${entry}` suffix.
  - Module-level memo: compute the set once, on first call (export `clearDenylistCache()` for tests later).
- **Mirror**: Lowercase + suffix-match pattern is standard; comment style mirrors `apps/web/src/lib/observability/env.ts:1-10`.
- **Validate**: `pnpm typecheck` passes; `pnpm lint` clean.

### Task 4: Create `lib/url-validation/privateIp.ts`

- **File**: `apps/web/src/lib/url-validation/privateIp.ts`
- **Action**: CREATE
- **Implement**:
  ```ts
  import ipaddr from 'ipaddr.js';

  // Ranges we consider non-routable / not allowed as proxy targets.
  // Covers RFC1918, loopback, link-local, multicast, broadcast, reserved,
  // and IPv6 equivalents (loopback, ULA, link-local, multicast).
  const PRIVATE_IPV4_RANGES: ReadonlyArray<ipaddr.RangeList<ipaddr.IPv4>[string]> = [];

  export function isPrivateAddress(address: string): boolean {
    let addr: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      addr = ipaddr.parse(address);
    } catch {
      // Unparseable input is treated as private (fail-closed).
      return true;
    }
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
      addr = (addr as ipaddr.IPv6).toIPv4Address();
    }
    const range = addr.range();
    // ipaddr.js range() returns labels: 'unicast', 'private', 'loopback',
    // 'linkLocal', 'multicast', 'reserved', 'broadcast', 'carrierGradeNat',
    // 'uniqueLocal', etc. Only 'unicast' (public) is allowed.
    return range !== 'unicast';
  }
  ```
- **Mirror**: Small focused module pattern; see `apps/web/src/lib/observability/env.ts`.
- **Validate**: `pnpm typecheck`; `pnpm lint`. (Behavioural tests deferred — see risks.)

### Task 5: Create `lib/url-validation/resolveHost.ts`

- **File**: `apps/web/src/lib/url-validation/resolveHost.ts`
- **Action**: CREATE
- **Implement**:
  ```ts
  import { promises as dns } from 'node:dns';
  import ipaddr from 'ipaddr.js';

  export type ResolveResult =
    | { ok: true; addresses: ReadonlyArray<string> }
    | { ok: false; reason: 'lookup_failed' };

  export async function resolveHost(hostname: string): Promise<ResolveResult> {
    // If the hostname is already an IP literal, skip DNS.
    if (ipaddr.isValid(hostname)) {
      return { ok: true, addresses: [hostname] };
    }
    try {
      const records = await dns.lookup(hostname, { all: true, verbatim: true });
      return { ok: true, addresses: records.map((r) => r.address) };
    } catch {
      return { ok: false, reason: 'lookup_failed' };
    }
  }
  ```
  - Do not log here — let the caller decide what to log.
- **Mirror**: Return discriminated-union result, matching the style of `ValidationResult` in Task 2.
- **Validate**: `pnpm typecheck`; `pnpm lint`.

### Task 6: Create `lib/url-validation/validateUrl.ts`

- **File**: `apps/web/src/lib/url-validation/validateUrl.ts`
- **Action**: CREATE
- **Implement**:
  - Export `async function validateUrl(input: string): Promise<ValidationResult>`.
  - Steps, in order (short-circuit on first failure):
    1. `if (typeof input !== 'string' || input.length === 0)` → `{ ok: false, code: 'invalid_url', message: 'URL is required.' }`.
    2. `if (input.length > MAX_URL_LENGTH)` → `too_long`.
    3. `let parsed: URL; try { parsed = new URL(input); } catch { return invalid_url; }`
    4. `if (parsed.protocol !== 'https:')` → `invalid_scheme` (message: "Only HTTPS URLs are accepted.").
    5. `const hostname = parsed.hostname.toLowerCase();` — empty string → `invalid_url`.
    6. `if (isDenylisted(hostname, loadDenylist()))` → `denylisted`.
    7. `const resolved = await resolveHost(hostname);` → if `!resolved.ok` → `dns_failure`.
    8. For each `address` in `resolved.addresses`: if `isPrivateAddress(address)` → `private_ip` (include the offending address).
    9. Otherwise: normalize (`parsed.toString()`) and return `{ ok: true, normalizedUrl, hostname }`.
  - No I/O outside `resolveHost` — pure orchestration.
- **Mirror**: Pure-function orchestrator pattern; see `apps/web/src/lib/auth/roles.ts:7-15` for shape (one function, several typed branches).
- **Validate**: `pnpm typecheck`; `pnpm lint`.

### Task 7: Create `lib/url-validation/index.ts`

- **File**: `apps/web/src/lib/url-validation/index.ts`
- **Action**: CREATE
- **Implement**:
  ```ts
  export { validateUrl } from './validateUrl';
  export {
    isDenylisted,
    loadDenylist,
    DEFAULT_DENYLIST,
  } from './denylist';
  export { isPrivateAddress } from './privateIp';
  export type {
    ValidationOk,
    ValidationError,
    ValidationResult,
  } from './types';
  export { MAX_URL_LENGTH } from './types';
  ```
- **Mirror**: `apps/web/src/lib/observability/index.ts:1-3`.
- **Validate**: `pnpm typecheck`.

### Task 8: Create `app/api/proxy/validate/route.ts`

- **File**: `apps/web/src/app/api/proxy/validate/route.ts`
- **Action**: CREATE
- **Implement**:
  ```ts
  import { auth } from '@clerk/nextjs/server';
  import { NextResponse, type NextRequest } from 'next/server';
  import { logger, withObservability } from '@/lib/observability';
  import { validateUrl } from '@/lib/url-validation';

  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';

  // Top-of-file note: validation here is best-effort against SSRF at the
  // moment of submission. The fetcher (VS-021) MUST re-resolve and pin to
  // the resolved IP at fetch time to defeat DNS rebinding between this
  // validation and the actual fetch.

  type Body = { url?: unknown };

  async function handler(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, code: 'unauthenticated', error: 'Sign-in required.' },
        { status: 401 },
      );
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json(
        { ok: false, code: 'invalid_body', error: 'Request body must be JSON.' },
        { status: 400 },
      );
    }
    const raw = body?.url;
    if (typeof raw !== 'string') {
      return NextResponse.json(
        { ok: false, code: 'invalid_body', error: 'Body must include a string "url" field.' },
        { status: 400 },
      );
    }

    const result = await validateUrl(raw);
    if (result.ok) {
      return NextResponse.json({
        ok: true,
        normalizedUrl: result.normalizedUrl,
        hostname: result.hostname,
      });
    }

    // Map ValidationError → HTTP status
    const status =
      result.code === 'denylisted' || result.code === 'private_ip'
        ? 403
        : result.code === 'dns_failure'
          ? 503
          : 400;

    const requestId = req.headers.get('x-request-id') ?? undefined;
    logger.warn('url_validation_reject', {
      event: 'url_validation_reject',
      code: result.code,
      hostname: 'hostname' in result ? result.hostname : undefined,
      url_length: raw.length,
      user_id: userId,
      request_id: requestId,
    });

    return NextResponse.json(
      { ok: false, code: result.code, error: result.message },
      { status },
    );
  }

  export const POST = withObservability(handler);
  ```
- **Mirror**: `apps/web/src/app/api/me/route.ts:1-22` (auth gate + structured response) and
  `apps/web/src/app/api/health/db/route.ts:1-23` (`runtime`, `dynamic`, `withObservability`).
- **Validate**: `pnpm typecheck`; `pnpm lint`; `pnpm build` (route compiles).

### Task 9: Create `<UrlEntryForm />` client component

- **File**: `apps/web/src/app/dashboard/components/UrlEntryForm.tsx`
- **Action**: CREATE
- **Implement**:
  - `'use client';` at the top.
  - `useState` for `url`, `error`, `result`, `pending`.
  - On submit (form `onSubmit`), POST to `/api/proxy/validate` with `{ url }`, `Content-Type: application/json`.
  - On non-2xx: set `error` to the response's `error` string (fallback to a generic message).
  - On 2xx: render the `normalizedUrl` and `hostname` in a success card. (Do not navigate anywhere — VS-020 only validates; the proxy view is VS-021+.)
  - Disable submit while `pending`.
  - Tailwind: mirror the `rounded-lg border border-black/10 p-4` card style used in
    `apps/web/src/app/dashboard/page.tsx:13`. Form input gets a subtle border + focus ring;
    error in `text-red-600`, success in `text-emerald-700`.
  - Client-side guard rails (just UX — server is authoritative): `maxLength={2048}` on the
    input; `type="url"` to get browser-level scheme prompts.
- **Mirror**: only existing `'use client'` example is `apps/web/src/app/global-error.tsx:1-6` — copy the directive position. Use plain `fetch` (no SWR / React Query — none in the codebase yet).
- **Validate**: `pnpm typecheck`; `pnpm lint`; `pnpm build`.

### Task 10: Render the form on `/dashboard`

- **File**: `apps/web/src/app/dashboard/page.tsx`
- **Action**: UPDATE
- **Implement**:
  - Import `UrlEntryForm` from `./components/UrlEntryForm`.
  - Add a new section below the existing user info card:
    ```tsx
    <section className="mt-6">
      <h2 className="text-lg font-medium">Submit a URL</h2>
      <p className="mt-1 text-sm text-black/60">
        Submit an HTTPS article URL to validate it before viewing.
      </p>
      <div className="mt-3">
        <UrlEntryForm />
      </div>
    </section>
    ```
  - Do **not** change the existing user/role card.
- **Mirror**: existing dashboard markup at `apps/web/src/app/dashboard/page.tsx:11-18`.
- **Validate**: `pnpm dev` renders `/dashboard` without runtime errors; `pnpm build`.

### Task 11: Document `URL_DENYLIST_EXTRA` in `.env.example`

- **File**: `apps/web/.env.example`
- **Action**: UPDATE
- **Implement**: append a new section in the same comment-rich style:
  ```
  # URL validation — proxy denylist (see VS-020 / LEX-71)
  # Comma-separated list of additional hostnames to reject at the proxy
  # validation endpoint (POST /api/proxy/validate). Matches are case-
  # insensitive and apply to the exact host or any subdomain. The default
  # denylist (cloud metadata endpoints, localhost) is hardcoded; this var
  # only adds to it. External feeds (Spamhaus, adult lists) are a later
  # issue.
  # Example: URL_DENYLIST_EXTRA=internal.example.com,evil.test
  URL_DENYLIST_EXTRA=
  ```
- **Mirror**: comment style of the Upstash block at `apps/web/.env.example:37-43`.
- **Validate**: nothing to typecheck; review diff manually.

### Task 12: Full repo verification

- **File**: n/a
- **Action**: VERIFY
- **Implement**: run the required verification set from the repo root.
- **Mirror**: AGENTS.md:37.
- **Validate**: see "Validation" section below — all must pass.

---

## Validation

Run from repo root:

```bash
# Type check (workspace-wide)
pnpm typecheck

# Lint (workspace-wide)
pnpm lint

# Production build (covers Next.js route compilation + Sentry source-map upload skip when unset)
pnpm build

# Tests
# apps/web has no test framework configured yet (AGENTS.md §Testing). Workspace
# packages still run their suites:
pnpm -r test  # safe even if some packages have no test script
```

Manual smoke (with `pnpm dev` running and a signed-in browser session):

```bash
# 200 — well-formed HTTPS URL
curl -sX POST http://localhost:3000/api/proxy/validate \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://en.wikipedia.org/wiki/Apollo_11"}' \
  --cookie "$CLERK_COOKIES"
# expect: {"ok":true,"normalizedUrl":"https://en.wikipedia.org/wiki/Apollo_11","hostname":"en.wikipedia.org"}

# 400 — non-HTTPS
curl -sX POST .../api/proxy/validate -d '{"url":"http://example.com"}' ...
# expect: 400, code "invalid_scheme"

# 400 — too long
curl -sX POST .../api/proxy/validate -d "{\"url\":\"https://$(python3 -c 'print("a"*2050)').com\"}" ...
# expect: 400, code "too_long"

# 403 — denylisted (after setting URL_DENYLIST_EXTRA=evil.test and restarting dev server)
curl ... -d '{"url":"https://evil.test/x"}'
# expect: 403, code "denylisted"

# 403 — private IP (host that resolves to 127.0.0.1, e.g. localhost)
curl ... -d '{"url":"https://localhost/x"}'
# expect: 403, code "private_ip" (or "denylisted" since localhost is in the default list — either is acceptable; private_ip is the SSRF guard demonstration)

# 401 — no Clerk cookie
curl -sX POST http://localhost:3000/api/proxy/validate -d '{"url":"https://example.com"}'
# expect: 401, code "unauthenticated"
```

Manual log inspection (Vercel logs or local stdout):

- `event: url_validation_reject` lines appear with `code`, `hostname`, `request_id` for every 4xx.
- No raw URL strings, no query strings, in the log output.

---

## Acceptance Criteria Checklist

- [ ] All 12 tasks completed.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` pass from repo root.
- [ ] AC1 — non-HTTPS → 400 with `code: 'invalid_scheme'`.
- [ ] AC2 — denylisted host → 403 with `code: 'denylisted'` AND a `url_validation_reject` warn log line.
- [ ] AC3 — URL > 2048 chars → 400 with `code: 'too_long'`.
- [ ] AC4 — internal-IP host (literal or DNS-resolved) → 403 with `code: 'private_ip'`.
- [ ] Auth: unauthenticated POST → 401.
- [ ] Form on `/dashboard` posts to the endpoint and renders success / error.
- [ ] No raw URLs / query strings in log output.
- [ ] `URL_DENYLIST_EXTRA` documented in `apps/web/.env.example`.
- [ ] One commit per logical unit (lib, route, UI, env) or a single coherent feature commit; subject prefix `LEX-71:`.

---

## Out-of-Scope (for explicit reference)

- DNS-rebinding pinning at fetch time → VS-021.
- Spamhaus / external feed denylist integration → later infra issue.
- Rate limiting of validation submissions → not in VS-020; FR-LIM-* covers AI quotas, not URL submissions.
- Caching of validation results in Redis → premature; revisit if `pnpm dev` profiling shows DNS lookup latency matters.
- Vitest setup for `apps/web` → own follow-up issue.
- Wikipedia / encyclopedia detection or canonicalisation → VS-023.
- Same-encyclopedia-domain reference check → VS-052 (FR-CE-3), not URL validation.
