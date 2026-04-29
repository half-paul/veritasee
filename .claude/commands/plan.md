---
description: Create implementation plan with codebase analysis
argument-hint: <feature description | path/to/prd.md>
---

# Implementation Plan Generator

**Input**: $ARGUMENTS

## Objective

Transform the input into a battle-tested implementation plan through codebase exploration and pattern extraction.

**Core Principle**: PLAN ONLY - no code written. Create a context-rich document that enables one-pass implementation.

**Order**: CODEBASE FIRST. Solutions must fit existing patterns.

---

## Phase 1: PARSE

### Determine Input Type

| Input | Action |
|-------|--------|
| `.prd.md` file | Read PRD, extract next pending phase |
| Other `.md` file | Read and extract feature description |
| Free-form text | Use directly as feature input |
| Blank | Use conversation context |

### Extract Feature Understanding

- **Problem**: What are we solving?
- **User Story**: As a [user], I want to [action], so that [benefit]
- **Type**: NEW_CAPABILITY / ENHANCEMENT / REFACTOR / BUG_FIX
- **Complexity**: LOW / MEDIUM / HIGH
- **Linear Issue**: If a Linear issue identifier is available in the conversation context — from a prior `/prime` command, user mention, PRD, or `.agents/stories/*linear-issues.md` — capture it. For this project, identifiers usually look like `LEX-N`. This is optional but should be included in the plan metadata when available so that `/implement` can update the issue after completion.

### Linear Issue Context

If a Linear issue is provided or discoverable, use Claude Code's Linear MCP integration to read it before planning:

1. Fetch the issue through the Linear MCP issue read tool, such as `get_issue`.
2. Extract the issue title, description, acceptance criteria, labels, priority, project, and current state.
3. Use that issue context as planning input and preserve traceability in the generated plan.

Use Linear MCP for all issue manipulation in this project. If the input contains a legacy non-Linear issue key, treat it as stale metadata; look for a matching Linear issue in the conversation, branch name, PRD-derived Linear issue list, or ask the user only if no reasonable match can be found.

---

## Phase 2: EXPLORE

### Study the Codebase

Use the Explore agent to find:

1. **Similar implementations** - analogous features with file:line references
2. **Naming conventions** - actual examples from the codebase
3. **Error handling patterns** - how errors are created and handled
4. **Type definitions** - relevant interfaces and types
5. **Test patterns** - test file structure and assertion styles

### Document Patterns

| Category | File:Lines | Pattern |
|----------|------------|---------|
| NAMING | `path/to/file.ts:10-15` | {pattern description} |
| ERRORS | `path/to/file.ts:20-30` | {pattern description} |
| TYPES | `path/to/file.ts:1-10` | {pattern description} |
| TESTS | `path/to/test.ts:1-25` | {pattern description} |

---

## Phase 3: DESIGN

### Align with Project Architecture

Use the Veritasee Override architecture documented in `docs/PRD.md` and `docs/general/SYSTEM-OVERVIEW.md`:

- `apps/web` is the Next.js App Router application.
- `packages` is for shared libraries only when the need is genuinely cross-app or cross-surface.
- v1 should use a single Next.js API surface with managed Postgres, Redis, S3-compatible object storage, managed auth, and a thin AI provider router.
- Browser extension work should remain separate from the web app surface when introduced.
- Do not plan standalone services, public APIs, or alternative infrastructure unless the issue explicitly requires it and the plan documents the tradeoff.

### Map the Changes

- What files need to be created?
- What files need to be modified?
- What's the dependency order?

### Identify Risks

| Risk | Mitigation |
|------|------------|
| {potential issue} | {how to handle} |

---

## Phase 4: GENERATE

### Create Plan File

**Output path**: `.agents/plans/{kebab-case-name}.plan.md`

```bash
mkdir -p .agents/plans
```

```markdown
# Plan: {Feature Name}

## Summary

{One paragraph: What we're building and approach}

## User Story

As a {user type}
I want to {action}
So that {benefit}

## Metadata

| Field | Value |
|-------|-------|
| Type | {type} |
| Complexity | {LOW/MEDIUM/HIGH} |
| Systems Affected | {list} |
| Linear Issue | {issue identifier if available, e.g. LEX-5, or "N/A"} |

---

## Patterns to Follow

### Naming
```
// SOURCE: {file:lines}
{actual code snippet}
```

### Error Handling
```
// SOURCE: {file:lines}
{actual code snippet}
```

### Tests
```
// SOURCE: {file:lines}
{actual code snippet}
```

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `path/to/file.ts` | CREATE | {why} |
| `path/to/other.ts` | UPDATE | {why} |

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: {Description}

- **File**: `path/to/file.ts`
- **Action**: CREATE / UPDATE
- **Implement**: {what to do}
- **Mirror**: `path/to/example.ts:lines` - follow this pattern
- **Validate**: `pnpm run typecheck`

### Task 2: {Description}

- **File**: `path/to/file.ts`
- **Action**: CREATE / UPDATE
- **Implement**: {what to do}
- **Mirror**: `path/to/example.ts:lines`
- **Validate**: `pnpm run typecheck`

{Continue for each task...}

---

## Validation

```bash
# Type check
pnpm run typecheck

# Lint
pnpm run lint

# Build
pnpm run build

# Tests
{test command if configured by the affected package; otherwise document "No test command configured yet"}
```

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] Type check passes
- [ ] Tests pass
- [ ] Follows existing patterns
```

---

## Phase 5: OUTPUT

```markdown
## Plan Created

**File**: `.agents/plans/{name}.plan.md`

**Summary**: {2-3 sentence overview}

**Scope**:
- {N} files to CREATE
- {M} files to UPDATE
- {K} total tasks

**Key Patterns**:
- {Pattern 1 with file:line}
- {Pattern 2 with file:line}

**Next Step**: Review the plan, then implement tasks in order.
```
