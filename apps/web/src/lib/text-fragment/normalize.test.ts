import { describe, expect, it } from 'vitest';
import { caseFold, normalizeTextForAnchor } from './normalize';

describe('normalizeTextForAnchor', () => {
  it('collapses runs of whitespace to a single space', () => {
    expect(normalizeTextForAnchor('a   b\t\tc\n\nd')).toBe('a b c d');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTextForAnchor('   hello world   ')).toBe('hello world');
  });

  it('preserves casing (does not lowercase)', () => {
    expect(normalizeTextForAnchor('FOO bar Baz')).toBe('FOO bar Baz');
  });

  it('strips HTML tags from input', () => {
    expect(normalizeTextForAnchor('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('is idempotent', () => {
    const once = normalizeTextForAnchor('  <p>The   quick</p>  brown   fox  ');
    const twice = normalizeTextForAnchor(once);
    expect(twice).toBe(once);
  });

  it('NFC-normalizes combining mark sequences', () => {
    const decomposed = 'á'; // a + combining acute = "á"
    const composed = 'á'; // single-codepoint "á"
    expect(normalizeTextForAnchor(decomposed)).toBe(composed);
  });
});

describe('caseFold', () => {
  it('lowercases ASCII input', () => {
    expect(caseFold('Hello WORLD')).toBe('hello world');
  });

  it('preserves length for ASCII inputs', () => {
    const input = 'The Quick Brown Fox';
    expect(caseFold(input).length).toBe(input.length);
  });

  it('NFC-normalizes its input', () => {
    const decomposed = 'Á';
    expect(caseFold(decomposed)).toBe('á');
  });
});
