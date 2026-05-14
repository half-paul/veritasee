import { NextResponse, type NextRequest } from 'next/server';
import { getRedis } from '@veritasee/redis';
import { withObservability } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(_req: NextRequest) {
  try {
    const reply = await getRedis().ping();
    if (reply !== 'PONG') return NextResponse.json({ ok: false }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}

export const GET = withObservability(handler);
