import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';
import { mockAuth } from '@test/factories/mockClerkAuth';
import { clearDenylistCache } from '@/lib/url-validation';

// Mock Clerk and DNS so we never reach the network or auth provider.
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: null, sessionClaims: null })),
  currentUser: vi.fn(async () => null),
}));

vi.mock('@/lib/url-validation/resolveHost', () => ({
  resolveHost: vi.fn(async () => ({ ok: true, addresses: ['8.8.8.8'] })),
}));

import { POST } from './route';
import { resolveHost } from '@/lib/url-validation/resolveHost';

const mockResolveHost = vi.mocked(resolveHost);

function makeReq(body: unknown) {
  return buildRequest({
    url: 'https://localhost/api/proxy/validate',
    method: 'POST',
    body,
  });
}

describe('POST /api/proxy/validate', () => {
  beforeEach(() => {
    clearDenylistCache();
    mockResolveHost.mockReset();
    mockResolveHost.mockResolvedValue({ ok: true, addresses: ['8.8.8.8'] });
  });

  afterEach(() => {
    clearDenylistCache();
  });

  it('401 when unauthenticated', async () => {
    await mockAuth({ userId: null });
    const res = await POST(makeReq({ url: 'https://en.wikipedia.org/wiki/Test' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unauthenticated');
  });

  it('400 when body is not JSON', async () => {
    await mockAuth({ userId: 'user_1' });
    const req = buildRequest({
      url: 'https://localhost/api/proxy/validate',
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('400 when body has no url field', async () => {
    await mockAuth({ userId: 'user_1' });
    const res = await POST(makeReq({ notUrl: 'x' }));
    expect(res.status).toBe(400);
  });

  it('403 when host is denylisted (localhost)', async () => {
    await mockAuth({ userId: 'user_1' });
    const res = await POST(makeReq({ url: 'https://localhost/x' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('denylisted');
  });

  it('403 when the URL resolves to a private IP', async () => {
    await mockAuth({ userId: 'user_1' });
    mockResolveHost.mockResolvedValue({ ok: true, addresses: ['10.0.0.1'] });
    const res = await POST(makeReq({ url: 'https://internal.example.com' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('private_ip');
  });

  it('503 when DNS resolution fails', async () => {
    await mockAuth({ userId: 'user_1' });
    mockResolveHost.mockResolvedValue({ ok: false, reason: 'lookup_failed' });
    const res = await POST(makeReq({ url: 'https://nonexistent.example.com' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('dns_failure');
  });

  it('200 on the happy path with normalized URL', async () => {
    await mockAuth({ userId: 'user_1' });
    mockResolveHost.mockResolvedValue({ ok: true, addresses: ['208.80.154.224'] });
    const res = await POST(makeReq({ url: 'https://en.wikipedia.org/wiki/Test' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; normalizedUrl: string; hostname: string };
    expect(body.ok).toBe(true);
    expect(body.hostname).toBe('en.wikipedia.org');
    expect(body.normalizedUrl).toBe('https://en.wikipedia.org/wiki/Test');
  });
});
