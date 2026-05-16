// Public types for the MediaWiki API integration.
//
// `MediaWikiArticle` is the success shape returned by `fetchSections()`.
// `MediaWikiApiError` is a custom Error subclass carrying a discriminated
// `detail` so callers can map upstream failures to typed HTTP responses
// (see the Integration Contract in the LEX-73 plan for the mapping).

export const MEDIAWIKI_REVISION_PREFIX = 'mw:';
export const MEDIAWIKI_TIMEOUT_DEFAULT_MS = 5_000;
export const MEDIAWIKI_TIMEOUT_MIN_MS = 100;
export const MEDIAWIKI_TIMEOUT_MAX_MS = 15_000;
export const MEDIAWIKI_DEFAULT_USER_AGENT =
  'Veritasee/0.1 (https://veritasee.app; ops@veritasee.app)';

export type Section = {
  /** MediaWiki anchor (e.g. "External_links"); empty string for the lead. */
  id: string;
  /** Plain-text heading. For the lead, the article displaytitle. */
  title: string;
  /** HTML heading level (2–6); 0 for the lead. */
  level: number;
  /** Raw section HTML (body up to the next equal-or-higher-level heading). */
  html: string;
};

export type MediaWikiArticle = {
  kind: 'mediawiki';
  url: string;
  title: string;
  /** `mw:${revid}` — canonical revision id, used as cache invalidation key. */
  revisionHash: string;
  pageId: number;
  fetchedAt: string;
  sections: Section[];
  /** Convenience accessor for `sections[0].html` (the intro before any heading). */
  leadHtml: string;
};

export type MediaWikiApiErrorDetail =
  | { code: 'http_error'; status: number; message: string }
  | { code: 'bad_response'; message: string }
  | { code: 'page_not_found'; pageTitle: string; message?: string }
  | { code: 'bad_redirect'; fromHost: string; toHost: string; message?: string }
  | { code: 'timeout'; durationMs: number; message?: string }
  | { code: 'not_mediawiki'; hostname: string; message?: string };

export class MediaWikiApiError extends Error {
  readonly detail: MediaWikiApiErrorDetail;

  constructor(detail: MediaWikiApiErrorDetail) {
    super(detail.message ?? detail.code);
    this.name = 'MediaWikiApiError';
    this.detail = detail;
  }
}
