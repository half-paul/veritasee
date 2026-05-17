import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRequest } from '@test/factories/buildRequest';

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({
  captureException,
}));

import { withObservability } from './withObservability';

describe('withObservability', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    captureException.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('passes through the handler response and logs request info', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withObservability(handler);
    const req = buildRequest({ url: 'https://localhost/api/foo', method: 'GET' });
    const res = await wrapped(req);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();

    const calls = logSpy.mock.calls.map((c) => JSON.parse(c[0] as string));
    const reqLog = calls.find((c) => c.event === 'request');
    expect(reqLog).toMatchObject({
      level: 'info',
      method: 'GET',
      route: '/api/foo',
      status: 200,
    });
    expect(typeof reqLog?.duration_ms).toBe('number');
    expect(typeof reqLog?.request_id).toBe('string');
  });

  it('uses x-request-id from the incoming headers when present', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withObservability(handler);
    const req = buildRequest({
      url: 'https://localhost/api/foo',
      method: 'GET',
      headers: { 'x-request-id': 'abc-123' },
    });
    await wrapped(req);
    const reqLog = logSpy.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((c) => c.event === 'request');
    expect(reqLog?.request_id).toBe('abc-123');
  });

  it('does NOT swallow exceptions — rethrows after logging and Sentry capture', async () => {
    const boom = new Error('boom');
    const handler = vi.fn(async () => {
      throw boom;
    });
    const wrapped = withObservability(handler);
    const req = buildRequest({ url: 'https://localhost/api/foo' });

    await expect(wrapped(req)).rejects.toThrow('boom');

    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0]?.[0]).toBe(boom);
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      tags: { route: '/api/foo' },
    });

    const errLog = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(errLog).toMatchObject({
      level: 'error',
      event: 'request',
      status: 500,
      err: 'boom',
    });
  });

  it('does NOT include query strings in the logged route (token-leak defense)', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withObservability(handler);
    const req = buildRequest({
      url: 'https://localhost/api/foo?token=secret123',
      method: 'GET',
    });
    await wrapped(req);
    const reqLog = logSpy.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((c) => c.event === 'request');
    expect(reqLog?.route).toBe('/api/foo');
    expect(JSON.stringify(reqLog)).not.toContain('secret123');
  });
});
