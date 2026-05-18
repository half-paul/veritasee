// Compute a minimal W3C Text Fragment anchor for a selection over normalized
// article text. The anchor is just-enough: if `textStart` is unique we omit
// `prefix`/`suffix`; otherwise we extend a balanced prefix/suffix one word
// at a time until exactly one match position remains.
//
// Word-count caveat: the threshold and disambiguation step count words via
// /\s+/, which is fine for Latin scripts. CJK / Thai corpora have no native
// word breaks; an `Intl.Segmenter`-based counter is tracked as a v1.1
// follow-up (LEX-75 risks table).

import { findAllMatches } from './locate';
import { caseFold } from './normalize';
import {
  TEXT_FRAGMENT_MAX_CONTEXT_WORDS,
  TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS,
  TextFragmentError,
  type TextFragmentAnchor,
} from './types';

export type ComputeAnchorInput = {
  normalizedText: string;
  start: number;
  end: number;
};

export function computeAnchor(input: ComputeAnchorInput): TextFragmentAnchor {
  const { normalizedText, start, end } = input;
  const textLength = normalizedText.length;

  if (start < 0 || end > textLength || start >= end) {
    throw new TextFragmentError({
      code: 'invalid_range',
      textLength,
      start,
      end,
      message: `Selection range [${start}, ${end}) is outside text bounds [0, ${textLength}).`,
    });
  }

  const selection = normalizedText.slice(start, end);
  if (selection.trim().length === 0) {
    throw new TextFragmentError({
      code: 'empty_selection',
      message: 'Selection contains only whitespace and cannot be anchored.',
    });
  }

  const selectionWords = wordCount(selection);
  const base = selectBaseAnchor(
    normalizedText,
    start,
    end,
    selection,
    selectionWords,
  );

  let matches = findAllMatches(base, normalizedText);
  if (isUniqueAt(matches, start, end)) {
    return base;
  }

  // Disambiguation cascade: alternate growing prefix and suffix one word at
  // a time. Real-world ambiguity often needs both sides; alternating keeps
  // anchors short and balanced.
  let prefixWords = 0;
  let suffixWords = 0;
  let lastMatchCount = matches.length;
  let growSuffixNext = false;
  while (
    prefixWords < TEXT_FRAGMENT_MAX_CONTEXT_WORDS ||
    suffixWords < TEXT_FRAGMENT_MAX_CONTEXT_WORDS
  ) {
    if (growSuffixNext) {
      if (suffixWords < TEXT_FRAGMENT_MAX_CONTEXT_WORDS) suffixWords++;
      else prefixWords++;
    } else {
      if (prefixWords < TEXT_FRAGMENT_MAX_CONTEXT_WORDS) prefixWords++;
      else suffixWords++;
    }
    growSuffixNext = !growSuffixNext;

    const candidate: TextFragmentAnchor = { ...base };
    if (prefixWords > 0) {
      const prefix = takeTrailingWords(normalizedText.slice(0, start), prefixWords);
      if (prefix.length > 0) candidate.prefix = prefix;
    }
    if (suffixWords > 0) {
      const suffix = takeLeadingWords(normalizedText.slice(end), suffixWords);
      if (suffix.length > 0) candidate.suffix = suffix;
    }

    matches = findAllMatches(candidate, normalizedText);
    lastMatchCount = matches.length;
    if (isUniqueAt(matches, start, end)) return candidate;
  }

  throw new TextFragmentError({
    code: 'not_disambiguatable',
    matchCount: lastMatchCount,
    message: `Could not disambiguate selection within ${TEXT_FRAGMENT_MAX_CONTEXT_WORDS} context words on each side (${lastMatchCount} matches remain).`,
  });
}

function isUniqueAt(
  matches: Array<{ start: number; end: number }>,
  expectedStart: number,
  expectedEnd: number,
): boolean {
  return (
    matches.length === 1 &&
    matches[0]!.start === expectedStart &&
    matches[0]!.end === expectedEnd
  );
}

// Choose the base anchor shape. Range form (textStart + textEnd) is used
// when the selection is long enough AND the range-form span pins exactly to
// (start, end) when textStart matches at `start`. The pin can fail if the
// last-three-words `textEnd` has an earlier occurrence inside the selection
// interior — in that case the W3C matcher's "first textEnd after textStart"
// rule would resolve to a shorter span. We fall back to single-text form
// there, accepting the (small) URL-length cost in exchange for round-trip
// fidelity. (Range form's payoff is robustness to mid-range edits, which
// is a cross-revision concern and lives with VS-027.)
function selectBaseAnchor(
  normalizedText: string,
  start: number,
  end: number,
  selection: string,
  selectionWords: number,
): TextFragmentAnchor {
  if (selectionWords >= TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS) {
    const textStart = firstNWords(selection, 3);
    const textEnd = lastNWords(selection, 3);
    if (textStart.length > 0 && textEnd.length > 0) {
      const foldedText = caseFold(normalizedText);
      const foldedStartLen = caseFold(textStart).length;
      const foldedEnd = caseFold(textEnd);
      const found = foldedText.indexOf(foldedEnd, start + foldedStartLen);
      if (found >= 0 && found + foldedEnd.length === end) {
        return { textStart, textEnd };
      }
    }
  }
  return { textStart: selection };
}

function wordCount(s: string): number {
  const trimmed = s.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function firstNWords(s: string, n: number): string {
  if (n <= 0) return '';
  const trimmed = s.replace(/^\s+/, '');
  let i = 0;
  let words = 0;
  let inWord = false;
  while (i < trimmed.length) {
    const isSpace = /\s/.test(trimmed[i]!);
    if (isSpace) {
      if (inWord && words === n) return trimmed.slice(0, i);
      inWord = false;
    } else {
      if (!inWord) words++;
      inWord = true;
    }
    i++;
  }
  return trimmed.replace(/\s+$/, '');
}

function lastNWords(s: string, n: number): string {
  if (n <= 0) return '';
  const trimmed = s.replace(/\s+$/, '');
  let i = trimmed.length;
  let words = 0;
  let inWord = false;
  while (i > 0) {
    const isSpace = /\s/.test(trimmed[i - 1]!);
    if (isSpace) {
      if (inWord && words === n) return trimmed.slice(i);
      inWord = false;
    } else {
      if (!inWord) words++;
      inWord = true;
    }
    i--;
  }
  return trimmed.replace(/^\s+/, '');
}

// Returns the literal substring at the END of `text` containing the last `n`
// words PLUS any whitespace that sits between those words and the end of
// `text` — i.e., the natural separator joining the prefix to the selection.
// This is what `locateAnchor`'s exact-slice prefix check compares against.
function takeTrailingWords(text: string, n: number): string {
  if (n <= 0) return '';
  let i = text.length;
  let words = 0;
  let inWord = false;
  while (i > 0) {
    const isSpace = /\s/.test(text[i - 1]!);
    if (isSpace) {
      if (inWord && words === n) return text.slice(i);
      inWord = false;
    } else {
      if (!inWord) words++;
      inWord = true;
    }
    i--;
  }
  return text;
}

// Mirror of `takeTrailingWords` for the suffix side.
function takeLeadingWords(text: string, n: number): string {
  if (n <= 0) return '';
  let i = 0;
  let words = 0;
  let inWord = false;
  while (i < text.length) {
    const isSpace = /\s/.test(text[i]!);
    if (isSpace) {
      if (inWord && words === n) return text.slice(0, i);
      inWord = false;
    } else {
      if (!inWord) words++;
      inWord = true;
    }
    i++;
  }
  return text;
}
