import { describe, expect, it } from 'vitest';
import { locateAnchor } from './locate';

describe('locateAnchor', () => {
  it('returns the first occurrence when textStart is unique', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const result = locateAnchor({ textStart: 'quick brown fox' }, text);
    expect(result).toEqual({ start: 4, end: 19 });
  });

  it('returns null when textStart does not appear', () => {
    const text = 'Hello world';
    expect(locateAnchor({ textStart: 'goodbye' }, text)).toBeNull();
  });

  it('returns the first match deterministically when textStart appears multiple times', () => {
    const text = 'foo bar foo baz foo';
    const result = locateAnchor({ textStart: 'foo' }, text);
    expect(result).toEqual({ start: 0, end: 3 });
  });

  it('filters by prefix to select a non-first occurrence', () => {
    const text = 'apple foo banana foo cherry foo';
    const result = locateAnchor({ prefix: 'banana ', textStart: 'foo' }, text);
    expect(result).toEqual({ start: 17, end: 20 });
  });

  it('filters by suffix to select a non-first occurrence', () => {
    const text = 'apple foo banana foo cherry foo done';
    const result = locateAnchor({ textStart: 'foo', suffix: ' cherry' }, text);
    expect(result).toEqual({ start: 17, end: 20 });
  });

  it('returns a span covering textStart through textEnd in range form', () => {
    const text = 'foo X Y Z bar baz';
    const result = locateAnchor({ textStart: 'foo', textEnd: 'bar' }, text);
    expect(result).toEqual({ start: 0, end: 13 });
  });

  it('match span end is inclusive of textEnd characters', () => {
    const text = 'alpha bravo charlie delta echo';
    const anchor = { textStart: 'alpha', textEnd: 'charlie' };
    const result = locateAnchor(anchor, text);
    expect(result).not.toBeNull();
    expect(text.slice(result!.start, result!.end)).toBe('alpha bravo charlie');
  });

  it('matches case-insensitively (anchor case differs from text)', () => {
    const text = 'Hello World';
    const result = locateAnchor({ textStart: 'HELLO' }, text);
    expect(result).toEqual({ start: 0, end: 5 });
  });

  it('returns null when prefix does not match at any candidate position', () => {
    const text = 'apple foo banana';
    const result = locateAnchor({ prefix: 'cherry ', textStart: 'foo' }, text);
    expect(result).toBeNull();
  });

  it('returns null when textEnd does not appear after a textStart match', () => {
    const text = 'foo baz qux';
    const result = locateAnchor({ textStart: 'foo', textEnd: 'bar' }, text);
    expect(result).toBeNull();
  });
});
