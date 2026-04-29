---
description: Prime agent with codebase understanding
argument-hint: [linear-issues] [confluence-pages]
---

# Prime: Load Project Context

**Input**: $ARGUMENTS

## Objective

Build comprehensive understanding of this codebase by analyzing structure and key files.

## Process

### Step 0: Load External Context (if provided)

The first argument is an optional Linear issue identifier or comma-separated list of identifiers (e.g., `LEX-5` or `LEX-5,LEX-6,LEX-7`). The second argument is an optional Confluence page ID or comma-separated list of IDs (e.g., `123456` or `123456,789012`).

If Linear issues are provided:
1. Use Claude Code's Linear MCP integration to fetch each issue, such as with `get_issue`
2. Extract the issue title, description, acceptance criteria, labels, priority, project, and current state
3. Use this context to inform your understanding of what work is expected
4. Use Linear MCP for all issue manipulation in this project

If Confluence page IDs are provided:
1. Call `mcp__atlassian__getAccessibleAtlassianResources` to get the `cloudId`
2. For each page ID, call `mcp__atlassian__getConfluencePage` with `contentFormat: "markdown"` to fetch the page content
3. Use this context as additional background for understanding the project

### Step 1: Analyze the Codebase

1. Read `CLAUDE.md` and `CODEBASE-GUIDE.md` for project conventions
2. Study the feature slice (`src/features/polls/`)
3. Study the app routes (`src/app/`)
4. Check recent commits with `git log --oneline -5`

## Output

Produce a scannable summary of what you learned:

- **Project Purpose**: One sentence
- **Tech Stack**
  - Frontend: framework, UI library, state management
  - Backend: framework, database, validation
- **Data Model**: Core entities
- **Key Patterns**: Database, API, state management patterns
- **Current State**: Recent commits, current branch

Use bullet points. Keep it concise.
