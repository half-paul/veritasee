---
description: After a PR is merged, move its linked Linear issue to Done with a summary comment
argument-hint: <pr-number|pr-url> (optional — defaults to current branch's PR)
---

# Merge Followup

**Input**: $ARGUMENTS

## Your Mission

A PR has been merged. Close the loop with Linear:

1. **Verify** the PR is actually merged (not just closed).
2. **Resolve** the linked Linear issue from PR metadata.
3. **Move** the issue to `Done` via Linear MCP.
4. **Comment** on the issue with the merge summary.

**Golden Rule**: Never advance a Linear issue to `Done` unless `gh` confirms the PR is merged. A closed-but-not-merged PR should leave the issue in its current state and post a "PR closed without merge" comment instead.

---

## Phase 1: RESOLVE PR

### Parse Input

| Input | Action |
|-------|--------|
| `123`, `#123` | Treat as PR number |
| `https://github.com/.../pull/123` | Extract PR number from URL |
| Blank | Detect from current branch: `gh pr view --json number,state,mergedAt,merged,title,body,headRefName` |

### Fetch PR Metadata

```bash
gh pr view {NUMBER} --json number,state,merged,mergedAt,mergeCommit,title,body,headRefName,baseRefName,author,url
```

Capture: `number`, `merged`, `mergedAt`, `mergeCommit.oid`, `title`, `body`, `headRefName`, `url`.

### Verify Merge State

| `merged` | Action |
|----------|--------|
| `true` | Proceed to Phase 2 |
| `false` and PR is open | STOP: "PR #{N} is not yet merged. Run /merge-followup again after merge." |
| `false` and PR is closed | Skip status change. Add a `closed-without-merge` comment to the Linear issue (Phase 4) and exit. |

---

## Phase 2: RESOLVE LINEAR ISSUE

### Find the Linear Identifier

For this project, identifiers look like `LEX-N`. Search in this order and stop at the first match:

1. **Branch name** (`headRefName`) — branches usually look like `features/LEX-66` or `fix/LEX-12-...`. Match `/[A-Z]+-\d+/`.
2. **PR title** — commits in this repo prefix the subject with the issue ID (e.g., `LEX-66: provision Upstash Redis...`).
3. **PR body** — search for "LEX-N" or a Linear URL (`linear.app/.../issue/LEX-N`).
4. **Plan file metadata** — look in `.agents/plans/completed/` and `.agents/plans/` for a plan whose Metadata table references the same branch or PR; read its `Linear Issue` row.

If multiple identifiers appear, prefer the one in the branch name. If none are found, STOP and report: `"No Linear issue identifier found in PR #{N} metadata."` Do **not** guess.

### Fetch the Issue

Call the Linear MCP issue read tool, such as `get_issue`, with the resolved identifier.

Confirm:

- The issue exists and the title plausibly matches the PR scope.
- The current state is something `Done` would advance from (typically `In Review` or `In Progress`). If the issue is already `Done` or `Cancelled`, skip Phase 3 and only post the merge comment.

---

## Phase 3: MOVE ISSUE TO DONE

Use Linear MCP status tools, such as `list_issue_statuses` and `save_issue` (or `update_issue`), scoped to the issue's team.

1. Call `list_issue_statuses` for the team to find the `Done` state ID. Match by name (case-insensitive). If the team uses a different completed-state name (e.g., `Completed`, `Shipped`), prefer the state whose `type` is `completed`.
2. Update the issue's `stateId` to the resolved Done-state ID.
3. If the update fails, do **not** retry blindly — surface the error and skip Phase 4's status section.

---

## Phase 4: ADD MERGE COMMENT

Call the Linear MCP comment tool, such as `save_comment`, on the issue. Use real newlines in the markdown body (not literal `\n`).

```markdown
## Merged ✅

**PR**: [#{N}]({pr-url})
**Branch**: `{headRefName}` → `{baseRefName}`
**Merged at**: {mergedAt}
**Merge commit**: `{mergeCommit.oid}`
**Author**: @{author.login}

{1–2 sentence summary of what shipped, derived from the PR title/body}

State transition: {previous-state} → Done
```

If the PR was closed without merge (Phase 1 fallback), post this instead and skip the state change:

```markdown
## PR closed without merge

PR [#{N}]({pr-url}) was closed without merging. Leaving this issue in its current state. Reopen or open a new PR if work should continue.
```

---

## Phase 5: OUTPUT

```markdown
## Merge Followup Complete

**PR**: #{N} ({pr-url})
**Linear Issue**: {LEX-N}
**State transition**: {previous-state} → {new-state}
**Comment posted**: ✅
```

If anything was skipped (no identifier found, PR not merged, issue already Done), say so explicitly in the output and explain why.

---

## Handling Failures

| Failure | Action |
|---------|--------|
| `gh pr view` fails | Report the gh error verbatim; do not touch Linear |
| No Linear ID found | Stop, report which sources you searched, ask the user for the ID |
| Linear MCP read fails | Stop and surface the error; do not post comments |
| `list_issue_statuses` returns no `Done`/`completed` state | Stop; ask the user which state name maps to "done" for this team |
| State update fails | Skip the state change, still post the merge comment, and report both outcomes |
