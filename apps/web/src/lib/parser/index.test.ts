import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock both downstream parsers so the dispatcher tests only exercise the
// routing decision, not the upstream HTTP layers.
vi.mock('@/lib/mediawiki', () => ({
  fetchSections: vi.fn(),
}));
vi.mock('@/lib/generic-parser', () => ({
  parseGenericArticle: vi.fn(),
}));

import { parseGenericArticle } from '@/lib/generic-parser';
import { fetchSections } from '@/lib/mediawiki';
import { parseArticle } from './index';

const mockFetchSections = vi.mocked(fetchSections);
const mockParseGenericArticle = vi.mocked(parseGenericArticle);

describe('parseArticle dispatcher', () => {
  afterEach(() => {
    mockFetchSections.mockReset();
    mockParseGenericArticle.mockReset();
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
    expect(mockParseGenericArticle).not.toHaveBeenCalled();
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

  it('routes a non-MediaWiki URL to parseGenericArticle', async () => {
    mockParseGenericArticle.mockResolvedValue({
      kind: 'generic',
      url: 'https://www.britannica.com/topic/foo',
      hostname: 'www.britannica.com',
      title: 'Foo',
      revisionHash: 'sha256:' + 'a'.repeat(64),
      fetchedAt: '2026-05-16T00:00:00.000Z',
      sections: [{ id: '', title: 'Foo', level: 0, html: '<p>x</p>' }],
      leadHtml: '<p>x</p>',
    });
    const result = await parseArticle('https://www.britannica.com/topic/foo');
    expect(mockParseGenericArticle).toHaveBeenCalledWith(
      'https://www.britannica.com/topic/foo',
      undefined,
    );
    expect(mockFetchSections).not.toHaveBeenCalled();
    expect(result.kind).toBe('generic');
  });

  it('routes a known MediaWiki host with a non-/wiki/ path to the generic parser', async () => {
    mockParseGenericArticle.mockResolvedValue({
      kind: 'generic',
      url: 'https://en.wikipedia.org/',
      hostname: 'en.wikipedia.org',
      title: 'Home',
      revisionHash: 'sha256:' + 'b'.repeat(64),
      fetchedAt: '2026-05-16T00:00:00.000Z',
      sections: [{ id: '', title: 'Home', level: 0, html: '<p>x</p>' }],
      leadHtml: '<p>x</p>',
    });
    const result = await parseArticle('https://en.wikipedia.org/');
    expect(result.kind).toBe('generic');
    expect(mockParseGenericArticle).toHaveBeenCalledWith('https://en.wikipedia.org/', undefined);
    expect(mockFetchSections).not.toHaveBeenCalled();
  });

  it('passes through the AbortSignal option to parseGenericArticle', async () => {
    const controller = new AbortController();
    mockParseGenericArticle.mockResolvedValue({
      kind: 'generic',
      url: 'https://www.britannica.com/topic/foo',
      hostname: 'www.britannica.com',
      title: 'Foo',
      revisionHash: 'sha256:' + 'c'.repeat(64),
      fetchedAt: '2026-05-16T00:00:00.000Z',
      sections: [{ id: '', title: 'Foo', level: 0, html: '<p>x</p>' }],
      leadHtml: '<p>x</p>',
    });
    await parseArticle('https://www.britannica.com/topic/foo', { signal: controller.signal });
    expect(mockParseGenericArticle).toHaveBeenCalledWith(
      'https://www.britannica.com/topic/foo',
      { signal: controller.signal },
    );
  });

  it('propagates errors thrown by fetchSections', async () => {
    mockFetchSections.mockRejectedValue(new Error('mw 500'));
    await expect(parseArticle('https://en.wikipedia.org/wiki/X')).rejects.toThrow('mw 500');
  });

  it('propagates errors thrown by parseGenericArticle', async () => {
    mockParseGenericArticle.mockRejectedValue(new Error('generic 500'));
    await expect(
      parseArticle('https://www.britannica.com/topic/foo'),
    ).rejects.toThrow('generic 500');
  });
});
