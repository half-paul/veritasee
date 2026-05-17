# Plan Review: Generic Readability-style Article Extractor

**Scope**: `.agents/plans/generic-readability-article-extractor.plan.md` (LEX-74)
**Recommendation**: **NEEDS WORK** — directionally sound, but two issues (SSRF posture, a contradictory test expectation) must be resolved before implementation; several others should be tightened.

## Summary

The plan replaces `FallbackResult` with a real generic article extractor backed by `@mozilla/readability` + `jsdom`, mirroring the existing `mediawiki/` module's shape (discriminated unions, custom error class, env-driven tunables, MSW-based tests, factory builders). The architecture and AC traceability are well-thought-through. The two blocking concerns are (1) accepting deployed SSRF risk while FR-VW-1 is unconfirmed and (2) a Readability vs. test-expectation mismatch for title selection. The rest is small-bore tightening.

---

## Issues Found

### Critical

None.

### High Priority

**H1. SSRF posture is "wait for FR-VW-1", with a redirect-follow that bypasses it anyway.**
- Plan, Risks row 2: "this plan does **not** add an SSRF guard inside `fetchHtml`" and conditionally "if FR-VW-1 isn't yet implemented … file a follow-up issue and add a stub-level check." That's an optional clause; the tasks themselves never implement the stub.
- Worse: `fetchHtml` uses `redirect: 'follow'` (Task 4). Even with a perfect FR-VW-1 entry-point validator, an attacker-controlled host can `302 Location: http://127.0.0.1:6379/...` and the parser follows it. MediaWiki's client has a `bad_redirect` host-allowlist that catches this; the generic fetcher has no equivalent and by design cannot allowlist (any host is valid).
- **Recommendation**: either (a) require FR-VW-1 to land first as a hard dependency and document it in the plan's "Predecessor" field, OR (b) commit (not "conditionally consider") to adding a per-hop SSRF guard inside `fetchHtml`: switch to `redirect: 'manual'`, validate each `Location` against the same DNS-resolve + `ipaddr.js` blocklist that FR-VW-1 will use, then re-fetch. `ipaddr.js` is already in `apps/web/package.json:22`.
- A follow-up Linear issue is not a mitigation if the code ships before it.

**H2. Task 10's title-extraction test contradicts Readability's behavior.**
- Task 10 asserts: "Title extraction prefers `<h1>` inside the content block over the `<head><title>` when both differ."
- When Readability returns non-null (the happy path), it surfaces its own `title`, derived primarily from `<head><title>` (with separator/site-name stripping), NOT from the content-block `<h1>`. See `@mozilla/readability` `_getArticleTitle`. The test will fail on any input where `<head><title>` and content `<h1>` diverge.
- **Recommendation**: either drop the assertion, or scope it to the fallback path only (Readability returns null → we synthesize a title from `<h1>` ourselves). If kept, Task 5's spec must explicitly override Readability's title with the content-block `<h1>` after extraction, which is a meaningful behavior change with downstream implications (e.g. articles whose head-title is the canonical name but whose h1 is a stylized variant).

### Medium Priority

**M1. Double info-log on each successful parse.**
- Task 4 emits `logger.info('generic_fetch_ok', …)` and Task 6 emits `logger.info('generic_parse_ok', …)`. MediaWiki emits exactly **one** info log at end of `fetchSections` (`client.ts:139-147`). Two info logs per successful request inflates log volume and creates duplicate ingestion in Sentry/observability stack.
- **Recommendation**: drop `generic_fetch_ok` from `fetchHtml`. Keep warnings on failure branches. Log once in the orchestrator with `bytes` threaded through from `fetchHtml`'s return value.

