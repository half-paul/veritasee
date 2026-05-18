import { describe, expect, it } from 'vitest';
import { parseAnchor, serializeAnchor } from './serialize';
import type { TextFragmentAnchor } from './types';

describe('serializeAnchor', () => {
  it('serializes single-text form with percent-encoded spaces', () => {
    expect(serializeAnchor({ textStart: 'hello world' })).toBe(':~:text=hello%20world');
  });

  it('serializes range form with comma separator', () => {
    expect(serializeAnchor({ textStart: 'hello', textEnd: 'world' })).toBe(
      ':~:text=hello,world',
    );
  });

  it('serializes a prefix using the trailing-dash structural separator', () => {
    expect(serializeAnchor({ prefix: 'a', textStart: 'b' })).toBe(':~:text=a-,b');
  });

  it('serializes a suffix using the leading-dash structural separator', () => {
    expect(serializeAnchor({ textStart: 'b', suffix: 'c' })).toBe(':~:text=b,-c');
  });

  it('serializes the full quad in order prefix, textStart, textEnd, suffix', () => {
    expect(
      serializeAnchor({ prefix: 'a', textStart: 'b', textEnd: 'c', suffix: 'd' }),
    ).toBe(':~:text=a-,b,c,-d');
  });

  it('percent-encodes commas inside content', () => {
    expect(serializeAnchor({ textStart: 'a,b' })).toBe(':~:text=a%2Cb');
  });

  it('percent-encodes hyphens inside content to disambiguate from structural dashes', () => {
    expect(serializeAnchor({ textStart: 'a-b' })).toBe(':~:text=a%2Db');
  });

  it('percent-encodes ampersands inside content', () => {
    expect(serializeAnchor({ textStart: 'a&b' })).toBe(':~:text=a%26b');
  });
});

describe('parseAnchor', () => {
  it('parses single-text form', () => {
    expect(parseAnchor(':~:text=hello%20world')).toEqual({ textStart: 'hello world' });
  });

  it('parses range form', () => {
    expect(parseAnchor(':~:text=hello,world')).toEqual({
      textStart: 'hello',
      textEnd: 'world',
    });
  });

  it('parses prefix-only', () => {
    expect(parseAnchor(':~:text=a-,b')).toEqual({ prefix: 'a', textStart: 'b' });
  });

  it('parses suffix-only', () => {
    expect(parseAnchor(':~:text=b,-c')).toEqual({ textStart: 'b', suffix: 'c' });
  });

  it('parses the full quad', () => {
    expect(parseAnchor(':~:text=a-,b,c,-d')).toEqual({
      prefix: 'a',
      textStart: 'b',
      textEnd: 'c',
      suffix: 'd',
    });
  });

  it('decodes percent-encoded hyphens inside content', () => {
    expect(parseAnchor(':~:text=a%2Db')).toEqual({ textStart: 'a-b' });
  });

  it('strips a leading "#" if present', () => {
    expect(parseAnchor('#:~:text=foo')).toEqual({ textStart: 'foo' });
  });

  it('returns null on empty input', () => {
    expect(parseAnchor('')).toBeNull();
  });

  it('returns null when the :~:text= prefix is missing', () => {
    expect(parseAnchor('text=foo')).toBeNull();
  });

  it('returns null when the body is empty', () => {
    expect(parseAnchor(':~:text=')).toBeNull();
  });

  it('returns null on more than two text segments', () => {
    expect(parseAnchor(':~:text=a,b,c')).toBeNull();
  });

  it('returns null on a malformed percent escape (does not throw)', () => {
    expect(parseAnchor(':~:text=%E0%A4')).toBeNull();
  });
});

describe('serializeAnchor / parseAnchor — round-trip', () => {
  const cases: TextFragmentAnchor[] = [
    { textStart: 'hello world' },
    { textStart: 'first three', textEnd: 'last three' },
    { prefix: 'before', textStart: 'middle' },
    { textStart: 'middle', suffix: 'after' },
    { prefix: 'before', textStart: 'middle', textEnd: 'middle2', suffix: 'after' },
    { textStart: 'comma, in, text' },
    { textStart: 'hyphen-in-text' },
    { textStart: 'amp & in text' },
  ];

  for (const anchor of cases) {
    it(`round-trips ${JSON.stringify(anchor)}`, () => {
      const serialized = serializeAnchor(anchor);
      const parsed = parseAnchor(serialized);
      expect(parsed).toEqual(anchor);
    });
  }
});
