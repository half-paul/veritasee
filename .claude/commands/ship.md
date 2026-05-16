---
description: Commit current changes to the current branch, push to remote, and open a PR
argument-hint: <optional PR title override>
---

# Ship

**Input**: $ARGUMENTS

## Your Mission

Take the working tree from "implementation finished" to "PR open and ready for review":

1. **Commit** the current changes on the current branch.
2. **Push** the branch to the remote (set upstream on first push).
3. **Open a PR** against `main` with a title and body that match the repo's conventions.

This command picks up where `/implement` leaves off — specifically, step 2 of its Next Steps (`Create PR: gh pr create`). After this completes, the next steps will be:

1. Wait for review and merge.
2. After merge, run `/merge-followup {PR_NUMBER}` to move the linked Linear issue to Done.

**Golden Rule**: Never commit on `main`. Never force-push. Never skip hooks (`--no-verify`). If a pre-commit hook fails, fix the underlying issue and create a NEW commit — do not `--amend`.

---

## Phase 1: PRE-FLIGHT

### 1.1 Inspect Git State

Run these in parallel:

```bash
git branch --show-current
git status
git diff --staged
git diff
git log --oneline -10
```

### 1.2 Refuse Unsafe States

| State | Action |
|-------|--------|
| On `main` (or `master`) | STOP: "Refusing to ship from main. Create a feature branch first." |
| No staged or unstaged changes AND no untracked files | STOP: "Nothing to commit." |
| Detached HEAD | STOP: "Detached HEAD — check out a branch first." |
| Untracked files that look like secrets (`.env*`, `*credentials*`, `*.pem`, `*secret*`) | Warn the user, list the files, and require explicit confirmation before staging |

### 1.3 Identify the Linear Issue

Look for a `LEX-N` identifier in this order, stop at the first match:

1. **Branch name** — e.g., `features/LEX-72`, `fix/LEX-12-...`. Match `/[A-Z]+-\d+/`.
2. **Plan metadata** — check `.agents/plans/` and `.agents/plans/completed/` for a plan referencing the current branch; read its `Linear Issue` field.
3. **Implementation report** — check `.agents/reports/` for a recent report tied to this branch.

If none found, proceed without a Linear prefix and note it in the output.

---

## Phase 2: COMMIT

### 2.1 Draft the Commit Message

Match the repo's commit style (see `git log --oneline -10`). Recent examples:

- `LEX-71: URL entry + server-side validation with SSRF guard`
- `LEX-70: observability baseline — Sentry + structured request logs`

Format:

- **Subject line**: `LEX-N: {concise summary of what changed}` (≤ 70 chars). If no Linear ID was resolved, omit the prefix.
- **Body** (optional, only if the change is non-trivial): 1–3 sentences focused on *why*, not *what*. Wrap at 72.
- **Trailer** (required):
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

Base the summary on the actual diff — what files changed, what feature/fix this represents. Prefer the verb that matches the change: `add` for new features, `update` for enhancements, `fix` for bug fixes, `refactor` for structural changes, `docs` for docs-only.

### 2.2 Stage Files

Stage files explicitly by name based on the diff. **Do not** use `git add -A` or `git add .` — that risks pulling in secrets, build artifacts, or unrelated junk.

If untracked files were flagged in 1.2 as possibly sensitive, exclude them unless the user confirmed.

### 2.3 Create the Commit

Pass the message via heredoc to preserve formatting:

```bash
git commit -m "$(cat <<'EOF'
LEX-N: subject line here

Optional body explaining why this change exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**If a pre-commit hook fails:**

1. Read the hook output.
2. Fix the underlying issue (lint error, type error, formatting).
3. Re-stage the fixed files.
4. Create a NEW commit (never `--amend`, because the failed commit never landed).

### 2.4 Verify

```bash
git status
git log --oneline -3
```

Confirm the new commit is on top and the working tree is clean (or only contains files you intentionally left out).

---

## Phase 3: PUSH

### 3.1 Determine Remote Tracking

```bash
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "no-upstream"
```

| Result | Action |
|--------|--------|
| `no-upstream` | `git push -u origin {branch-name}` |
| Existing upstream | `git push` |

### 3.2 Push

Never use `--force` or `--force-with-lease` unless the user explicitly asks. If a non-fast-forward push is rejected, STOP and report — do not force-push to recover.

---

## Phase 4: OPEN PR

### 4.1 Check for Existing PR

```bash
gh pr view --json number,state,url 2>/dev/null
```

| Result | Action |
|--------|--------|
| PR exists and open | Skip creation. Report the existing PR URL. Note that new commits were pushed to it. |
| PR exists and merged/closed | STOP: "A previous PR for this branch is {state}. Open a new branch instead of pushing more commits here." |
| No PR | Proceed to 4.2 |

### 4.2 Diff Against Base

Understand the full scope of the PR, not just the last commit:

```bash
git log main..HEAD --oneline
git diff main...HEAD --stat
```

### 4.3 Draft the PR

- **Title**: If `$ARGUMENTS` is non-empty, use it verbatim. Otherwise derive from the commit history — usually `LEX-N: {summary spanning all commits on the branch}`. Keep under 70 chars.
- **Body**: Use the template below. Pull bullet content from the commits, the implementation report (if present at `.agents/reports/{plan-name}-report.md`), and the diff stat.

```markdown
## Summary

- {1–3 bullets describing what shipped}

## Linear

{LEX-N link, or "No linked issue."}

## Test plan

- [ ] {Bulleted checklist of how a reviewer should verify this — derive from the implementation report's E2E section if available}

## Notes

{Deviations, follow-ups, or "None" — pull from the implementation report if it exists.}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### 4.4 Create the PR

Pass the body via heredoc:

```bash
gh pr create --base main --title "..." --body "$(cat <<'EOF'
...body...
EOF
)"
```

Capture the returned PR URL.

---

## Phase 5: OUTPUT

```markdown
## Ship Complete

**Branch**: `{branch-name}`
**Commit**: `{short-sha}` — {subject}
**PR**: #{N} — {pr-url}
**Linear**: {LEX-N or "no linked issue"}

### Next Steps

1. Wait for review and merge.
2. After merge: `/merge-followup {N}` to move the Linear issue to Done.
```

If a step was skipped (existing PR, no Linear ID, etc.), say so explicitly with the reason.

---

## Handling Failures

| Failure | Action |
|---------|--------|
| On `main` | STOP before staging anything |
| Pre-commit hook fails | Fix the underlying issue, re-stage, create a NEW commit (never `--amend`) |
| Push rejected (non-fast-forward) | STOP, report the conflict — do not force-push |
| `gh pr create` fails | Report the error verbatim; the commit and push already succeeded, so the user just needs to retry PR creation |
| `gh` not authenticated | STOP and tell the user to run `gh auth login` (suggest `! gh auth login` in the prompt) |
