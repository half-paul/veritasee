import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  FOOTER_NOISE,
  mockGenericPage,
  NAVIGATION_NOISE,
} from '@test/factories/mockGenericPage';
import { server } from '@test/msw/server';
import { parseGenericArticle } from './parseGenericArticle';
import { GenericParserError } from './types';

const TEST_URL = 'https://example.com/article';

function htmlResponse(body: string): HttpResponse<string> {
  return new HttpResponse(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

describe('parseGenericArticle — happy path', () => {
  it('returns a typed GenericArticle with sha256 hash and one section', async () => {
    const html = mockGenericPage({ title: 'Hello', container: 'article', paragraphs: 5 });
    server.use(http.get(TEST_URL, () => htmlResponse(html)));
    const article = await parseGenericArticle(TEST_URL);
    expect(article.kind).toBe('generic');
    expect(article.url).toBe(TEST_URL);
    expect(article.hostname).toBe('example.com');
    expect(article.title).toBe('Hello');
    expect(article.revisionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(article.sections).toHaveLength(1);
    expect(article.sections[0]?.id).toBe('');
    expect(article.sections[0]?.html).toBe(article.leadHtml);
    expect(article.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('parseGenericArticle — revision hash determinism and sensitivity', () => {
  it('produces the same revisionHash for identical bodies', async () => {
    const html = mockGenericPage({ title: 'Same', container: 'article', paragraphs: 4 });
    server.use(http.get(TEST_URL, () => htmlResponse(html)));
    const a = await parseGenericArticle(TEST_URL);
    server.use(http.get(TEST_URL, () => htmlResponse(html)));
    const b = await parseGenericArticle(TEST_URL);
    expect(a.revisionHash).toBe(b.revisionHash);
  });

  it('produces a different revisionHash when content changes', async () => {
    const html1 = mockGenericPage({ title: 'Same', container: 'article', paragraphs: 4 });
    const html2 = mockGenericPage({ title: 'Same', container: 'article', paragraphs: 5 });
    server.use(http.get(TEST_URL, () => htmlResponse(html1)));
    const a = await parseGenericArticle(TEST_URL);
    server.use(http.get(TEST_URL, () => htmlResponse(html2)));
    const b = await parseGenericArticle(TEST_URL);
    expect(a.revisionHash).not.toBe(b.revisionHash);
  });
});

describe('parseGenericArticle — error propagation', () => {
  it('propagates fetchHtml http_error', async () => {
    server.use(http.get(TEST_URL, () => new HttpResponse(null, { status: 500 })));
    try {
      await parseGenericArticle(TEST_URL);
      throw new Error('expected GenericParserError');
    } catch (err) {
      expect(err).toBeInstanceOf(GenericParserError);
      const detail = (err as GenericParserError).detail;
      expect(detail.code).toBe('http_error');
      if (detail.code === 'http_error') expect(detail.status).toBe(500);
    }
  });

  it('propagates extraction_failed when the body is only nav/footer', async () => {
    const html = mockGenericPage({
      bodyOverride: `<nav>${NAVIGATION_NOISE}</nav><footer>${FOOTER_NOISE}</footer>`,
    });
    server.use(http.get(TEST_URL, () => htmlResponse(html)));
    try {
      await parseGenericArticle(TEST_URL);
      throw new Error('expected GenericParserError');
    } catch (err) {
      expect((err as GenericParserError).detail.code).toBe('extraction_failed');
    }
  });

  it('refuses to parse a MediaWiki URL', async () => {
    try {
      await parseGenericArticle('https://en.wikipedia.org/wiki/HTTP_404');
      throw new Error('expected GenericParserError');
    } catch (err) {
      expect((err as GenericParserError).detail.code).toBe('extraction_failed');
    }
  });
});
