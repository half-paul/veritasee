# Plan: Generic Readability-style Article Extractor

## Summary

Replace the temporary `FallbackResult` sentinel in the parser dispatcher with a real generic article extractor that handles non-MediaWiki URLs. The extractor fetches the page over HTTP with a timeout and size cap, runs Mozilla Readability against a `jsdom` DOM to select the main content block (with `<article>` / `<main>` / text-density fallbacks), and returns a typed `GenericArticle` that parallels `MediaWikiArticle` so downstream code can branch on `result.kind` without further special cases. Errors flow through a new `GenericParserError` discriminated union that mirrors the existing `MediaWikiApiError` shape.

## User Story

As a Veritasee reader
I want corrections to anchor on arbitrary non-MediaWiki article URLs (Britannica, news sites, blogs, etc.)
So that the platform's correction layer isn't restricted to Wikipedia-family sources.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `apps/web/src/lib/parser` (dispatcher + types), `apps/web/src/lib/generic-parser` (NEW), `apps/web/package.json` (new deps) |
| Linear Issue | LEX-74 |
| PRD Reference | FR-VW-3 (`docs/PRD.md:85`) |
| Predecessor | LEX-73 (parser dispatcher + classifier + MediaWiki API client) |

---

## Acceptance Criteria (from Linear)

1. Given a non-MediaWiki article, when parsed, then `<article>` / `<main>` / longest-text-density block is selected.
2. Given navigation/footer noise, when parsed, then it is excluded from the main content block.

The PRD wording (`docs/PRD.md:85`) phrases this as "A scraper (Readability-style) identifies the main content block on non-MediaWiki pages... fall back to heuristic block detection (`<article>`, `<main>`, longest text density)." Using `@mozilla/readability` as the primary engine (it implements exactly these heuristics and drops nav/footer/script noise), with a thin in-house `<article>`/`<main>` fallback if Readability returns `null` (rare, but possible on very small or malformed pages), satisfies both criteria.

---

## Patterns to Follow

### Parser interface — discriminated union returned by the dispatcher
```ts
// SOURCE: apps/web/src/lib/parser/types.ts:1-10
import type { MediaWikiArticle } from '@/lib/mediawiki';

export type FallbackResult = {
  kind: 'fallback';
  url: string;
  hostname: string;
  reason: 'generic_scraper_not_yet_implemented';
};

export type ParsedArticle = MediaWikiArticle | FallbackResult;
```
We replace `FallbackResult` with `GenericArticle` in this union (no back-compat shim — the sentinel was always slated for removal per the comment in `parser/index.ts:6-8`).

### Dispatcher routing — single source-of-truth `switch` on `source.kind`
```ts
// SOURCE: apps/web/src/lib/parser/index.ts:9-23
export async function parseArticle(
  normalizedUrl: string,
  options?: { signal?: AbortSignal },
): Promise<ParsedArticle> {
  const source = classifySource(normalizedUrl);
  if (source.kind === 'mediawiki') {
    return fetchSections(normalizedUrl, options);
  }
  return { kind: 'fallback', url: normalizedUrl, hostname: source.hostname, reason: '...' };
}
```
The new branch becomes `if (source.kind === 'generic') return parseGenericArticle(normalizedUrl, options);` and the `FallbackResult` literal is deleted.

### Article success shape — mirror this for parity
```ts
// SOURCE: apps/web/src/lib/mediawiki/types.ts:26-37
export type MediaWikiArticle = {
  kind: 'mediawiki';
  url: string;
  title: string;
  revisionHash: string; // `mw:${revid}`
  pageId: number;
  fetchedAt: string;
  sections: Section[];
  leadHtml: string;
};
```
`GenericArticle` mirrors every field that has a meaningful generic analogue:
- `kind: 'generic'`
- `url`, `title`, `fetchedAt`, `sections`, `leadHtml` — same semantics
- `revisionHash`: no upstream revid available, so use `'sha256:<hex>'` of the normalized extracted text. Matches FR-VW-5 which specifies "sha256 of normalized article text" as the snapshot pin.
- `hostname: string` — included so logs and downstream UI don't need to re-parse the URL.
- `byline?: string`, `excerpt?: string`, `lang?: string` — populated when Readability returns them, omitted otherwise.

For v1, `sections` is a single entry mirroring MediaWiki's lead (`{ id: '', title, level: 0, html: contentHtml }`). Subdividing by inner `<h2>` / `<h3>` headings is intentionally deferred — section selection (FR-VW-4) anchors via W3C Text Fragments, not section ids, so a single-block representation is sufficient for v1.

