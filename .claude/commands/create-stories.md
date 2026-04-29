Below is the converted **SKIL.md** adapted for **Linear** (Issues, Teams, Labels). All Jira-specific references have been removed or replaced.

---

# Create Linear Issues from PRD

Generate structured issues from a Product Requirements Document and optionally prepare them for Linear (manual or API import).

**Input**: $ARGUMENTS
Source: 

---

## Phase 1: LOAD

Read the PRD file provided as input. If no path given, look for:

1. `.agents/PRDs/*.prd.md`
2. `PRD.md` at project root
3. Ask the user which PRD to use

Extract:

* User stories already defined in the PRD
* Acceptance criteria from success criteria and requirements
* Implementation phases and their deliverables
* Technical constraints and dependencies

Parse optional flags:

* `--team` or `-t`: Linear team (DevOps, Dev, Support, Security)
* `--label`: Optional tags to apply (e.g., `frontend`, `backend`, `api`)

---

## Phase 2: ANALYZE

### Break Down into Issues

For each feature or requirement:

1. **Create a user story**:

   ```
   As a [user type], I want to [action], so that [benefit]
   ```

2. **Define acceptance criteria** (3–5):

   ```
   Given [context], when [action], then [expected result]
   ```

3. **Estimate complexity**:

   * Small: Single change
   * Medium: Multiple components
   * Large: Cross-system / architecture

4. **Identify dependencies** between issues

---

### Issue Categories (Mapped to Linear)

| Category    | Linear Handling           |
| ----------- | ------------------------- |
| Feature     | Issue + tag `feature`     |
| Enhancement | Issue + tag `enhancement` |
| Bug         | Issue + tag `bug`         |
| Technical   | Issue + tag `technical`   |
| Spike       | Issue + tag `spike`       |

---

## Phase 3: STRUCTURE

### Issue Template

```markdown
## [ISSUE-ID] Title

**Team**: DevOps | Dev | Support | Security  
**Priority**: High | Medium | Low  
**Complexity**: Small | Medium | Large  
**Phase**: (from PRD)  
**Labels**: frontend, backend, api, database, etc.

### Description
As a [user type], I want to [action], so that [benefit].

### Acceptance Criteria
- [ ] Given [context], when [action], then [result]
- [ ] Given [context], when [action], then [result]
- [ ] Given [context], when [action], then [result]

### Technical Notes
- Key implementation details  
- Affected systems/files  
- Patterns or standards to follow  

### Dependencies
- Blocked by: [ISSUE-IDs]  
- Blocks: [ISSUE-IDs]
```

---

### Team Assignment Rules

* **DevOps** → infrastructure, CI/CD, AWS, deployment
* **Dev** → application logic, APIs, frontend/backend
* **Support** → operational fixes, customer-impacting bugs
* **Security** → compliance, vulnerabilities, audits

---

### Ordering

1. Phase
2. Dependencies
3. Priority

---

## Phase 4: VALIDATE

Ensure:

* Every PRD requirement maps to ≥1 issue
* No issue is too large (>1–2 days work)
* Acceptance criteria are testable
* No circular dependencies
* Full SDLC coverage (infra, code, tests, monitoring)
* Each issue is independently deliverable

---

## Phase 5: OUTPUT

Create directory if needed:

```
mkdir -p .agents/stories
```

Save output:

```
.agents/stories/{prd-name}-linear-issues.md
```

---

## Phase 6: LINEAR INTEGRATION (Optional)

If using Linear API:

1. Map fields:

   * `title` → Issue title
   * `description` → Full markdown content
   * `teamId` → DevOps / Dev / Support / Security
   * `labels` → tags
   * `priority` → Linear priority
   * `state` → Backlog

2. Create issues via API or CLI

3. Link dependencies:

   * Use blocking relationships

4. Report created issues:

```markdown
## Linear Issues Created

| ID | Title | Team | Priority |
|----|------|------|----------|
| DEV-1 | Example | Dev | High |

Board: https://linear.app/{workspace}
```

---

## Tips

* Keep issues small (1–2 days max)
* Acceptance criteria must be testable without clarification
* Technical issues still require acceptance criteria
* Include traceability back to PRD
* Use consistent labels across teams

---

## Notes

No native “Epic” requirement in this structure. If needed:

* Use a **label** (e.g., `epic:payments`)
* Or a **parent issue** with linked children

---
