# Plan: MediaWiki API integration for clean section structure

## Summary

Build a server-side MediaWiki API client that extracts structured sections (id, title, level, HTML content) plus a stable revision ID from MediaWiki-compatible sources (Wikipedia, Citizendium, other MediaWiki wikis). Add a source classifier that routes URLs to either the MediaWiki path or a typed fallback stub for non-MediaWiki sources (Britannica, generic web pages). Expose a single `parseArticle(normalizedUrl)` dispatcher and a token-gated health endpoint that smoke-tests the MediaWiki path end-to-end against `en.wikipedia.org`. The actual `/api/proxy/fetch` route handler is out of scope — this plan defines the integration contract for whichever ticket wires it.

## User Story

As a reader,
I want Wikipedia (and other MediaWiki-backed) articles to render with their original section structure preserved,
so that I can navigate the article by heading and pin comments to specific sections by stable anchor.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `apps/web/src/lib/mediawiki/`, `apps/web/src/lib/source-classifier/`, `apps/web/src/lib/parser/`, `apps/web/src/app/api/health/mediawiki/`, `apps/web/.env.example` |
| Linear Issue | LEX-73 ([VS-023] MediaWiki API integration for clean section structure) |
| Linear URL | https://linear.app/lexaim/issue/LEX-73/vs-023-mediawiki-api-integration-for-clean-section-structure |
| Spec Sources | `docs/PRD.md` §FR-VW-3 (line 85), §FR-VW-2 (line 81), §FR-VW-5 (line 89) |
| Depends on | LEX-70 (observability), LEX-71 (URL validation), LEX-72 (proxy cache types) |
| Blocks | the future `/api/proxy/fetch` route ticket |

---

## Acceptance Criteria (verbatim from VS-023)

- [ ] Given a Wikipedia URL, when parsed, then sections are extracted via the MediaWiki API with stable IDs.
- [ ] Given Britannica/Citizendium, when matched as MediaWiki-compatible, then API path is used; otherwise fallback path runs.

### Derived

- [ ] The MediaWiki client emits a typed `ParsedArticle` whose `revisionHash` is suitable as the `expectedRevisionHash` input to `getCachedFresh()` in `@/lib/proxy-cache`.
- [ ] The source classifier correctly maps `*.wikipedia.org`, `*.wikimedia.org`, `*.wiktionary.org`, `en.citizendium.org` to the MediaWiki path; `britannica.com` and other domains to the fallback path.
- [ ] The health endpoint `/api/health/mediawiki` returns `{ ok: true, sections: N, revisionId }` against a known live Wikipedia page.
- [ ] Outbound calls use an explicit timeout, a Veritasee `User-Agent`, and `Accept: application/json`.

---

## Approach & Design Decisions

### 1. Scope — parser modules only; not the proxy fetch route

The `/api/proxy/fetch` route handler does not exist yet. LEX-71 (VS-020) shipped the validation endpoint at `/api/proxy/validate` but explicitly punted the fetcher to a future ticket (see `apps/web/src/app/api/proxy/validate/route.ts:9-12`). LEX-73's scope is the **parser modules** that the future fetch route will call. This plan defines an "Integration Contract" section that the fetch-route ticket consumes verbatim — mirrors how LEX-72 wrote the contract that LEX-71 was supposed to honor.

### 2. Source classifier — small dedicated module, not bolted onto `url-validation`

A new module `apps/web/src/lib/source-classifier/` exports `classifySource(hostname): SourceClass`. It is **separate** from `lib/url-validation/` because:

- `url-validation` is a security gate (allow/deny) with a side-effecting DNS check; it must stay a single-purpose orchestrator.
- `source-classifier` is a pure dispatcher over a static host table. No I/O, no async.

The classifier returns a discriminated union:

```
type SourceClass =
  | { kind: 'mediawiki'; apiEndpoint: string; pageTitle: string }
  | { kind: 'generic' };
```

`apiEndpoint` is derived from the hostname (e.g. `en.wikipedia.org` → `https://en.wikipedia.org/w/api.php`). `pageTitle` is parsed from the URL path (`/wiki/Foo_Bar` → `Foo_Bar`). The classifier matches on hostname using the same **exact-or-subdomain** rule already used in `lib/url-validation/denylist.ts:35-42`.

**Britannica explicitly maps to `generic`.** The Linear AC's phrasing ("Britannica/Citizendium, when matched as MediaWiki-compatible") is parameterized: Citizendium is MediaWiki, Britannica is not. The classifier captures this distinction.

### 3. Known MediaWiki host table — committed, NOT env-driven (for v1)

```
en.wikipedia.org, fr.wikipedia.org, ...   → https://{host}/w/api.php   (any *.wikipedia.org)
en.wiktionary.org, ...                    → https://{host}/w/api.php   (any *.wiktionary.org)
*.wikimedia.org                           → https://{host}/w/api.php
en.citizendium.org                        → https://en.citizendium.org/wiki/api.php
```

The MediaWiki host table lives in `apps/web/src/lib/source-classifier/hosts.ts` as a committed constant. Reasons:

