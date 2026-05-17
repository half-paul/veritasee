import { describe, expect, it } from 'vitest';
import { classifySource } from './classify';

describe('classifySource — MediaWiki hosts', () => {
  it('classifies en.wikipedia.org with /w/api.php endpoint', () => {
    const result = classifySource('https://en.wikipedia.org/wiki/HTTP_404');
    expect(result).toEqual({
      kind: 'mediawiki',
      hostname: 'en.wikipedia.org',
      apiEndpoint: 'https://en.wikipedia.org/w/api.php',
      pageTitle: 'HTTP_404',
    });
  });

  it('classifies a wikipedia.org subdomain (de.wikipedia.org)', () => {
    const result = classifySource('https://de.wikipedia.org/wiki/Berlin');
    expect(result).toMatchObject({
      kind: 'mediawiki',
      hostname: 'de.wikipedia.org',
      apiEndpoint: 'https://de.wikipedia.org/w/api.php',
    });
  });

  it('classifies a wikimedia.org subdomain', () => {
    const result = classifySource('https://commons.wikimedia.org/wiki/Main_Page');
    expect(result).toMatchObject({ kind: 'mediawiki', hostname: 'commons.wikimedia.org' });
  });

  it('classifies a wiktionary.org subdomain', () => {
    const result = classifySource('https://en.wiktionary.org/wiki/test');
    expect(result).toMatchObject({ kind: 'mediawiki', hostname: 'en.wiktionary.org' });
  });

  it('classifies citizendium.org with its /wiki/api.php endpoint', () => {
    const result = classifySource('https://en.citizendium.org/wiki/Biology');
    expect(result).toMatchObject({
      kind: 'mediawiki',
      apiEndpoint: 'https://en.citizendium.org/wiki/api.php',
    });
  });

  it('classifies the apex (no subdomain) of a known host', () => {
    const result = classifySource('https://wikipedia.org/wiki/Test');
    expect(result).toMatchObject({ kind: 'mediawiki', hostname: 'wikipedia.org' });
  });

  it('decodes percent-encoded page titles', () => {
    const result = classifySource(
      'https://en.wikipedia.org/wiki/Cura%C3%A7ao',
    );
    expect(result).toMatchObject({ kind: 'mediawiki', pageTitle: 'Curaçao' });
  });

  it('lowercases hostnames for matching (case-insensitive host)', () => {
    const result = classifySource('https://EN.WIKIPEDIA.ORG/wiki/Test');
    expect(result).toMatchObject({ kind: 'mediawiki', hostname: 'en.wikipedia.org' });
  });
});

describe('classifySource — generic fallback', () => {
  it('returns generic for non-MediaWiki hosts', () => {
    const result = classifySource('https://www.britannica.com/topic/foo');
    expect(result).toEqual({ kind: 'generic', hostname: 'www.britannica.com' });
  });

  it('returns generic for a known host with a non-/wiki/ path', () => {
    // No /wiki/ prefix means we cannot derive a page title; fall back.
    const result = classifySource('https://en.wikipedia.org/');
    expect(result).toEqual({ kind: 'generic', hostname: 'en.wikipedia.org' });
  });

  it('returns generic for a known host when /wiki/ has an empty title', () => {
    const result = classifySource('https://en.wikipedia.org/wiki/');
    expect(result).toEqual({ kind: 'generic', hostname: 'en.wikipedia.org' });
  });

  it('returns generic with empty hostname on an unparseable URL', () => {
    const result = classifySource('not a url');
    expect(result).toEqual({ kind: 'generic', hostname: '' });
  });

  it('returns generic for a near-miss host (substring boundary)', () => {
    // `notwikipedia.org` ends with `wikipedia.org` but not on a dot boundary.
    const result = classifySource('https://notwikipedia.org/wiki/Test');
    expect(result).toMatchObject({ kind: 'generic' });
  });

  it('returns generic with garbage hostname on malformed percent-encoding', () => {
    const result = classifySource('https://en.wikipedia.org/wiki/%E0%A4%A');
    // Bad % escape causes decodeURIComponent to throw → fallback.
    expect(result).toEqual({ kind: 'generic', hostname: 'en.wikipedia.org' });
  });
});
