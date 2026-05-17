// Discriminated union describing the source class a URL belongs to.
// Returned by `classifySource()` so callers can dispatch to the MediaWiki
// API path or the generic fallback path without throwing on non-MediaWiki
// hosts.

export type MediaWikiSource = {
  kind: 'mediawiki';
  hostname: string;
  apiEndpoint: string;
  pageTitle: string;
};

export type GenericSource = {
  kind: 'generic';
  hostname: string;
};

export type SourceClass = MediaWikiSource | GenericSource;
