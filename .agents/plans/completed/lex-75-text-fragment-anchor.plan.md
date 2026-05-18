# Plan: W3C Text Fragment Anchor — Compute + Normalize

## Summary

Add a pure-logic `text-fragment` library that computes a W3C Text Fragment anchor (`prefix`, `start`, `end`, `suffix`) from a user selection over the normalized article text, serializes/deserializes the canonical `:~:text=` URL form, and locates an anchor in a (normalized) text body — so an anchor written today round-trips on re-render against the same revision (AC #1) and disambiguates two adjacent identical phrases by minimally extending `prefix`/`suffix` (AC #2). The module is text-only and DOM-free: it operates over the same normalized article text the rest of the pipeline already produces (`parseGenericArticle.normalizeForHash` shape — adjusted to preserve case, see Task 2), so it is callable from both server (correction persistence) and client (selection capture) without environment shims. DOM `Range → offsets` mapping for the reader UI and fuzzy re-anchor on drift are explicitly out of scope and tracked by VS-028 and VS-027 respectively.

## User Story

As a contributor authoring a correction
I want my section selection to be stored as a stable text-fragment anchor
So that the correction re-renders against the same text on later page loads, even when the same phrase appears twice on the page.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `apps/web/src/lib/text-fragment` (NEW) |
| Linear Issue | LEX-75 (VS-025) |
| PRD Reference | FR-VW-5 (`docs/PRD.md:89-93`) |
| Predecessor | LEX-74 (generic parser — provides normalized article text), LEX-65 (DB schema — `corrections.anchor_text_fragment`/`anchor_prefix`/`anchor_suffix` columns already exist) |
| Followers | VS-026 (snapshot persistence), VS-027 (fuzzy re-anchor + drift banner), VS-028 (DOM section click → panel) |

---

## Acceptance Criteria (from Linear)

1. Given a user selection, when finalized, then an anchor `(prefix, start, end, suffix)` is computed and round-trips on re-render.
2. Given two adjacent identical phrases, when anchored, then prefix/suffix uniquely disambiguate.

**Interpretation:**

- "User selection" for v1 = a `(textStart, textEnd)` character range over the normalized article text. The DOM `Range → offsets` step is a separate ticket (VS-028); this lib accepts an offset range so it can be wired in from either side.
- "Round-trips on re-render" = given the same normalized text the anchor was computed from, `locate(anchor, text)` returns a range whose `(start, end)` equals the original selection. This is the *same-revision* round-trip; cross-revision/fuzzy is VS-027.
- "Adjacent identical phrases" = the canonical disambiguation pattern from the W3C spec. With selection text repeated at two positions, `prefix`/`suffix` must be populated and extended just enough that exactly one position in the text matches the full `(prefix, start[, end], suffix)` tuple.

---

## Background — W3C Text Fragments (informative)

The fragment format is `:~:text=[prefix-,]textStart[,textEnd][,-suffix]` (WICG/scroll-to-text-fragment). Each component is percent-encoded; `-` (when trailing on prefix or leading on suffix), `,`, and `&` are reserved punctuation in the fragment grammar and must be percent-encoded inside the text components.

Two relevant facts for this plan:

- **Matching is case-insensitive after Unicode case-fold** (per the spec). We preserve original casing in the stored anchor so the URL fragment reads naturally and so we can later compare against the casing of the source.
- **`textEnd` is a separator-style anchor**, not an offset: a range is `(textStart, textEnd)` where the match is "the shortest substring beginning with the first `textStart` occurrence after the prefix-anchored position and continuing through the next `textEnd` occurrence". We compute `textEnd` as a short suffix of the selection (Task 3 below) rather than the full selected text — this is what makes the anchor cheap to store and resilient to small mid-range edits, the property called out by PRD §FR-VW-5 line 90.

This plan implements only the **compute / normalize / locate / serialize** primitives. It does not implement the browser-native scroll-to-text behavior — that is purely a function of the URL fragment our serializer produces.

---

## Patterns to Follow

### Module shape — barrel + one file per responsibility

```ts
// SOURCE: apps/web/src/lib/generic-parser/index.ts:1-13
export { parseGenericArticle } from './parseGenericArticle';
export {
  GENERIC_PARSER_DEFAULT_USER_AGENT,
  // ...
  GenericParserError,
} from './types';
export type { GenericArticle, GenericParserErrorDetail } from './types';
```

The new `text-fragment/` module mirrors this: a barrel that re-exports the public functions (`computeAnchor`, `locateAnchor`, `serializeAnchor`, `parseAnchor`, `normalizeTextForAnchor`) and the public types (`TextFragmentAnchor`, `TextFragmentError`).

### Custom error subclass with discriminated `detail`

```ts
// SOURCE: apps/web/src/lib/generic-parser/types.ts:41-57
export type GenericParserErrorDetail =
  | { code: 'http_error'; status: number; message: string }
  | { code: 'extraction_failed'; hostname: string; message: string };

export class GenericParserError extends Error {
  readonly detail: GenericParserErrorDetail;
  constructor(detail: GenericParserErrorDetail) {
    super(detail.message ?? detail.code);
    this.name = 'GenericParserError';
    this.detail = detail;
  }
}
```

`TextFragmentError` follows the same shape with codes for the failure modes this module owns (Task 2).

### Pure function, throws typed errors

```ts
// SOURCE: apps/web/src/lib/generic-parser/extractArticle.ts:88-167
export function extractArticle(html: string, ctx: { url: string; hostname: string }): ExtractedArticle {
  // ...
  if (contentHtml.length === 0 || contentTextLength < MIN_CONTENT_TEXT_LENGTH) {
    throw new GenericParserError({ code: 'extraction_failed', hostname: ctx.hostname, message: '...' });
  }
  // ...
}
```

`computeAnchor` and `locateAnchor` are pure, synchronous, and throw `TextFragmentError` on illegal input (e.g. selection range outside the text bounds).

### Normalization that lives next to the consumer

```ts
// SOURCE: apps/web/src/lib/generic-parser/parseGenericArticle.ts:13-19
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}
function normalizeForHash(html: string): string {
  return stripTags(html).replace(/\s+/g, ' ').toLowerCase().trim();
}
```

The hash normalizer **lowercases** because case-only diffs should not register as drift in the snapshot pin. Anchor normalization has a different goal: it must preserve the casing of the original text so the stored anchor renders naturally in URL fragments and so the casing matches what the eventual reader UI/extension will pass to a native browser implementation. Therefore Task 2 introduces a *sibling* normalizer (`normalizeTextForAnchor`) that strips tags + collapses whitespace + trims but does **not** lowercase. Matching inside `locateAnchor` does the case-fold comparison instead — the stored anchor stays in original case, but lookup is case-insensitive (W3C-conformant). This split is the single most important call in this plan; the alternative (one shared normalizer that lowercases) would silently make the stored anchor non-conformant with the W3C URL form. Documented in `types.ts` with a `// Why two normalizers?` comment.

### Test layout — colocated, vitest, factory-driven fixtures

```ts
// SOURCE: apps/web/src/lib/source-classifier/classify.test.ts:1-58
import { describe, expect, it } from 'vitest';
import { classifySource } from './classify';

describe('classifySource — MediaWiki hosts', () => {
  it('classifies en.wikipedia.org with /w/api.php endpoint', () => {
    const result = classifySource('https://en.wikipedia.org/wiki/HTTP_404');
    expect(result).toMatchObject({ kind: 'mediawiki', hostname: 'en.wikipedia.org' });
  });
});
```

Pure-logic tests, no MSW (no network), one `describe` per behavior cluster. Round-trip and disambiguation tests get their own `describe` blocks so the AC mapping is greppable from the test names (`AC #1`, `AC #2`).

### Per-file `// @vitest-environment` only if needed

This module is DOM-free, so the default Node environment (`apps/web/vitest.config.ts:11`) is correct. No `@vitest-environment jsdom` pragma.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/lib/text-fragment/types.ts` | CREATE | `TextFragmentAnchor`, `TextFragmentError`, error detail union, anchor-length constants. |
| `apps/web/src/lib/text-fragment/normalize.ts` | CREATE | `normalizeTextForAnchor(s)` (whitespace collapse + trim, preserves case); `caseFold(s)` helper for matching. |
| `apps/web/src/lib/text-fragment/compute.ts` | CREATE | `computeAnchor({ text, start, end })` → `TextFragmentAnchor` with minimal `prefix`/`suffix` to disambiguate. |
| `apps/web/src/lib/text-fragment/locate.ts` | CREATE | `locateAnchor(anchor, text)` → `{ start: number; end: number } \| null` over normalized text. |
| `apps/web/src/lib/text-fragment/serialize.ts` | CREATE | `serializeAnchor(anchor)` → URL fragment string (`:~:text=…`); `parseAnchor(fragment)` → `TextFragmentAnchor \| null`. |
| `apps/web/src/lib/text-fragment/index.ts` | CREATE | Public re-exports (mirror `generic-parser/index.ts`). |
| `apps/web/src/lib/text-fragment/normalize.test.ts` | CREATE | Whitespace collapse, NFC stability, idempotency, case preservation. |
| `apps/web/src/lib/text-fragment/compute.test.ts` | CREATE | Unique-start short-circuit, AC #2 disambiguation cascade, range vs single-text mode, boundary errors. |
| `apps/web/src/lib/text-fragment/locate.test.ts` | CREATE | First-match, prefix/suffix filtering, range resolution, no-match returns `null`, case-insensitive match. |
| `apps/web/src/lib/text-fragment/serialize.test.ts` | CREATE | Round-trip encode/decode, percent-encoding of `,`/`&`/`-`, missing optional components. |
| `apps/web/src/lib/text-fragment/roundtrip.test.ts` | CREATE | AC #1 fuzz: 200 random selections over a fixture article → compute → locate → equal range. |
| `apps/web/test/factories/articleText.ts` | CREATE | Fixture strings: `SHORT_ARTICLE`, `ADJACENT_IDENTICAL` (the AC #2 fixture), `LARGE_ARTICLE` (≥5 KB, used by `roundtrip.test.ts`). |

No changes to: `packages/db` schema (the `corrections.anchor_text_fragment / anchor_prefix / anchor_suffix` columns already match the shape in Task 2), API routes (none consume anchors yet), `parser/`, `generic-parser/`, `mediawiki/`, `proxy-cache/`. No new dependencies — everything is ES-standard string/regex/`TextEncoder` work.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Module barrel placeholder

- **File**: `apps/web/src/lib/text-fragment/index.ts`
- **Action**: CREATE
- **Implement**: Empty stub re-exporting from `./types`. Lets later tasks compile incrementally.
  ```ts
  export * from './types';
  ```
  Fill out remaining re-exports as files land (`export { computeAnchor } from './compute';` etc. added in Tasks 4–7).
- **Mirror**: `apps/web/src/lib/generic-parser/index.ts:1-13` (final shape; Task 7 brings this in line).
- **Validate**: `pnpm --filter web typecheck` (passes against just the empty barrel).

### Task 2: Anchor types + error class + constants

- **File**: `apps/web/src/lib/text-fragment/types.ts`
- **Action**: CREATE
- **Implement**:
  - Constants:
    - `TEXT_FRAGMENT_PREFIX = ':~:text='` (canonical leader).
    - `TEXT_FRAGMENT_MAX_CONTEXT_WORDS = 12` — hard cap on words appended to `prefix` / `suffix` during disambiguation. Above this we throw `not_disambiguatable` rather than serialize a multi-paragraph anchor. Chosen on principle: a sane page won't need >12 words of context to be unique; if it does, the section is pathologically repetitive and the moderation queue will catch it. Configurable later via admin if real corpora demand it.
    - `TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS = 8` — selections shorter than this are stored as `textStart` only (no `textEnd`); selections at or above use the `(textStart, textEnd)` range form with `textEnd = lastNWords(selection, 3)`. Three trailing words match the W3C spec's recommendation for separator-style anchors.
  - `TextFragmentAnchor` shape:
    ```ts
    export type TextFragmentAnchor = {
      /** Required. Original-case substring of the normalized text. */
      textStart: string;
      /** Present only when the selection is long enough to use range form (see TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS). */
      textEnd?: string;
      /** Present only when needed to disambiguate against the source text. */
      prefix?: string;
      /** Present only when needed to disambiguate. */
      suffix?: string;
    };
    ```
    This is the in-memory shape. The DB columns (`anchor_text_fragment`, `anchor_prefix`, `anchor_suffix` at `packages/db/src/schema/corrections.ts:16-18`) persist this anchor via `serializeAnchor(anchor)` for `anchor_text_fragment` (canonical `:~:text=…` string, which round-trips through `parseAnchor`) and the individual `prefix` / `suffix` columns as denormalized helpers for query-time fuzzy match (VS-027 will use them). For LEX-75 we only write through `serializeAnchor`; the denormalized columns are addressed when VS-026 (snapshot persistence) wires the save path.
  - `TextFragmentErrorDetail` union:
    ```ts
    export type TextFragmentErrorDetail =
      | { code: 'invalid_range'; textLength: number; start: number; end: number; message: string }
      | { code: 'empty_selection'; message: string }
      | { code: 'not_disambiguatable'; matchCount: number; message: string }
      | { code: 'malformed_fragment'; fragment: string; message: string };
    ```
  - `TextFragmentError extends Error` with `readonly detail`, identical constructor pattern to `GenericParserError` at `apps/web/src/lib/generic-parser/types.ts:49-57`.
  - Add a top-of-file comment that explains **why two normalizers** (see "Patterns to Follow → Normalization" above). One paragraph, no more.
- **Mirror**: `apps/web/src/lib/generic-parser/types.ts:1-57` (constant block + type + error class shape).
- **Validate**: `pnpm --filter web typecheck`.

### Task 3: Text normalization (anchor-domain)

- **File**: `apps/web/src/lib/text-fragment/normalize.ts`
- **Action**: CREATE
- **Implement**:
  - `normalizeTextForAnchor(s: string): string`
    - NFC-normalize (`s.normalize('NFC')`) so visually identical sequences hash identically. This is the only Unicode step; we do not strip combining marks or fold widths.
    - Strip tags via the same one-liner pattern at `apps/web/src/lib/generic-parser/parseGenericArticle.ts:13-15` (`replace(/<[^>]+>/g, '')`). Inputs to this lib are *normally* already plain-text (the proxy/extractor returns text or HTML that callers strip), but accept HTML defensively so callers can hand us `extracted.contentHtml` directly without an extra step.
    - Collapse runs of `\s+` to a single space.
    - `trim()`.
    - **Do not lowercase.** Casing is preserved on stored anchors.
  - `caseFold(s: string): string`
    - Returns `s.normalize('NFC').toLowerCase()`. Used inside `computeAnchor` and `locateAnchor` for case-insensitive comparison; never used to produce stored anchor text.
  - Both functions are pure, synchronous, no side effects.
  - One-line jsdoc on each.
- **Mirror**: `apps/web/src/lib/generic-parser/parseGenericArticle.ts:13-19` (one-liner style; same regex shape, different policy on casing).
- **Validate**: `pnpm --filter web typecheck`.

### Task 4: `locateAnchor` (search a normalized text body)

Built before `computeAnchor` so `computeAnchor`'s disambiguation loop can call it.

- **File**: `apps/web/src/lib/text-fragment/locate.ts`
- **Action**: CREATE
- **Implement**:
  - `export function locateAnchor(anchor: TextFragmentAnchor, normalizedText: string): { start: number; end: number } | null`.
    - **Inputs are normalized**: `normalizedText` must come from `normalizeTextForAnchor`. We do **not** re-normalize inside `locateAnchor` because doing so would invalidate the offsets we return (the caller would have to re-derive offsets against its un-normalized copy). Document this contract at the top of the file.
    - **Case-insensitive comparison**: build `foldedText = caseFold(normalizedText)` and `foldedStart = caseFold(anchor.textStart)`. Use `String.prototype.indexOf` over the folded copies; map indices back into `normalizedText` directly (NFC + case-fold do not change UTF-16 code-unit count for the characters we care about — Latin alphabets, the same digit/punctuation set). For corpus-level guarantees we add a smoke-level note in the comment that one-to-one length is *not* universal across all Unicode (e.g. German ß → SS), but is universal for the cases LEX-75 must handle today. VS-027's fuzzy-match work will switch to ICU-aware folding if/when it matters; we won't pre-build that here.
    - Iterate all match positions for `textStart`:
      - Filter by `prefix` if present: text immediately before the match (`normalizedText.slice(p - prefix.length, p)`, case-folded) must equal the case-folded prefix.
      - If `textEnd` is present, search for the next `textEnd` occurrence at or after `p + textStart.length`. Match span is `[p, p + textEnd_position + textEnd.length)`.
      - Otherwise the match span is `[p, p + textStart.length)`.
      - Filter by `suffix` if present: text immediately after the match-span end must equal the case-folded suffix.
      - Return the first surviving span.
    - Return `null` when no span survives.
  - Performance: linear-scan via repeated `indexOf` from a moving cursor. The corpus we care about is a single article body (≤ ~200 KB after extraction), so this is O(n·m) worst-case but fine in absolute terms. No need for a suffix array.
- **Mirror**: No exact precedent. The "pure function returning a discriminated success/`null` value" style follows `apps/web/src/lib/source-classifier/classify.ts:29-54`.
- **Validate**: `pnpm --filter web typecheck`.

### Task 5: `computeAnchor` (compute + minimally disambiguate)

- **File**: `apps/web/src/lib/text-fragment/compute.ts`
- **Action**: CREATE
- **Implement**:
  - `export function computeAnchor(input: { normalizedText: string; start: number; end: number }): TextFragmentAnchor`.
  - Bounds checks (throw `TextFragmentError`):
    - `start < 0 || end > normalizedText.length || start >= end` → `invalid_range`.
    - The substring `normalizedText.slice(start, end).trim()` is empty → `empty_selection`. (Whitespace-only selections aren't anchorable.)
  - Derive the base `selection` string: `normalizedText.slice(start, end)`. Do **not** re-trim inside the anchor (offsets are the source of truth; the caller passed exactly what they meant). We do, however, refuse all-whitespace selections per the previous step.
  - Decide single-text vs range form by word count:
    - `wordCount(selection) >= TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS` → range form: `textStart = firstNWords(selection, 3)`, `textEnd = lastNWords(selection, 3)`.
    - else → single-text form: `textStart = selection`, no `textEnd`.
    - `wordCount` splits on `/\s+/` after trimming.
  - **Disambiguation loop**:
    1. Build a candidate anchor with the chosen `textStart` (+ `textEnd` if applicable), no `prefix`/`suffix`.
    2. Collect every match span in `normalizedText` via a thin internal helper `findAllMatches(anchor, normalizedText)` (same matcher used by `locate.ts`; factor into `locate.ts` and import here — keeps `locate.ts` the single source of truth for matching).
    3. **If matches.length === 1 and that match's `start === input.start`**, return the candidate.
    4. Otherwise, extend `prefix`/`suffix` in lockstep until unique:
       - Compute `wantedPrefixWords = 1, wantedSuffixWords = 1`.
       - Build `prefix = lastNWords(normalizedText.slice(0, input.start), wantedPrefixWords)`.
       - Build `suffix = firstNWords(normalizedText.slice(input.end), wantedSuffixWords)`.
       - Re-run `findAllMatches`. If the only remaining match is at `input.start`, return.
       - Otherwise alternate: grow `wantedPrefixWords` by 1, then on next round grow `wantedSuffixWords` by 1, then prefix, then suffix, … up to `TEXT_FRAGMENT_MAX_CONTEXT_WORDS` each.
    5. If we hit the cap without uniqueness, throw `TextFragmentError({ code: 'not_disambiguatable', matchCount, message })`. This is genuinely rare (would require the same word run repeated >12 times in a single article body) and is the right behavior — corrupted anchors are worse than refusing to write one.
  - **Why alternate prefix/suffix?** The AC #2 case (two adjacent identical phrases) is solved by extending **one side**, but real text often has multiple repetitions where only the *combination* of prefix and suffix is unique. Alternating keeps both anchors short and balanced; growing only one side first produces wider anchors than necessary in the multi-repetition case.
  - Return the smallest anchor that satisfies the constraint.
- **Mirror**: `apps/web/src/lib/generic-parser/extractArticle.ts:88-167` (pure function, typed-throw, early-exit pattern).
- **Validate**: `pnpm --filter web typecheck`.

### Task 6: Serialize / parse the `:~:text=…` URL form

- **File**: `apps/web/src/lib/text-fragment/serialize.ts`
- **Action**: CREATE
- **Implement**:
  - `export function serializeAnchor(anchor: TextFragmentAnchor): string`.
    - Returns `':~:text=' + parts.join(',')`.
    - Each part is `encodeURIComponent(part)` with two adjustments: `encodeURIComponent` already escapes `,` and `&`; we additionally escape `-` (`%2D`) inside the text components because the W3C grammar uses leading `-` on suffix and trailing `-` on prefix as control characters.
    - Order: `[prefix && prefix + '-', textStart, textEnd, suffix && '-' + suffix].filter(Boolean).join(',')`.
    - The `prefix-` trailing dash and `-suffix` leading dash are **literal** dashes (not part of the encoded content) — that's why we percent-encode any `-` *inside* the user-content portions but leave the structural dashes as raw `-`.
  - `export function parseAnchor(fragment: string): TextFragmentAnchor | null`.
    - Strip a leading `#` if present. If the fragment does not start with `:~:text=` after stripping, return `null`. (We are strict; bad inputs are someone else's job to surface.)
    - Split the body on `,`. The result has 1–4 segments.
    - Classify each segment:
      - Starts-with-control `…-` (only on the first segment): `prefix = decodeURIComponent(segment.slice(0, -1))`.
      - Starts-with-control `-…` (only on the last segment): `suffix = decodeURIComponent(segment.slice(1))`.
      - Otherwise a text segment: first such segment is `textStart`, second is `textEnd`. More than two text segments → return `null`.
    - On any `decodeURIComponent` throw, return `null` (do not propagate).
  - Both functions are pure; no IO; no logger.
  - **Why a custom parser instead of `URLSearchParams`?** The fragment grammar uses `,` (not `&`) as the part separator, and the leading/trailing `-` shorthand is positional, not key-based. `URLSearchParams` does not model this.
- **Mirror**: `apps/web/src/lib/source-classifier/classify.ts:18-27` (silent-`null` style on malformed input — bad URLs become a recoverable `null`, not a thrown error).
- **Validate**: `pnpm --filter web typecheck`.

### Task 7: Complete the module barrel

- **File**: `apps/web/src/lib/text-fragment/index.ts`
- **Action**: UPDATE (from the stub in Task 1)
- **Implement**:
  ```ts
  export { computeAnchor } from './compute';
  export { locateAnchor } from './locate';
  export { normalizeTextForAnchor, caseFold } from './normalize';
  export { serializeAnchor, parseAnchor } from './serialize';
  export {
    TEXT_FRAGMENT_PREFIX,
    TEXT_FRAGMENT_MAX_CONTEXT_WORDS,
    TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS,
    TextFragmentError,
  } from './types';
  export type { TextFragmentAnchor, TextFragmentErrorDetail } from './types';
  ```
- **Mirror**: `apps/web/src/lib/generic-parser/index.ts:1-13`.
- **Validate**: `pnpm --filter web typecheck`.

### Task 8: Fixture factory

- **File**: `apps/web/test/factories/articleText.ts`
- **Action**: CREATE
- **Implement**:
  - `export const SHORT_ARTICLE: string` — ~3 paragraphs of plain text, no repeated phrases. Used to assert the unique-start short-circuit and round-trip basics.
  - `export const ADJACENT_IDENTICAL: string` — the AC #2 fixture. Must contain the exact substring `"the cat sat"` at least twice within ~50 chars of each other, with distinguishable surrounding text on each side. Example:
    ```
    Many sentences open with "the cat sat on the mat". Yet here, the cat sat
    on the floor, and right after, the cat sat on the table. Both are common.
    ```
  - `export const LARGE_ARTICLE: string` — ≥5 KB of paragraphs assembled by repeating a short corpus; used by `roundtrip.test.ts` for fuzzed selections.
  - `export const HEAVY_REPETITION: string` — a corpus that should fail disambiguation (same 5-word phrase repeated 30 times). Used to test the `not_disambiguatable` cap.
  - All fixtures return strings already in the canonical form (post-`normalizeTextForAnchor` — no excess whitespace, original case preserved).
- **Mirror**: `apps/web/test/factories/mockGenericPage.ts:1-65` for the "constants + helper" layout.
- **Validate**: importable from a test file; `pnpm --filter web typecheck`.

### Task 9: Normalization tests

- **File**: `apps/web/src/lib/text-fragment/normalize.test.ts`
- **Action**: CREATE
- **Implement** (one `it` per behavior):
  - Collapses runs of whitespace (spaces, tabs, newlines) to single spaces.
  - Trims leading/trailing whitespace.
  - Preserves casing (`"FOO bar"` → `"FOO bar"`, **not** lowercased).
  - Strips HTML tags from input (`"<p>Hello <b>world</b></p>"` → `"Hello world"`).
  - Is idempotent (`normalize(normalize(x)) === normalize(x)`).
  - NFC-normalizes (combining-mark sequences like `"á"` → `"á"`).
  - `caseFold` lowercases and NFC-normalizes; preserves length for ASCII inputs.
- **Mirror**: `apps/web/src/lib/source-classifier/classify.test.ts:1-58` (simple `describe`/`it`/`toBe` style; no MSW).
- **Validate**: `pnpm --filter web test src/lib/text-fragment/normalize.test.ts`.

### Task 10: `locateAnchor` tests

- **File**: `apps/web/src/lib/text-fragment/locate.test.ts`
- **Action**: CREATE
- **Implement**:
  - Returns the first occurrence when only `textStart` is set and the text is unique.
  - Returns `null` when `textStart` does not appear.
  - With multiple occurrences and no prefix/suffix, returns the **first** match (deterministic — `computeAnchor` is responsible for ensuring uniqueness; `locateAnchor` is a pure searcher).
  - Filters by `prefix` (selects only matches whose preceding text equals the case-folded prefix).
  - Filters by `suffix` (selects only matches whose following text equals the case-folded suffix).
  - Range form: with `textStart='foo'` and `textEnd='bar'` in `"foo X Y Z bar baz"`, returns span covering `"foo X Y Z bar"`.
  - Case-insensitive: anchor with `textStart='HELLO'` finds `"hello"` in the text.
  - Span end is **inclusive** of `textEnd` characters (i.e., `result.end === position_of_textEnd + textEnd.length`).
- **Mirror**: `apps/web/src/lib/source-classifier/classify.test.ts:1-58`.
- **Validate**: `pnpm --filter web test src/lib/text-fragment/locate.test.ts`.

### Task 11: `computeAnchor` tests (including AC #2)

- **File**: `apps/web/src/lib/text-fragment/compute.test.ts`
- **Action**: CREATE
- **Implement**:
  - **AC #2 — disambiguation cascade**:
    - In `ADJACENT_IDENTICAL`, select the **second** occurrence of `"the cat sat"`. Computed anchor has `prefix` and/or `suffix` non-empty; `locateAnchor(computed, ADJACENT_IDENTICAL)` returns the second-occurrence offsets, not the first. (`expect(located).toEqual({ start: <known second offset>, end: <known end> })`).
    - Symmetric: select the **first** occurrence of the same phrase. Anchor disambiguates to first-occurrence offsets.
  - **Unique start short-circuits**: when the selection is uniquely identifying, the returned anchor has no `prefix` and no `suffix`.
  - **Range form threshold**: selecting ≥ `TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS` words sets both `textStart` and `textEnd`; shorter selections do not.
  - **Range form text content**: in range form, `textStart` is the first 3 words of the selection and `textEnd` is the last 3 words.
  - **Bounds**: `start < 0` throws `TextFragmentError({ code: 'invalid_range' })`.
  - **Bounds**: `end > text.length` throws `invalid_range`.
  - **Bounds**: `start >= end` throws `invalid_range`.
  - **Empty selection**: whitespace-only substring throws `empty_selection`.
  - **Disambiguation cap**: in `HEAVY_REPETITION`, selecting one of the repeated phrases throws `not_disambiguatable`.
  - **Casing preservation**: when the source has mixed case (`"In 2026, Veritasee shipped."`), the stored anchor's `textStart` keeps the original case.
- **Mirror**: `apps/web/src/lib/generic-parser/extractArticle.test.ts:12-91` for the `describe(... — AC #N)` naming convention.
- **Validate**: `pnpm --filter web test src/lib/text-fragment/compute.test.ts`.

### Task 12: Serializer tests

- **File**: `apps/web/src/lib/text-fragment/serialize.test.ts`
- **Action**: CREATE
- **Implement**:
  - Single-text form: `{ textStart: 'hello world' }` → `':~:text=hello%20world'`.
  - Range form: `{ textStart: 'hello', textEnd: 'world' }` → `':~:text=hello,world'`.
  - With prefix: `{ prefix: 'a', textStart: 'b' }` → `':~:text=a-,b'`.
  - With suffix: `{ textStart: 'b', suffix: 'c' }` → `':~:text=b,-c'`.
  - All four parts: `':~:text=a-,b,c,-d'`.
  - Percent-encodes commas inside content: `{ textStart: 'a,b' }` → `':~:text=a%2Cb'`.
  - Percent-encodes hyphens inside content: `{ textStart: 'a-b' }` → `':~:text=a%2Db'` (so the parser can't confuse them with structural dashes).
  - Percent-encodes ampersands: `{ textStart: 'a&b' }` → `':~:text=a%26b'`.
  - **Round-trip**: `parseAnchor(serializeAnchor(a)).deepEqual(a)` for: single-text, range, prefix-only, suffix-only, full quad.
  - **Parse: `null` cases**: empty string, missing `:~:text=`, `:~:text=` with no body, more than two text segments (e.g. `':~:text=a,b,c'` is illegal — only one optional `textEnd`).
  - **Parse: handles leading `#`**: `'#:~:text=foo'` parses to `{ textStart: 'foo' }`.
  - **Parse: malformed percent escape** (e.g. `:~:text=%E0%A4`) → `null` (does not throw).
- **Mirror**: `apps/web/src/lib/source-classifier/classify.test.ts:60-93` for the negative-case style.
- **Validate**: `pnpm --filter web test src/lib/text-fragment/serialize.test.ts`.

### Task 13: Round-trip integration test (AC #1)

- **File**: `apps/web/src/lib/text-fragment/roundtrip.test.ts`
- **Action**: CREATE
- **Implement**:
  - **Deterministic 200-iteration fuzz** seeded with a constant (use a tiny inline PRNG — `mulberry32` from the canonical 4-line snippet — so failures reproduce). Per iteration:
    1. Pick random `start ∈ [0, text.length - 20]`, `end ∈ [start + 5, min(start + 200, text.length)]` over `LARGE_ARTICLE`.
    2. Skip if `text.slice(start, end).trim().length === 0` (whitespace-only).
    3. `anchor = computeAnchor({ normalizedText: LARGE_ARTICLE, start, end })`.
    4. `serialized = serializeAnchor(anchor)`.
    5. `parsed = parseAnchor(serialized)` — assert deep-equal to `anchor`.
    6. `located = locateAnchor(parsed, LARGE_ARTICLE)`.
    7. Assert `located !== null && located.start === start && located.end === end`.
  - **Targeted cases** (each its own `it`, easier to read than buried fuzz failures):
    - Selecting the first paragraph → anchor round-trips.
    - Selecting across a paragraph boundary → anchor round-trips.
    - Selecting a single word → anchor round-trips and uses single-text form.
    - Selecting a full long paragraph → anchor round-trips and uses range form.
- **Mirror**: New shape; nearest analogue is `apps/web/src/lib/mediawiki/parseResponse.test.ts` for "structured-iteration over a single fixture" style.
- **Validate**: `pnpm --filter web test src/lib/text-fragment/roundtrip.test.ts`.

### Task 14: Full verification

- **File**: n/a
- **Action**: validation
- **Implement**: Run the full required verification set per `AGENTS.md:42`.
- **Validate**:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`

---

## Risks

| Risk | Mitigation |
|------|------------|
| Wrong choice of normalizer (lowercasing the stored anchor) would silently produce non-spec-conformant URL fragments and stale-looking case in DB-stored anchors. | Two separate normalizers (Task 2 + Task 3); `caseFold` is only ever called internally for matching, never for output. Tests in `normalize.test.ts` lock in that `normalizeTextForAnchor` preserves case. |
| Unicode length divergence: NFC + case-fold can change UTF-16 code-unit length for some scripts (e.g. German `ß`), so mapping folded offsets back into the original could drift. | Documented at top of `locate.ts`. For LEX-75's MVP corpus (English-leaning Wikipedia / Britannica articles) this is a non-issue. VS-027's fuzzy re-anchor work will adopt ICU-aware folding if/when needed; we don't pre-build the heavy fix here. |
| Disambiguation cap (`TEXT_FRAGMENT_MAX_CONTEXT_WORDS = 12`) could refuse to anchor in pathological corpora. | Throws `not_disambiguatable` rather than fallback-write a non-unique anchor. The caller (a future VS-026 / VS-028) is expected to map this to a UI affordance ("could not anchor — try selecting a more distinctive phrase"). Constant is exported and admin-configurable per Task 2. |
| Reader UI eventually needs DOM `Range → offsets` mapping; if that's not strictly compatible with this lib's offset semantics, the integration will be painful. | Intentionally scoped out; documented in the Summary as VS-028's responsibility. The contract this lib offers (`{ normalizedText, start, end }` → anchor; anchor + `normalizedText` → `{ start, end }`) is the same shape VS-028 will need to bridge — the integration is "compute the normalized-text offset from a DOM range", not "rewrite this lib". |
| Lowercase-folding `String.prototype.toLowerCase()` is locale-sensitive (Turkish `i`/`I`). | `caseFold` always uses default-locale `toLowerCase` (matches V8 default). Acceptable for v1; if Turkish-locale articles surface, switch to `String.prototype.toLocaleLowerCase('en')` for stability. Single-line follow-up if it bites. |
| Adjacent-identical phrases that span the whole text (e.g. a poem of 30 repetitions) trip the disambiguation cap. | This is the intended failure mode (`not_disambiguatable`), and the AC test (`HEAVY_REPETITION`) pins it explicitly. If real corpora demand higher caps, raise the constant — but **never** silently degrade to a non-unique anchor. |
| `parseAnchor` returning `null` on every malformed fragment could mask data-corruption bugs in the DB. | Acceptable for v1 because the DB path goes through `serializeAnchor` only (we control the writer); reads that come back as `null` from `parseAnchor` are observable in the caller. VS-027 will add explicit logging if drift-style malformations show up in production. |
| Word-counting via `/\s+/` is naive (Chinese / Japanese / Thai have no word breaks). | Documented in `compute.ts` header comment. For Latin-script articles (~all v1 MVP traffic) this is fine. CJK corpora will eventually need a `Intl.Segmenter`-based word counter; tracked as a v1.1 follow-up, not now. |

---

## Validation

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Unit tests (Vitest, Node env, no MSW handlers needed — pure logic)
pnpm test

# Build
pnpm build
```

No new e2e coverage in this ticket — DOM integration lands with VS-028.

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes (including the 200-iteration `roundtrip.test.ts` fuzz)
- [ ] `pnpm build` passes
- [ ] AC #1 explicitly covered by `roundtrip.test.ts` (compute → serialize → parse → locate returns the original `(start, end)` for every iteration)
- [ ] AC #2 explicitly covered by `compute.test.ts` (two adjacent identical phrases each anchor uniquely; `locateAnchor` returns the *correct* occurrence's offsets, not just any match)
- [ ] No changes to `packages/db` schema; the existing `corrections.anchor_text_fragment` / `anchor_prefix` / `anchor_suffix` columns continue to match the serialized shape
- [ ] Module is DOM-free (no `jsdom`, no `window`, no `document` references) and works in both Node and the browser environment
