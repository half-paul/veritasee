# Code Review: LEX-69 — object store provisioning PRD + runbook + teardown helper

**Scope**: commit `39e9b43` on `features/LEX-69`
- `.agents/PRDs/lex-69-r2-bucket-provisioning.md` (new, 269 lines)
- `docs/general/DEPLOYMENT.md` (+71/-3 — new "Object store (R2 or AWS S3)" section)
- `scripts/delete-s3-app.sh` (new, 227 lines)

**Recommendation**: APPROVE with minor fixups

## Summary

A docs-and-tooling-only change layered on top of LEX-67 (storage package) and LEX-68 (Vercel deployment). The PRD lays out per-environment R2 / S3 bucket provisioning, the DEPLOYMENT runbook gains a parallel R2/S3 operator section, and a teardown script complements `setup-s3-app.sh`. No application code changes. Lint, typecheck, and bash syntax all clean. Cross-references to file paths and line numbers (`client.ts:16-32`, `lifecycle.ts:7-9`, `lifecycle.ts:16-32`) all check out against the actual source.

## Issues Found

### Critical
None.

### High Priority

1. **`scripts/delete-s3-app.sh` is not marked executable.**
   - `ls -l` shows no `x` bit on the new file; `scripts/setup-s3-app.sh` is executable.
   - The script's own self-printed help (`scripts/delete-s3-app.sh:217`) tells the user to run `DELETE_BUCKET=true ./delete-s3-app.sh`, which fails without the executable bit.
   - **Fix**: `chmod +x scripts/delete-s3-app.sh` (or `git update-index --chmod=+x` if filesystem-level chmod is awkward), then re-commit.

### Medium Priority

2. **PRD references a non-existent `PRD §17`.**
   - `.agents/PRDs/lex-69-r2-bucket-provisioning.md:13` says "PRD §14.1 and §17 require per-environment isolation of stored objects."
   - `docs/PRD.md` only has sections through §14. The same stale `§17` reference appears in `.agents/plans/completed/lex-67-s3-object-store.plan.md:5` and `:289`, so this is a longstanding citation drift, not something introduced here — but it's repeated in a new doc.
   - **Fix options**: drop "and §17", or replace with the actual section that motivates env isolation (likely just §14.1, or the ADR 0003 §Decision table, which is already linked).

### Low Priority / Suggestions

3. **`delete-s3-app.sh` ordering: IAM teardown runs before bucket teardown, so a precondition failure inside the bucket block leaves the state inconsistent.**
   - When `DELETE_BUCKET=true` and the bucket is versioned but `jq` is missing, `scripts/delete-s3-app.sh:162-166` does `exit 1` — by that point the access key, policy, and IAM user are already gone, but the bucket (and objects) remain.
   - **Fix**: precheck `jq` availability at the top of the script when `DELETE_BUCKET=true`, before any deletions. Same for the `aws sts get-caller-identity` smoke at line 28 — already there, good — but it doesn't catch the jq case.

4. **PRD §3 naming convention (`veritasee-prod` / `-preview` / `-dev`) doesn't match `scripts/setup-s3-app.sh`'s default (`raisin-app-uploads-<timestamp>`).**
   - The PRD's provisioning steps are manual (dashboard or `aws s3api`), not via the setup script, so there's no direct conflict — but a reader who finds both files could be confused about which is canonical. A one-line note in `scripts/setup-s3-app.sh` ("for the canonical naming convention see `.agents/PRDs/lex-69…`") would close the loop. Optional.

5. **PRD §5.3 step 5 (R2 token creation): Endpoint is captured per-token, but is account-scoped.**
   - The same R2 endpoint URL is used for all three tokens (R2 endpoints are `<account-id>.r2.cloudflarestorage.com`). The PRD does correctly note "same for all three buckets" parenthetically, but the per-token capture instruction is mildly misleading. Cosmetic.

6. **`delete-s3-app.sh` `awk` profile-removal matches `$0 == profile` exactly.**
   - A line like `[profile s3-app-test] ; trailing comment` won't match. This is fine for AWS CLI-generated config files, but worth knowing if a user has manually edited their `~/.aws/config`. Not actionable.

## Validation Results

| Check                                | Status |
|--------------------------------------|--------|
| `pnpm run lint`                      | PASS   |
| `pnpm run typecheck`                 | PASS   |
| `bash -n scripts/delete-s3-app.sh`   | PASS   |
| Cross-references (line numbers in PRD / runbook map to real code) | PASS |

Tests not run — there are no source changes in this commit, and the storage smoke test is env-gated (requires live S3/R2 credentials per `packages/storage/test/smoke.test.ts`).

## What's Good

- The PRD's dual-path structure (one R2 column, one S3 column, identical env var keys) cleanly reflects how the storage package was designed in LEX-67. The "no application code changes for either provider" claim is verifiable against `packages/storage/src/client.ts`.
- Acceptance criteria (§8) are concrete and check-by-check verifiable.
- The lifecycle script's "replaces the bucket's full rule set" caveat is surfaced in both the PRD and DEPLOYMENT.md, matching the actual comment in `packages/storage/src/lifecycle.ts:7-9`. Good defensive documentation.
- The DEPLOYMENT.md env-var matrix consolidates Clerk, Neon, Upstash, and S3 in one place — useful for first-time setup.
- IAM policy in DEPLOYMENT.md correctly includes `s3:GetBucketLifecycleConfiguration` and `s3:PutBucketLifecycleConfiguration`, which the `storage:apply-lifecycle` script requires.
- Risks table (PRD §9) covers the realistic failure modes (lost creds, wrong-scope env vars, lifecycle script misfire).

## Recommendation

Fix item #1 (chmod +x on `delete-s3-app.sh`) before merge — it's a real bug that breaks the documented usage. Item #2 (stale §17 reference) is worth a one-line edit in the same fixup. Items #3–#6 are nice-to-haves and can land later or be ignored.
