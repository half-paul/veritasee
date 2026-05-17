import { describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';
import { mockAuth } from '@test/factories/mockClerkAuth';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: null, sessionClaims: null })),
  currentUser: vi.fn(async () => null),
}));

import { GET } from './route';

describe('GET /api/me', () => {
  it('401 with user=null when unauthenticated', async () => {
    await mockAuth({ userId: null });
    const res = await GET(buildRequest({ url: 'https://localhost/api/me', method: 'GET' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });

  it('200 with id, email, role when authenticated', async () => {
    await mockAuth({ userId: 'user_123', role: 'moderator' });
    const res = await GET(buildRequest({ url: 'https://localhost/api/me', method: 'GET' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string | null; role: string };
    };
    expect(body.user).toEqual({
      id: 'user_123',
      email: 'user_123@example.test',
      role: 'moderator',
    });
  });

  it('falls back to the default role when claims have no role', async () => {
    await mockAuth({ userId: 'user_2' });
    const res = await GET(buildRequest({ url: 'https://localhost/api/me', method: 'GET' }));
    const body = (await res.json()) as { user: { role: string } };
    expect(body.user.role).toBe('contributor');
  });
});