**M2. TextDecoder + Content-Type charset will mojibake non-UTF-8 pages that declare charset only in `<meta charset>`.**
- Task 4: "Decode with `TextDecoder` (respect `charset=` from Content-Type when present; default UTF-8)."
- Many sites serve `Content-Type: text/html` (no charset) and embed `<meta charset="…">` inside the document. Pre-decoding bytes with `TextDecoder('utf-8')` bypasses the meta-charset sniffing path entirely; non-UTF-8 pages with no Content-Type charset will become mojibake before JSDOM ever sees them.
- **Recommendation**: either (a) hand bytes to JSDOM via `Buffer` and let JSDOM do BOM/meta sniffing (per `jsdom` docs, `new JSDOM(buffer, { contentType })` performs encoding detection), OR (b) do a two-pass: decode UTF-8 first, regex-sniff for `<meta charset>`, re-decode if mismatched. Option (a) is the cleaner fit.

**M3. `res.body!` non-null assertion can crash on bodyless responses.**
- Task 4 uses `res.body!.getReader()`. Plan also says "On empty body, throw `bad_response`" — but `null` body crashes the `.getReader()` call before that check runs. Edge case for 204/304 responses or unusual proxies.
- **Recommendation**: `if (!res.body) throw new GenericParserError({ code: 'bad_response', message: 'Empty response body.' });` *before* `.getReader()`.

**M4. `bytes` not threaded through `fetchHtml` return value.**
- Task 6's `generic_parse_ok` log includes `bytes`, but `fetchHtml` returns only `{ html, finalUrl }`. The orchestrator has no source for `bytes`. Either compute `html.length` in Bytes (lossy for multi-byte) or extend the return to `{ html, finalUrl, bytes }`.

### Suggestions (Low)

**L1. Pin `@mozilla/readability` to `^0.6.0`, not `^0.5.0`.**
- Current latest stable is `0.6.0` (verified via `npm view`). `^0.5.0` resolves to `0.5.x` only. If the choice of 0.5 is intentional (API stability), document why. Otherwise use `^0.6.0`.

**L2. Hash normalization lowercases — may be too aggressive.**
- Task 6: "strip tags, collapse whitespace, lowercase, trim." For an FR-VW-5 drift detector, a case-only edit (e.g. style guide change "FOO" → "Foo") is arguably a real edit and should drift the hash. Lowercasing absorbs it. The PRD says only "sha256 of normalized article text" without specifying case-folding.
- **Recommendation**: drop the lowercase step. Strip tags + collapse whitespace + trim is sufficient and matches typical text-hash normalization.

**L3. Returned `url` is the input, but `finalUrl` is discarded.**
- `parseGenericArticle` returns `url: normalizedUrl` (the input). After a cross-host redirect, the canonical source URL is the post-redirect one, which matters for FR-VW-1's cache key `(url, source-revision)`. Either expose `finalUrl` as a separate field on `GenericArticle` or document in code that `url` is the input (request key, not response provenance).

**L4. AbortError → `timeout` conflates user-abort with timeout.**
- Mirrored from `client.ts:51-62`. If a user-supplied `options.signal` aborts before the timer fires, the error is still labeled `timeout`. Not introduced by this plan, but worth a one-line comment so future devs understand the bias. Acceptable to defer.

**L5. `vi.stubEnv` without a teardown can leak between tests.**
- Task 9 uses `vi.stubEnv('GENERIC_PARSER_MAX_BYTES', '4096')`. Current `vitest.config.ts` does not set `unstubEnvs: true`. Add `afterEach(() => { vi.unstubAllEnvs(); })` to the fetcher test file, or set the config flag globally.