### Custom error subclass with discriminated `detail`
```ts
// SOURCE: apps/web/src/lib/mediawiki/types.ts:39-55
export type MediaWikiApiErrorDetail =
  | { code: 'http_error'; status: number; message: string }
  | { code: 'bad_response'; message: string }
  | { code: 'page_not_found'; pageTitle: string; message?: string }
  | { code: 'bad_redirect'; fromHost: string; toHost: string; message?: string }
  | { code: 'timeout'; durationMs: number; message?: string }
  | { code: 'not_mediawiki'; hostname: string; message?: string };

export class MediaWikiApiError extends Error {
  readonly detail: MediaWikiApiErrorDetail;
  constructor(detail: MediaWikiApiErrorDetail) {
    super(detail.message ?? detail.code);
    this.name = 'MediaWikiApiError';
    this.detail = detail;
  }
}
```
`GenericParserError` follows the same shape with codes tailored to the new failure modes (see types.ts in tasks below).

### Fetch with timeout + signal combination + error mapping
```ts
// SOURCE: apps/web/src/lib/mediawiki/client.ts:19-76
function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const concrete = signals.filter((s): s is AbortSignal => s !== undefined);
  if (concrete.length === 0) return undefined;
  if (concrete.length === 1) return concrete[0];
  return AbortSignal.any(concrete);
}

const signal = combineSignals([options?.signal, AbortSignal.timeout(timeoutMs)]);
const start = performance.now();
try {
  res = await fetch(url, { headers, signal, redirect: 'follow' });
} catch (err) {
  if (isAbortError(err)) throw new MediaWikiApiError({ code: 'timeout', durationMs, ... });
  throw new MediaWikiApiError({ code: 'http_error', status: 0, message: ... });
}
```
The generic fetcher copies this exactly, including the structured `logger.warn(...)` call on each failure branch (`client.ts:52-76`, `100-114`, `116-132`) and the `logger.info('generic_fetch_ok', {...})` on success (`client.ts:139-147`).

