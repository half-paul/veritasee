/**
 * Normalize text into the canonical form anchors are computed and located
 * against: NFC-normalized, tag-stripped, whitespace-collapsed, trimmed.
 * Casing is preserved — see the "Why two normalizers?" note in `./types.ts`.
 * Accepts plain text or HTML; tag stripping is defensive so callers can
 * pass `extracted.contentHtml` directly.
 */
export function normalizeTextForAnchor(s: string): string {
  return s
    .normalize('NFC')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Case-fold helper used internally by `computeAnchor` and `locateAnchor`
 * for case-insensitive matching (per the W3C scroll-to-text spec). Never
 * used to produce stored anchor text — stored anchors keep original case.
 */
export function caseFold(s: string): string {
  return s.normalize('NFC').toLowerCase();
}
