// Public types for the generic (non-MediaWiki) article extractor.
//
// `GenericArticle` is the success shape returned by `parseGenericArticle()`.
// `GenericParserError` is a custom Error subclass carrying a discriminated
// `detail` so callers can map upstream failures to typed HTTP responses, in
// the same shape as `MediaWikiApiError`.

import { MEDIAWIKI_DEFAULT_USER_AGENT, type Section } from '@/lib/mediawiki';

export const GENERIC_PARSER_REVISION_PREFIX = 'sha256:';

export const GENERIC_PARSER_TIMEOUT_DEFAULT_MS = 10_000;
export const GENERIC_PARSER_TIMEOUT_MIN_MS = 100;
export const GENERIC_PARSER_TIMEOUT_MAX_MS = 30_000;

export const GENERIC_PARSER_MAX_BYTES_DEFAULT = 5 * 1024 * 1024;
export const GENERIC_PARSER_MAX_BYTES_MIN = 64 * 1024;
export const GENERIC_PARSER_MAX_BYTES_MAX = 25 * 1024 * 1024;

// Re-export the MediaWiki UA so both parsers identify themselves with the
// same Veritasee-branded string (single source of truth).
export { MEDIAWIKI_DEFAULT_USER_AGENT as GENERIC_PARSER_DEFAULT_USER_AGENT };

export type GenericArticle = {
  kind: 'generic';
  url: string;
  hostname: string;
  title: string;
  /** `sha256:<64-hex>` over normalized extracted text (FR-VW-5 snapshot pin). */
  revisionHash: string;
  fetchedAt: string;
  /** Single-entry array for v1: `[{ id: '', title, level: 0, html: contentHtml }]`. */
  sections: Section[];
  /** Convenience accessor for `sections[0].html`. */
  leadHtml: string;
  byline?: string;
  excerpt?: string;
  lang?: string;
};

export type GenericParserErrorDetail =
  | { code: 'http_error'; status: number; message: string }
  | { code: 'bad_response'; message: string }
  | { code: 'bad_content_type'; contentType: string; message: string }
  | { code: 'too_large'; limitBytes: number; message: string }
  | { code: 'timeout'; durationMs: number; message?: string }
  | { code: 'extraction_failed'; hostname: string; message: string };

export class GenericParserError extends Error {
  readonly detail: GenericParserErrorDetail;

  constructor(detail: GenericParserErrorDetail) {
    super(detail.message ?? detail.code);
    this.name = 'GenericParserError';
    this.detail = detail;
  }
}
