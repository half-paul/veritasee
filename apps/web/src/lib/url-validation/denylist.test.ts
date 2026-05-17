import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDenylistCache,
  DEFAULT_DENYLIST,
  isDenylisted,
  loadDenylist,
} from './denylist';

describe('loadDenylist', () => {
  const ORIGINAL_ENV = process.env.URL_DENYLIST_EXTRA;

  beforeEach(() => {
    clearDenylistCache();
    delete process.env.URL_DENYLIST_EXTRA;
  });

  afterEach(() => {
    clearDenylistCache();
    if (ORIGINAL_ENV === undefined) {
      delete process.env.URL_DENYLIST_EXTRA;
    } else {
      process.env.URL_DENYLIST_EXTRA = ORIGINAL_ENV;
    }
  });

  it('includes every default entry, lowercased', () => {
    const list = loadDenylist();
    for (const entry of DEFAULT_DENYLIST) {
      expect(list.has(entry.toLowerCase())).toBe(true);
    }
  });

  it('appends URL_DENYLIST_EXTRA entries', () => {
    process.env.URL_DENYLIST_EXTRA = 'malware.test, internal.example.com ,EVIL.NET';
    const list = loadDenylist();
    expect(list.has('malware.test')).toBe(true);
    expect(list.has('internal.example.com')).toBe(true);
    expect(list.has('evil.net')).toBe(true);
  });

  it('ignores empty entries in URL_DENYLIST_EXTRA', () => {
    process.env.URL_DENYLIST_EXTRA = ',,malware.test,,';
    const list = loadDenylist();
    expect(list.has('malware.test')).toBe(true);
    expect(list.has('')).toBe(false);
  });

  it('memoizes — second call returns the same set', () => {
    const a = loadDenylist();
    const b = loadDenylist();
    expect(a).toBe(b);
  });
});

describe('isDenylisted', () => {
  const list = new Set(['localhost', 'evil.com', '169.254.169.254']);

  it('matches an exact host', () => {
    expect(isDenylisted('localhost', list)).toBe(true);
    expect(isDenylisted('evil.com', list)).toBe(true);
  });

  it('matches any subdomain of a denylisted host', () => {
    expect(isDenylisted('a.evil.com', list)).toBe(true);
    expect(isDenylisted('deep.nested.evil.com', list)).toBe(true);
  });

  it('does not match a parent of a denylisted host', () => {
    expect(isDenylisted('com', list)).toBe(false);
  });

  it('does not match a substring boundary trick', () => {
    // `notevil.com` ends with `evil.com` as a substring but not on a dot
    // boundary, so it must not match.
    expect(isDenylisted('notevil.com', list)).toBe(false);
  });

  it('matches case-insensitively on the input host', () => {
    expect(isDenylisted('EVIL.COM', list)).toBe(true);
    expect(isDenylisted('A.Evil.Com', list)).toBe(true);
  });

  it('matches an IP-literal entry exactly', () => {
    expect(isDenylisted('169.254.169.254', list)).toBe(true);
  });
});
