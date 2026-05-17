import type { GenericArticle } from '@/lib/generic-parser';
import type { MediaWikiArticle } from '@/lib/mediawiki';

export type ParsedArticle = MediaWikiArticle | GenericArticle;
