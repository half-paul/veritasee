import { describe, expect, it } from 'vitest';
import type { MediaWikiSource } from '@/lib/source-classifier';
import { buildMediaWikiRequest } from './buildRequest';

const wikipediaSource: MediaWikiSource = {
  kind: 'mediawiki',
  hostname: 'en.wikipedia.org',
  apiEndpoint: 'https://en.wikipedia.org/w/api.php',
  pageTitle: 'HTTP_404',
};

describe('buildMediaWikiRequest', () => {
  it('builds an action=parse URL pinned to formatversion=2', () => {
    const { url } = buildMediaWikiRequest(wikipediaSource);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://en.wikipedia.org/w/api.php');
    expect(parsed.searchParams.get('action')).toBe('parse');
    expect(parsed.searchParams.get('format')).toBe('json');
    expect(parsed.searchParams.get('formatversion')).toBe('2');
  });

  it('requests sections|text|revid|displaytitle', () => {
    const { url } = buildMediaWikiRequest(wikipediaSource);
    expect(new URL(url).searchParams.get('prop')).toBe('sections|text|revid|displaytitle');
  });

  it('follows server-side redirects via redirects=1', () => {
    const { url } = buildMediaWikiRequest(wikipediaSource);
    expect(new URL(url).searchParams.get('redirects')).toBe('1');
  });

  it('passes the page title through unencoded in the params object', () => {
    const { url } = buildMediaWikiRequest({
      ...wikipediaSource,
      pageTitle: 'Curaçao',
    });
    // URLSearchParams encodes the title; the round-trip decode must equal the input.
    expect(new URL(url).searchParams.get('page')).toBe('Curaçao');
  });

  it('sets Accept and a Veritasee-branded User-Agent', () => {
    const { headers } = buildMediaWikiRequest(wikipediaSource);
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toMatch(/^Veritasee\//);
  });
});
