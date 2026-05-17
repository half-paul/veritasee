import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';
import { MediaWikiApiError } from '@/lib/mediawiki';

const { parseArticle } = vi.hoisted(() => ({
  parseArticle: vi.fn(),
}));

vi.mock('@/lib/parser', () => ({
  parseArticle,
}));

import { GET } from './route';

const URL_BASE = 'https://localhost/api/health/mediawiki';

function happyArticle() {
  return {
    kind: 'mediawiki' as const,
    url: 'https://en.wikipedia.org/wiki/HTTP_404',
    title: 'HTTP 404',
    revisionHash: 'mw:42',
    pageId: 1,
    fetchedAt: new Date().toISOString(),
    sections: [
      { id: '', title: 'HTTP 404', level: 0, html: '<p>lead</p>' },
      { id: 'History', title: 'History', level: 2, html: '<h2>x</h2>' },
    ],
    leadHtml: '<p>lead</p>',
  };
}

describe('GET /api/health/mediawiki', () => {
  const ORIGINAL_TOKEN = process.env.MEDIAWIKI_HEALTH_TOKEN;

  beforeEach(() => {
    delete process.env.MEDIAWIKI_HEALTH_TOKEN;
    vi.stubEnv('NODE_ENV', 'test');
    parseArticle.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.MEDIAWIKI_HEALTH_TOKEN;
    else process.env.MEDIAWIKI_HEALTH_TOKEN = ORIGINAL_TOKEN;
    vi.unstubAllEnvs();
  });

  it('200 with sections + revisionId when the probe succeeds', async () => {
    parseArticle.mockResolvedValue(happyArticle());
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      sections: number;
      revisionId: number;
    };
    expect(body.ok).toBe(true);
    expect(body.sections).toBe(2);
    expect(body.revisionId).toBe(42);
  });

  it('503 when the parser returns a fallback (probe URL was not classified)', async () => {
    parseArticle.mockResolvedValue({
      kind: 'fallback',
      url: 'x',
      hostname: 'y',
      reason: 'generic_scraper_not_yet_implemented',
    });
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(503);
  });

  it('503 with code from MediaWikiApiError when fetch fails', async () => {
    parseArticle.mockRejectedValue(
      new MediaWikiApiError({ code: 'http_error', status: 500, message: 'oops' }),
    );
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('http_error');
  });

  it('503 in production when MEDIAWIKI_HEALTH_TOKEN is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(503);
  });

  it('401 when the token is set but the request lacks it', async () => {
    process.env.MEDIAWIKI_HEALTH_TOKEN = 'tk';
    const res = await GET(buildRequest({ url: URL_BASE }));
    expect(res.status).toBe(401);
  });

  it('200 when the token matches', async () => {
    process.env.MEDIAWIKI_HEALTH_TOKEN = 'tk';
    parseArticle.mockResolvedValue(happyArticle());
    const res = await GET(
      buildRequest({ url: URL_BASE, headers: { 'x-health-token': 'tk' } }),
    );
    expect(res.status).toBe(200);
  });
});
