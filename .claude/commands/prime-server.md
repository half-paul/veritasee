---
description: Prime agent with server/backend codebase understanding
argument-hint: [linear-issues] [confluence-pages]
---

# Prime Server: Load Backend Context

**Input**: $ARGUMENTS

## Objective

Build comprehensive understanding of the server codebase by analyzing structure and key files.

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

1. Study the vertical feature slice (`src/features/polls/`) — models, schemas, repository, service, actions
2. Study the database setup (`src/core/database/`) — schema, client, migrations
3. Study the shared utilities (`src/shared/`)
4. Check `package.json` for backend dependencies (Drizzle, better-sqlite3, Zod, Pino)

## Output

Produce a scannable summary of what you learned:

- **Purpose**: What the data layer does
- **Tech Stack**: Next.js Server Actions, Drizzle ORM, SQLite (better-sqlite3), Zod, Pino
- **Data Model**: Core tables (polls, poll_options, votes) and their relationships
- **Patterns**: Vertical slice (models → schemas → repository → service → actions), error classes with HTTP status codes
- **Server Actions**: How mutations flow from UI → action → service → repository

Use bullet points. Keep it concise.