### Env-driven tunables
```ts
// SOURCE: apps/web/src/lib/mediawiki/env.ts:8-21
export function getTimeoutMs(): number {
  const raw = process.env.MEDIAWIKI_API_TIMEOUT_MS;
  if (!raw) return MEDIAWIKI_TIMEOUT_DEFAULT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return MEDIAWIKI_TIMEOUT_DEFAULT_MS;
  if (n < MEDIAWIKI_TIMEOUT_MIN_MS) return MEDIAWIKI_TIMEOUT_MIN_MS;
  if (n > MEDIAWIKI_TIMEOUT_MAX_MS) return MEDIAWIKI_TIMEOUT_MAX_MS;
  return n;
}
```
Generic parser env reads `GENERIC_PARSER_TIMEOUT_MS` (default 10 000ms, min 100, max 30 000 — generic pages are larger and slower than MediaWiki's `action=parse`), `GENERIC_PARSER_USER_AGENT` (defaults to the same Veritasee-branded UA constant exported from `mediawiki/types.ts`), and `GENERIC_PARSER_MAX_BYTES` (default 5 MB, min 64 KB, max 25 MB).

### Test pattern — MSW + parameterized factories
```ts
// SOURCE: apps/web/src/lib/mediawiki/client.test.ts:11-21
describe('fetchSections — happy path', () => {
  it('returns a typed MediaWikiArticle when the API returns a valid response', async () => {
    server.use(
      http.get(API_URL, () => HttpResponse.json(mockMediaWikiParse({ revid: 12345 }))),
    );
    const article = await fetchSections(WIKI_URL);
    expect(article.kind).toBe('mediawiki');
    expect(article.revisionHash).toBe('mw:12345');
    expect(article.sections.length).toBeGreaterThan(0);
  });
});
```
MSW handlers, `server.use(...)` for per-test overrides, factories under `apps/web/test/factories/` for response shapes, and global setup at `apps/web/test/setup.ts:8-12` configures `onUnhandledRequest: 'error'` so any un-intercepted HTTP is a test failure.

### Factory builder pattern
```ts
// SOURCE: apps/web/test/factories/mockMediaWikiResponse.ts:30-58
export function mockMediaWikiParse(input: MockMediaWikiParseInput = {}): { parse: {...} } {
  const sections = input.sections ?? [{ anchor: 'History', line: 'History', level: 2 }, ...];
  const text = input.textOverride ?? leadHtml + sections.map(renderSectionHtml).join('');
  return { parse: { title: input.title ?? 'Test', revid: input.revid ?? 999000, text, sections, ... } };
}
```
A new factory `mockGenericPage()` builds canonical HTML pages with optional `<article>`, `<main>`, navigation, footer, and an article body parameter — the same "knobs over fixtures" philosophy.

### Dispatcher test — mock the boundary
```ts
// SOURCE: apps/web/src/lib/parser/index.test.ts:5-12
vi.mock('@/lib/mediawiki', () => ({
  fetchSections: vi.fn(),
}));
import { fetchSections } from '@/lib/mediawiki';
import { parseArticle } from './index';
const mockFetchSections = vi.mocked(fetchSections);
```
Add a sibling `vi.mock('@/lib/generic-parser', () => ({ parseGenericArticle: vi.fn() }))` for the new branch.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/package.json` | UPDATE | Add `@mozilla/readability` runtime dep. `jsdom` and `@types/jsdom` already present (no change). |
| `apps/web/src/lib/generic-parser/types.ts` | CREATE | `GenericArticle`, `GenericParserError`, error details, env constants. |
| `apps/web/src/lib/generic-parser/env.ts` | CREATE | `getTimeoutMs()`, `getUserAgent()`, `getMaxBytes()` with same validation pattern as `mediawiki/env.ts`. |
| `apps/web/src/lib/generic-parser/fetchHtml.ts` | CREATE | HTTP fetch with timeout, size cap, content-type guard, structured logging, typed errors. |
| `apps/web/src/lib/generic-parser/extractArticle.ts` | CREATE | jsdom + `@mozilla/readability` extraction with `<article>`/`<main>` fallback. Returns `{ title, contentHtml, byline?, excerpt?, lang? }` or throws `extraction_failed`. |
| `apps/web/src/lib/generic-parser/parseGenericArticle.ts` | CREATE | Orchestrator: fetch → extract → hash → assemble `GenericArticle`. |
| `apps/web/src/lib/generic-parser/index.ts` | CREATE | Public re-exports (mirror `mediawiki/index.ts`). |
| `apps/web/src/lib/generic-parser/fetchHtml.test.ts` | CREATE | MSW-based: happy path, http_error, timeout, too_large, bad_content_type. |
| `apps/web/src/lib/generic-parser/extractArticle.test.ts` | CREATE | DOM-only: `<article>` selection, `<main>` selection, text-density selection, nav/footer exclusion, extraction_failed. |
| `apps/web/src/lib/generic-parser/parseGenericArticle.test.ts` | CREATE | End-to-end with MSW: happy path returns typed `GenericArticle` with `sha256:` hash; error mapping. |
| `apps/web/test/factories/mockGenericPage.ts` | CREATE | HTML builder factory with knobs for article container, nav, footer, paragraph count. |
| `apps/web/src/lib/parser/types.ts` | UPDATE | Replace `FallbackResult` with import of `GenericArticle`; `ParsedArticle = MediaWikiArticle \| GenericArticle`. |
| `apps/web/src/lib/parser/index.ts` | UPDATE | Add `if (source.kind === 'generic') return parseGenericArticle(...)`. Remove `FallbackResult` literal and re-export. Update file-level comment. |
| `apps/web/src/lib/parser/index.test.ts` | UPDATE | Replace the two "fallback" assertions with assertions that the dispatcher calls `parseGenericArticle` and returns a `kind: 'generic'` result. Mock both boundaries. |

No changes to `source-classifier/` (its `'generic'` discriminant is already correct), `mediawiki/` (untouched), or API routes (none directly consume `ParsedArticle` yet at the time of LEX-73; if any do, they already `switch (result.kind)` and just gain a new branch).

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Add `@mozilla/readability` dependency

- **File**: `apps/web/package.json`
- **Action**: UPDATE
- **Implement**: Add `"@mozilla/readability": "^0.5.0"` (or current latest stable) to `dependencies`. Run `pnpm install` from repo root. Verify the lockfile updates and that `jsdom` (already in `devDependencies` at `^25.0.1`) is promoted to `dependencies` — Readability uses a runtime jsdom Document, so jsdom must ship in the production bundle.
- **Mirror**: existing dependency placement in `apps/web/package.json:17-25`.
- **Validate**: `pnpm install` succeeds; `pnpm --filter web typecheck` still passes against the empty new dir.

### Task 2: Generic parser types + error class

- **File**: `apps/web/src/lib/generic-parser/types.ts`
- **Action**: CREATE
- **Implement**:
  - Constants: `GENERIC_PARSER_TIMEOUT_DEFAULT_MS = 10_000`, `GENERIC_PARSER_TIMEOUT_MIN_MS = 100`, `GENERIC_PARSER_TIMEOUT_MAX_MS = 30_000`, `GENERIC_PARSER_MAX_BYTES_DEFAULT = 5 * 1024 * 1024`, `GENERIC_PARSER_MAX_BYTES_MIN = 64 * 1024`, `GENERIC_PARSER_MAX_BYTES_MAX = 25 * 1024 * 1024`, `GENERIC_PARSER_REVISION_PREFIX = 'sha256:'`.
  - Re-export `MEDIAWIKI_DEFAULT_USER_AGENT` from `@/lib/mediawiki` as the shared UA (single source of truth) OR define `GENERIC_PARSER_DEFAULT_USER_AGENT` with the same string — pick the re-export to avoid drift.
  - `GenericArticle` shape:
    ```ts
    export type GenericArticle = {
      kind: 'generic';
      url: string;
      hostname: string;
      title: string;
      revisionHash: string;            // 'sha256:<64-hex>' over normalized content
      fetchedAt: string;                // ISO timestamp
      sections: Section[];              // single-entry array for v1: [{ id: '', title, level: 0, html: contentHtml }]
      leadHtml: string;                 // = sections[0].html
      byline?: string;
      excerpt?: string;
      lang?: string;
    };
    ```
    Import `Section` from `@/lib/mediawiki` (re-exported at `apps/web/src/lib/mediawiki/index.ts:10-14`) so a single `Section` type spans both parsers.
  - `GenericParserErrorDetail` union:
    ```ts
    export type GenericParserErrorDetail =
      | { code: 'http_error'; status: number; message: string }
      | { code: 'bad_response'; message: string }              // empty body, malformed HTML
      | { code: 'bad_content_type'; contentType: string; message: string }
      | { code: 'too_large'; limitBytes: number; message: string }
      | { code: 'timeout'; durationMs: number; message?: string }
      | { code: 'extraction_failed'; hostname: string; message: string };
    ```
  - `GenericParserError extends Error` with `readonly detail`, identical constructor shape to `MediaWikiApiError`.
- **Mirror**: `apps/web/src/lib/mediawiki/types.ts:1-55` line-for-line.
- **Validate**: `pnpm --filter web typecheck`.

### Task 3: Env tunables

- **File**: `apps/web/src/lib/generic-parser/env.ts`
- **Action**: CREATE
- **Implement**: `getTimeoutMs()`, `getUserAgent()`, `getMaxBytes()` reading `GENERIC_PARSER_TIMEOUT_MS`, `GENERIC_PARSER_USER_AGENT`, `GENERIC_PARSER_MAX_BYTES` with the clamp-on-out-of-range pattern. `getUserAgent()` defaults to `MEDIAWIKI_DEFAULT_USER_AGENT` (re-exported via Task 2).
- **Mirror**: `apps/web/src/lib/mediawiki/env.ts:1-22` (identical structure, different constant names).
- **Validate**: `pnpm --filter web typecheck`.

### Task 4: HTTP fetcher with size cap and typed errors

- **File**: `apps/web/src/lib/generic-parser/fetchHtml.ts`
- **Action**: CREATE
- **Implement**:
  - Export `fetchHtml(normalizedUrl: string, options?: { signal?: AbortSignal }): Promise<{ html: string; finalUrl: string }>`.
  - Reuse the local `combineSignals` and `isAbortError` helpers from `mediawiki/client.ts:8-26` (copy them — they're 6 lines each and not worth extracting to a shared module yet; flag in risks).
  - `fetch(url, { headers: { Accept: 'text/html, application/xhtml+xml; q=0.9, */*; q=0.1', 'User-Agent': getUserAgent() }, signal, redirect: 'follow' })`.
  - Map fetch rejection → `timeout` or `http_error` (status 0) exactly like `mediawiki/client.ts:49-76`.
  - On `!res.ok`, throw `http_error` with `res.status`. Same `logger.warn('generic_fetch_error', { ... })` envelope.
  - Validate `Content-Type` header: parse the first token (before `;`). If it does not match `/^(text\/html|application\/xhtml\+xml)$/i`, throw `bad_content_type`.
  - Read the body via a streaming reader bounded by `getMaxBytes()`. Concrete approach: `res.body!.getReader()`, accumulate `Uint8Array` chunks, abort and throw `too_large` if accumulated length exceeds the limit. Decode with `TextDecoder` (respect `charset=` from Content-Type when present; default UTF-8). Plain `await res.text()` would buffer the entire body without bound — must not use it.
  - On empty body, throw `bad_response`.
  - Emit `logger.info('generic_fetch_ok', { event, hostname, status, bytes, duration_ms, final_url_host })` on success. Hostname comes from the requested URL; `final_url_host` from `res.url` so cross-origin redirects are observable.
  - Returned `finalUrl` is `res.url` when parseable, else the input.
- **Mirror**: `apps/web/src/lib/mediawiki/client.ts:28-149` (overall control-flow + log shape).
- **Validate**: `pnpm --filter web typecheck`.

### Task 5: DOM extractor — Readability + heuristic fallback

- **File**: `apps/web/src/lib/generic-parser/extractArticle.ts`
- **Action**: CREATE
- **Implement**:
  - Export `extractArticle(html: string, ctx: { url: string; hostname: string }): { title: string; contentHtml: string; byline?: string; excerpt?: string; lang?: string }`. Throws `GenericParserError` with `code: 'extraction_failed'` when no main content block is found.
  - Build the DOM:
    ```ts
    const dom = new JSDOM(html, { url: ctx.url });        // url enables relative-link resolution
    const doc = dom.window.document;
    ```
  - Capture `lang` from `<html lang="...">` and `<head><title>` text before extraction (Readability mutates the DOM).
  - Run `new Readability(doc, { /* defaults */ }).parse()`. If it returns non-null, prefer its `content` (sanitized HTML), `title`, `byline`, `excerpt`. Readability already drops nav/footer/scripts/styles and selects the highest-scoring content block using text density, which satisfies AC #2.
  - Fallback path when Readability returns `null` (e.g. very short pages): query the freshly re-parsed DOM (re-instantiate `JSDOM(html)` since Readability mutates) for `<article>`, then `<main>`. Take `outerHTML` of the first match whose text-content length exceeds 200 characters. If still nothing, scan all top-level `<section>` and `<div>` direct children of `<body>` and pick the one whose `textContent.length` is largest — this is the "longest text density" branch.
  - If even the fallback yields no candidate with ≥200 chars of text, throw `extraction_failed` with `{ hostname, message: 'No main content block detected.' }`.
  - The fallback path explicitly strips known-noisy elements before measuring: remove `<nav>`, `<header>`, `<footer>`, `<aside>`, `<form>`, `<script>`, `<style>`, `[role="navigation"]`, `[role="banner"]`, `[role="contentinfo"]` via `element.querySelectorAll(...).forEach(n => n.remove())` on a cloned subtree. This makes AC #2 hold even when Readability declines.
  - Sanitization concern: Readability's output is reasonably safe but not DOMPurify-safe. The proxy view that ultimately renders this HTML is FR-VW-2's responsibility and already strips/sanitizes scripts — do **not** duplicate sanitization here. Add a one-line comment to that effect and link to FR-VW-2.
- **Mirror**: No exact precedent in repo. The shape (pure function, throws typed errors) follows `apps/web/src/lib/mediawiki/parseResponse.ts:214-250`.
- **Validate**: `pnpm --filter web typecheck`.

### Task 6: Orchestrator + content hash

- **File**: `apps/web/src/lib/generic-parser/parseGenericArticle.ts`
- **Action**: CREATE
- **Implement**:
  - Export `parseGenericArticle(normalizedUrl: string, options?: { signal?: AbortSignal }): Promise<GenericArticle>`.
  - Call `classifySource(normalizedUrl)`; if `kind !== 'generic'`, throw `extraction_failed` with a message — defensive parity with `mediawiki/client.ts:32-39`'s `not_mediawiki` guard (the dispatcher already routes correctly, but this keeps the function safe to call directly from tests and future callers).
  - `const { html, finalUrl } = await fetchHtml(normalizedUrl, options)`.
  - `const extracted = extractArticle(html, { url: finalUrl, hostname: source.hostname })`.
  - Compute `revisionHash`: normalize the extracted text — strip tags via the existing `mediawiki/parseResponse.ts:45-47` `stripTags` helper pattern (duplicate the 1-liner; not worth a shared module yet), collapse whitespace to single spaces, lowercase, trim. Hash with `crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))`, hex-encode, prefix with `'sha256:'`. Aligns with FR-VW-5 in `docs/PRD.md:91`.
  - Assemble and return:
    ```ts
    const sections: Section[] = [
      { id: '', title: extracted.title, level: 0, html: extracted.contentHtml },
    ];
    return {
      kind: 'generic',
      url: normalizedUrl,
      hostname: source.hostname,
      title: extracted.title,
      revisionHash,
      fetchedAt: new Date().toISOString(),
      sections,
      leadHtml: extracted.contentHtml,
      byline: extracted.byline,
      excerpt: extracted.excerpt,
      lang: extracted.lang,
    };
    ```
  - Emit `logger.info('generic_parse_ok', { event, hostname, revision_hash, bytes, sections: 1, duration_ms })` once at the end.
- **Mirror**: `apps/web/src/lib/mediawiki/client.ts:28-149` overall shape (fetch → parse → assemble + log).
- **Validate**: `pnpm --filter web typecheck`.

### Task 7: Module barrel

- **File**: `apps/web/src/lib/generic-parser/index.ts`
- **Action**: CREATE
- **Implement**: Re-export `parseGenericArticle` from `./parseGenericArticle`, the types `GenericArticle`, `GenericParserErrorDetail`, and the `GenericParserError` class from `./types`.
- **Mirror**: `apps/web/src/lib/mediawiki/index.ts:1-15`.
- **Validate**: `pnpm --filter web typecheck`.

### Task 8: HTML fixture factory

- **File**: `apps/web/test/factories/mockGenericPage.ts`
- **Action**: CREATE
- **Implement**: `mockGenericPage(input?: { title?: string; container?: 'article' \| 'main' \| 'div'; paragraphs?: number; includeNav?: boolean; includeFooter?: boolean; bodyOverride?: string; lang?: string }): string`. Returns a full `<!doctype html>...` document with optional `<nav>NAVIGATION_NOISE</nav>` and `<footer>FOOTER_NOISE</footer>`, an article container holding `paragraphs` `<p>`s of substantial filler text (≥80 chars each, so density heuristics fire), and a configurable title in `<head>` and inside the container as `<h1>`.
- **Mirror**: `apps/web/test/factories/mockMediaWikiResponse.ts:1-65`.
- **Validate**: importable from a test file; `pnpm --filter web typecheck`.

### Task 9: Fetcher unit tests

- **File**: `apps/web/src/lib/generic-parser/fetchHtml.test.ts`
- **Action**: CREATE
- **Implement** (one `it` per branch):
  - Happy path: `server.use(http.get(URL, () => new HttpResponse(mockGenericPage(), { headers: { 'content-type': 'text/html; charset=utf-8' } })))`. Assert returned `html` contains the body and `finalUrl` matches.
  - HTTP 500 → `http_error` with `status === 500`.
  - HTTP 429 → `http_error` with `status === 429`.
  - Non-HTML content-type → `bad_content_type` (use `application/pdf`).
  - Empty body, 200 OK → `bad_response`.
  - Body larger than `limitBytes` → `too_large`. Set `GENERIC_PARSER_MAX_BYTES = '4096'` via `vi.stubEnv` and return a 6 KB body.
  - AbortSignal pre-aborted → `timeout` (the controller is aborted before the call; the fetch rejects with AbortError immediately).
- **Mirror**: `apps/web/src/lib/mediawiki/client.test.ts:11-109` for assertion style; uses `MediaWikiApiError`-checking pattern for `instanceof` + `detail.code` discriminant.
- **Validate**: `pnpm --filter web test src/lib/generic-parser/fetchHtml.test.ts`.

### Task 10: Extractor unit tests

- **File**: `apps/web/src/lib/generic-parser/extractArticle.test.ts`
- **Action**: CREATE
- **Implement** (parameterized via `mockGenericPage`, no HTTP):
  - `<article>` container → returned `contentHtml` contains the article paragraphs and does **not** contain `NAVIGATION_NOISE` or `FOOTER_NOISE`. (AC #1 + AC #2)
  - `<main>` container with no `<article>` → same assertions. (AC #1 + AC #2)
  - Plain `<div>` container with high text density and `<nav>`/`<footer>` siblings → density-based selection wins; noise stripped. (AC #1 + AC #2)
  - Title extraction prefers `<h1>` inside the content block over the `<head><title>` when both differ.
  - `lang` from `<html lang="en-GB">` is preserved.
  - Empty body, just nav/footer noise → throws `GenericParserError` with `code: 'extraction_failed'`.
- **Mirror**: `apps/web/src/lib/mediawiki/parseResponse.test.ts` for the parameterized factory pattern.
- **Validate**: `pnpm --filter web test src/lib/generic-parser/extractArticle.test.ts`.

### Task 11: Orchestrator integration tests

- **File**: `apps/web/src/lib/generic-parser/parseGenericArticle.test.ts`
- **Action**: CREATE
- **Implement**:
  - Happy path with MSW serving an `<article>`-wrapped page → returns `kind: 'generic'`, `revisionHash` matches `/^sha256:[0-9a-f]{64}$/`, `sections.length === 1`, `sections[0].id === ''`, `leadHtml === sections[0].html`, `hostname === 'example.com'`.
  - Two requests for the **same** body return the **same** `revisionHash` (determinism).
  - Two requests where the second body has one extra paragraph return **different** `revisionHash` values (sensitivity).
  - `fetchHtml`-layer error (e.g. 500) propagates as `GenericParserError { code: 'http_error', status: 500 }`.
  - `extractArticle`-layer failure (body has only noise) propagates as `GenericParserError { code: 'extraction_failed' }`.
- **Mirror**: `apps/web/src/lib/mediawiki/client.test.ts:11-109`.
- **Validate**: `pnpm --filter web test src/lib/generic-parser/parseGenericArticle.test.ts`.

### Task 12: Wire dispatcher to generic parser

- **File**: `apps/web/src/lib/parser/index.ts`
- **Action**: UPDATE
- **Implement**:
  - Import `parseGenericArticle` from `@/lib/generic-parser`.
  - Replace the `return { kind: 'fallback', ... }` literal with `return parseGenericArticle(normalizedUrl, options);`.
  - Update the file-header comment: drop "until then it returns a typed sentinel"; describe both branches.
  - Update the re-export at line 25: remove `FallbackResult`, add `GenericArticle`.
- **Mirror**: existing structure in `apps/web/src/lib/parser/index.ts:9-23`.
- **Validate**: `pnpm --filter web typecheck`.

### Task 13: Update dispatcher types

- **File**: `apps/web/src/lib/parser/types.ts`
- **Action**: UPDATE
- **Implement**:
  - Import `GenericArticle` from `@/lib/generic-parser` alongside `MediaWikiArticle`.
  - Delete the `FallbackResult` type entirely (no shim, no re-export).
  - `ParsedArticle = MediaWikiArticle | GenericArticle`.
- **Mirror**: previous shape at `apps/web/src/lib/parser/types.ts:1-10`.
- **Validate**: `pnpm --filter web typecheck`.

### Task 14: Update dispatcher tests

- **File**: `apps/web/src/lib/parser/index.test.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `vi.mock('@/lib/generic-parser', () => ({ parseGenericArticle: vi.fn() }))` alongside the existing `vi.mock('@/lib/mediawiki', ...)` at lines 5-7.
  - Reset both mocks in `afterEach`.
  - Replace the "returns a typed fallback sentinel" test (lines 57-66) with:
    ```ts
    it('routes a non-MediaWiki URL to parseGenericArticle', async () => {
      mockParseGenericArticle.mockResolvedValue({
        kind: 'generic',
        url: 'https://www.britannica.com/topic/foo',
        hostname: 'www.britannica.com',
        title: 'Foo',
        revisionHash: 'sha256:' + 'a'.repeat(64),
        fetchedAt: '2026-05-16T00:00:00.000Z',
        sections: [{ id: '', title: 'Foo', level: 0, html: '<p>x</p>' }],
        leadHtml: '<p>x</p>',
      });
      const result = await parseArticle('https://www.britannica.com/topic/foo');
      expect(mockParseGenericArticle).toHaveBeenCalledWith(
        'https://www.britannica.com/topic/foo',
        undefined,
      );
      expect(result.kind).toBe('generic');
    });
    ```
  - Replace the "returns a fallback for a known host that has no /wiki/ path" test (lines 68-73) similarly: it now routes to the generic parser.
  - Add a "propagates errors thrown by parseGenericArticle" test mirroring the existing MediaWiki error-propagation test at lines 75-78.
