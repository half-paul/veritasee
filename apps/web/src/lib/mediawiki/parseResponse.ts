import {
  MEDIAWIKI_REVISION_PREFIX,
  MediaWikiApiError,
  type MediaWikiArticle,
  type Section,
} from './types';

// Subset of MediaWiki API response fields we depend on. The shape is pinned
// by `formatversion=2`; we runtime-check each field rather than coercing.
type MediaWikiSectionEntry = {
  anchor: string;
  line: string;
  level: string | number;
};

type MediaWikiParseShape = {
  title: string;
  displaytitle: string;
  pageid: number;
  revid: number;
  text: string;
  sections: MediaWikiSectionEntry[];
};

const PAGE_NOT_FOUND_CODES = new Set([
  'missingtitle',
  'nosuchpageid',
  'invalidtitle',
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLevel(raw: string | number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : 2;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

function validateParseShape(raw: unknown): MediaWikiParseShape {
  if (!isObject(raw)) {
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: 'Response was not a JSON object.',
    });
  }
  const parse = raw.parse;
  if (!isObject(parse)) {
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: 'Response is missing `parse` object.',
    });
  }
  const {
    title,
    displaytitle,
    pageid,
    revid,
    text,
    sections,
  } = parse as Record<string, unknown>;
  if (typeof title !== 'string') {
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: '`parse.title` must be a string.',
    });
  }
  if (typeof displaytitle !== 'string') {
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: '`parse.displaytitle` must be a string.',
    });
  }
  if (typeof pageid !== 'number') {
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: '`parse.pageid` must be a number.',
    });
  }
  if (typeof revid !== 'number') {
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: '`parse.revid` must be a number.',
    });
  }
  if (typeof text !== 'string') {
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: '`parse.text` must be a string.',
    });
  }
  if (!Array.isArray(sections)) {
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: '`parse.sections` must be an array.',
    });
  }
  for (const entry of sections) {
    if (
      !isObject(entry) ||
      typeof entry.anchor !== 'string' ||
      typeof entry.line !== 'string' ||
      !(typeof entry.level === 'string' || typeof entry.level === 'number')
    ) {
      throw new MediaWikiApiError({
        code: 'bad_response',
        message: 'A `parse.sections[]` entry has the wrong shape.',
      });
    }
  }
  return {
    title,
    displaytitle,
    pageid,
    revid,
    text,
    sections: sections as MediaWikiSectionEntry[],
  };
}

// Locate the start position of a heading in the rendered HTML by anchoring
// on `id="<anchor>"`. MediaWiki renders headings in two shapes depending on
// version: `<h2 id="..."><span class="mw-headline" id="...">…</span></h2>`
// (legacy) and `<div class="mw-heading mw-heading2"><h2 id="...">…</h2>…</div>`
// (newer Parsoid-derived). We prefer the outer `<div class="mw-heading">`
// wrapper when present so the section's HTML range includes the wrapper.
function findHeadingStart(text: string, anchor: string): number {
  const escAnchor = escapeRegex(anchor);
  const idRegex = new RegExp(`\\bid="${escAnchor}"`, 'g');
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(text)) !== null) {
    const idPos = match.index;
    const windowStart = Math.max(0, idPos - 300);
    const window = text.slice(windowStart, idPos);

    const divIdx = window.lastIndexOf('<div class="mw-heading');
    if (divIdx !== -1) return windowStart + divIdx;

    const hRegex = /<h[2-6]\b/gi;
    let hLast = -1;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = hRegex.exec(window)) !== null) {
      hLast = hMatch.index;
    }
    if (hLast !== -1) return windowStart + hLast;
  }
  return -1;
}

type HeadingPosition = {
  start: number;
  level: number;
  anchor: string;
  title: string;
};

function buildSections(
  text: string,
  apiSections: MediaWikiSectionEntry[],
  displayTitle: string,
): { sections: Section[]; leadHtml: string } {
  const positions: HeadingPosition[] = [];
  for (const s of apiSections) {
    const start = findHeadingStart(text, s.anchor);
    if (start === -1) continue;
    positions.push({
      start,
      level: parseLevel(s.level),
      anchor: s.anchor,
      title: stripTags(s.line),
    });
  }
  positions.sort((a, b) => a.start - b.start);

  const first = positions[0];
  const leadEnd = first !== undefined ? first.start : text.length;
  const leadHtml = text.slice(0, leadEnd);

  const sections: Section[] = [
    { id: '', title: stripTags(displayTitle), level: 0, html: leadHtml },
  ];

  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    if (cur === undefined) continue;
    let end = text.length;
    for (let j = i + 1; j < positions.length; j++) {
      const next = positions[j];
      if (next !== undefined && next.level <= cur.level) {
        end = next.start;
        break;
      }
    }
    sections.push({
      id: cur.anchor,
      title: cur.title,
      level: cur.level,
      html: text.slice(cur.start, end),
    });
  }

  return { sections, leadHtml };
}

export function parseMediaWikiResponse(
  raw: unknown,
  context: { url: string; pageTitle: string },
): MediaWikiArticle {
  if (isObject(raw) && isObject(raw.error)) {
    const code = typeof raw.error.code === 'string' ? raw.error.code : '';
    if (PAGE_NOT_FOUND_CODES.has(code)) {
      throw new MediaWikiApiError({
        code: 'page_not_found',
        pageTitle: context.pageTitle,
        message: typeof raw.error.info === 'string' ? raw.error.info : code,
      });
    }
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: `MediaWiki error: ${code || 'unknown'}`,
    });
  }

  const parse = validateParseShape(raw);
  const { sections, leadHtml } = buildSections(
    parse.text,
    parse.sections,
    parse.displaytitle,
  );

  return {
    kind: 'mediawiki',
    url: context.url,
    title: stripTags(parse.displaytitle),
    revisionHash: `${MEDIAWIKI_REVISION_PREFIX}${parse.revid}`,
    pageId: parse.pageid,
    fetchedAt: new Date().toISOString(),
    sections,
    leadHtml,
  };
}
