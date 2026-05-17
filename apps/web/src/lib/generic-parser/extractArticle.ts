import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { GenericParserError } from './types';

// Sanitization note: this module returns the raw HTML produced by Readability
// (or the heuristic fallback). It is NOT DOMPurify-safe. Downstream rendering
// in the proxy view (FR-VW-2) is responsible for stripping scripts and
// dangerous attributes — do not duplicate that work here.

export type ExtractedArticle = {
  title: string;
  contentHtml: string;
  byline?: string;
  excerpt?: string;
  lang?: string;
};

const NOISE_SELECTORS = [
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'script',
  'style',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
].join(', ');

const MIN_CONTENT_TEXT_LENGTH = 200;

function getTextLength(el: Element | null | undefined): number {
  if (!el) return 0;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}

function stripNoise(root: Element): void {
  root.querySelectorAll(NOISE_SELECTORS).forEach((n) => n.remove());
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

function pickHeuristicCandidate(doc: Document): Element | null {
  // Strip noise globally first so candidate measurements aren't inflated by it.
  if (doc.body !== null) stripNoise(doc.body);

  const article = doc.querySelector('article');
  if (article !== null && getTextLength(article) >= MIN_CONTENT_TEXT_LENGTH) {
    return article;
  }

  const main = doc.querySelector('main');
  if (main !== null && getTextLength(main) >= MIN_CONTENT_TEXT_LENGTH) {
    return main;
  }

  if (doc.body !== null) {
    const candidates = Array.from(
      doc.body.querySelectorAll(':scope > div, :scope > section'),
    );
    let best: Element | null = null;
    let bestLen = 0;
    for (const el of candidates) {
      const len = getTextLength(el);
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    }
    if (best !== null && bestLen >= MIN_CONTENT_TEXT_LENGTH) return best;
  }

  return null;
}

function extractTitleFromContent(contentHtml: string): string | null {
  const match = contentHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (match === null) return null;
  const inner = match[1];
  if (inner === undefined) return null;
  const text = stripTags(inner);
  return text.length > 0 ? text : null;
}

export function extractArticle(
  html: string,
  ctx: { url: string; hostname: string },
): ExtractedArticle {
  const dom = new JSDOM(html, { url: ctx.url });
  const doc = dom.window.document;

  // Capture lang, <head><title>, and the first <h1> BEFORE Readability mutates
  // the DOM. Readability rewrites the article-level <h1> to <h2>, so we have
  // to fish out the heading up front if we want to prefer it as the title.
  const lang = doc.documentElement.getAttribute('lang') ?? doc.documentElement.lang ?? '';
  const headTitle = (doc.querySelector('head > title')?.textContent ?? '').trim();
  const firstH1Title = ((): string => {
    const h1 = doc.querySelector('body h1');
    const text = h1?.textContent ?? '';
    return text.replace(/\s+/g, ' ').trim();
  })();

  let contentHtml = '';
  let contentTextLength = 0;
  let byline: string | undefined;
  let excerpt: string | undefined;
  let readabilityTitle = '';

  try {
    const parsed = new Readability(doc).parse();
    if (parsed !== null && typeof parsed.content === 'string' && parsed.content.length > 0) {
      const textLen =
        typeof parsed.textContent === 'string'
          ? parsed.textContent.replace(/\s+/g, ' ').trim().length
          : 0;
      if (textLen >= MIN_CONTENT_TEXT_LENGTH) {
        contentHtml = parsed.content;
        contentTextLength = textLen;
        readabilityTitle = typeof parsed.title === 'string' ? parsed.title : '';
        if (typeof parsed.byline === 'string' && parsed.byline.length > 0) {
          byline = parsed.byline;
        }
        if (typeof parsed.excerpt === 'string' && parsed.excerpt.length > 0) {
          excerpt = parsed.excerpt;
        }
      }
    }
  } catch {
    // Readability sometimes throws on malformed input; fall through to heuristic.
  }

  if (contentHtml.length === 0) {
    // Readability mutates the original DOM, so reparse for the fallback.
    const fallbackDom = new JSDOM(html, { url: ctx.url });
    const candidate = pickHeuristicCandidate(fallbackDom.window.document);
    if (candidate !== null) {
      contentHtml = candidate.outerHTML;
      contentTextLength = getTextLength(candidate);
    }
  }

  if (contentHtml.length === 0 || contentTextLength < MIN_CONTENT_TEXT_LENGTH) {
    throw new GenericParserError({
      code: 'extraction_failed',
      hostname: ctx.hostname,
      message: 'No main content block detected.',
    });
  }

  const titleFromContent = extractTitleFromContent(contentHtml);
  const title =
    (firstH1Title.length > 0 ? firstH1Title : null) ??
    titleFromContent ??
    (readabilityTitle.length > 0 ? readabilityTitle : headTitle);

  const result: ExtractedArticle = {
    title: title.length > 0 ? title : headTitle,
    contentHtml,
  };
  if (byline !== undefined) result.byline = byline;
  if (excerpt !== undefined) result.excerpt = excerpt;
  if (lang.length > 0) result.lang = lang;
  return result;
}
