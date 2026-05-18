import { describe, expect, it } from 'vitest';
import { ADJACENT_IDENTICAL, HEAVY_REPETITION, SHORT_ARTICLE } from '@test/factories/articleText';
import { computeAnchor } from './compute';
import { locateAnchor } from './locate';
import {
  TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS,
  TextFragmentError,
} from './types';

describe('computeAnchor — basic behavior', () => {
  it('returns a bare textStart anchor when the selection is uniquely identifying', () => {
    const start = SHORT_ARTICLE.indexOf('contributor-driven platform');
    const end = start + 'contributor-driven platform'.length;
    const anchor = computeAnchor({ normalizedText: SHORT_ARTICLE, start, end });
    expect(anchor.textStart).toBe('contributor-driven platform');
    expect(anchor.prefix).toBeUndefined();
    expect(anchor.suffix).toBeUndefined();
    expect(anchor.textEnd).toBeUndefined();
  });

  it('uses range form when the selection has ≥ TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS words', () => {
    const phrase = 'Corrections are stored as text-fragment anchors against a snapshotted revision';
    const start = SHORT_ARTICLE.indexOf(phrase);
    const end = start + phrase.length;
    expect(phrase.split(/\s+/).length).toBeGreaterThanOrEqual(TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS);
    const anchor = computeAnchor({ normalizedText: SHORT_ARTICLE, start, end });
    expect(anchor.textStart).toBe('Corrections are stored');
    expect(anchor.textEnd).toBe('a snapshotted revision');
  });

  it('uses single-text form for selections shorter than the threshold', () => {
    const phrase = 'contributor-driven platform';
    const start = SHORT_ARTICLE.indexOf(phrase);
    const end = start + phrase.length;
    const anchor = computeAnchor({ normalizedText: SHORT_ARTICLE, start, end });
    expect(anchor.textEnd).toBeUndefined();
    expect(anchor.textStart).toBe(phrase);
  });

  it('preserves original casing in the stored anchor', () => {
    const text = 'In 2026, Veritasee shipped its first release.';
    const phrase = 'Veritasee shipped';
    const start = text.indexOf(phrase);
    const end = start + phrase.length;
    const anchor = computeAnchor({ normalizedText: text, start, end });
    expect(anchor.textStart).toBe('Veritasee shipped');
  });
});

describe('computeAnchor — AC #2: adjacent identical phrases disambiguate', () => {
  // Find the n-th (1-indexed) occurrence of `needle` in `haystack`.
  function nthIndexOf(haystack: string, needle: string, n: number): number {
    let pos = -1;
    for (let i = 0; i < n; i++) {
      pos = haystack.indexOf(needle, pos + 1);
      if (pos < 0) throw new Error(`needle "${needle}" not found ${n} times`);
    }
    return pos;
  }

  it('selects the 2nd occurrence: anchor disambiguates and locates the 2nd-occurrence offsets', () => {
    const needle = 'the cat sat';
    const start = nthIndexOf(ADJACENT_IDENTICAL, needle, 2);
    const end = start + needle.length;
    const anchor = computeAnchor({ normalizedText: ADJACENT_IDENTICAL, start, end });

    // AC #2 requires prefix and/or suffix to be populated.
    expect(anchor.prefix !== undefined || anchor.suffix !== undefined).toBe(true);

    const located = locateAnchor(anchor, ADJACENT_IDENTICAL);
    expect(located).toEqual({ start, end });
  });

  it('selects the 1st occurrence: anchor disambiguates to first-occurrence offsets', () => {
    const needle = 'the cat sat';
    const start = nthIndexOf(ADJACENT_IDENTICAL, needle, 1);
    const end = start + needle.length;
    const anchor = computeAnchor({ normalizedText: ADJACENT_IDENTICAL, start, end });

    expect(anchor.prefix !== undefined || anchor.suffix !== undefined).toBe(true);

    const located = locateAnchor(anchor, ADJACENT_IDENTICAL);
    expect(located).toEqual({ start, end });
  });

  it('selects the 3rd occurrence: anchor disambiguates to third-occurrence offsets', () => {
    const needle = 'the cat sat';
    const start = nthIndexOf(ADJACENT_IDENTICAL, needle, 3);
    const end = start + needle.length;
    const anchor = computeAnchor({ normalizedText: ADJACENT_IDENTICAL, start, end });

    const located = locateAnchor(anchor, ADJACENT_IDENTICAL);
    expect(located).toEqual({ start, end });
  });
});

describe('computeAnchor — bounds and error handling', () => {
  it('throws invalid_range when start < 0', () => {
    expect(() =>
      computeAnchor({ normalizedText: SHORT_ARTICLE, start: -1, end: 5 }),
    ).toThrow(TextFragmentError);
  });

  it('throws invalid_range when end > text.length', () => {
    expect(() =>
      computeAnchor({
        normalizedText: SHORT_ARTICLE,
        start: 0,
        end: SHORT_ARTICLE.length + 1,
      }),
    ).toThrow(TextFragmentError);
  });

  it('throws invalid_range when start >= end', () => {
    expect(() =>
      computeAnchor({ normalizedText: SHORT_ARTICLE, start: 10, end: 10 }),
    ).toThrow(TextFragmentError);
  });

  it('throws empty_selection on a whitespace-only selection', () => {
    const text = 'foo     bar';
    // The slice [3, 8) is "    " — five whitespace chars.
    expect(() => computeAnchor({ normalizedText: text, start: 3, end: 8 })).toThrow(
      TextFragmentError,
    );
    try {
      computeAnchor({ normalizedText: text, start: 3, end: 8 });
    } catch (err) {
      expect(err).toBeInstanceOf(TextFragmentError);
      expect((err as TextFragmentError).detail.code).toBe('empty_selection');
    }
  });

  it('attaches detail.code === "invalid_range" on bounds violations', () => {
    try {
      computeAnchor({ normalizedText: SHORT_ARTICLE, start: -5, end: 1 });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TextFragmentError);
      expect((err as TextFragmentError).detail.code).toBe('invalid_range');
    }
  });

  it('throws not_disambiguatable when no amount of context is enough', () => {
    // HEAVY_REPETITION is the same 5-word phrase 30 times, so the 24-word
    // context window allowed by the cap is still ambiguous.
    const needle = 'alpha bravo charlie';
    // Take the middle occurrence (the 15th of 30) so prefix and suffix are
    // both non-trivial.
    let start = -1;
    for (let i = 0; i < 15; i++) {
      start = HEAVY_REPETITION.indexOf(needle, start + 1);
    }
    const end = start + needle.length;
    expect(() =>
      computeAnchor({ normalizedText: HEAVY_REPETITION, start, end }),
    ).toThrow(TextFragmentError);
    try {
      computeAnchor({ normalizedText: HEAVY_REPETITION, start, end });
    } catch (err) {
      expect((err as TextFragmentError).detail.code).toBe('not_disambiguatable');
    }
  });
});
