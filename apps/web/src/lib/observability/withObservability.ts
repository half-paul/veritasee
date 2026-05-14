import * as Sentry from '@sentry/nextjs';
import type { NextRequest } from 'next/server';
import { logger } from './logger';

type RouteHandler<TArgs extends unknown[]> = (
  req: NextRequest,
  ...args: TArgs
) => Promise<Response>;

export function withObservability<TArgs extends unknown[]>(
  handler: RouteHandler<TArgs>,
): RouteHandler<TArgs> {
  return async (req, ...args) => {
    const start = performance.now();
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const method = req.method;
    const route = req.nextUrl.pathname;

    try {
      const res = await handler(req, ...args);
      logger.info('request', {
        event: 'request',
        method,
        route,
        status: res.status,
        duration_ms: performance.now() - start,
        request_id: requestId,
      });
      return res;
    } catch (err) {
      const duration_ms = performance.now() - start;
      logger.error('request_error', {
        event: 'request',
        method,
        route,
        status: 500,
        duration_ms,
        request_id: requestId,
        err: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err, {
        tags: { route, request_id: requestId },
      });
      throw err;
    }
  };
}
