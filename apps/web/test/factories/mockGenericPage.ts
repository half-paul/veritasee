// Builds canonical HTML pages for generic-parser tests. Pass knobs for the
// container type, paragraph count, nav/footer toggles, lang, and head title
// rather than maintaining static fixtures.

export type MockGenericPageInput = {
  title?: string;
  /** Override the <head><title> separately so tests can assert h1-vs-headTitle preference. */
  headTitle?: string;
  container?: 'article' | 'main' | 'div';
  paragraphs?: number;
  includeNav?: boolean;
  includeFooter?: boolean;
  /** When set, replaces the entire <body> content (still wrapped in <html><body>). */
  bodyOverride?: string;
  lang?: string;
};

export const NAVIGATION_NOISE = 'NAVIGATION_NOISE_TOKEN';
export const FOOTER_NOISE = 'FOOTER_NOISE_TOKEN';

function paragraph(i: number): string {
  // Generate ≥80 chars of filler so density heuristics fire and Readability
  // scores the content block above the noise.
  const filler =
    'The quick brown fox jumps over the lazy dog. ' +
    'Sphinx of black quartz judge my vow. ' +
    'Pack my box with five dozen liquor jugs.';
  return `<p>Paragraph ${i + 1}: ${filler}</p>`;
}

export function mockGenericPage(input: MockGenericPageInput = {}): string {
  const title = input.title ?? 'Example Article';
  const headTitle = input.headTitle ?? title;
  const containerTag = input.container ?? 'article';
  const paragraphCount = input.paragraphs ?? 4;
  const lang = input.lang ?? 'en';

  const paragraphs = Array.from({ length: paragraphCount }, (_, i) => paragraph(i)).join('');

  const navHtml = input.includeNav
    ? `<nav><ul><li><a href="/a">${NAVIGATION_NOISE}</a></li><li><a href="/b">${NAVIGATION_NOISE}</a></li></ul></nav>`
    : '';
  const footerHtml = input.includeFooter
    ? `<footer><p>${FOOTER_NOISE}</p><p>Copyright text in the footer area.</p></footer>`
    : '';

  let bodyInner: string;
  if (input.bodyOverride !== undefined) {
    bodyInner = input.bodyOverride;
  } else {
    const containerInner = `<h1>${title}</h1>${paragraphs}`;
    bodyInner = `${navHtml}<${containerTag}>${containerInner}</${containerTag}>${footerHtml}`;
  }

  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${headTitle}</title>`,
    '</head>',
    '<body>',
    bodyInner,
    '</body>',
    '</html>',
  ].join('');
}
