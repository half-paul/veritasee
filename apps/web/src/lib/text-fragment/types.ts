// Public types and constants for the W3C Text Fragment anchor module.
//
// Why two normalizers?
// `parseGenericArticle.normalizeForHash` lowercases on its way to the
// revision hash because case-only diffs should not register as drift. Anchor
// text has the opposite requirement: it must round-trip into a URL fragment
// (`:~:text=…`) that reads naturally and matches the casing of the source,
// so `normalizeTextForAnchor` preserves case. Case-insensitive *matching*
// (per the W3C scroll-to-text spec) is implemented inside `locateAnchor`
// via the `caseFold()` helper and never alters the stored anchor.

export const TEXT_FRAGMENT_PREFIX = ':~:text=';

/**
 * Hard cap on words appended to `prefix` / `suffix` during the
 * disambiguation cascade. Above this we throw `not_disambiguatable` rather
 * than serialize a multi-paragraph anchor — corrupted anchors are worse
 * than refusing to write one. Exported so admins can tune later if real
 * corpora demand it.
 */
export const TEXT_FRAGMENT_MAX_CONTEXT_WORDS = 12;

/**
 * Selections with fewer than this many words are stored as `textStart`
 * only; selections at or above use the `(textStart, textEnd)` range form
 * with three trailing words on each side, per the W3C separator-style
 * recommendation.
 */
export const TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS = 8;

export type TextFragmentAnchor = {
  /** Required. Original-case substring of the normalized text. */
  textStart: string;
  /** Present only when the selection is long enough to use range form
   * (see `TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS`). */
  textEnd?: string;
  /** Present only when needed to disambiguate against the source text. */
  prefix?: string;
  /** Present only when needed to disambiguate. */
  suffix?: string;
};

export type TextFragmentErrorDetail =
  | { code: 'invalid_range'; textLength: number; start: number; end: number; message: string }
  | { code: 'empty_selection'; message: string }
  | { code: 'not_disambiguatable'; matchCount: number; message: string }
  | { code: 'malformed_fragment'; fragment: string; message: string };

export class TextFragmentError extends Error {
  readonly detail: TextFragmentErrorDetail;

  constructor(detail: TextFragmentErrorDetail) {
    super(detail.message ?? detail.code);
    this.name = 'TextFragmentError';
    this.detail = detail;
  }
}
