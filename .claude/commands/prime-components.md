---
description: Learn how to build components in this codebase
argument-hint: [linear-issues] [confluence-pages]
---

# Prime Components: How to Build Components

**Input**: $ARGUMENTS

## Objective

Understand the component patterns used in this codebase so you can build new components correctly.

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

1. Study the UI primitives in `src/components/ui/` (shadcn/ui components)
2. Study `src/lib/utils.ts` for the `cn()` utility
3. Study feature components as examples:
   - `src/features/polls/components/create-poll-form.tsx` — Client Component using Server Action with `useActionState`
   - `src/features/polls/components/vote-form.tsx` — radio form with pending state via `useFormStatus`
   - `src/components/theme-toggle.tsx` — minimal Client Component example

## Output

Produce a scannable summary of what you learned:

- **UI Library**: Available shadcn/ui components and how they're composed
- **Styling**: How Tailwind 4 and `cn()` are used for conditional classes
- **Props Pattern**: How props interfaces are defined (inline types vs exported interfaces)
- **Server vs Client**: Which components are Server Components (default) vs Client Components (`"use client"`)
- **Forms**: How Server Actions + `useActionState` + `useFormStatus` work together for form state

Use bullet points. Keep it concise.
