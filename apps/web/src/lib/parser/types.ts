import type { MediaWikiArticle } from '@/lib/mediawiki';

export type FallbackResult = {
  kind: 'fallback';
  url: string;
  hostname: string;
  reason: 'generic_scraper_not_yet_implemented';
};

export type ParsedArticle = MediaWikiArticle | FallbackResult;