**L6. `@types/jsdom` placement.**
- Plan promotes `jsdom` to dependencies. `@types/jsdom` can stay in devDependencies (TS type-only packages aren't shipped to runtime). Not an issue; no change needed. Confirm the plan doesn't accidentally move it.

**L7. Re-using mediawiki's `MEDIAWIKI_DEFAULT_USER_AGENT` for generic UA is fine, but read carefully.**
- The Veritasee-branded UA is product-level, not source-specific, so the re-export is correct. Only thing to verify: `mediawiki/index.ts:3` already exports it — single source of truth is intact. Plan matches.

**L8. `extractArticle` re-parses HTML on the fallback path.**
- Task 5: "re-instantiate `JSDOM(html)` since Readability mutates". Correct, but a second multi-MB parse is wasteful. Alternative: clone the document via `doc.cloneNode(true)` *before* running Readability. JSDOM documents implement `cloneNode`, and a deep clone is ~10× faster than reparsing serialized HTML. Acceptable to defer; the fallback path is rare per the plan.

**L9. The fallback's `nav`/`header`/`footer`/`aside`/`form` strip happens "on a cloned subtree".**
- Task 5: "remove `<nav>`, `<header>`, … via `element.querySelectorAll(...).forEach(n => n.remove())` on a cloned subtree."
- Stripping happens *per-candidate* during measurement, but the returned `contentHtml` should also be the stripped version, not the original `outerHTML` of the candidate. Plan should clarify that the returned HTML is post-strip, since AC #2 requires noise excluded from the *output*, not just from the measurement.

**L10. `parseResponse.ts:45-47` `stripTags` is described as "duplicate the 1-liner; not worth a shared module yet".**
- Reasonable per rule-of-three. Just note that the duplicate's hash sensitivity (Task 6) is more load-bearing than the MediaWiki use (display title cosmetic), so the duplicate copy should land with a comment explaining what it normalizes for. Otherwise a future "DRY-up" PR might unify them and silently change hash semantics.

---

## Validation Results

| Check | Status |
|-------|--------|
| Type Check | N/A — plan, not code |
| Lint | N/A — plan, not code |
| Tests | N/A — plan, not code |
| Plan structure (sections present) | PASS |
| Source citations resolve | PASS — all `apps/web/src/lib/mediawiki/*` and `parser/*` line references verified against actual files |
| AC traceability | PASS — Linear ACs and PRD FR-VW-3/FR-VW-5 mapped to tasks |
| `AGENTS.md:47` test-adjacency rule satisfied | PASS — every new `lib/` file has an adjacent `.test.ts` task |

---

## What's Good

- **Mirrors the established module shape** (env constants → types/error class → env getters → fetcher → parser → orchestrator → barrel) so reviewers can pattern-match against `mediawiki/`.
- **Discriminated union throughout** (`GenericArticle.kind`, `GenericParserErrorDetail.code`) keeps callers exhaustive at the type level.
- **Streaming size cap with explicit "must not use `res.text()`" callout** in Task 4 — exactly the right framing for a security-adjacent fetch.
- **Determinism + sensitivity tests for `revisionHash`** (Task 11) are the right pair to lock in normalization semantics.
- **Single-section v1 representation** is well-justified against FR-VW-4 (text fragments anchor, not section ids) — a real design decision documented, not glossed over.
- **`FallbackResult` removal is verified clean** (only `parser/index.test.ts` references it; confirmed via grep). No back-compat shim — the right call.
- **Risks section explicitly names Readability + jsdom bundle weight, FR-VW-6 budget interaction, and helper duplication**, with concrete defer-or-mitigate decisions.
- **Test plan covers every error branch** discovered in the design, plus determinism + sensitivity tests — no gaps in coverage.

---

## Recommendation

**Before implementation:**

1. **Resolve H1** — either gate this on FR-VW-1 landing first (and add it to Predecessor metadata) or commit to in-fetcher per-redirect SSRF guards. The current "follow-up issue if FR-VW-1 isn't done" wording is not a mitigation.
2. **Resolve H2** — fix Task 10's title test to match Readability behavior, or rewrite Task 5's extractor to override Readability's title with content `<h1>`.
3. **Address M1–M4** — single info-log; charset handling via JSDOM bytes path; null-body guard; thread `bytes` through `fetchHtml` return.

**Optional improvements:** L1 (version pin), L2 (drop lowercase from hash), L3 (expose `finalUrl`), L4–L10 as desired.

Once H1/H2 are resolved and M1–M4 incorporated into the task list, the plan is ready to execute.
