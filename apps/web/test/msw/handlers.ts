// MSW handlers. Kept empty at the default tier — the global setup runs with
// `onUnhandledRequest: 'error'` so every test must explicitly register the
// shape it expects via `server.use(...)`. Shared response builders live in
// `test/factories/` and produce per-test handler instances.
import type { RequestHandler } from 'msw';

export const defaultHandlers: RequestHandler[] = [];
