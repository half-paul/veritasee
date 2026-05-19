import { describe, expect, it } from 'vitest';
import { revisionHashFor, sha256Hex, SNAPSHOT_REVISION_PREFIX } from './hash';

describe('sha256Hex', () => {
  it('matches the known sha256 of "hello"', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('is deterministic for the same input', () => {
    expect(sha256Hex('foo')).toBe(sha256Hex('foo'));
  });
});

describe('revisionHashFor', () => {
  it('prefixes the hex with sha256:', () => {
    const h = revisionHashFor('hello');
    expect(h).toBe(
      `${SNAPSHOT_REVISION_PREFIX}2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`,
    );
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    expect(revisionHashFor('')).not.toBe(revisionHashFor('hello'));
  });
});
