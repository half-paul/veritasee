import { logger } from '@/lib/observability';
import { getMaxBytes, getTimeoutMs, getUserAgent } from './env';
import { GenericParserError } from './types';

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function combineSignals(
  signals: Array<AbortSignal | undefined>,
): AbortSignal | undefined {
  const concrete = signals.filter((s): s is AbortSignal => s !== undefined);
  if (concrete.length === 0) return undefined;
  if (concrete.length === 1) return concrete[0];
  return AbortSignal.any(concrete);
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const HTML_CONTENT_TYPE_REGEX = /^(text\/html|application\/xhtml\+xml)$/i;

function parseContentType(header: string | null): { mime: string; charset: string } {
  if (!header) return { mime: '', charset: 'utf-8' };
  const parts = header.split(';').map((p) => p.trim());
  const mime = (parts[0] ?? '').toLowerCase();
  let charset = 'utf-8';
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i];
    if (segment === undefined) continue;
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    if (key === 'charset') {
      charset = segment.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '').toLowerCase() || 'utf-8';
    }
  }
  return { mime, charset };
}

export async function fetchHtml(
  normalizedUrl: string,
  options?: { signal?: AbortSignal },
): Promise<{ html: string; finalUrl: string }> {
  const hostname = getHostname(normalizedUrl);
  const timeoutMs = getTimeoutMs();
  const maxBytes = getMaxBytes();
  const signal = combineSignals([options?.signal, AbortSignal.timeout(timeoutMs)]);

  const start = performance.now();
  let res: Response;
  try {
    res = await fetch(normalizedUrl, {
      headers: {
        Accept: 'text/html, application/xhtml+xml; q=0.9, */*; q=0.1',
        'User-Agent': getUserAgent(),
      },
      signal,
      redirect: 'follow',
    });
  } catch (err) {
    const duration_ms = performance.now() - start;
    if (isAbortError(err)) {
      logger.warn('generic_fetch_error', {
        event: 'generic_fetch_error',
        hostname,
        code: 'timeout',
        duration_ms,
      });
      throw new GenericParserError({
        code: 'timeout',
        durationMs: duration_ms,
        message: `Generic fetch timed out after ${timeoutMs}ms.`,
      });
    }
    logger.warn('generic_fetch_error', {
      event: 'generic_fetch_error',
      hostname,
      code: 'http_error',
      duration_ms,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new GenericParserError({
      code: 'http_error',
      status: 0,
      message: err instanceof Error ? err.message : 'Network error.',
    });
  }

  if (!res.ok) {
    const duration_ms = performance.now() - start;
    logger.warn('generic_fetch_error', {
      event: 'generic_fetch_error',
      hostname,
      code: 'http_error',
      status: res.status,
      duration_ms,
    });
    throw new GenericParserError({
      code: 'http_error',
      status: res.status,
      message: `Upstream returned HTTP ${res.status}.`,
    });
  }

  const { mime, charset } = parseContentType(res.headers.get('content-type'));
  if (!HTML_CONTENT_TYPE_REGEX.test(mime)) {
    const duration_ms = performance.now() - start;
    logger.warn('generic_fetch_error', {
      event: 'generic_fetch_error',
      hostname,
      code: 'bad_content_type',
      content_type: mime,
      duration_ms,
    });
    throw new GenericParserError({
      code: 'bad_content_type',
      contentType: mime,
      message: `Expected HTML content-type; got "${mime || 'unknown'}".`,
    });
  }

  let finalUrl = normalizedUrl;
  try {
    finalUrl = new URL(res.url).toString();
  } catch {
    // Ignore — fall back to the requested URL.
  }
  const finalHost = getHostname(finalUrl);

  const body = res.body;
  if (body === null) {
    const duration_ms = performance.now() - start;
    logger.warn('generic_fetch_error', {
      event: 'generic_fetch_error',
      hostname,
      code: 'bad_response',
      duration_ms,
    });
    throw new GenericParserError({
      code: 'bad_response',
      message: 'Upstream response had no body.',
    });
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        // Cancel best-effort; do not await so a stalled cancel cannot block.
        void reader.cancel().catch(() => undefined);
        const duration_ms = performance.now() - start;
        logger.warn('generic_fetch_error', {
          event: 'generic_fetch_error',
          hostname,
          code: 'too_large',
          limit_bytes: maxBytes,
          received_bytes: received,
          duration_ms,
        });
        throw new GenericParserError({
          code: 'too_large',
          limitBytes: maxBytes,
          message: `Response body exceeded ${maxBytes} bytes.`,
        });
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof GenericParserError) throw err;
    const duration_ms = performance.now() - start;
    if (isAbortError(err)) {
      logger.warn('generic_fetch_error', {
        event: 'generic_fetch_error',
        hostname,
        code: 'timeout',
        duration_ms,
      });
      throw new GenericParserError({
        code: 'timeout',
        durationMs: duration_ms,
        message: `Generic fetch timed out after ${timeoutMs}ms.`,
      });
    }
    logger.warn('generic_fetch_error', {
      event: 'generic_fetch_error',
      hostname,
      code: 'bad_response',
      duration_ms,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new GenericParserError({
      code: 'bad_response',
      message: err instanceof Error ? err.message : 'Failed to read response body.',
    });
  }

  if (received === 0) {
    const duration_ms = performance.now() - start;
    logger.warn('generic_fetch_error', {
      event: 'generic_fetch_error',
      hostname,
      code: 'bad_response',
      duration_ms,
    });
    throw new GenericParserError({
      code: 'bad_response',
      message: 'Upstream response body was empty.',
    });
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let html: string;
  try {
    html = new TextDecoder(charset, { fatal: false }).decode(merged);
  } catch {
    html = new TextDecoder('utf-8', { fatal: false }).decode(merged);
  }

  const duration_ms = performance.now() - start;
  logger.info('generic_fetch_ok', {
    event: 'generic_fetch_ok',
    hostname,
    status: res.status,
    bytes: received,
    duration_ms,
    final_url_host: finalHost,
  });

  return { html, finalUrl };
}
