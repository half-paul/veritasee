import { describe, expect, it } from 'vitest';
import {
  FOOTER_NOISE,
  mockGenericPage,
  NAVIGATION_NOISE,
} from '@test/factories/mockGenericPage';
import { extractArticle } from './extractArticle';
import { GenericParserError } from './types';

const CTX = { url: 'https://example.com/article', hostname: 'example.com' };

describe('extractArticle — main content selection (AC #1)', () => {
  it('selects content from an <article> container and excludes nav/footer noise', () => {
    const html = mockGenericPage({
      container: 'article',
      includeNav: true,
      includeFooter: true,
      paragraphs: 5,
    });
    const result = extractArticle(html, CTX);
    expect(result.contentHtml).toContain('Paragraph 1');
    expect(result.contentHtml).toContain('Paragraph 5');
    expect(result.contentHtml).not.toContain(NAVIGATION_NOISE);
    expect(result.contentHtml).not.toContain(FOOTER_NOISE);
  });

  it('selects content from a <main> container when no <article> is present', () => {
    const html = mockGenericPage({
      container: 'main',
      includeNav: true,
      includeFooter: true,
      paragraphs: 5,
    });
    const result = extractArticle(html, CTX);
    expect(result.contentHtml).toContain('Paragraph 1');
    expect(result.contentHtml).not.toContain(NAVIGATION_NOISE);
    expect(result.contentHtml).not.toContain(FOOTER_NOISE);
  });

  it('selects the densest <div> when no semantic container is present', () => {
    const html = mockGenericPage({
      container: 'div',
      includeNav: true,
      includeFooter: true,
      paragraphs: 6,
    });
    const result = extractArticle(html, CTX);
    expect(result.contentHtml).toContain('Paragraph 1');
    expect(result.contentHtml).toContain('Paragraph 6');
    expect(result.contentHtml).not.toContain(NAVIGATION_NOISE);
    expect(result.contentHtml).not.toContain(FOOTER_NOISE);
  });
});

describe('extractArticle — title and metadata', () => {
  it('prefers the <h1> inside the content block over <head><title> when they differ', () => {
    const html = mockGenericPage({
      title: 'Article H1 Title',
      headTitle: 'Head Title (different)',
      container: 'article',
      paragraphs: 4,
    });
    const result = extractArticle(html, CTX);
    expect(result.title).toBe('Article H1 Title');
  });

  it('preserves the lang attribute from <html lang="...">', () => {
    const html = mockGenericPage({
      lang: 'en-GB',
      container: 'article',
      paragraphs: 4,
    });
    const result = extractArticle(html, CTX);
    expect(result.lang).toBe('en-GB');
  });
});

describe('extractArticle — failure modes', () => {
  it('throws extraction_failed when the body has only navigation/footer noise', () => {
    const html = mockGenericPage({
      bodyOverride: `<nav>${NAVIGATION_NOISE}</nav><footer>${FOOTER_NOISE}</footer>`,
    });
    try {
      extractArticle(html, CTX);
      throw new Error('expected GenericParserError');
    } catch (err) {
      expect(err).toBeInstanceOf(GenericParserError);
      expect((err as GenericParserError).detail.code).toBe('extraction_failed');
    }
  });
});
