import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { MediaWikiApiError } from '@/lib/mediawiki';
import { withObservability } from '@/lib/observability';
import { parseArticle } from '@/lib/parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Small, stable Wikipedia page; the API returns the same shape regardless of
// content, so any live article works for a smoke probe.
const PROBE_URL = 'https://en.wikipedia.org/wiki/HTTP_404';

function tokensMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

async function handler(req: NextRequest): Promise<Response> {
  const expected = process.env.MEDIAWIKI_HEALTH_TOKEN;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !expected) {
    return NextResponse.json(
      { ok: false, error: 'health_token_unconfigured' },
      { status: 503 },
    );
  }
  if (expected && !tokensMatch(expected, req.headers.get('x-health-token'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const start = performance.now();
  try {
    const result = await parseArticle(PROBE_URL);
    const fetchMs = Math.round(performance.now() - start);

    if (result.kind !== 'mediawiki') {
      return NextResponse.json(
        { ok: false, step: 'classify', error: 'probe URL was not classified as MediaWiki' },
        { status: 503 },
      );
    }
    if (result.sections.length === 0) {
      return NextResponse.json(
        { ok: false, step: 'shape', error: 'no sections returned' },
        { status: 503 },
      );
    }
    if (!/^mw:\d+$/.test(result.revisionHash)) {
      return NextResponse.json(
        { ok: false, step: 'shape', error: `revisionHash ${result.revisionHash} did not match mw:<digits>` },
        { status: 503 },
      );
    }

    const revisionId = Number.parseInt(result.revisionHash.slice('mw:'.length), 10);
    return NextResponse.json({
      ok: true,
      sections: result.sections.length,
      revisionId,
      fetchMs,
    });
  } catch (err) {
    const fetchMs = Math.round(performance.now() - start);
    if (err instanceof MediaWikiApiError) {
      return NextResponse.json(
        {
          ok: false,
          step: 'fetch',
          code: err.detail.code,
          error: err.message,
          fetchMs,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        step: 'fetch',
        error: err instanceof Error ? err.message : 'unknown',
        fetchMs,
      },
      { status: 503 },
    );
  }
}

export const GET = withObservability(handler);
