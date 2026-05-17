# Implementation Report

**Plan**: `.agents/plans/completed/generic-readability-article-extractor.plan.md`
**Branch**: `features/LEX-103`
**Status**: COMPLETE
**Linear Issue**: LEX-74

## Summary

Replaced the temporary `FallbackResult` sentinel in the parser dispatcher with
a real generic article extractor for non-MediaWiki URLs. The extractor fetches
HTML over HTTP with a streaming size cap and timeout, runs Mozilla Readability
against a `jsdom` DOM, and falls back to `<article>` / `<main>` / text-density
heuristics when Readability declines. Output is a `GenericArticle` shaped to
parallel `MediaWikiArticle`, with a `sha256:` revision hash over normalized
extracted text. Errors flow through a `GenericParserError` discriminated union
that mirrors `MediaWikiApiError`.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Add `@mozilla/readability`; promote `jsdom` to deps | `apps/web/package.json` | ✅ |
| 2 | Generic parser types + error class | `apps/web/src/lib/generic-parser/types.ts` | ✅ |
| 3 | Env tunables (timeout, UA, max bytes) | `apps/web/src/lib/generic-parser/env.ts` | ✅ |
| 4 | HTTP fetcher with size cap and typed errors | `apps/web/src/lib/generic-parser/fetchHtml.ts` | ✅ |
| 5 | DOM extractor (Readability + heuristic fallback) | `apps/web/src/lib/generic-parser/extractArticle.ts` | ✅ |
| 6 | Orchestrator + content hash | `apps/web/src/lib/generic-parser/parseGenericArticle.ts` | ✅ |
| 7 | Module barrel | `apps/web/src/lib/generic-parser/index.ts` | ✅ |
| 8 | HTML fixture factory | `apps/web/test/factories/mockGenericPage.ts` | ✅ |
| 9 | Fetcher unit tests | `apps/web/src/lib/generic-parser/fetchHtml.test.ts` | ✅ |
| 10 | Extractor unit tests | `apps/web/src/lib/generic-parser/extractArticle.test.ts` | ✅ |
| 11 | Orchestrator integration tests | `apps/web/src/lib/generic-parser/parseGenericArticle.test.ts` | ✅ |
| 12 | Wire dispatcher to generic parser | `apps/web/src/lib/parser/index.ts` | ✅ |
| 13 | Update dispatcher types | `apps/web/src/lib/parser/types.ts` | ✅ |
| 14 | Update dispatcher tests | `apps/web/src/lib/parser/index.test.ts` | ✅ |
| 15 | Full verification | n/a | ✅ |

## Validation Results

| Check | Result |
|-------|--------|
| `pnpm typecheck` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm test` | ✅ 192 passed |
| `pnpm build` | ✅ |

## Files Changed

| File | Action |
|------|--------|
| `apps/web/package.json` | UPDATE (add `@mozilla/readability`, move `jsdom` to deps) |
| `apps/web/src/lib/generic-parser/types.ts` | CREATE |
| `apps/web/src/lib/generic-parser/env.ts` | CREATE |
| `apps/web/src/lib/generic-parser/fetchHtml.ts` | CREATE |
| `apps/web/src/lib/generic-parser/extractArticle.ts` | CREATE |
| `apps/web/src/lib/generic-parser/parseGenericArticle.ts` | CREATE |
| `apps/web/src/lib/generic-parser/index.ts` | CREATE |
| `apps/web/src/lib/generic-parser/fetchHtml.test.ts` | CREATE |
| `apps/web/src/lib/generic-parser/extractArticle.test.ts` | CREATE |
| `apps/web/src/lib/generic-parser/parseGenericArticle.test.ts` | CREATE |
| `apps/web/test/factories/mockGenericPage.ts` | CREATE |
| `apps/web/src/lib/parser/index.ts` | UPDATE (route generic branch) |
| `apps/web/src/lib/parser/types.ts` | UPDATE (drop `FallbackResult`, add `GenericArticle`) |
| `apps/web/src/lib/parser/index.test.ts` | UPDATE (mock both boundaries) |

## Deviations from Plan

1. **Title-extraction strategy.** The plan called for extracting `<h1>` from
   the post-Readability content. In practice Readability rewrites the
   article-level `<h1>` to `<h2>` to demote the heading, so the regex never
   matched. The implementation now captures the first `<body h1>` text from
   the original DOM *before* Readability mutates it, and uses that as the
   preferred title. Test #10 ("prefers `<h1>` over `<head><title>`") still
   covers the behaviour.

2. **Empty-content guard inside the extractor.** Readability returns a
   non-null result even for pages that contain only `<nav>` / `<footer>`
   noise (it wraps the body in a `readability-page-1` div). The extractor
   now also checks `parsed.textContent` length against the same
   `MIN_CONTENT_TEXT_LENGTH = 200` threshold used by the heuristic fallback
   and treats short results as "no main content found." Test #6
   ("extraction_failed on noise-only body") covers this.

3. **`reader.cancel()` is fire-and-forget.** Awaiting `reader.cancel()` after
   a `too_large` decision caused the response stream to stall in the MSW
   test harness (the test would hang until vitest's 10s timeout). The
   implementation now calls `void reader.cancel().catch(() => undefined)`
   and throws immediately. Behaviourally identical from the caller's POV;
   the response body is still abandoned.

4. **Extra `headTitle` knob on `mockGenericPage`.** Needed so the
   title-preference test can set `<head><title>` separately from the
   in-container `<h1>`. Minor addition to the factory; the plan listed the
   key knobs but did not enumerate this one.

5. **SHA-256 via `node:crypto` instead of `crypto.subtle`.** Node's
   `crypto.subtle.digest` would have worked but requires async/await and an
   ArrayBuffer round-trip. `createHash('sha256').update(...).digest('hex')`
   is synchronous and reads more clearly. Output is identical (hex SHA-256).

## Tests Written

| Test File | Test Cases |
|-----------|-----------|
| `apps/web/src/lib/generic-parser/fetchHtml.test.ts` | happy path (text/html, application/xhtml+xml), HTTP 500/429, bad_content_type, bad_response (empty body), too_large, timeout (pre-aborted signal) |
| `apps/web/src/lib/generic-parser/extractArticle.test.ts` | `<article>` selection + noise exclusion, `<main>` selection + noise exclusion, density-based `<div>` selection + noise exclusion, h1-over-head-title preference, `lang` preservation, extraction_failed on noise-only body |
| `apps/web/src/lib/generic-parser/parseGenericArticle.test.ts` | happy path (kind/url/hostname/title/sha256/sections/fetchedAt), hash determinism, hash sensitivity, http_error propagation, extraction_failed propagation, refuses MediaWiki URL |
| `apps/web/src/lib/parser/index.test.ts` | updated to mock both downstream parsers; added generic-routing, generic-abort, and generic-error-propagation tests |

## End-to-End Verification

The plan listed `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` as
the verification set (no smoke tests defined for this feature). All four
pass. The generic parser is exercised at the integration level by
`parseGenericArticle.test.ts`, which runs the full fetch → extract → hash
pipeline against MSW-served HTML.

## New env vars / dependencies

- `@mozilla/readability` ^0.5.0 (new runtime dep)
- `jsdom` ^25.0.1 (promoted from devDependencies)
- `GENERIC_PARSER_TIMEOUT_MS` (default 10 000, min 100, max 30 000)
- `GENERIC_PARSER_USER_AGENT` (default = `MEDIAWIKI_DEFAULT_USER_AGENT`)
- `GENERIC_PARSER_MAX_BYTES` (default 5 MB, min 64 KB, max 25 MB)