- The set is small and well-known.
- The `/w/api.php` convention is stable across all Wikimedia projects.
- Surprises in this list change the *security posture* (outbound calls to new origins) and should require a code review, not an env-var flip.

Adding a new MediaWiki host later is a one-line PR; that is the right friction.

### 4. MediaWiki client — single `fetchSections(url)` entrypoint

`apps/web/src/lib/mediawiki/client.ts` exports a single function:

```
fetchSections(normalizedUrl: string, options?: { signal?: AbortSignal }): Promise<MediaWikiArticle>
```

Internally it:

1. Calls `classifySource()` and asserts `kind === 'mediawiki'` (throws `MediaWikiApiError` otherwise — guards against misuse; the caller should have routed via the classifier).
2. Issues a single GET to `${apiEndpoint}?action=parse&page=${title}&prop=sections|text|revid|displaytitle&format=json&formatversion=2&redirects=1` with explicit timeout, `User-Agent`, and `Accept: application/json`.
3. Validates the response shape with a runtime check (no Zod — matches LEX-71's "no validator framework" decision at `.agents/plans/completed/lex-71-url-entry-validation.plan.md:70-75`).
4. Maps the MediaWiki response to a typed `MediaWikiArticle`.
5. Throws typed `MediaWikiApiError` with a discriminated `code` for: HTTP error (`http_error`), parse error (`bad_response`), unknown page (`page_not_found`), redirect to non-MediaWiki origin (`bad_redirect`), and timeout (`timeout`).

**One request, not two.** `action=parse` with `prop=sections|text|revid` returns sections, full HTML, and the revision ID in a single call. We do *not* need a separate `action=query` for revision ID.

### 5. Stable section IDs — use MediaWiki `anchor` field, scope to revision

MediaWiki's `action=parse&prop=sections` returns each section with these fields:

| Field | Value | Stable? |
|-------|-------|---------|
| `anchor` | URL anchor (`External_links`) | ✅ stable across re-renders of the same revision; can drift if heading is renamed |
| `line` | Heading text (raw) | ❌ drifts with edits |
| `level` | HTML heading level (2–6) | mostly stable |
| `number` | TOC number (`1.2`) | ❌ drifts when sections are added/removed |
| `index` | Ordinal index (`"3"`) | ❌ drifts |
| `byteoffset` | Position in wikitext | ❌ drifts |

We use **`anchor` as the section ID**, paired with the revision hash. When the revision changes, the cache invalidates (per LEX-72's `getCachedFresh` flow), the article is re-fetched, and anchors are re-resolved against the new revision. W3C Text Fragments + content-hashed pinning (FR-VW-5) is a separate ticket — for v1 MVP, `(revision, anchor)` is the stability contract.

### 6. Revision hash format — `mw:{revid}`, NOT `sha256(html)`

LEX-72's `CachedProxyResponse.revisionHash` is documented as "sha256(normalized_text)" (see `apps/web/src/lib/proxy-cache/types.ts:7`). For MediaWiki sources, we have a **canonical authoritative revision ID** from the API — no need to hash content. We use the format `mw:${revid}` (e.g. `mw:1234567890`).

Rationale:

- Free, exact, and trivially stable.
- Distinguishable from generic-scraper hashes (which will be `sha256:...` or similar) — debugging cache keys is easier.
- Avoids a needless hash over a multi-MB HTML blob.

The `revisionHash` field type is `string`; LEX-72 makes no assumption about the format beyond equality comparison. This is forward-compatible with the generic scraper using `sha256:...` later.

### 7. Output shape — `MediaWikiArticle`, serializable to `CachedProxyResponse.payload`

```
type Section = {
  id: string;        // MediaWiki anchor, e.g. "External_links"
  title: string;     // plain text heading, no markup
  level: number;     // 2–6
  html: string;      // section HTML body (between this heading and the next)
};

type MediaWikiArticle = {
  kind: 'mediawiki';
  url: string;              // input normalized URL
  title: string;            // displaytitle (plain text)
  revisionHash: string;     // `mw:${revid}`
  pageId: number;
  fetchedAt: string;        // ISO timestamp
  sections: Section[];      // top-of-page lead is sections[0] with id='' and level=0
  leadHtml: string;         // intro before first heading, also accessible as sections[0].html
};
```

When the fetch-route ticket lands, it will JSON-serialize this into `CachedProxyResponse.payload` (LEX-72) along with `revisionHash`, `fetchedAt`, and `url`. The serialized payload must stay under the 950 KB cap (`MAX_PAYLOAD_BYTES` in `apps/web/src/lib/proxy-cache/types.ts:3`). Sections with very large HTML are stored as-is; the fetch route handles the size-cap fallthrough to R2.

### 8. Parser dispatcher — `lib/parser/index.ts`, single entry point

```
parseArticle(normalizedUrl: string, options?: { signal?: AbortSignal })
  : Promise<MediaWikiArticle | FallbackResult>

type FallbackResult = {
  kind: 'fallback';
  url: string;
  reason: 'generic_scraper_not_yet_implemented';
  hostname: string;
};
```

The dispatcher:

1. Parses URL to extract hostname.
2. Calls `classifySource(hostname)`.
3. Routes to `fetchSections()` for `kind === 'mediawiki'`.
4. Returns a typed `FallbackResult` for `kind === 'generic'`.

Returning a typed stub (rather than throwing or returning `null`) keeps the API forward-compatible: when the generic Readability scraper lands in a later ticket, it just replaces the stub branch — callers branch on `result.kind` either way.

### 9. Outbound HTTP — bare `fetch()` with explicit timeout, no wrapper module

No HTTP client wrapper exists today; routes use `node:dns` directly (`apps/web/src/lib/url-validation/resolveHost.ts:1-30`) and `fetch` is called once from the client side. We do **not** introduce a generic `lib/http.ts` wrapper in this ticket — overgeneralizing too early. The MediaWiki client uses bare `fetch()` with `AbortSignal.timeout(MEDIAWIKI_API_TIMEOUT_MS)` and explicit headers. Future tickets needing outbound HTTP can either inline the same pattern or extract a shared helper once we have a second consumer.

### 10. Timeout, User-Agent, redirect policy

| Concern | Decision |
|---------|----------|
| Timeout | `MEDIAWIKI_API_TIMEOUT_MS` env var, default **5000ms**, hard cap **15000ms**. Implemented via `AbortSignal.timeout()`. |
| User-Agent | `MEDIAWIKI_USER_AGENT` env var, default `Veritasee/0.1 (https://veritasee.app; ops@veritasee.app)`. MediaWiki API etiquette **requires** a descriptive UA with contact info; default values are deploy-overridable. |
| `Accept` | `application/json` (we use `format=json&formatversion=2`). |
| Redirects | `redirect: 'follow'` (default), but the API call uses `&redirects=1` so MediaWiki resolves page-level redirects (`HTTP/Status_404` → `HTTP_404`) for us. We do **not** follow cross-origin redirects: if the response URL hostname differs from the request hostname, we throw `bad_redirect`. |

### 11. Health endpoint — `/api/health/mediawiki`, token-gated

Mirrors `/api/health/proxy-cache` (`apps/web/src/app/api/health/proxy-cache/route.ts:1-87`) exactly:

- Token gated via `MEDIAWIKI_HEALTH_TOKEN` env var with `timingSafeEqual` comparison.
- 503 in production if token unconfigured (fail-closed).
- In dev (NODE_ENV !== 'production'), unconfigured token allows access for local smoke.

The probe calls `parseArticle('https://en.wikipedia.org/wiki/HTTP_404')` (a small, stable page) and asserts:

- Result kind is `mediawiki`.
- `sections.length > 0`.
- `revisionHash` matches `/^mw:\d+$/`.

Returns `{ ok: true, sections: N, revisionId: number, fetchMs: number }` on success, `{ ok: false, step: 'fetch'|'shape'|'classify', error }` with status 503 on failure.

### 12. Observability + failure semantics

The MediaWiki client logs at the structured-event level using `logger` from `@/lib/observability` (already used at `apps/web/src/app/api/proxy/validate/route.ts:58-65`). Events:

- `mediawiki_fetch_ok` — `{ event, hostname, page_title, revid, sections, duration_ms }` at `info`
- `mediawiki_fetch_error` — `{ event, hostname, code, duration_ms, err }` at `warn`
- `mediawiki_bad_redirect` — `{ event, from_host, to_host, duration_ms }` at `warn`

Errors thrown by `fetchSections()` propagate; the `withObservability` wrapper around the route handler captures them to Sentry (`apps/web/src/lib/observability/withObservability.ts:30-44`). Internal callers (the fetch route, the health route) catch and map to typed HTTP responses; they do **not** rely on the throw bubbling to a generic 500.

### 13. No new dependencies

The MediaWiki API returns JSON — no XML, no parser needed. Section HTML is shipped as-is; sanitization is the fetch route's responsibility (it owns DOMPurify per LEX-71's scope). `node:url` parses URLs. `AbortSignal.timeout()` is in Node 18+ (we are on 20). Nothing to install.

---

## Patterns to Follow

### Module shape (mirror `proxy-cache/` and `url-validation/`)

```
// SOURCE: apps/web/src/lib/proxy-cache/types.ts:1-12
export const PROXY_CACHE_TTL_SECONDS = 900;
export const MAX_PAYLOAD_BYTES = 950_000;
export type CachedProxyResponse = {
  url: string;
  revisionHash: string;
  fetchedAt: string;
  payload: string;
  contentType?: string;
};
```

Mirror this for `mediawiki/types.ts`: small file, top-level constants, exported types.

### Discriminated result type

```
// SOURCE: apps/web/src/lib/url-validation/types.ts (the ValidationResult pattern)
export type ValidationResult =
  | { ok: true; normalizedUrl: string; hostname: string }
  | { ok: false; code: 'invalid_url' | 'too_long' | ...; message: string; hostname?: string };
```

Use the same shape for `MediaWikiApiError`:

```
type MediaWikiApiError =
  | { code: 'http_error'; status: number; message: string }
  | { code: 'bad_response'; message: string }
  | { code: 'page_not_found'; pageTitle: string }
  | { code: 'bad_redirect'; fromHost: string; toHost: string }
  | { code: 'timeout'; durationMs: number }
  | { code: 'not_mediawiki'; hostname: string };
```

Implemented as a custom `Error` subclass that carries the discriminator:

```
export class MediaWikiApiError extends Error {
  constructor(public readonly detail: MediaWikiApiErrorDetail) {
    super(detail.message ?? detail.code);
    this.name = 'MediaWikiApiError';
  }
}
```

### Suffix-match classifier (mirror denylist)

```
// SOURCE: apps/web/src/lib/url-validation/denylist.ts:35-42
export function isDenylisted(hostname: string, list: ReadonlySet<string>): boolean {
  const host = hostname.toLowerCase();
  if (list.has(host)) return true;
  for (const entry of list) {
    if (host.endsWith(`.${entry}`)) return true;
  }
  return false;
}
```

Use the same exact-or-subdomain pattern for `classifySource`.

### Token-gated health route (mirror proxy-cache health)

```
// SOURCE: apps/web/src/app/api/health/proxy-cache/route.ts:21-41
function tokensMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

async function handler(req: NextRequest): Promise<Response> {
  const expected = process.env.PROXY_CACHE_HEALTH_TOKEN;
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !expected) {
    return NextResponse.json({ ok: false, error: 'health_token_unconfigured' }, { status: 503 });
  }
  if (expected && !tokensMatch(expected, req.headers.get('x-health-token'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // ...probe...
}
```

Copy verbatim for `/api/health/mediawiki`, swap env var name and probe body.

### Route handler + observability wrapper

```
// SOURCE: apps/web/src/app/api/proxy/validate/route.ts:73 and apps/web/src/lib/observability/withObservability.ts:10-47
export const GET = withObservability(handler);
```

Same export pattern for the health route.

### Structured warn log

```
// SOURCE: apps/web/src/app/api/proxy/validate/route.ts:58-65
logger.warn('url_validation_reject', {
  event: 'url_validation_reject',
  code: result.code,
  hostname: 'hostname' in result ? result.hostname : undefined,
  url_length: raw.length,
  user_id: userId,
  request_id: req.headers.get('x-request-id') ?? undefined,
});
```

Mirror for `mediawiki_fetch_error`.

### Env var documentation style

```
# SOURCE: apps/web/.env.example (additions style from LEX-71)
# URL_DENYLIST_EXTRA — comma-separated extra hosts to block (see lib/url-validation/denylist.ts)
URL_DENYLIST_EXTRA=
```

Add three new entries with similar block comments for the MediaWiki env vars.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/lib/source-classifier/hosts.ts` | CREATE | Committed table of MediaWiki host suffixes |
| `apps/web/src/lib/source-classifier/types.ts` | CREATE | `SourceClass` discriminated union |
| `apps/web/src/lib/source-classifier/classify.ts` | CREATE | `classifySource(hostname)` pure function |
| `apps/web/src/lib/source-classifier/index.ts` | CREATE | Barrel re-export |
| `apps/web/src/lib/mediawiki/types.ts` | CREATE | `Section`, `MediaWikiArticle`, `MediaWikiApiError`, env-driven constants |
| `apps/web/src/lib/mediawiki/env.ts` | CREATE | Read + clamp `MEDIAWIKI_API_TIMEOUT_MS`, `MEDIAWIKI_USER_AGENT` |
| `apps/web/src/lib/mediawiki/buildRequest.ts` | CREATE | Pure helper: classified source + URL → API request URL + headers |
| `apps/web/src/lib/mediawiki/parseResponse.ts` | CREATE | Pure helper: raw API JSON → `MediaWikiArticle` (runtime shape check, throws typed) |
| `apps/web/src/lib/mediawiki/client.ts` | CREATE | `fetchSections()` orchestrator (timeout + fetch + redirect-host check + parseResponse) |
| `apps/web/src/lib/mediawiki/index.ts` | CREATE | Barrel re-export |
| `apps/web/src/lib/parser/types.ts` | CREATE | `ParsedArticle = MediaWikiArticle \| FallbackResult` union |
| `apps/web/src/lib/parser/index.ts` | CREATE | `parseArticle()` dispatcher |
| `apps/web/src/app/api/health/mediawiki/route.ts` | CREATE | Token-gated smoke endpoint |
| `apps/web/.env.example` | UPDATE | Document `MEDIAWIKI_USER_AGENT`, `MEDIAWIKI_API_TIMEOUT_MS`, `MEDIAWIKI_HEALTH_TOKEN` |

---

## Dependency Order

1. `source-classifier/` — pure, depends on nothing.
2. `mediawiki/types.ts` + `mediawiki/env.ts` — pure.
3. `mediawiki/buildRequest.ts` — depends on (1) + (2).
4. `mediawiki/parseResponse.ts` — depends on (2).
5. `mediawiki/client.ts` — depends on (3) + (4) + observability.
6. `mediawiki/index.ts` — barrel.
7. `parser/` — depends on (1) + (5).
8. `app/api/health/mediawiki/route.ts` — depends on (7).
9. `.env.example` — independent, do last.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| MediaWiki API rate-limits an outbound burst from one IP | Single GET per request; `User-Agent` carries contact info per WMF policy; v1 traffic is low. Add Redis-backed token bucket only if we see throttling. |
| Wikipedia page is a redirect (move/rename) | `&redirects=1` parameter handles it server-side. We still validate that the response page title belongs to a MediaWiki host. |
| Section anchor renamed between cache write and read | Out of scope for LEX-73 — handled by revision invalidation (cache key includes `revisionHash`; `getCachedFresh()` evicts on mismatch per `apps/web/src/lib/proxy-cache/cache.ts:48-58`). Mention in caller's PR. |
| MediaWiki returns HTML with inline scripts / event handlers | Sanitization is the fetch route's responsibility, NOT this parser's. The parser ships raw section HTML; the fetch-route ticket DOMPurifies before caching. Document in integration contract. |
| Britannica AC ambiguity — should Britannica work in this ticket? | No. Britannica is NOT MediaWiki; AC explicitly says "otherwise fallback path runs." LEX-73 ships the typed fallback stub; full Readability scraper is a later ticket. |
| Section HTML pushes payload over 950 KB cap | Detection is the fetch route's job (`MAX_PAYLOAD_BYTES` check in `setCached`). Parser does not truncate; oversized payloads fall through to R2 in a future ticket. |
| Hardcoded host list misses a self-hosted MediaWiki wiki | v1 MVP scope; adding hosts is a one-line PR. Document the extension path in `hosts.ts`. |
| MediaWiki API schema changes between minor versions | `formatversion=2` pins us to the stable v2 shape. The `parseResponse.ts` runtime check fails loudly on shape drift rather than silently miscoercing. |
| Outbound fetch hits a non-routable IP via DNS rebinding | NOT a parser concern — the fetch route must re-resolve and pin to the resolved IP at fetch time, per the existing SSRF note in `apps/web/src/app/api/proxy/validate/route.ts:9-12`. Document in integration contract. |

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: `lib/source-classifier/types.ts`

- **File**: `apps/web/src/lib/source-classifier/types.ts`
- **Action**: CREATE
- **Implement**: Export `SourceClass` discriminated union (`mediawiki` with `apiEndpoint`, `hostname`, `pageTitle`; `generic` with `hostname`).
- **Mirror**: `apps/web/src/lib/url-validation/types.ts` (discriminated result shape).
- **Validate**: `pnpm typecheck`.

### Task 2: `lib/source-classifier/hosts.ts`

- **File**: `apps/web/src/lib/source-classifier/hosts.ts`
- **Action**: CREATE
- **Implement**: Export `MEDIAWIKI_HOST_SUFFIXES = ['wikipedia.org', 'wiktionary.org', 'wikimedia.org', 'citizendium.org'] as const`. Comment block explains the suffix-match rule + adding-a-host instructions.
- **Mirror**: `apps/web/src/lib/url-validation/denylist.ts:10-15`.
- **Validate**: `pnpm typecheck`.

### Task 3: `lib/source-classifier/classify.ts`

- **File**: `apps/web/src/lib/source-classifier/classify.ts`
- **Action**: CREATE
- **Implement**: `classifySource(input: string): SourceClass`. Parse URL via `new URL()`; lowercase hostname; check `hostname === suffix || hostname.endsWith('.' + suffix)`; for matches, derive `apiEndpoint = \`https://${hostname}/w/api.php\`` and `pageTitle` from `/wiki/{title}` path (URL-decoded, no namespace stripping for v1). Return `{ kind: 'generic', hostname }` on no match. If URL parsing fails OR path is not `/wiki/{title}` for a MediaWiki host, return `{ kind: 'generic', hostname }` — let the parser's fallback handle non-article URLs.
- **Mirror**: `apps/web/src/lib/url-validation/denylist.ts:35-42` (suffix match).
- **Validate**: `pnpm typecheck`.

### Task 4: `lib/source-classifier/index.ts`

- **File**: `apps/web/src/lib/source-classifier/index.ts`
- **Action**: CREATE
- **Implement**: Re-export `classifySource` and `SourceClass`.
- **Validate**: `pnpm typecheck`.

### Task 5: `lib/mediawiki/types.ts`

- **File**: `apps/web/src/lib/mediawiki/types.ts`
- **Action**: CREATE
- **Implement**: Export `Section`, `MediaWikiArticle`, `MediaWikiApiErrorDetail` (discriminated union), `MediaWikiApiError` class. Const `MEDIAWIKI_REVISION_PREFIX = 'mw:'` and `MEDIAWIKI_TIMEOUT_DEFAULT_MS = 5000`, `MEDIAWIKI_TIMEOUT_MAX_MS = 15_000`.
- **Mirror**: `apps/web/src/lib/proxy-cache/types.ts:1-12` (constants + discriminated types).
- **Validate**: `pnpm typecheck`.

### Task 6: `lib/mediawiki/env.ts`

- **File**: `apps/web/src/lib/mediawiki/env.ts`
- **Action**: CREATE
- **Implement**: Export `getTimeoutMs()` (reads `MEDIAWIKI_API_TIMEOUT_MS`, parses int, clamps to `[100, MEDIAWIKI_TIMEOUT_MAX_MS]`, falls back to `MEDIAWIKI_TIMEOUT_DEFAULT_MS`); `getUserAgent()` (reads `MEDIAWIKI_USER_AGENT`, falls back to `Veritasee/0.1 (https://veritasee.app; ops@veritasee.app)`).
- **Mirror**: `apps/web/src/lib/observability/env.ts` (env-reader module shape).
- **Validate**: `pnpm typecheck`.

### Task 7: `lib/mediawiki/buildRequest.ts`

- **File**: `apps/web/src/lib/mediawiki/buildRequest.ts`
- **Action**: CREATE
- **Implement**: `buildMediaWikiRequest(source: SourceClass & { kind: 'mediawiki' }): { url: string; headers: Record<string, string> }`. URL is `${apiEndpoint}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=sections|text|revid|displaytitle&format=json&formatversion=2&redirects=1`. Headers: `Accept: application/json`, `User-Agent: getUserAgent()`.
- **Mirror**: pure helper style of `apps/web/src/lib/proxy-cache/keys.ts`.
- **Validate**: `pnpm typecheck`.

### Task 8: `lib/mediawiki/parseResponse.ts`

- **File**: `apps/web/src/lib/mediawiki/parseResponse.ts`
- **Action**: CREATE
- **Implement**: `parseMediaWikiResponse(raw: unknown, context: { url: string; pageTitle: string }): MediaWikiArticle`. Runtime checks: `raw` is object with `.parse` object containing `title: string`, `displaytitle: string`, `revid: number`, `pageid: number`, `text: string` (the FULL article HTML), `sections: Array<{ anchor: string; line: string; level: string | number; toclevel: number }>`. On any check failure, throw `MediaWikiApiError({ code: 'bad_response', message: '...' })`. On `raw.error?.code === 'missingtitle'`, throw `MediaWikiApiError({ code: 'page_not_found', pageTitle })`.

  Section HTML extraction: MediaWiki returns the full `text` blob; split it by H2/H3/H4/H5/H6 boundaries using the `anchor`-derived `id="..."` attribute. Construct sections in order:
  - `sections[0] = { id: '', title: <displaytitle>, level: 0, html: <text before first heading> }` (the lead).
  - Each subsequent entry maps a MediaWiki section header to its HTML body up to the next equal-or-higher-level heading.

  Use a single regex over the `text` blob to find heading boundaries; do not introduce an HTML parser dependency. Document the regex limitation: nested HTML inside heading text won't break split (anchors are always on the H-tag), but malformed HTML from MediaWiki has never been observed in practice.
- **Mirror**: `apps/web/src/lib/url-validation/validateUrl.ts:21-26` (try/catch around parse + typed error return — but here we throw rather than return because callers wrap in try/catch).
- **Validate**: `pnpm typecheck`.

### Task 9: `lib/mediawiki/client.ts`

- **File**: `apps/web/src/lib/mediawiki/client.ts`
- **Action**: CREATE
- **Implement**: `fetchSections(normalizedUrl: string, options?: { signal?: AbortSignal }): Promise<MediaWikiArticle>`.

  Flow:
  1. `const source = classifySource(normalizedUrl)`.
  2. If `source.kind !== 'mediawiki'`, throw `MediaWikiApiError({ code: 'not_mediawiki', hostname: source.hostname })`.
  3. `const { url, headers } = buildMediaWikiRequest(source)`.
  4. `const timeoutMs = getTimeoutMs()`; combine caller signal with `AbortSignal.timeout(timeoutMs)` via `AbortSignal.any([...])` (Node 20+).
  5. `const start = performance.now()`; `const res = await fetch(url, { headers, signal })`. Catch `AbortError` and re-throw as `MediaWikiApiError({ code: 'timeout', durationMs })`.
  6. Verify the *response* URL hostname (after MediaWiki redirects) is still a MediaWiki suffix; if not, throw `bad_redirect`.
  7. If `!res.ok`, throw `http_error`.
  8. `const raw = await res.json()`; pass through `parseMediaWikiResponse(raw, ...)`.
  9. Log `mediawiki_fetch_ok` with `hostname`, `page_title`, `revid`, `sections`, `duration_ms`.

  Set `revisionHash = \`${MEDIAWIKI_REVISION_PREFIX}${revid}\``.
- **Mirror**: `apps/web/src/lib/proxy-cache/cache.ts:15-58` (small orchestrator over typed helpers).
- **Validate**: `pnpm typecheck`.

### Task 10: `lib/mediawiki/index.ts`

- **File**: `apps/web/src/lib/mediawiki/index.ts`
- **Action**: CREATE
- **Implement**: Re-export `fetchSections`, `MediaWikiArticle`, `Section`, `MediaWikiApiError`, `MediaWikiApiErrorDetail`.
- **Mirror**: `apps/web/src/lib/proxy-cache/index.ts` (barrel).
- **Validate**: `pnpm typecheck`.

### Task 11: `lib/parser/types.ts`

- **File**: `apps/web/src/lib/parser/types.ts`
- **Action**: CREATE
- **Implement**: `FallbackResult` type; `ParsedArticle = MediaWikiArticle | FallbackResult` union.
- **Validate**: `pnpm typecheck`.

### Task 12: `lib/parser/index.ts`

- **File**: `apps/web/src/lib/parser/index.ts`
- **Action**: CREATE
- **Implement**: `parseArticle(normalizedUrl, options?): Promise<ParsedArticle>`. Calls `classifySource`; for `mediawiki` delegates to `fetchSections`; for `generic` returns `{ kind: 'fallback', url, reason: 'generic_scraper_not_yet_implemented', hostname }`. Re-export `ParsedArticle`, `FallbackResult` from this module.
- **Mirror**: discriminated-dispatch pattern from `apps/web/src/lib/proxy-cache/cache.ts:48-58` (typed result, no thrown errors for the expected fallback path).
- **Validate**: `pnpm typecheck`.

### Task 13: `app/api/health/mediawiki/route.ts`

- **File**: `apps/web/src/app/api/health/mediawiki/route.ts`
- **Action**: CREATE
- **Implement**: Token-gated GET (mirror proxy-cache health route verbatim). Probe URL: `https://en.wikipedia.org/wiki/HTTP_404`. Call `parseArticle(probe)`; assert `result.kind === 'mediawiki' && result.sections.length > 0 && /^mw:\d+$/.test(result.revisionHash)`. Return `{ ok: true, sections, revisionId, fetchMs }`; on failure return `{ ok: false, step, error, code? }` with status 503. Env var: `MEDIAWIKI_HEALTH_TOKEN`. Wrap in `withObservability`.
- **Mirror**: `apps/web/src/app/api/health/proxy-cache/route.ts:1-87` verbatim.
- **Validate**: `pnpm build` (route should appear in the manifest); `pnpm typecheck`.

### Task 14: Document env vars in `.env.example`

- **File**: `apps/web/.env.example`
- **Action**: UPDATE
- **Implement**: Add three new blocks:

  ```
  # MEDIAWIKI_USER_AGENT — User-Agent header for outbound MediaWiki API calls.
  # MediaWiki etiquette requires a descriptive UA with contact info.
  # Defaults to `Veritasee/0.1 (https://veritasee.app; ops@veritasee.app)`.
  MEDIAWIKI_USER_AGENT=

  # MEDIAWIKI_API_TIMEOUT_MS — per-request timeout in milliseconds.
  # Defaults to 5000; clamped to [100, 15000].
  MEDIAWIKI_API_TIMEOUT_MS=

  # MEDIAWIKI_HEALTH_TOKEN — header token for /api/health/mediawiki.
  # Required in production (fails closed). Optional in development.
  MEDIAWIKI_HEALTH_TOKEN=
  ```
- **Mirror**: `apps/web/.env.example` `URL_DENYLIST_EXTRA` block (LEX-71 style).
- **Validate**: file is valid; `pnpm typecheck` unaffected.

### Task 15: Manual smoke

- **Action**: Run `pnpm dev`; `curl -H "x-health-token: $MEDIAWIKI_HEALTH_TOKEN" http://localhost:3000/api/health/mediawiki` → expect `{"ok":true,"sections":N,"revisionId":<int>,"fetchMs":<int>}` HTTP 200.
- **Then**: temporarily replace probe URL with `https://www.britannica.com/topic/Internet` in a one-off test (not committed) to confirm the fallback path returns a `FallbackResult`. Revert before commit.
- **Validate**: by inspection + console output.

### Task 16: Full repo verification

- **Run**: `pnpm typecheck && pnpm lint && pnpm build` from repo root.
- **Validate**: all four workspace projects pass; build output lists `/api/health/mediawiki` in the manifest.

---

## Integration Contract for the future `/api/proxy/fetch` route

When the fetch-route ticket is opened, its plan MUST honor this contract:

### 1. Single entry point

```typescript
import { parseArticle } from '@/lib/parser';
import { getCachedFresh, setCached } from '@/lib/proxy-cache';

const cached = await getCachedFresh(normalizedUrl, expectedRevisionHash);
if (cached) return cached;

const parsed = await parseArticle(normalizedUrl, { signal });
if (parsed.kind === 'fallback') { /* serve as 501 not_implemented for now */ }

const payload = JSON.stringify(parsed);  // sanitize section HTML BEFORE serialize
await setCached(normalizedUrl, {
  url: normalizedUrl,
  revisionHash: parsed.revisionHash,
  fetchedAt: parsed.fetchedAt,
  payload,
});
```

### 2. Sanitization

Section HTML coming out of `parseArticle()` is **raw MediaWiki output** (already mostly safe — no `<script>` — but not guaranteed). The fetch route MUST DOMPurify each `section.html` before serializing into `CachedProxyResponse.payload`. Sanitization is intentionally NOT inside the parser so the same parser can serve internal callers who need raw HTML (future LLM reader, citation extractor).

### 3. SSRF re-resolution

The proxy fetch route MUST re-resolve and pin to the resolved IP at fetch time, per the note in `apps/web/src/app/api/proxy/validate/route.ts:9-12`. The MediaWiki client does NOT do this — it trusts that its hostname allowlist (only `*.wikipedia.org`, etc.) is not under attacker control. If the fetch route allows user-supplied non-MediaWiki URLs through to the generic scraper path, the re-resolution must happen there.

### 4. Revision peek (optional)

If the future fetch route wants to skip a full `parseArticle()` on a cache hit, it can implement `peekUpstreamRevision(url)` separately (cheap `action=query&prop=revisions` call returning just `revid`) and pass the result to `getCachedFresh(url, \`mw:${revid}\`)`. Not required for v1 — full re-fetch on cache miss is acceptable.

### 5. Error mapping

`MediaWikiApiError` is thrown by `parseArticle()` on the MediaWiki path. Route handlers should:

| `error.detail.code` | HTTP status |
|---------------------|-------------|
| `page_not_found` | 404 |
| `bad_redirect` | 502 |
| `http_error` (4xx upstream) | 502 |
| `http_error` (5xx upstream) | 503 |
| `timeout` | 504 |
| `bad_response` | 502 |
| `not_mediawiki` | 500 (router bug — caller routed wrong) |

---

## Validation

```bash
# Type check (all 4 workspace projects)
pnpm typecheck

# Lint
pnpm lint

# Build (verifies route manifest includes /api/health/mediawiki)
pnpm build

# Manual smoke (after `pnpm dev`)
curl -H "x-health-token: $MEDIAWIKI_HEALTH_TOKEN" http://localhost:3000/api/health/mediawiki

# Baseline regression
curl http://localhost:3000/api/health/redis
curl -H "x-health-token: $PROXY_CACHE_HEALTH_TOKEN" http://localhost:3000/api/health/proxy-cache

# Tests — no unit-test framework configured in apps/web yet; deferred per LEX-71
# .agents/plans/completed/lex-71-url-entry-validation.plan.md:139
```

---

## Acceptance Criteria Checklist

- [ ] Wikipedia URL → `parseArticle()` returns `kind: 'mediawiki'` with `sections.length > 0` and each section has a non-empty `id` (anchor) — covered by the health endpoint.
- [ ] Wikipedia URL → `revisionHash` matches `/^mw:\d+$/` — covered by the health endpoint assertion.
- [ ] Citizendium URL → routes through MediaWiki path (classified as `mediawiki` by `classifySource`); manually smoke-tested with `https://en.citizendium.org/wiki/Biology`.
- [ ] Britannica URL → routes to fallback (`kind: 'fallback'` with `reason: 'generic_scraper_not_yet_implemented'`); manually smoke-tested.
- [ ] `parseArticle()` is the only entry point — no other module imports from `@/lib/mediawiki` directly except `parseArticle()` itself and the health route.
- [ ] Outbound MediaWiki calls send `User-Agent` and `Accept: application/json` headers (verify by reading `client.ts`).
- [ ] Outbound calls time out after `MEDIAWIKI_API_TIMEOUT_MS` (default 5s); confirmed by code review of `client.ts`.
- [ ] `MEDIAWIKI_HEALTH_TOKEN` is required in production (fails closed); confirmed by code review of the health route.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass.
- [ ] Health route appears in build manifest at `/api/health/mediawiki`.
- [ ] `.env.example` documents all three new env vars.
- [ ] Integration contract (this plan's "Integration Contract for the future `/api/proxy/fetch` route" section) is referenced from the next fetch-route plan or PR description.

---

## Out-of-Scope (for explicit reference)

- **HTML sanitization** — owned by the fetch route ticket (DOMPurify, etc.).
- **Generic Readability-style scraper** — separate ticket; LEX-73 ships only the typed fallback stub.
- **Caching wiring** — `parseArticle` does not call `getCached`/`setCached`; that's the fetch route's job.
- **W3C Text Fragments / content-hashed pinning** — PRD §FR-VW-5; separate ticket.
- **Browser extension parser path** — extensions are a separate surface per `docs/general/SYSTEM-OVERVIEW.md`; this plan stays in `apps/web/`.
- **Rate limiting outbound to MediaWiki** — only add if we observe throttling; not needed for v1 traffic levels.
- **MediaWiki section content extracted from wikitext (not HTML)** — we use rendered HTML (`prop=text`) for simplicity; wikitext parsing is a separate concern.
- **Namespace handling (Talk pages, User pages, etc.)** — v1 accepts any `/wiki/{title}` path; namespace-aware routing can come later.
- **Unit tests for `apps/web`** — no test framework configured; health endpoint serves as integration smoke. Follow-up: add Vitest to `apps/web` (separate ticket) and write `classify.test.ts`, `parseResponse.test.ts`, `client.smoke.test.ts`.
