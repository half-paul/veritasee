# Implementation Report

**Plan**: `.agents/plans/lex-75-text-fragment-anchor.plan.md`
**Branch**: `features/LEX-75-text-fragment-anchor`
**Status**: COMPLETE

## Summary

Added a DOM-free `apps/web/src/lib/text-fragment/` library that computes a W3C Text Fragment anchor `(prefix, textStart, textEnd, suffix)` from a `(normalizedText, start, end)` selection, serializes/deserializes the canonical `:~:text=` URL form, and locates an anchor in a normalized text body. The module satisfies AC #1 (same-revision round-trip) and AC #2 (adjacent identical phrases disambiguate). Tag stripping, NFC normalization, whitespace collapse, and case-fold matching all live in the module's own normalizer so the proxy/extractor's hash-domain normalizer (which lowercases) stays untouched.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Module barrel placeholder | `apps/web/src/lib/text-fragment/index.ts` | ✅ |
| 2 | Anchor types + error class + constants | `apps/web/src/lib/text-fragment/types.ts` | ✅ |
| 3 | Text normalization (anchor-domain) | `apps/web/src/lib/text-fragment/normalize.ts` | ✅ |
| 4 | `locateAnchor()` + internal `findAllMatches` | `apps/web/src/lib/text-fragment/locate.ts` | ✅ |
| 5 | `computeAnchor()` with disambiguation cascade | `apps/web/src/lib/text-fragment/compute.ts` | ✅ |
| 6 | `serializeAnchor()` / `parseAnchor()` | `apps/web/src/lib/text-fragment/serialize.ts` | ✅ |
| 7 | Complete module barrel | `apps/web/src/lib/text-fragment/index.ts` | ✅ |
| 8 | Fixture factory | `apps/web/test/factories/articleText.ts` | ✅ |
| 9 | Normalization tests | `apps/web/src/lib/text-fragment/normalize.test.ts` | ✅ |
| 10 | `locateAnchor` tests | `apps/web/src/lib/text-fragment/locate.test.ts` | ✅ |
| 11 | `computeAnchor` tests (AC #2) | `apps/web/src/lib/text-fragment/compute.test.ts` | ✅ |
| 12 | Serializer tests | `apps/web/src/lib/text-fragment/serialize.test.ts` | ✅ |
| 13 | Round-trip integration test (AC #1) | `apps/web/src/lib/text-fragment/roundtrip.test.ts` | ✅ |
| 14 | Full verification | n/a | ✅ |

## Validation Results

| Check | Result |
|-------|--------|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ (281 passed, including 65 new in `text-fragment/` and the 200-iteration AC #1 fuzz) |
| `pnpm build` | ✅ |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `apps/web/src/lib/text-fragment/index.ts` | CREATE | +12 |
| `apps/web/src/lib/text-fragment/types.ts` | CREATE | +57 |
| `apps/web/src/lib/text-fragment/normalize.ts` | CREATE | +23 |
| `apps/web/src/lib/text-fragment/locate.ts` | CREATE | +74 |
| `apps/web/src/lib/text-fragment/compute.ts` | CREATE | +235 |
| `apps/web/src/lib/text-fragment/serialize.ts` | CREATE | +91 |
| `apps/web/src/lib/text-fragment/normalize.test.ts` | CREATE | +48 |
| `apps/web/src/lib/text-fragment/locate.test.ts` | CREATE | +65 |
| `apps/web/src/lib/text-fragment/compute.test.ts` | CREATE | +164 |
| `apps/web/src/lib/text-fragment/serialize.test.ts` | CREATE | +120 |
| `apps/web/src/lib/text-fragment/roundtrip.test.ts` | CREATE | +124 |
| `apps/web/test/factories/articleText.ts` | CREATE | +70 |

No changes to existing files: `packages/db`, `parser/`, `generic-parser/`, `mediawiki/`, `proxy-cache/`. No new dependencies.

## Deviations from Plan

1. **`computeAnchor` uniqueness check now requires `end` match in addition to `start`.** The plan said "matches.length === 1 and match's start === input.start". The 200-iteration fuzz exposed a real round-trip break for range form: when the `lastNWords` `textEnd` has an earlier occurrence inside the selection's interior, the W3C matcher's "first textEnd after textStart" rule resolves to a *shorter* span than the user's selection. That violates AC #1's own interpretation ("locate returns a range whose (start, end) equals the original selection"), so the uniqueness predicate now checks both. Single-text mode (where `match.end` is mechanically derived from `match.start + textStart.length`) is unaffected.

2. **Range form falls back to single-text form when it cannot pin the end.** Same root cause as #1. A `selectBaseAnchor` helper verifies up front that `textEnd`'s first match after `start + textStart.length` lands exactly at `end - textEnd.length`; if not, the anchor uses single-text form. This is conservative: range form's payoff is robustness to mid-range edits, which is a cross-revision concern owned by VS-027. For LEX-75's same-revision AC #1, single-text fallback is correct.

3. **`LARGE_ARTICLE` uses uniquely-numbered section headers ("Section N: …") instead of pure repetition.** The plan said "≥5 KB of paragraphs assembled by repeating a short corpus." A literal interpretation made every fuzz iteration ambiguous beyond the 12-word disambiguation cap (because each repeated paragraph was ≥24 words long), so 200/200 iterations failed `not_disambiguatable`. Numbered headers make the disambiguation cascade reachable from anywhere inside any section, which is what the plan intended.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `normalize.test.ts` | whitespace collapse, trim, case preservation, tag stripping, idempotency, NFC normalization, `caseFold` lowercases + length-preserves ASCII (9 cases) |
| `locate.test.ts` | first-match deterministic, `null` on no-match, prefix filter, suffix filter, range-form span, case-insensitive match, prefix mismatch → null, textEnd missing → null (10 cases) |
| `compute.test.ts` | unique-start short-circuits, range-form threshold + content, casing preservation, bounds (`start<0`, `end>len`, `start>=end`), empty selection, AC #2 disambiguation for 1st/2nd/3rd occurrence of `"the cat sat"`, `not_disambiguatable` on `HEAVY_REPETITION` (13 cases) |
| `serialize.test.ts` | each part shape (single-text, range, prefix-only, suffix-only, full quad), percent-encoding of `,`/`-`/`&`, full round-trip on 8 anchor shapes, null on bad inputs (28 cases) |
| `roundtrip.test.ts` | **AC #1**: deterministic 200-iteration fuzz (compute → serialize → parse → locate must equal original `(start, end)`); + 4 targeted cases — first paragraph, paragraph boundary, single word, long range-form paragraph (5 cases) |

**Total: 65 tests, all passing.**

## Acceptance Criteria Check

- [x] All tasks completed
- [x] `pnpm typecheck` passes
- [x] `pnpm lint` passes
- [x] `pnpm test` passes (including the 200-iteration `roundtrip.test.ts` fuzz)
- [x] `pnpm build` passes
- [x] AC #1 explicitly covered by `roundtrip.test.ts` (compute → serialize → parse → locate returns the original `(start, end)` for every iteration)
- [x] AC #2 explicitly covered by `compute.test.ts` (two adjacent identical phrases each anchor uniquely; `locateAnchor` returns the *correct* occurrence's offsets, not just any match) — 3 tests, one per occurrence of `"the cat sat"`
- [x] No changes to `packages/db` schema
- [x] Module is DOM-free (no `jsdom`, no `window`, no `document` references); runs in default Node Vitest env
