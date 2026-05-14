import { auth } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { logger, withObservability } from '@/lib/observability';
import { validateUrl } from '@/lib/url-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSRF note: this endpoint validates URLs at the moment of submission.
// The proxy fetcher (VS-021) MUST re-resolve and pin to the resolved IP at
// fetch time to defeat DNS rebinding between this validation and the
// actual fetch.

type Body = { url?: unknown };

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, code: 'unauthenticated', error: 'Sign-in required.' },
      { status: 401 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'invalid_body', error: 'Request body must be JSON.' },
      { status: 400 },
    );
  }
  const raw = body?.url;
  if (typeof raw !== 'string') {
    return NextResponse.json(
      { ok: false, code: 'invalid_body', error: 'Body must include a string "url" field.' },
      { status: 400 },
    );
  }

  const result = await validateUrl(raw);
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      normalizedUrl: result.normalizedUrl,
      hostname: result.hostname,
    });
  }

  const status =
    result.code === 'denylisted' || result.code === 'private_ip'
      ? 403
      : result.code === 'dns_failure'
        ? 503
        : 400;

  logger.warn('url_validation_reject', {
    event: 'url_validation_reject',
    code: result.code,
    hostname: 'hostname' in result ? result.hostname : undefined,
    url_length: raw.length,
    user_id: userId,
    request_id: req.headers.get('x-request-id') ?? undefined,
  });

  return NextResponse.json(
    { ok: false, code: result.code, error: result.message },
    { status },
  );
}

export const POST = withObservability(handler);
