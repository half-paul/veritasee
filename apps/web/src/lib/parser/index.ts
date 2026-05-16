import { fetchSections } from '@/lib/mediawiki';
import { classifySource } from '@/lib/source-classifier';
import type { ParsedArticle } from './types';

// Dispatcher: route a normalized URL to either the MediaWiki API client or
// a typed fallback stub. The fallback branch will be replaced by a generic
// Readability-style scraper in a later ticket; until then it returns a
// typed sentinel so callers branch on `result.kind`.
export async function parseArticle(
  normalizedUrl: string,
  options?: { signal?: AbortSignal },
): Promise<ParsedArticle> {
  const source = classifySource(normalizedUrl);
  if (source.kind === 'mediawiki') {
    return fetchSections(normalizedUrl, options);
  }
  return {
    kind: 'fallback',
    url: normalizedUrl,
    hostname: source.hostname,
    reason: 'generic_scraper_not_yet_implemented',
  };
}

export type { FallbackResult, ParsedArticle } from './types';
