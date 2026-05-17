import { describe, expect, it } from 'vitest';
import { proxyCacheKey } from './keys';

describe('proxyCacheKey', () => {
  it('is deterministic: same URL → same key', () => {
    const url = 'https://en.wikipedia.org/wiki/Test';
    expect(proxyCacheKey(url)).toBe(proxyCacheKey(url));
  });

  it('produces different keys for URLs that differ only in revision/query', () => {
    expect(proxyCacheKey('https://en.wikipedia.org/wiki/Test?revision=1')).not.toBe(
      proxyCacheKey('https://en.wikipedia.org/wiki/Test?revision=2'),
    );
  });

  it('produces different keys for distinct URLs (no collision in casual inputs)', () => {
    const a = proxyCacheKey('https://en.wikipedia.org/wiki/A');
    const b = proxyCacheKey('https://en.wikipedia.org/wiki/B');
    const c = proxyCacheKey('https://de.wikipedia.org/wiki/A');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('emits a versioned namespace prefix (avoids cross-version collisions)', () => {
    expect(proxyCacheKey('https://en.wikipedia.org/wiki/X')).toMatch(/^proxy:cache:v1:/);
  });

  it('hashes the URL — the literal URL does not appear in the key', () => {
    const url = 'https://en.wikipedia.org/wiki/Sensitive_Token_in_URL';
    const key = proxyCacheKey(url);
    expect(key).not.toContain('Sensitive_Token_in_URL');
    expect(key).not.toContain('en.wikipedia.org');
  });

  it('produces a fixed-length hex digest after the prefix', () => {
    const key = proxyCacheKey('https://en.wikipedia.org/wiki/Test');
    const digest = key.replace(/^proxy:cache:v1:/, '');
    // sha256 → 64 hex chars
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