- **Mirror**: `apps/web/src/lib/parser/index.test.ts:1-79`.
- **Validate**: `pnpm --filter web test src/lib/parser/index.test.ts`.

### Task 15: Full verification

- **File**: n/a
- **Action**: validation
- **Implement**: Run the full required verification set from `AGENTS.md:42`.
- **Validate**:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`

---

## Risks

| Risk | Mitigation |
|------|------------|
| Readability + jsdom is heavy at runtime (multi-MB dep, slow on cold start). | Acceptable for v1 since the proxy view is already server-rendered and cached ≥15 min (FR-VW-2). Note the cost in the commit and revisit if P95 hits FR-VW-6 (cold ≤5 s). |
| SSRF: the generic fetcher will accept any URL the dispatcher hands it. | FR-VW-1 places URL validation (scheme, denylist, internal IP ranges) at the dashboard-entry layer, not the parser. This plan does **not** add an SSRF guard inside `fetchHtml` because the parser should be agnostic to where the URL came from. Document explicitly in the parser README/comment that **all callers must run the URL through the FR-VW-1 validator first** and link to wherever that lands. If FR-VW-1 isn't yet implemented when this lands, file a follow-up issue and add a stub-level check (reject `localhost`, `127.0.0.0/8`, RFC1918, link-local via `ipaddr.js` — already in deps at `apps/web/package.json:22`). |
| Unbounded response body could OOM the worker. | `fetchHtml` enforces `GENERIC_PARSER_MAX_BYTES` (default 5 MB) via streaming reader; throws `too_large` instead of buffering with `res.text()`. Tested in Task 9. |
| Readability mutates the DOM, so the fallback path needs a fresh parse. | The extractor re-instantiates `JSDOM(html)` for the fallback branch. Tested in Task 10. |
| Content hash sensitivity to whitespace / case could produce false-positive drift. | Normalize before hashing: strip tags, collapse whitespace, lowercase, trim. Determinism + sensitivity tested in Task 11. |
| Duplicated `combineSignals` / `isAbortError` / `stripTags` helpers across `mediawiki/` and `generic-parser/`. | Acceptable until a third caller emerges (rule of three). Flag a follow-up to extract `apps/web/src/lib/_internal/fetch-helpers.ts` once a third consumer appears — don't pre-factor here. |
| `@mozilla/readability` version drift could quietly change extraction behavior. | Pin to a caret-bounded minor (`^0.5.x`) for now; rely on `extractArticle.test.ts` to catch regressions. |
| Dropping `FallbackResult` is a breaking change for any external consumer that switches on `kind: 'fallback'`. | The type was added in LEX-73 with the explicit intent of being a placeholder (`apps/web/src/lib/parser/index.ts:6-8`, `parser/types.ts:7` `reason: 'generic_scraper_not_yet_implemented'`). No production code switches on it (verified: only `parser/index.test.ts` references it). Safe to remove. |
| `jsdom` is currently in `devDependencies` only. | Task 1 promotes it to `dependencies` so it ships in the production bundle. |

---

## Validation

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Unit tests (Vitest, no real network thanks to MSW onUnhandledRequest: 'error')
pnpm test

# Build
pnpm build
```

