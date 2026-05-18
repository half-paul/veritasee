// Locator for W3C Text Fragment anchors over a *normalized* text body.
//
// Inputs are assumed to be in canonical form already (see
// `normalizeTextForAnchor`). We deliberately do not re-normalize inside the
// locator because doing so would invalidate the offsets we return — the
// caller would have to re-derive offsets against an un-normalized copy.
//
// Unicode caveat: for Latin scripts (the LEX-75 MVP corpus), NFC + lower-
// case folding does not change UTF-16 code-unit count, so we map indices
// between the folded copy and the original directly. Some scripts (e.g.
// German `ß` → `SS`) break this invariant; VS-027's fuzzy re-anchor work
// will adopt ICU-aware folding if real corpora demand it.

import { caseFold } from './normalize';
import type { TextFragmentAnchor } from './types';

export function locateAnchor(
  anchor: TextFragmentAnchor,
  normalizedText: string,
): { start: number; end: number } | null {
  const matches = findAllMatches(anchor, normalizedText);
  return matches[0] ?? null;
}

/**
 * Internal helper shared with `computeAnchor`'s disambiguation loop. Returns
 * every span in `normalizedText` matched by the given anchor. Single source
 * of truth for matcher semantics.
 */
export function findAllMatches(
  anchor: TextFragmentAnchor,
  normalizedText: string,
): Array<{ start: number; end: number }> {
  const foldedText = caseFold(normalizedText);
  const foldedStart = caseFold(anchor.textStart);
  if (foldedStart.length === 0) return [];

  const foldedEnd = anchor.textEnd !== undefined ? caseFold(anchor.textEnd) : null;
  const foldedPrefix = anchor.prefix !== undefined ? caseFold(anchor.prefix) : null;
  const foldedSuffix = anchor.suffix !== undefined ? caseFold(anchor.suffix) : null;

  const results: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor <= foldedText.length) {
    const p = foldedText.indexOf(foldedStart, cursor);
    if (p < 0) break;
    cursor = p + 1;

    if (foldedPrefix !== null) {
      const sliceStart = p - foldedPrefix.length;
      if (sliceStart < 0) continue;
      if (foldedText.slice(sliceStart, p) !== foldedPrefix) continue;
    }

    let spanEnd: number;
    if (foldedEnd !== null) {
      const endSearchFrom = p + foldedStart.length;
      const endPos = foldedText.indexOf(foldedEnd, endSearchFrom);
      if (endPos < 0) continue;
      spanEnd = endPos + foldedEnd.length;
    } else {
      spanEnd = p + foldedStart.length;
    }

    if (foldedSuffix !== null) {
      if (spanEnd + foldedSuffix.length > foldedText.length) continue;
      if (foldedText.slice(spanEnd, spanEnd + foldedSuffix.length) !== foldedSuffix) continue;
    }

    results.push({ start: p, end: spanEnd });
  }

  return results;
}
