// Global Vitest setup. Boots an MSW server so any HTTP call from code under
// test resolves against per-test handler overrides instead of going to the
// real network. Tests register handlers via `server.use(...)` and they reset
// between tests so leakage across files is impossible.
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server';

beforeAll(() => {
  // `error` ensures any un-mocked outbound request fails loudly rather than
  // hitting the network.
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
