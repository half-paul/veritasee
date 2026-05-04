---
description: Execute an implementation plan with validation loops
argument-hint: <path/to/plan.md>
---

# Implement Plan

**Plan**: $ARGUMENTS

## Your Mission

Execute the plan end-to-end with rigorous self-validation.

**Core Philosophy**: Validation loops catch mistakes early. Run checks after every change. Fix issues immediately.

**Golden Rule**: If validation fails, fix it before moving on. Never accumulate broken state.

---

## Phase 1: LOAD

### Read the Plan

Load the plan file and extract:

- **Summary** - What we're building
- **Patterns to Mirror** - Code to copy from
- **Files to Change** - CREATE/UPDATE list
- **Tasks** - Implementation order
- **Validation Commands** - How to verify
- **Linear Issue** - Check the plan's Metadata table for a Linear issue identifier (for this project, usually `LEX-N`). If present, this issue will be updated through the Linear MCP after implementation is complete.

### Project Context to Honor

This repository is the Veritasee Override monorepo:

- `apps/web` is the Next.js App Router application.
- `packages` is reserved for shared libraries as the system grows.
- Product and architecture source of truth lives in `docs/PRD.md` and `docs/general/SYSTEM-OVERVIEW.md`.
- The v1 architecture is a single Next.js API surface with managed services: Postgres, Redis, S3-compatible object storage, managed auth, and a thin AI provider router.
- Prefer feature slices that match the PRD domains: proxy viewer, correction editor, AI verification, moderation/governance, quotas, and shared infrastructure.
- Do not introduce standalone services, public APIs, or alternate architecture unless the plan explicitly justifies the deviation against the PRD.

**If plan not found:**
```
Error: Plan not found at $ARGUMENTS
Create a plan first: /plan "feature description"
```

---

## Phase 2: PREPARE

### Git State

```bash
git branch --show-current
git status
```

| State | Action |
|-------|--------|
| On main, clean | Create branch: `git checkout -b feature/{plan-name}` |
| On main, dirty | STOP: "Stash or commit changes first" |
| On feature branch | Use it |

---

## Phase 3: EXECUTE

**For each task in the plan:**

### 3.1 Verify Assumptions

Before writing any code for a task:

- **Read the target file** you're about to create or modify
- **Read adjacent files** — files it imports from, and files that import it
- **Read relevant project docs** — for architecture-sensitive work, check `docs/PRD.md` and `docs/general/SYSTEM-OVERVIEW.md`
- **Verify the plan's references** — do the functions, interfaces, tables, or endpoints the plan mentions actually exist? Do they match the plan's expectations?
- **If assumptions are wrong**, adapt your approach before implementing. Document what differs from the plan.

### 3.2 Implement

- Read the **MIRROR** file reference and understand the pattern to follow
- Make the change as specified in the plan
- **Check integration**: verify your change connects correctly to adjacent code — do imports resolve? Do callers/callees still work? Does the data flow correctly across boundaries?
- **Stay within the architecture**:
  - App UI and routes belong under `apps/web/src/app`.
  - Reusable code should move into `packages` only when there is a real cross-app/shared need.
  - Backend work should start as Next.js route handlers/server actions unless the plan explicitly calls for a separate worker or package.
  - Infrastructure clients should be thin wrappers around managed services named in the PRD.
  - AI verification code must preserve the human-in-the-loop rule: AI may gather/summarize evidence, but it must not publish or auto-submit corrections.

### 3.3 Validate Immediately

**After EVERY task:**

```bash
pnpm run typecheck
```

**If it fails:**
1. Read the error
2. Fix the issue
3. Re-run validation
4. Only proceed when passing

### 3.4 Track Progress

```
Task 1: CREATE src/x.ts ✅
Task 2: UPDATE src/y.ts ✅
```

**If you deviate from the plan**, document what changed and why.

---

## Phase 4: VALIDATE

### Run All Checks

```bash
# Type check
pnpm run typecheck

# Lint
pnpm run lint

# Build
pnpm run build
```

**All configured checks must pass with zero errors.**

If the plan or changed package defines a test command, run it as well. If no test command exists yet, document that explicitly in the report and add focused tests when the feature introduces meaningful logic or user-visible behavior.

### Write Tests

You MUST write tests for new code:
- Every new function needs at least one test
- Error cases and edge cases need tests
- Update existing tests if behavior changed
- **Test across boundaries** — don't just test functions in isolation. If you added an API endpoint, test that the endpoint returns the correct response shape and data. If you added a service method, test that it integrates correctly with its callers.

**If tests fail:**
1. Determine: bug in implementation or test?
2. Fix the actual issue
3. Re-run until green

### REQUIRED: End-to-End Verification

