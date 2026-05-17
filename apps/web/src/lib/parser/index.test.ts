import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the mediawiki client so the parser dispatcher tests don't make HTTP
// calls. We are testing the *dispatch* decision, not the upstream parser.
vi.mock('@/lib/mediawiki', () => ({
  fetchSections: vi.fn(),
}));

import { fetchSections } from '@/lib/mediawiki';
import { parseArticle } from './index';

const mockFetchSections = vi.mocked(fetchSections);

describe('parseArticle dispatcher', () => {
  afterEach(() => {
    mockFetchSections.mockReset();
  });

  it('routes a MediaWiki URL to fetchSections', async () => {
    mockFetchSections.mockResolvedValue({
      kind: 'mediawiki',
      url: 'https://en.wikipedia.org/wiki/Test',
      title: 'Test',
      revisionHash: 'mw:1',
      pageId: 1,
      fetchedAt: '2026-05-16T00:00:00.000Z',
      sections: [],
      leadHtml: '',
    });
    const result = await parseArticle('https://en.wikipedia.org/wiki/Test');
    expect(mockFetchSections).toHaveBeenCalledWith(
      'https://en.wikipedia.org/wiki/Test',
      undefined,
    );
    expect(result.kind).toBe('mediawiki');
  });

  it('passes through the AbortSignal option to fetchSections', async () => {
    const controller = new AbortController();
    mockFetchSections.mockResolvedValue({
      kind: 'mediawiki',
      url: 'https://en.wikipedia.org/wiki/Test',
      title: 'Test',
      revisionHash: 'mw:1',
      pageId: 1,
      fetchedAt: '2026-05-16T00:00:00.000Z',
      sections: [],
      leadHtml: '',
    });
    await parseArticle('https://en.wikipedia.org/wiki/Test', { signal: controller.signal });
    expect(mockFetchSections).toHaveBeenCalledWith(
      'https://en.wikipedia.org/wiki/Test',
      { signal: controller.signal },
    );
  });

  it('returns a typed fallback sentinel for a non-MediaWiki URL', async () => {
    const result = await parseArticle('https://www.britannica.com/topic/foo');
    expect(result).toEqual({
      kind: 'fallback',
      url: 'https://www.britannica.com/topic/foo',
      hostname: 'www.britannica.com',
      reason: 'generic_scraper_not_yet_implemented',
    });
    expect(mockFetchSections).not.toHaveBeenCalled();
  });

  it('returns a fallback for a known host that has no /wiki/ path', async () => {
    // wikipedia.org with non-/wiki/ path is classified generic → fallback.
    const result = await parseArticle('https://en.wikipedia.org/');
    expect(result).toMatchObject({ kind: 'fallback', hostname: 'en.wikipedia.org' });
    expect(mockFetchSections).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by fetchSections', async () => {
    mockFetchSections.mockRejectedValue(new Error('mw 500'));
    await expect(parseArticle('https://en.wikipedia.org/wiki/X')).rejects.toThrow('mw 500');
  });
});
