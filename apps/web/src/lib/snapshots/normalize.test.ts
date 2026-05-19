import { describe, expect, it } from 'vitest';
import type { GenericArticle } from '@/lib/generic-parser';
import type { MediaWikiArticle, Section } from '@/lib/mediawiki';
import type { ParsedArticle } from '@/lib/parser';
import { normalizeArticleText } from './normalize';

function generic(html: string, title = 'Hello'): GenericArticle {
  return {
    kind: 'generic',
    url: 'https://example.com/a',
    hostname: 'example.com',
    title,
    revisionHash: 'sha256:placeholder',
    fetchedAt: '2026-05-18T00:00:00.000Z',
    sections: [{ id: '', title, level: 0, html }],
    leadHtml: html,
  };
}

function mediawiki(sections: Section[], title = 'Hello'): MediaWikiArticle {
  return {
    kind: 'mediawiki',
    url: 'https://en.wikipedia.org/wiki/Hello',
    title,
    revisionHash: 'mw:42',
    pageId: 1,
    fetchedAt: '2026-05-18T00:00:00.000Z',
    sections,
    leadHtml: sections[0]?.html ?? '',
  };
}

describe('normalizeArticleText', () => {
  it('produces the same text for identical sections', () => {
    const a = generic('<p>Hello world</p>');
    const b = generic('<p>Hello world</p>');
    expect(normalizeArticleText(a)).toBe(normalizeArticleText(b));
  });

  it('treats different HTML markup carrying the same text as identical', () => {
    const a = generic('<p>foo bar</p>');
    const b = generic('<div>foo bar</div>');
    expect(normalizeArticleText(a)).toBe(normalizeArticleText(b));
  });

  it('treats case-only differences as identical (FR-VW-5 / LEX-75 line 117)', () => {
    const a = generic('<p>Foo Bar</p>');
    const b = generic('<p>foo bar</p>');
    expect(normalizeArticleText(a)).toBe(normalizeArticleText(b));
  });

  it('collapses internal whitespace and trims', () => {
    const a = generic('<p>foo  bar</p>');
    const b = generic('<p>foo bar\n</p>');
    expect(normalizeArticleText(a)).toBe(normalizeArticleText(b));
  });

  it('produces different output when text differs', () => {
    const a = generic('<p>foo</p>');
    const b = generic('<p>bar</p>');
    expect(normalizeArticleText(a)).not.toBe(normalizeArticleText(b));
  });

  it('produces the same canonical text for the same content across mediawiki and generic kinds', () => {
    const text = '<p>the quick brown fox</p>';
    const g: ParsedArticle = generic(text);
    const m: ParsedArticle = mediawiki([{ id: '', title: 'Hello', level: 0, html: text }]);
    expect(normalizeArticleText(g)).toBe(normalizeArticleText(m));
  });
});