> **⚠️ Do NOT proceed to Phase 5 (Report) until all E2E steps below pass.**

Re-read the plan and find the end-to-end testing section. Execute every E2E test listed in the plan as a checklist:

- [ ] Start the application (dev servers, databases, etc.)
- [ ] For EACH end-to-end test in the plan:
  - [ ] Execute the test exactly as described
  - [ ] Verify the expected outcome matches the plan
  - [ ] If it fails: fix the issue, re-run, confirm it passes
- [ ] Confirm all E2E tests pass before proceeding

**If the plan has no E2E tests**, perform a basic smoke test: start the app, exercise the new/changed feature manually, verify it works.

**This is a hard gate.** You cannot report the implementation as complete until E2E verification passes. Static checks and unit tests alone are never sufficient.

---

## Phase 5: REPORT

### Create Report

**Output path**: `.agents/reports/{plan-name}-report.md`

```bash
mkdir -p .agents/reports
```

```markdown
# Implementation Report

**Plan**: `{plan-path}`
**Branch**: `{branch-name}`
**Status**: COMPLETE

## Summary

{Brief description of what was implemented}

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | {description} | `src/x.ts` | ✅ |
| 2 | {description} | `src/y.ts` | ✅ |

## Validation Results

| Check | Result |
|-------|--------|
| Type check | ✅ |
| Lint | ✅ |
| Tests | ✅ ({N} passed) |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/x.ts` | CREATE | +{N} |
| `src/y.ts` | UPDATE | +{N}/-{M} |

## Deviations from Plan

{List any deviations with rationale, or "None"}

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/x.test.ts` | {list} |
```

### Archive Plan

```bash
mkdir -p .agents/plans/completed
mv $ARGUMENTS .agents/plans/completed/
```

---

## Phase 6: UPDATE LINEAR (if issue specified in plan)

**This phase is mandatory if the plan's Metadata table contains a Linear Issue identifier.** Skip only if the Linear Issue field is `N/A` or absent.

Claude Code has Linear MCP integration; use the Linear MCP tools for all issue reads, status changes, comments, labels, relations, and description updates.

### 6.1 Fetch the Linear Issue

Call the Linear MCP issue read tool, such as `get_issue`, for the issue identifier from the plan metadata.

Confirm:
- The issue exists
- The title/description still match the implemented scope
- Current state, labels, project, and assignee

### 6.2 Move the Issue to the Appropriate State

Use Linear MCP status/state tools, such as `list_issue_statuses` and `update_issue`.

State after implementation:

1. `In Review` once the PR is opened (or about to be opened). This is the target state for `/implement`.
2. **Do not** move the issue to `Done` from this command — `Done` is owned by `/merge-followup`, which runs after the PR is merged.
3. If validation failed, keep the current state and add a blocker comment instead of advancing the issue.

### 6.3 Add Implementation Comment

Call the Linear MCP comment tool, such as `create_comment`, with a markdown summary including:
  - What was implemented
  - Branch name
  - Files created/updated (count)
  - Tests written (count)
  - Validation commands run and results
  - Any deviations from the plan
  - Link to the implementation report file path

### 6.4 Update Issue Fields (if needed)

If the implementation resulted in meaningful deviations from the original issue description or acceptance criteria, call the Linear MCP update tool, such as `update_issue`, to update the description or labels.

Preserve traceability to the PRD and implementation report. Do not overwrite acceptance criteria unless they are objectively stale; prefer an implementation comment for normal execution notes.

---

## Phase 7: OUTPUT

```markdown
## Implementation Complete

**Plan**: `{plan-path}`
**Branch**: `{branch-name}`
**Status**: ✅ Complete

### Validation

| Check | Result |
|-------|--------|
| Type check | ✅ |
| Lint | ✅ |
| Tests | ✅ |

### Files Changed

- {N} files created
- {M} files updated
- {K} tests written

### Deviations

{Summary or "Implementation matched the plan."}

### Artifacts

- Report: `.agents/reports/{name}-report.md`
- Plan archived: `.agents/plans/completed/`

### Linear

{If issue was updated: "Updated {ISSUE_KEY}: moved to {state}, added implementation comment." Otherwise: "No Linear issue linked."}

### Next Steps

1. Review the report
2. Create PR: `gh pr create`
3. Merge when approved
4. After merge, run `/merge-followup {PR_NUMBER}` to move the Linear issue to Done
```

---

## Handling Failures

| Failure | Action |
|---------|--------|
| Type check fails | Read error, fix issue, re-run |
| Tests fail | Fix implementation or test, re-run |
| Lint fails | Run `pnpm run lint --fix`, then manual fixes |
| Build fails | Check error output, fix and re-run |
