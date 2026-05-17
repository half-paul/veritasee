// Playwright fixtures. Once Clerk test users are provisioned, this file should
// expose `readerPage`, `contributorPage`, `moderatorPage`, `adminPage` —
// authenticated browser contexts per role — wrapping `@clerk/testing`'s
// `setupClerkTestingToken`. Until then, specs use the anonymous fixture and
// any session-dependent flow lives behind a `test.skip(!hasClerkTest, ...)`
// guard so the suite is green on a clean clone.
import { test as base, expect } from '@playwright/test';

export const hasClerkTestEnv =
  !!process.env.CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY &&
  !!process.env.CLERK_TESTING_TOKEN;

export const test = base;
export { expect };
