import { describe, expect, it } from 'vitest';
import { mockMediaWikiError, mockMediaWikiParse } from '@test/factories/mockMediaWikiResponse';
import { parseMediaWikiResponse } from './parseResponse';
import { MediaWikiApiError } from './types';

const CTX = { url: 'https://en.wikipedia.org/wiki/Test', pageTitle: 'Test' };

describe('parseMediaWikiResponse — happy path', () => {
  it('extracts title, revisionHash, pageId, sections from a canonical response', () => {
    const raw = mockMediaWikiParse({
      title: 'HTTP 404',
      displaytitle: 'HTTP 404',
      pageid: 100,
      revid: 555,
    });
    const article = parseMediaWikiResponse(raw, CTX);
    expect(article.kind).toBe('mediawiki');
    expect(article.title).toBe('HTTP 404');
    expect(article.revisionHash).toBe('mw:555');
    expect(article.pageId).toBe(100);
    expect(article.url).toBe(CTX.url);
    // Lead + 2 default sections.
    expect(article.sections).toHaveLength(3);
    expect(article.sections[0]?.level).toBe(0);
    expect(article.sections[0]?.title).toBe('HTTP 404');
    expect(article.leadHtml).toBe(article.sections[0]?.html);
  });

  it('uses the displaytitle for the lead section title', () => {
    const raw = mockMediaWikiParse({
      title: 'h',
      displaytitle: 'H<sub>2</sub>O',
    });
    const article = parseMediaWikiResponse(raw, CTX);
    // HTML tags in displaytitle are stripped for the plain-text section title.
    expect(article.sections[0]?.title).toBe('H2O');
  });

  it('uses anchor ids for section ids and strips HTML from line titles', () => {
    const raw = mockMediaWikiParse({
      sections: [
        { anchor: 'History', line: 'History', level: 2 },
        { anchor: 'See_also', line: '<i>See also</i>', level: 2 },
      ],
    });
    const article = parseMediaWikiResponse(raw, CTX);
    expect(article.sections[1]?.id).toBe('History');
    expect(article.sections[2]?.id).toBe('See_also');
    expect(article.sections[2]?.title).toBe('See also');
  });

  it('records fetchedAt as an ISO timestamp', () => {
    const raw = mockMediaWikiParse();
    const article = parseMediaWikiResponse(raw, CTX);
    expect(article.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(() => new Date(article.fetchedAt).toISOString()).not.toThrow();
  });

  it('groups sub-sections under their parent until an equal-or-higher heading', () => {
    const raw = mockMediaWikiParse({
      sections: [
        { anchor: 'Top', line: 'Top', level: 2 },
        { anchor: 'Sub', line: 'Sub', level: 3 },
        { anchor: 'Next', line: 'Next', level: 2 },
      ],
    });
    const article = parseMediaWikiResponse(raw, CTX);
    const top = article.sections.find((s) => s.id === 'Top');
    expect(top?.html).toContain('id="Top"');
    expect(top?.html).toContain('id="Sub"');
    expect(top?.html).not.toContain('id="Next"');
  });
});

describe('parseMediaWikiResponse — error responses', () => {
  it('throws page_not_found on missingtitle error', () => {
    expect(() =>
      parseMediaWikiResponse(mockMediaWikiError('missingtitle', 'no such page'), CTX),
    ).toThrow(MediaWikiApiError);
    try {
      parseMediaWikiResponse(mockMediaWikiError('missingtitle'), CTX);
    } catch (err) {
      expect((err as MediaWikiApiError).detail.code).toBe('page_not_found');
    }
  });

  it('throws page_not_found on nosuchpageid', () => {
    try {
      parseMediaWikiResponse(mockMediaWikiError('nosuchpageid'), CTX);
    } catch (err) {
      expect((err as MediaWikiApiError).detail.code).toBe('page_not_found');
    }
  });

  it('throws bad_response on an unknown error code', () => {
    try {
      parseMediaWikiResponse(mockMediaWikiError('ratelimited'), CTX);
    } catch (err) {
      expect((err as MediaWikiApiError).detail.code).toBe('bad_response');
    }
  });
});

describe('parseMediaWikiResponse — shape guards', () => {
  it('throws bad_response when raw is not an object', () => {
    expect(() => parseMediaWikiResponse('not json', CTX)).toThrow(MediaWikiApiError);
  });

  it('throws bad_response when parse is missing', () => {
    expect(() => parseMediaWikiResponse({}, CTX)).toThrow(MediaWikiApiError);
  });

  it.each([
    ['title is missing', { displaytitle: 'X', pageid: 1, revid: 1, text: 'x', sections: [] }],
    [
      'revid is not a number',
      {
        title: 'x',
        displaytitle: 'x',
        pageid: 1,
        revid: 'NaN',
        text: 'x',
        sections: [],
      },
    ],
    [
      'sections is not an array',
      {
        title: 'x',
        displaytitle: 'x',
        pageid: 1,
        revid: 1,
        text: 'x',
        sections: {},
      },
    ],
  ])('throws bad_response when %s', (_label, parse) => {
    expect(() => parseMediaWikiResponse({ parse }, CTX)).toThrow(MediaWikiApiError);
  });
});
