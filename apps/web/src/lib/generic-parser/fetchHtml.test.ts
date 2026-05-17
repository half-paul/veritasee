import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockGenericPage } from '@test/factories/mockGenericPage';
import { server } from '@test/msw/server';
import { fetchHtml } from './fetchHtml';
import { GenericParserError } from './types';

const TEST_URL = 'https://example.com/article';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetchHtml — happy path', () => {
  it('returns the HTML body and a final URL for a valid HTML response', async () => {
    const html = mockGenericPage({ title: 'Hello' });
    server.use(
      http.get(TEST_URL, () =>
        new HttpResponse(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );
    const result = await fetchHtml(TEST_URL);
    expect(result.html).toContain('Hello');
    expect(result.html).toContain('<p>Paragraph 1:');
    expect(result.finalUrl).toContain('example.com');
  });

  it('accepts application/xhtml+xml content-type', async () => {
    const html = mockGenericPage({ title: 'XHTML' });
    server.use(
      http.get(TEST_URL, () =>
        new HttpResponse(html, {
          status: 200,
          headers: { 'content-type': 'application/xhtml+xml' },
        }),
      ),
    );
    const result = await fetchHtml(TEST_URL);
    expect(result.html).toContain('XHTML');
  });
});

describe('fetchHtml — error mapping', () => {
  it('throws http_error with status 500 on HTTP 500', async () => {
    server.use(http.get(TEST_URL, () => new HttpResponse(null, { status: 500 })));
    try {
      await fetchHtml(TEST_URL);
      throw new Error('expected GenericParserError');
    } catch (err) {
      expect(err).toBeInstanceOf(GenericParserError);
      const detail = (err as GenericParserError).detail;
      expect(detail.code).toBe('http_error');
      if (detail.code === 'http_error') expect(detail.status).toBe(500);
    }
  });

  it('throws http_error with status 429 on HTTP 429', async () => {
    server.use(http.get(TEST_URL, () => new HttpResponse(null, { status: 429 })));
    try {
      await fetchHtml(TEST_URL);
      throw new Error('expected GenericParserError');
    } catch (err) {
      const detail = (err as GenericParserError).detail;
      expect(detail.code).toBe('http_error');
      if (detail.code === 'http_error') expect(detail.status).toBe(429);
    }
  });

  it('throws bad_content_type when content-type is not HTML', async () => {
    server.use(
      http.get(TEST_URL, () =>
        new HttpResponse('%PDF-1.4 not really a pdf', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    );
    try {
      await fetchHtml(TEST_URL);
      throw new Error('expected GenericParserError');
    } catch (err) {
      const detail = (err as GenericParserError).detail;
      expect(detail.code).toBe('bad_content_type');
      if (detail.code === 'bad_content_type') expect(detail.contentType).toBe('application/pdf');
    }
  });

  it('throws bad_response when the body is empty', async () => {
    server.use(
      http.get(TEST_URL, () =>
        new HttpResponse('', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    try {
      await fetchHtml(TEST_URL);
      throw new Error('expected GenericParserError');
    } catch (err) {
      expect((err as GenericParserError).detail.code).toBe('bad_response');
    }
  });

  it('throws too_large when the body exceeds the configured limit', async () => {
    // The env value is clamped to GENERIC_PARSER_MAX_BYTES_MIN (64 KB). Any
    // smaller env value still results in a 64 KB ceiling, so we pad past it.
    vi.stubEnv('GENERIC_PARSER_MAX_BYTES', '4096');
    const filler = 'x'.repeat(70 * 1024);
    const html = `<!doctype html><html><body><article><p>${filler}</p></article></body></html>`;
    server.use(
      http.get(TEST_URL, () =>
        new HttpResponse(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );
    try {
      await fetchHtml(TEST_URL);
      throw new Error('expected GenericParserError');
    } catch (err) {
      const detail = (err as GenericParserError).detail;
      expect(detail.code).toBe('too_large');
      if (detail.code === 'too_large') expect(detail.limitBytes).toBe(64 * 1024);
    }
  });

  it('throws timeout when the AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await fetchHtml(TEST_URL, { signal: controller.signal });
      throw new Error('expected GenericParserError');
    } catch (err) {
      expect((err as GenericParserError).detail.code).toBe('timeout');
    }
  });
});
