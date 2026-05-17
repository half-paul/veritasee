import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockMediaWikiParse } from '@test/factories/mockMediaWikiResponse';
import { server } from '@test/msw/server';
import { fetchSections } from './client';
import { MediaWikiApiError } from './types';

const WIKI_URL = 'https://en.wikipedia.org/wiki/HTTP_404';
const API_URL = 'https://en.wikipedia.org/w/api.php';

describe('fetchSections — happy path', () => {
  it('returns a typed MediaWikiArticle when the API returns a valid response', async () => {
    server.use(
      http.get(API_URL, () => HttpResponse.json(mockMediaWikiParse({ revid: 12345 }))),
    );
    const article = await fetchSections(WIKI_URL);
    expect(article.kind).toBe('mediawiki');
    expect(article.revisionHash).toBe('mw:12345');
    expect(article.sections.length).toBeGreaterThan(0);
  });
});

describe('fetchSections — error mapping', () => {
  it('throws not_mediawiki when URL is a generic host', async () => {
    await expect(fetchSections('https://www.britannica.com/topic/foo')).rejects.toMatchObject({
      name: 'MediaWikiApiError',
      detail: { code: 'not_mediawiki' },
    });
  });

  it('throws http_error on HTTP 500', async () => {
    server.use(http.get(API_URL, () => new HttpResponse(null, { status: 500 })));
    try {
      await fetchSections(WIKI_URL);
      throw new Error('expected MediaWikiApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(MediaWikiApiError);
      const detail = (err as MediaWikiApiError).detail;
      expect(detail.code).toBe('http_error');
      if (detail.code === 'http_error') expect(detail.status).toBe(500);
    }
  });

  it('throws http_error on HTTP 429 (rate-limited)', async () => {
    server.use(http.get(API_URL, () => new HttpResponse(null, { status: 429 })));
    try {
      await fetchSections(WIKI_URL);
      throw new Error('expected MediaWikiApiError');
    } catch (err) {
      const detail = (err as MediaWikiApiError).detail;
      expect(detail.code).toBe('http_error');
      if (detail.code === 'http_error') expect(detail.status).toBe(429);
    }
  });

  it('throws page_not_found on missingtitle error', async () => {
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({ error: { code: 'missingtitle', info: 'no page' } }),
      ),
    );
    try {
      await fetchSections(WIKI_URL);
      throw new Error('expected MediaWikiApiError');
    } catch (err) {
      expect((err as MediaWikiApiError).detail.code).toBe('page_not_found');
    }
  });

  it('throws bad_response when the JSON body is malformed', async () => {
    server.use(
      http.get(API_URL, () =>
        new HttpResponse('not json', { headers: { 'content-type': 'application/json' } }),
      ),
    );
    try {
      await fetchSections(WIKI_URL);
      throw new Error('expected MediaWikiApiError');
    } catch (err) {
      expect((err as MediaWikiApiError).detail.code).toBe('bad_response');
    }
  });

  it('throws bad_redirect when the upstream redirects to a non-MediaWiki host', async () => {
    // MSW handles the redirect-then-non-mediawiki scenario by intercepting
    // the upstream URL and producing a response whose `url` field looks like
    // a different host. We simulate by returning JSON but routing via a
    // disallowed host alias.
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json(mockMediaWikiParse(), {
          // Forge res.url to a non-MediaWiki host via the Location header
          // on a 200? Not possible. Instead, redirect to a 200 on evil.test.
          status: 302,
          headers: { location: 'https://evil.test/w/api.php' },
        }),
      ),
      http.get('https://evil.test/w/api.php', () =>
        HttpResponse.json(mockMediaWikiParse()),
      ),
    );
    try {
      await fetchSections(WIKI_URL);
      throw new Error('expected MediaWikiApiError');
    } catch (err) {
      expect((err as MediaWikiApiError).detail.code).toBe('bad_redirect');
    }
  });
});
