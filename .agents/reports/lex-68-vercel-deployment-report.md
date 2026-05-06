# Implementation Report

**Plan**: `.agents/plans/lex-68-vercel-deployment.plan.md`
**Branch**: `features/LEX-68`
**Status**: COMPLETE (committed surface). Operational steps in the plan's Task 6 must be performed by the developer in the Vercel / Neon / Upstash / R2 dashboards — they are not code and cannot be executed from this repo.

## Summary

Wired the Next.js monorepo to Vercel by committing a small, reproducible build contract and the supporting documentation:

- `vercel.json` at the repo root pins framework / install / build / output so deploys do not depend on dashboard drift.
- ADR 0003 records the hosting choice, the three-environment model (Production / Preview / Development), the Neon ↔ Vercel per-PR DB integration, and the explicit decision to leave preview Redis + object store shared.
- `docs/general/DEPLOYMENT.md` is the operational runbook: project setup, env-var matrix and provisioning steps, AC verification, rollback, and FAQ.
- `apps/web/.env.example` gained a header explaining `.env.local` (dev) vs Vercel project env vars (preview/prod) and the `with-env.mjs` precedence rule.
- `AGENTS.md` points at the new doc.

No application code changes, no new dependencies, no new packages — exactly per the plan.

## Tasks Completed

| #   | Task                                              | File                                     | Status |
| --- | ------------------------------------------------- | ---------------------------------------- | ------ |
| 1   | Pin framework / install / build / output          | `vercel.json` (CREATE)                   | ✅     |
| 2   | Document hosting + per-env isolation              | `docs/adr/0003-vercel-deployment.md` (CREATE) | ✅ |
| 3   | Operational runbook with AC checklist             | `docs/general/DEPLOYMENT.md` (CREATE)    | ✅     |
| 4   | Header explaining env-var sourcing and precedence | `apps/web/.env.example` (UPDATE)         | ✅     |
| 5   | Pointer to deployment doc                         | `AGENTS.md` (UPDATE)                     | ✅     |
| 6   | Operational checklist (developer performs once)   | n/a (recorded in PR description)         | ⏳ deferred to PR |

## Validation Results

| Check                                                       | Result                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                            | ✅ (no lockfile drift)                                       |
| `pnpm --filter web build` (mirrors what Vercel runs)        | ✅ (compiled in 1926ms; 9 routes, middleware 87.6 kB)        |
| `pnpm typecheck`                                            | ✅ (4 packages, all clean)                                   |
| `pnpm lint`                                                 | ✅ (4 packages, all clean)                                   |
| `pnpm format:check` (whole repo)                            | ⚠️ 51 files flagged — pre-existing across `main`; not introduced by this change. New/modified files in this PR all pass `prettier --check`. |
| `pnpm --filter @veritasee/db test` (pgvector)               | ✅ 1 passed                                                  |
| `pnpm --filter @veritasee/redis test` (Upstash smoke)       | ✅ 2 passed                                                  |
| `pnpm --filter @veritasee/storage test` (S3 smoke)          | ✅ 2 passed                                                  |

### E2E verification

Per the plan's "Validation" and "Acceptance Criteria" sections, the live AC #1 / AC #2 / AC #3 checks (PR preview URL, prod deploy on merge, env-var isolation) require:

1. A Vercel project linked to the GitHub repo,
2. Env vars populated for Production and Preview (Clerk, Neon, Upstash, S3/R2),
3. The Neon ↔ Vercel integration installed.

These steps are operational and non-committable. The runbook (`docs/general/DEPLOYMENT.md` §"Verification") gives the developer the exact `curl` commands and dashboard checks to run once the Vercel project exists. They will be run as part of the PR description checklist (plan §Task 6) and recorded there before merge.

The local proxy for AC checks is the `pnpm --filter web build` step above, which mirrors what Vercel will run on every push.

## Files Changed

| File                                                        | Action | Notes                                                  |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------ |
| `vercel.json`                                               | CREATE | 7 lines, schema-pinned                                  |
| `docs/adr/0003-vercel-deployment.md`                        | CREATE | MADR-lite shape; matches ADR 0002 ordering             |
| `docs/general/DEPLOYMENT.md`                                | CREATE | Runbook with env matrix and AC verification commands   |
| `apps/web/.env.example`                                     | UPDATE | +9 line header at the top; existing blocks untouched   |
| `AGENTS.md`                                                 | UPDATE | +1 bullet under Project Structure pointing at the runbook |

## Deviations from Plan

- **`with-env.mjs` line reference**: The plan suggested citing `scripts/with-env.mjs:18,49`. The actual code lives at lines 17 and 42 (no change since the plan was drafted; the plan's references were imprecise). ADR 0003 cites `scripts/with-env.mjs:17,42`.
- **Prettier autofix on the new docs**: Running `prettier --write` on the two new doc files reformatted `*emphasis*` → `_emphasis_` and aligned table columns. This is repo-wide Prettier convention; behavior unchanged.

No structural deviations. No app code touched. No risk-table item triggered (e.g., `transpilePackages` was not needed — local `pnpm --filter web build` succeeded with workspace TS imports as-is).

## Tests Written

None — this is an infra/docs change with no new code paths. The existing per-package vitest suites (`db`, `redis`, `storage`) were re-run as smoke checks and all pass.

## Acceptance Criteria — committed-surface checklist

- [x] `vercel.json` exists at the repo root with framework/install/build/output pinned.
- [x] `docs/adr/0003-vercel-deployment.md` exists and follows the MADR-lite contract from `docs/adr/README.md`.
- [x] `docs/general/DEPLOYMENT.md` exists with the env-var matrix, the verification checklist, and the rollback procedure.
- [x] `apps/web/.env.example` has a header explaining local-vs-Vercel env-var sourcing and the `with-env.mjs` precedence rule.
- [x] `AGENTS.md` references the new deployment doc.
- [x] `pnpm install --frozen-lockfile && pnpm --filter web build` succeeds locally with no new warnings.
- [x] `pnpm typecheck`, `pnpm lint` clean.
- [ ] `pnpm format:check` clean — see note above; pre-existing repo-wide Prettier debt is out of scope and not introduced here.
- [ ] **LEX-68 AC #1 / #2 / #3** — verified live by the developer once the Vercel project is provisioned (instructions in `docs/general/DEPLOYMENT.md` §Verification). Recorded in the PR description per plan Task 6.
