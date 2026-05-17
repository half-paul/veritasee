// Builders for canonical MediaWiki API responses. Tests pass parameter knobs
// for known edge cases (revid, section count, error code) rather than pasting
// 40-line fixture objects.

export type MediaWikiSectionFixture = {
  anchor: string;
  line: string;
  level: number | string;
};

export type MockMediaWikiParseInput = {
  title?: string;
  displaytitle?: string;
  pageid?: number;
  revid?: number;
  sections?: MediaWikiSectionFixture[];
  textOverride?: string;
};

function renderSectionHtml(sec: MediaWikiSectionFixture): string {
  const level = typeof sec.level === 'number' ? sec.level : Number(sec.level);
  return [
    `<div class="mw-heading mw-heading${level}">`,
    `<h${level} id="${sec.anchor}">${sec.line}</h${level}>`,
    `</div>`,
    `<p>Body for ${sec.line}.</p>`,
  ].join('');
}

export function mockMediaWikiParse(input: MockMediaWikiParseInput = {}): {
  parse: {
    title: string;
    displaytitle: string;
    pageid: number;
    revid: number;
    text: string;
    sections: MediaWikiSectionFixture[];
  };
} {
  const sections =
    input.sections ??
    [
      { anchor: 'History', line: 'History', level: 2 },
      { anchor: 'See_also', line: 'See also', level: 2 },
    ];
  const leadHtml = '<p>Lead paragraph.</p>';
  const text = input.textOverride ?? leadHtml + sections.map(renderSectionHtml).join('');
  return {
    parse: {
      title: input.title ?? 'Test',
      displaytitle: input.displaytitle ?? 'Test',
      pageid: input.pageid ?? 12345,
      revid: input.revid ?? 999000,
      text,
      sections,
    },
  };
}

export function mockMediaWikiError(code: string, info = 'mocked error'): {
  error: { code: string; info: string };
} {
  return { error: { code, info } };
}
