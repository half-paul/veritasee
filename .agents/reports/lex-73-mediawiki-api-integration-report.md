## Implementation Report

**Plan**: `.agents/plans/lex-73-mediawiki-api-integration.plan.md`
**Branch**: `features/LEX-73`
**Status**: COMPLETE

## Summary

Implemented the server-side MediaWiki API integration: a pure source classifier that routes URLs to either the MediaWiki path or a typed fallback stub, a MediaWiki client that extracts structured sections + a stable revision ID via a single `action=parse` call, a `parseArticle()` dispatcher as the only public entry point, and a token-gated `/api/health/mediawiki` smoke endpoint. No new dependencies. Health endpoint verified live against Wikipedia and Citizendium; Britannica routes to the fallback stub as required.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Source class discriminated union | `apps/web/src/lib/source-classifier/types.ts` | DONE |
| 2 | MediaWiki host table (suffix + apiPath) | `apps/web/src/lib/source-classifier/hosts.ts` | DONE |
| 3 | `classifySource(url)` pure function | `apps/web/src/lib/source-classifier/classify.ts` | DONE |
| 4 | source-classifier barrel | `apps/web/src/lib/source-classifier/index.ts` | DONE |
| 5 | MediaWiki types + `MediaWikiApiError` class | `apps/web/src/lib/mediawiki/types.ts` | DONE |
| 6 | Timeout / User-Agent env readers | `apps/web/src/lib/mediawiki/env.ts` | DONE |
| 7 | `buildMediaWikiRequest()` pure helper | `apps/web/src/lib/mediawiki/buildRequest.ts` | DONE |
| 8 | `parseMediaWikiResponse()` (shape check + section splitter) | `apps/web/src/lib/mediawiki/parseResponse.ts` | DONE |
| 9 | `fetchSections()` orchestrator | `apps/web/src/lib/mediawiki/client.ts` | DONE |
| 10 | mediawiki barrel | `apps/web/src/lib/mediawiki/index.ts` | DONE |
| 11 | `ParsedArticle` / `FallbackResult` types | `apps/web/src/lib/parser/types.ts` | DONE |
| 12 | `parseArticle()` dispatcher | `apps/web/src/lib/parser/index.ts` | DONE |
| 13 | Token-gated health endpoint | `apps/web/src/app/api/health/mediawiki/route.ts` | DONE |
| 14 | `.env.example` documentation | `apps/web/.env.example` | DONE |

## Validation Results

| Check | Result |
|-------|--------|
| `pnpm typecheck` (4 workspaces) | PASS |
| `pnpm lint` (4 workspaces) | PASS |
| `pnpm build` | PASS (route `/api/health/mediawiki` appears in the manifest) |
| Unit tests | N/A — no test framework configured in `apps/web` (deferred per LEX-71). Health endpoint serves as the integration smoke. |

### End-to-end smoke (against the running dev server)

| Scenario | Result |
|----------|--------|
| Wikipedia probe (`en.wikipedia.org/wiki/HTTP_404`) | `{ ok: true, sections: 12, revisionId: 1351605800, fetchMs: ~320 }` |
| Citizendium probe (`en.citizendium.org/wiki/Biology`) | `{ ok: true, sections: 16, revisionId: 964366, fetchMs: ~520 }` |
| Britannica probe (`www.britannica.com/topic/Internet`) | `{ ok: false, step: "classify", error: "probe URL was not classified as MediaWiki" }` HTTP 503 |
| Live Citizendium API direct GET | `parse` object returned, `revid=964366` — confirms `/wiki/api.php` is the correct path |

The Citizendium and Britannica probes were run by temporarily editing `PROBE_URL` in the health route; the committed value is back to the Wikipedia URL.

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `apps/web/src/lib/source-classifier/types.ts` | CREATE | 18 |
| `apps/web/src/lib/source-classifier/hosts.ts` | CREATE | 25 |
| `apps/web/src/lib/source-classifier/classify.ts` | CREATE | 54 |
| `apps/web/src/lib/source-classifier/index.ts` | CREATE | 4 |
| `apps/web/src/lib/mediawiki/types.ts` | CREATE | 55 |
| `apps/web/src/lib/mediawiki/env.ts` | CREATE | 21 |
| `apps/web/src/lib/mediawiki/buildRequest.ts` | CREATE | 28 |
| `apps/web/src/lib/mediawiki/parseResponse.ts` | CREATE | 250 |
| `apps/web/src/lib/mediawiki/client.ts` | CREATE | 149 |
| `apps/web/src/lib/mediawiki/index.ts` | CREATE | 14 |
| `apps/web/src/lib/parser/types.ts` | CREATE | 10 |
| `apps/web/src/lib/parser/index.ts` | CREATE | 25 |
| `apps/web/src/app/api/health/mediawiki/route.ts` | CREATE | 94 |
| `apps/web/.env.example` | UPDATE | +15 |

## Deviations from Plan

1. **Host table shape — per-host `apiPath` instead of a flat suffix list.** The plan section §3 listed Citizendium with `/wiki/api.php` while §6 of the original draft of `hosts.ts` would have hardcoded `/w/api.php` for every host. To honor the plan's call-out that Citizendium uses a different path, I refactored `hosts.ts` to export a `MEDIAWIKI_HOSTS: readonly { suffix; apiPath }[]` table (with a derived `MEDIAWIKI_HOST_SUFFIXES` for callers that only need the suffix list). `classifySource()` looks up the entry and emits `apiEndpoint = \`https://${host}${entry.apiPath}\``. Verified live: Citizendium responds to `/wiki/api.php` and not `/w/api.php`.
2. **Single-call `prop=text` only** — the plan called out one `action=parse&prop=sections|text|revid|displaytitle` call, which is what I shipped. No deviation; documented here for clarity.
3. **Section HTML splitter** — the plan accepted a regex over the rendered text. I implemented a two-pass scheme: locate each API section anchor by searching `id="<anchor>"`, then walk back at most 300 chars to find the enclosing `<div class="mw-heading">` wrapper (newer Parsoid output) OR the nearest `<hN ...>` open (legacy output). Sections are then sliced from each heading start to the next equal-or-higher-level heading. This handles both heading shapes MediaWiki currently emits.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| None | No test framework configured in `apps/web` (LEX-71 deferral). The health endpoint exercises the full stack (classify → buildRequest → fetch → parseResponse → MediaWikiArticle assembly) against live MediaWiki APIs and is the integration smoke. A follow-up Vitest ticket should add `classify.test.ts`, `parseResponse.test.ts`, and a `client.smoke.test.ts`. |
