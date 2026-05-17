import { logger } from '@/lib/observability';
import { classifySource, MEDIAWIKI_HOST_SUFFIXES } from '@/lib/source-classifier';
import { buildMediaWikiRequest } from './buildRequest';
import { getTimeoutMs } from './env';
import { parseMediaWikiResponse } from './parseResponse';
import { MediaWikiApiError, type MediaWikiArticle } from './types';

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function isMediaWikiHost(host: string): boolean {
  for (const suffix of MEDIAWIKI_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

function combineSignals(
  signals: Array<AbortSignal | undefined>,
): AbortSignal | undefined {
  const concrete = signals.filter((s): s is AbortSignal => s !== undefined);
  if (concrete.length === 0) return undefined;
  if (concrete.length === 1) return concrete[0];
  return AbortSignal.any(concrete);
}

export async function fetchSections(
  normalizedUrl: string,
  options?: { signal?: AbortSignal },
): Promise<MediaWikiArticle> {
  const source = classifySource(normalizedUrl);
  if (source.kind !== 'mediawiki') {
    throw new MediaWikiApiError({
      code: 'not_mediawiki',
      hostname: source.hostname,
      message: `Hostname ${source.hostname || 'unknown'} is not a known MediaWiki host.`,
    });
  }

  const { url, headers } = buildMediaWikiRequest(source);
  const timeoutMs = getTimeoutMs();
  const signal = combineSignals([options?.signal, AbortSignal.timeout(timeoutMs)]);

  const start = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { headers, signal, redirect: 'follow' });
  } catch (err) {
    const duration_ms = performance.now() - start;
    if (isAbortError(err)) {
      logger.warn('mediawiki_fetch_error', {
        event: 'mediawiki_fetch_error',
        hostname: source.hostname,
        code: 'timeout',
        duration_ms,
      });
      throw new MediaWikiApiError({
        code: 'timeout',
        durationMs: duration_ms,
        message: `MediaWiki fetch timed out after ${timeoutMs}ms.`,
      });
    }
    logger.warn('mediawiki_fetch_error', {
      event: 'mediawiki_fetch_error',
      hostname: source.hostname,
      code: 'http_error',
      duration_ms,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new MediaWikiApiError({
      code: 'http_error',
      status: 0,
      message: err instanceof Error ? err.message : 'Network error.',
    });
  }

  let responseHost = source.hostname;
  try {
    responseHost = new URL(res.url).hostname.toLowerCase();
  } catch {
    // Fall back to the request hostname; ill-formed res.url is exceedingly rare.
  }
  if (!isMediaWikiHost(responseHost)) {
    const duration_ms = performance.now() - start;
    logger.warn('mediawiki_bad_redirect', {
      event: 'mediawiki_bad_redirect',
      from_host: source.hostname,
      to_host: responseHost,
      duration_ms,
    });
    throw new MediaWikiApiError({
      code: 'bad_redirect',
      fromHost: source.hostname,
      toHost: responseHost,
      message: `Redirected from ${source.hostname} to non-MediaWiki host ${responseHost}.`,
    });
  }

  if (!res.ok) {
    const duration_ms = performance.now() - start;
    logger.warn('mediawiki_fetch_error', {
      event: 'mediawiki_fetch_error',
      hostname: source.hostname,
      code: 'http_error',
      status: res.status,
      duration_ms,
    });
    throw new MediaWikiApiError({
      code: 'http_error',
      status: res.status,
      message: `MediaWiki API returned HTTP ${res.status}.`,
    });
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    const duration_ms = performance.now() - start;
    logger.warn('mediawiki_fetch_error', {
      event: 'mediawiki_fetch_error',
      hostname: source.hostname,
      code: 'bad_response',
      duration_ms,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new MediaWikiApiError({
      code: 'bad_response',
      message: 'MediaWiki API response was not valid JSON.',
    });
  }

  const article = parseMediaWikiResponse(raw, {
    url: normalizedUrl,
    pageTitle: source.pageTitle,
  });
  const duration_ms = performance.now() - start;
  logger.info('mediawiki_fetch_ok', {
    event: 'mediawiki_fetch_ok',
    hostname: source.hostname,
    page_title: source.pageTitle,
    revision_hash: article.revisionHash,
    page_id: article.pageId,
    sections: article.sections.length,
    duration_ms,
  });
  return article;
}