Smoke tests (`pnpm test:smoke`) are **not** added in this plan — the generic parser does not call any service requiring real credentials. If desired, a future smoke test could fetch a known-stable URL (e.g. example.com) and assert `kind: 'generic'`, but it must auto-skip when offline per the convention in `AGENTS.md:45`.

---

## Acceptance Criteria

- [ ] AC #1 (Linear): Non-MediaWiki URL parses with `<article>`/`<main>`/text-density selection — covered by Task 10.
- [ ] AC #2 (Linear): Navigation/footer noise excluded from main content — covered by Task 10.
- [ ] Dispatcher returns `kind: 'generic'` for non-MediaWiki URLs and `kind: 'mediawiki'` for MediaWiki URLs.
- [ ] `FallbackResult` is fully removed from the codebase.
- [ ] `GenericParserError` discriminated union matches the structure of `MediaWikiApiError`.
- [ ] `revisionHash` is deterministic, `'sha256:<64-hex>'`, and changes when content changes.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.
- [ ] No new `apps/web/src/lib/**/!(*.test).ts` ships without an adjacent `.test.ts` (`AGENTS.md:47`).
- [ ] No new API route ships without a test (n/a — this plan adds none).
- [ ] PR description notes the new env vars `GENERIC_PARSER_TIMEOUT_MS`, `GENERIC_PARSER_USER_AGENT`, `GENERIC_PARSER_MAX_BYTES` and the new `@mozilla/readability` dependency.
