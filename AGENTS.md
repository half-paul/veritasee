# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm workspace. The active application lives in `apps/web`, a Next.js App Router project using TypeScript, React, Tailwind CSS, and Clerk authentication. Shared packages live under `packages/`: `@veritasee/db` wraps Neon Postgres + Drizzle, `@veritasee/redis` wraps Upstash Redis (requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`), and `@veritasee/storage` wraps an S3-compatible object store (Cloudflare R2 or AWS S3) for snapshot and reference-asset persistence per PRD §14.1 (requires `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, plus `S3_FORCE_PATH_STYLE=true` for R2). Project documentation is under `docs/`, including the PRD, ADRs, and system overview.

Key paths:

- `apps/web/src/app/`: App Router pages, layouts, route handlers, and global CSS.
- `apps/web/src/lib/`: reusable application logic, including auth role helpers.
- `apps/web/src/types/`: local TypeScript declaration files.
- `docs/adr/`: architectural decision records.

## Build, Test, and Development Commands

Run commands from the repository root unless noted.

- `pnpm dev`: starts the web app with `next dev`.
- `pnpm build`: builds the production Next.js app.
- `pnpm start`: serves the built app.
- `pnpm lint`: runs ESLint across workspace packages.
- `pnpm typecheck`: runs TypeScript checks with `tsc --noEmit`.
- `pnpm format`: formats the repo with Prettier and the Tailwind plugin.
- `pnpm format:check`: verifies formatting without changing files.

Use Node `>=20.11` and pnpm `10.30.3`, as declared in `package.json`.

## Coding Style & Naming Conventions

Use TypeScript for application code. Follow the existing Next.js conventions: route folders use lowercase URL segments, React components use PascalCase, and helpers use descriptive camelCase names. Keep reusable logic out of page files when it can live in `src/lib`.

Formatting is handled by Prettier. Linting uses ESLint 9 with `next/core-web-vitals` and `next/typescript`; resolve lint and type errors before opening a PR.

## Testing Guidelines

No dedicated test framework is configured yet. For now, treat `pnpm lint`, `pnpm typecheck`, and `pnpm build` as the required verification set. When adding tests, colocate them near the code they cover or use a clear `tests/` directory, and use names such as `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines

Recent commits use short, imperative subjects, usually prefixed with a ticket ID, for example `LEX-64: integrate Clerk managed auth with role-based access`. Keep commits focused and avoid mixing formatting-only changes with feature work.

Pull requests should include a concise description, linked issue or ticket, verification commands run, and screenshots for visible UI changes. Note any new environment variables or auth/configuration requirements.

Linear issue lifecycle: `/implement` moves the linked issue to `In Review` once the PR is up. After the PR merges, run `/merge-followup <pr-number>` to advance the issue to `Done` and post a merge summary comment. Do not mark issues `Done` before merge.

## Security & Configuration Tips

Do not commit secrets or local `.env` files. Clerk-related configuration should stay environment-specific, and any new required variables should be documented in the PR and relevant docs.
