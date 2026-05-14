import { NextResponse, type NextRequest } from 'next/server';
import { getDb, sql } from '@veritasee/db';
import { withObservability } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(_req: NextRequest) {
  try {
    const rows = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    const ok = Array.isArray(rows)
      ? rows[0]?.ok === 1
      : (rows as { rows: { ok: number }[] }).rows?.[0]?.ok === 1;
    if (!ok) return NextResponse.json({ ok: false }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}

export const GET = withObservability(handler);
