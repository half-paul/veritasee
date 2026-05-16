import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getRedis } from '@veritasee/redis';
import { withObservability } from '@/lib/observability';
import {
  getCached,
  invalidateCached,
  proxyCacheKey,
  PROXY_CACHE_TTL_SECONDS,
  setCached,
  type CachedProxyResponse,
} from '@/lib/proxy-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// RFC 2606 reserved `.test` TLD — guarantees no collision with real traffic.
const PROBE_URL = 'https://veritasee.test/__healthcheck__';

function tokensMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

async function handler(req: NextRequest): Promise<Response> {
  const expected = process.env.PROXY_CACHE_HEALTH_TOKEN;
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

  const entry: CachedProxyResponse = {
    url: PROBE_URL,
    revisionHash: 'health',
    fetchedAt: new Date().toISOString(),
    payload: 'ok',
    contentType: 'text/plain; charset=utf-8',
  };

  try {
    const written = await setCached(PROBE_URL, entry);
    if (!written) {
      return NextResponse.json(
        { ok: false, step: 'set', error: 'setCached returned false' },
        { status: 503 },
      );
    }

    const got = await getCached(PROBE_URL);
    if (got?.payload !== 'ok') {
      return NextResponse.json(
        { ok: false, step: 'get', error: 'payload mismatch' },
        { status: 503 },
      );
    }

    const ttl = await getRedis().ttl(proxyCacheKey(PROBE_URL));
    if (!(ttl > 0 && ttl <= PROXY_CACHE_TTL_SECONDS)) {
      return NextResponse.json(
        { ok: false, step: 'ttl', error: `ttl=${ttl} out of (0, ${PROXY_CACHE_TTL_SECONDS}]` },
        { status: 503 },
      );
    }

    await invalidateCached(PROBE_URL);

    return NextResponse.json({ ok: true, ttl });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}

export const GET = withObservability(handler);
