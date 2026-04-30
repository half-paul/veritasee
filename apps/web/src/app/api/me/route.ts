import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { resolveRole } from '@/lib/auth/roles';

export async function GET() {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const user = await currentUser();
  return NextResponse.json({
    user: {
      id: userId,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      role: resolveRole(sessionClaims),
    },
  });
}
