import { NextResponse } from 'next/server';
import { getDb, sql } from '@veritasee/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    const ok = Array.isArray(rows) ? rows[0]?.ok === 1 : (rows as { rows: { ok: number }[] }).rows?.[0]?.ok === 1;
    if (!ok) return NextResponse.json({ ok: false }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    );
  }
}
