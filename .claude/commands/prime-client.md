---
description: Prime agent with client/frontend codebase understanding
argument-hint: [linear-issues] [confluence-pages]
---

# Prime Client: Load Frontend Context

**Input**: $ARGUMENTS

## Objective

Build comprehensive understanding of the client codebase by analyzing structure and key files.

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

1. Study the app routes (`src/app/`) — pages, layouts, loading/error boundaries
2. Study the feature components (`src/features/polls/components/`)
3. Study the shared UI primitives (`src/components/ui/`)
4. Check `package.json` for frontend dependencies

## Output

Produce a scannable summary of what you learned:

- **Purpose**: What the UI does
- **Tech Stack**: Next.js App Router, shadcn/ui, Tailwind 4
- **Components**: Key components and their responsibilities
- **Data Flow**: Server Components fetch data directly; Client Components use Server Actions for mutations
- **Patterns**: Server vs Client component split, how forms use Server Actions with `useActionState`

Use bullet points. Keep it concise.
