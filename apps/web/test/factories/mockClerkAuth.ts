// Clerk auth mock helper. Used in route-handler tests after
// `vi.mock('@clerk/nextjs/server')` so the route's `auth()` resolves with a
// caller-specified shape (anonymous, role, etc.) rather than hitting Clerk.
import { vi } from 'vitest';
import type { Role } from '@/lib/auth/roles';

type MockAuthOptions = {
  userId: string | null;
  role?: Role;
};

type ClerkAuthShape = {
  userId: string | null;
  sessionClaims: { metadata?: { role?: string } } | null;
};

type ClerkUserShape = {
  primaryEmailAddress: { emailAddress: string } | null;
} | null;

// Lazy import of the mocked module so callers don't have to know whether
// it's a default or named export; we just patch what's there.
async function getClerkServer(): Promise<{
  auth: { mockResolvedValue?: (v: ClerkAuthShape) => void };
  currentUser: { mockResolvedValue?: (v: ClerkUserShape) => void };
}> {
  return (await import('@clerk/nextjs/server')) as unknown as {
    auth: { mockResolvedValue?: (v: ClerkAuthShape) => void };
    currentUser: { mockResolvedValue?: (v: ClerkUserShape) => void };
  };
}

export async function mockAuth(opts: MockAuthOptions): Promise<void> {
  const mod = await getClerkServer();
  const claims: ClerkAuthShape = opts.userId
    ? {
        userId: opts.userId,
        sessionClaims: opts.role ? { metadata: { role: opts.role } } : { metadata: {} },
      }
    : { userId: null, sessionClaims: null };
  mod.auth.mockResolvedValue?.(claims);
  mod.currentUser.mockResolvedValue?.(
    opts.userId
      ? { primaryEmailAddress: { emailAddress: `${opts.userId}@example.test` } }
      : null,
  );
}

// `vi.mock('@clerk/nextjs/server')` partial-factory used by route-handler tests.
// Reusable so every test file isn't pasting the same factory body.
export function clerkAuthFactory() {
  return {
    auth: vi.fn(async () => ({ userId: null, sessionClaims: null })),
    currentUser: vi.fn(async () => null),
    clerkMiddleware: vi.fn(),
    createRouteMatcher: vi.fn(() => () => false),
  };
}
