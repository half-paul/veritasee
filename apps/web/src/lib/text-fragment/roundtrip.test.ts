// AC #1 integration test for LEX-75.
//
// Compute → serialize → parse → locate must round-trip the original
// (start, end) offsets for any selection over the canonical normalized
// article text. We exercise this with a deterministic 200-iteration fuzz
// over `LARGE_ARTICLE`, plus a handful of targeted cases that are easier
// to diagnose than buried fuzz failures.

import { describe, expect, it } from 'vitest';
import { LARGE_ARTICLE } from '@test/factories/articleText';
import { computeAnchor } from './compute';
import { locateAnchor } from './locate';
import { parseAnchor, serializeAnchor } from './serialize';
import { TextFragmentError } from './types';

// Tiny seeded PRNG so failures reproduce. Standard 4-line mulberry32.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('text-fragment — AC #1 round-trip', () => {
  it('runs a deterministic 200-iteration fuzz over LARGE_ARTICLE', () => {
    const rand = mulberry32(0xc0ffee);
    const text = LARGE_ARTICLE;
    let iterations = 0;
    let attempted = 0;

    while (iterations < 200 && attempted < 2000) {
      attempted++;
      const start = Math.floor(rand() * Math.max(1, text.length - 20));
      const minEnd = start + 5;
      const maxEnd = Math.min(start + 200, text.length);
      if (minEnd >= maxEnd) continue;
      const end = minEnd + Math.floor(rand() * (maxEnd - minEnd));

      if (text.slice(start, end).trim().length === 0) continue;

      let anchor;
      try {
        anchor = computeAnchor({ normalizedText: text, start, end });
      } catch (err) {
        // `not_disambiguatable` is an acceptable outcome for pathological
        // overlapping selections; everything else is a fuzz failure.
        if (
          err instanceof TextFragmentError &&
          err.detail.code === 'not_disambiguatable'
        ) {
          continue;
        }
        throw err;
      }

      const serialized = serializeAnchor(anchor);
      const parsed = parseAnchor(serialized);
      expect(parsed, `parse(serialize(anchor)) returned null for ${serialized}`).toEqual(
        anchor,
      );

      const located = locateAnchor(parsed!, text);
      expect(located, `locate returned null for anchor ${serialized}`).not.toBeNull();
      expect(located).toEqual({ start, end });
      iterations++;
    }

    expect(iterations).toBe(200);
  });

  it('round-trips a selection of the first paragraph', () => {
    const text = LARGE_ARTICLE;
    const firstSentenceEnd = text.indexOf('. ') + 1;
    const start = 0;
    const end = firstSentenceEnd;
    const anchor = computeAnchor({ normalizedText: text, start, end });
    const located = locateAnchor(parseAnchor(serializeAnchor(anchor))!, text);
    expect(located).toEqual({ start, end });
  });

  it('round-trips a selection that crosses a paragraph boundary', () => {
    const text = LARGE_ARTICLE;
    const boundary = text.indexOf('. ');
    const start = boundary - 10;
    const end = boundary + 20;
    const anchor = computeAnchor({ normalizedText: text, start, end });
    const located = locateAnchor(parseAnchor(serializeAnchor(anchor))!, text);
    expect(located).toEqual({ start, end });
  });

  it('round-trips a single-word selection using single-text form', () => {
    const text = LARGE_ARTICLE;
    // "classifiers" sits inside section 2's theme and is short enough to be
    // single-text form; "Section 2:" is unique so disambiguation is local.
    const word = 'classifiers';
    const start = text.indexOf(word);
    const end = start + word.length;
    const anchor = computeAnchor({ normalizedText: text, start, end });
    expect(anchor.textEnd).toBeUndefined();
    const located = locateAnchor(parseAnchor(serializeAnchor(anchor))!, text);
    expect(located).toEqual({ start, end });
  });

  it('round-trips a long paragraph selection using range form', () => {
    const text = LARGE_ARTICLE;
    // A multi-word selection from section 3, which contains the unique
    // tail "a separator-style anchor." — range form pins both ends.
    const phraseStart = text.indexOf('Section 3:');
    const tail = 'a separator-style anchor.';
    const phraseEnd = text.indexOf(tail, phraseStart) + tail.length;
    const anchor = computeAnchor({
      normalizedText: text,
      start: phraseStart,
      end: phraseEnd,
    });
    expect(anchor.textEnd).toBeDefined();
    const located = locateAnchor(parseAnchor(serializeAnchor(anchor))!, text);
    expect(located).toEqual({ start: phraseStart, end: phraseEnd });
  });
});
