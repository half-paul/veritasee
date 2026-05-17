// NextRequest builder for route-handler tests. Keeps each test focused on the
// behavior under test (status code, body shape) instead of WHATWG-Request
// boilerplate. Defaults to `POST https://localhost/` with a JSON body.
import { NextRequest } from 'next/server';

type BuildOptions = {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export function buildRequest(opts: BuildOptions = {}): NextRequest {
  const url = opts.url ?? 'https://localhost/';
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const headers = new Headers(opts.headers ?? {});
  let body: BodyInit | null = null;
  if (opts.body !== undefined) {
    if (typeof opts.body === 'string') {
      body = opts.body;
    } else {
      body = JSON.stringify(opts.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }
  return new NextRequest(url, { method, headers, body });
}
