import { createHash } from 'node:crypto';
import type { Section } from '@/lib/mediawiki';
import { logger } from '@/lib/observability';
import { classifySource } from '@/lib/source-classifier';
import { extractArticle } from './extractArticle';
import { fetchHtml } from './fetchHtml';
import {
  GENERIC_PARSER_REVISION_PREFIX,
  GenericParserError,
  type GenericArticle,
} from './types';

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

function normalizeForHash(html: string): string {
  return stripTags(html).replace(/\s+/g, ' ').toLowerCase().trim();
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export async function parseGenericArticle(
  normalizedUrl: string,
  options?: { signal?: AbortSignal },
): Promise<GenericArticle> {
  const source = classifySource(normalizedUrl);
  if (source.kind !== 'generic') {
    throw new GenericParserError({
      code: 'extraction_failed',
      hostname: source.hostname,
      message: `URL classified as ${source.kind}; refusing to run generic extractor.`,
    });
  }

  const start = performance.now();
  const { html, finalUrl } = await fetchHtml(normalizedUrl, options);
  const bytes = Buffer.byteLength(html, 'utf8');
  const extracted = extractArticle(html, { url: finalUrl, hostname: source.hostname });

  const revisionHash = `${GENERIC_PARSER_REVISION_PREFIX}${sha256Hex(normalizeForHash(extracted.contentHtml))}`;

  const sections: Section[] = [
    { id: '', title: extracted.title, level: 0, html: extracted.contentHtml },
  ];

  const article: GenericArticle = {
    kind: 'generic',
    url: normalizedUrl,
    hostname: source.hostname,
    title: extracted.title,
    revisionHash,
    fetchedAt: new Date().toISOString(),
    sections,
    leadHtml: extracted.contentHtml,
  };
  if (extracted.byline !== undefined) article.byline = extracted.byline;
  if (extracted.excerpt !== undefined) article.excerpt = extracted.excerpt;
  if (extracted.lang !== undefined) article.lang = extracted.lang;

  const duration_ms = performance.now() - start;
  logger.info('generic_parse_ok', {
    event: 'generic_parse_ok',
    hostname: source.hostname,
    revision_hash: revisionHash,
    bytes,
    sections: sections.length,
    duration_ms,
  });

  return article;
}
