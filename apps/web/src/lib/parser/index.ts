import { parseGenericArticle } from '@/lib/generic-parser';
import { fetchSections } from '@/lib/mediawiki';
import { classifySource } from '@/lib/source-classifier';
import type { ParsedArticle } from './types';

// Dispatcher: route a normalized URL to the MediaWiki API client for
// MediaWiki-family hosts, or to the generic Readability-based article
// extractor for everything else. Callers branch on `result.kind`.
export async function parseArticle(
  normalizedUrl: string,
  options?: { signal?: AbortSignal },
): Promise<ParsedArticle> {
  const source = classifySource(normalizedUrl);
  if (source.kind === 'mediawiki') {
    return fetchSections(normalizedUrl, options);
  }
  return parseGenericArticle(normalizedUrl, options);
}

export type { GenericArticle } from '@/lib/generic-parser';
export type { ParsedArticle } from './types';
