// Anonymous-user smoke specs. These do not require a Clerk test instance and
// run on every PR. Auth-dependent specs (sign-in → dashboard, role gating)
// will land in `auth.spec.ts` once Clerk test creds are wired.
import { test, expect } from './fixtures';

test('home page renders with sign-in CTA', async ({ page }) => {
  await page.goto('/');
  // The home shell shows a sign-in link/button — accept either the "Sign in"
  // CTA from Clerk or a marketing-style "Get started" CTA.
  const signInCta = page.getByRole('link', { name: /sign in/i }).or(
    page.getByRole('button', { name: /sign in/i }),
  );
  await expect(signInCta).toBeVisible();
});

test('protected /dashboard redirects anonymous users to sign-in', async ({ page }) => {
  const response = await page.goto('/dashboard');
  // Clerk middleware sends anonymous users to its sign-in URL. We accept
  // either a server redirect (3xx final response on /sign-in) or that the
  // final URL is /sign-in.
  expect(response).not.toBeNull();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('GET /api/me without session returns 401', async ({ request }) => {
  const res = await request.get('/api/me');
  expect(res.status()).toBe(401);
  const body = (await res.json()) as { user: unknown };
  expect(body.user).toBeNull();
});
