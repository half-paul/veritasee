import { NextResponse } from 'next/server';
import { headBucket } from '@veritasee/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HttpAwareError {
  $metadata?: { httpStatusCode?: number };
  message?: string;
}

export async function GET() {
  try {
    await headBucket();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as HttpAwareError;
    const status = e.$metadata?.httpStatusCode;
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json(
      status ? { ok: false, error: message, status } : { ok: false, error: message },
      { status: 503 },
    );
  }
}
