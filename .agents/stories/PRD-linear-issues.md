# Veritasee Override — Linear Issues

Generated from `docs/PRD.md` (v0.1, 2026-04-28).
Target Linear project: **Veritasee Override** (workspace: lexaim, team: LEX).

Conventions:
- One issue per shippable unit (≤ ~2 days).
- Labels carry area (`frontend`, `backend`, `infra`, `extension`, `ai`, `security`, `docs`).
- Phase tag aligns to PRD §11 rollout (`phase:0-foundation`, `phase:1-mvp`, `phase:1-beta`, `phase:1.1`, `phase:1.2`, `phase:nfr`).
- Priority: H/M/L. Complexity: S/M/L.
- All IDs are placeholders; Linear will assign `LEX-N` on creation.

---

## Phase 0 — Foundation

### [VS-001] Bootstrap Next.js (App Router) + TypeScript + Tailwind
**Phase**: 0-foundation · **Priority**: High · **Complexity**: Small
**Labels**: frontend, infra

**Description**
As a developer, I want a baseline Next.js app with TS and Tailwind so feature work can start on a consistent foundation.

**Acceptance Criteria**
- [ ] Given a fresh clone, when I run `pnpm install && pnpm dev`, then a hello-world page renders at `/`.
- [ ] Given the repo, when I run `pnpm typecheck && pnpm lint`, then both pass with zero errors.
- [ ] Given a Tailwind utility on a component, when I render it, then the style applies (verifies Tailwind pipeline).

**Technical Notes**
- App Router, React Server Components default.
- Strict TS, ESLint + Prettier wired.
- Set up `pnpm` workspaces shape even if monorepo is deferred (extension comes later).

**Dependencies**
- Blocks: VS-002, VS-003, VS-004, VS-010+

---

### [VS-002] Choose & integrate managed auth (Clerk vs Auth0)
**Phase**: 0-foundation · **Priority**: High · **Complexity**: Medium
**Labels**: backend, security

**Description**
As an admin, I want managed auth so contributors and moderators sign in safely without us owning password storage.

**Acceptance Criteria**
- [ ] Given the auth ADR, when reviewed, then the chosen provider, cost model, and migration path are documented.
- [ ] Given a sign-in attempt, when credentials are valid, then a session cookie is issued and `/me` returns the user.
- [ ] Given an unauthenticated user, when hitting a protected route, then they're redirected to sign-in.

**Technical Notes**
- Decision deferred in PRD §12 — produce ADR before code.
- RBAC roles: Reader / Contributor / Moderator / Admin (PRD §3).

**Dependencies**
- Blocks: VS-014 (contributor authoring), VS-040 (moderator queue).

---

### [VS-003] Provision managed Postgres + ORM + initial schema
**Phase**: 0-foundation · **Priority**: High · **Complexity**: Medium
**Labels**: backend, database, infra

**Description**
As a developer, I want a Postgres instance and ORM with the PRD §8 schema scaffolded so feature code can persist data.

**Acceptance Criteria**
- [ ] Given Neon or Supabase, when provisioned, then connection strings are wired through env vars in dev/preview/prod.
- [ ] Given the §8 sketch, when migrated, then `users`, `articles`, `snapshots`, `corrections`, `references`, `ai_runs`, `moderation_decisions`, `reputation_events` exist with FKs.
- [ ] Given `pgvector`, when enabled, then a migration test confirms the extension is loadable (used later for evidence search).

**Technical Notes**
- Use Drizzle or Prisma — pick in this issue's design comment.
- Tables defined per PRD §8; quotas live in Redis, not here.

**Dependencies**
- Blocks: most feature work.

---

### [VS-004] Provision Upstash Redis (region-pinned)
**Phase**: 0-foundation · **Priority**: High · **Complexity**: Small
**Labels**: backend, infra

**Description**
As a developer, I want Redis available for caches and quotas so we can implement PRD §5.5 quotas and §5.1 proxy cache.

**Acceptance Criteria**
- [ ] Given Upstash, when provisioned in EU + US, then a thin client wrapper is exposed in code.
- [ ] Given a smoke test, when run, then SET/GET/EXPIRE work end-to-end.

**Dependencies**
- Blocks: VS-022 (proxy cache), VS-052 (AI quota).

---

### [VS-005] Provision S3-compatible object store
**Phase**: 0-foundation · **Priority**: High · **Complexity**: Small
**Labels**: backend, infra

**Description**
As a developer, I want R2 or S3 buckets for snapshots and reference assets so PRD §14.1 retention can be implemented.

**Acceptance Criteria**
- [ ] Given creds, when calling the SDK, then we can put/get/delete a test object.
- [ ] Given a lifecycle policy, when configured, then unanchored snapshot prefix has 24h expiry.

**Dependencies**
- Blocks: VS-026 (snapshot persistence).

---

### [VS-006] Set up Vercel deployment + preview environments
**Phase**: 0-foundation · **Priority**: High · **Complexity**: Small
**Labels**: infra

**Description**
As a developer, I want PR preview deploys on Vercel so changes are reviewable in a live environment.

**Acceptance Criteria**
- [ ] Given a PR, when opened, then a preview URL is posted as a check.
- [ ] Given main, when merged, then production deploy succeeds.
- [ ] Given env vars, when set per environment, then dev/preview/prod isolation holds.

---

### [VS-007] Logging, error reporting, and metrics baseline
**Phase**: 0-foundation · **Priority**: Medium · **Complexity**: Small
**Labels**: infra, security

**Description**
As an operator, I want structured logs, error capture, and basic latency metrics so we can meet PRD §6 SLOs.

**Acceptance Criteria**
- [ ] Given a thrown error, when it reaches the API boundary, then it's reported (Sentry or equivalent).
- [ ] Given an HTTP request, when handled, then a structured log line includes route, status, latency.
- [ ] Given the read path, when serving requests, then P95 latency is exported as a metric.

---

## Phase 1 — Proxy Viewer (FR-VW)

### [VS-020] URL entry form + scheme/length/denylist validation (FR-VW-1)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Small
**Labels**: frontend, backend, security

**Acceptance Criteria**
- [ ] Given a non-HTTPS URL, when submitted, then the API returns 400 with a clear message.
- [ ] Given a denylisted domain, when submitted, then 403 is returned and the attempt is logged.
- [ ] Given a URL >2048 chars, when submitted, then 400 is returned.
- [ ] Given an internal-IP URL, when submitted, then it is blocked (SSRF guard).

**Technical Notes**
- Denylist sources: project-curated + Spamhaus/Adult feeds (configurable).
- SSRF: resolve host, reject RFC1918/loopback/link-local.

---

### [VS-021] Server-side fetcher with header strip + script sanitize (FR-VW-2)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: backend, security

**Acceptance Criteria**
- [ ] Given a URL with `X-Frame-Options: DENY`, when proxied, then the response strips the header before sending to the client.
- [ ] Given a URL with `Content-Security-Policy: frame-ancestors`, when proxied, then it is removed/rewritten.
- [ ] Given inline `<script>` in source, when proxied, then it is sanitized (DOMPurify or equivalent).
- [ ] Given relative URLs in source, when proxied, then they are rewritten to absolute origin URLs.

---

### [VS-022] Proxy response cache (Redis, 15 min, keyed by url+revision) (FR-VW-2)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Small
**Labels**: backend

**Acceptance Criteria**
- [ ] Given a cache miss, when proxying, then the fetched, sanitized payload is stored with TTL=900s.
- [ ] Given a cache hit, when re-requested within 15 min, then the response is served without origin fetch.
- [ ] Given source revision change, when detected, then cache key invalidates.

**Dependencies**
- Blocked by: VS-004, VS-021.

---

### [VS-023] MediaWiki API integration for clean section structure (FR-VW-3)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: backend

**Acceptance Criteria**
- [ ] Given a Wikipedia URL, when parsed, then sections are extracted via the MediaWiki API with stable IDs.
- [ ] Given Britannica/Citizendium, when matched as MediaWiki-compatible, then API path is used; otherwise fallback path runs.

---

### [VS-024] Generic Readability-style article extractor (FR-VW-3)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: backend

**Acceptance Criteria**
- [ ] Given a non-MediaWiki article, when parsed, then `<article>`/`<main>`/longest-text-density block is selected.
- [ ] Given navigation/footer noise, when parsed, then it is excluded from the main content block.

---

### [VS-025] W3C Text Fragment anchor compute + normalize (FR-VW-5)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: backend, frontend

**Acceptance Criteria**
- [ ] Given a user selection, when finalized, then an anchor `(prefix, start, end, suffix)` is computed and round-trips on re-render.
- [ ] Given two adjacent identical phrases, when anchored, then prefix/suffix uniquely disambiguate.

---

### [VS-026] Snapshot persistence with revision hash + zstd compression (FR-VW-5, §14.1)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: backend, database

**Acceptance Criteria**
- [ ] Given a fetched article, when normalized, then `sha256(normalized_text)` is stored as `revision_hash`.
- [ ] Given an identical revision, when stored again, then the `(article_id, hash)` dedupe key prevents duplicate rows.
- [ ] Given a snapshot blob, when persisted, then it is zstd level-6 compressed in object storage.

**Dependencies**
- Blocked by: VS-005.

---

### [VS-027] Drift detection + "Source has changed" banner + fuzzy re-anchor (FR-VW-5)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: backend, frontend

**Acceptance Criteria**
- [ ] Given a correction whose anchor no longer matches current source, when rendered, then a fuzzy match attempt runs.
- [ ] Given fuzzy match fails, when rendering, then a banner shows "Source has changed since this correction was written" with link to pinned snapshot.
- [ ] Given fuzzy match succeeds with low confidence, when rendering, then a softer "may have shifted" warning appears.

---

### [VS-028] Section click → correction panel (FR-VW-4)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Small
**Labels**: frontend

**Acceptance Criteria**
- [ ] Given a paragraph in the proxy view, when clicked, then a side panel opens with overrides (or "no corrections yet").
- [ ] Given keyboard nav, when tabbing, then sections are focusable in reading order (a11y).

---

### [VS-029] Read-path P95 SLO instrumentation (FR-VW-6, §6)
**Phase**: 1-mvp · **Priority**: Medium · **Complexity**: Small
**Labels**: infra

**Acceptance Criteria**
- [ ] Given proxy traffic, when measured, then P95 cached ≤2.5s and cold ≤5s are emitted as metrics.
- [ ] Given SLO breach, when sustained 10 min, then an alert fires.

---

## Phase 1 — Reader UI

### [VS-030] Verity Score chip rendering on highlighted sections
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Small
**Labels**: frontend

**Acceptance Criteria**
- [ ] Given a section with an approved correction, when rendered, then a chip shows the score and color (red/amber/green bands).
- [ ] Given multiple corrections on one section, when rendered, then the lowest score is shown with a "+N more" affordance.

---

### [VS-031] Correction panel: body, references, AI evidence trail (read-only)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: frontend

**Acceptance Criteria**
- [ ] Given an approved correction, when the panel opens, then body markdown renders with citations.
- [ ] Given references, when listed, then each shows title, author (best-effort), publish date, accessed date.
- [ ] Given AI evidence (if present), when expanded, then supporting/contradicting lists are visible.

---

### [VS-032] Anonymous flag-for-review with IP rate limit
**Phase**: 1-mvp · **Priority**: Medium · **Complexity**: Small
**Labels**: backend, frontend, security

**Acceptance Criteria**
- [ ] Given a reader, when clicking flag, then a reason form posts without auth.
- [ ] Given >5 flags from one IP in 10 min, when posted, then 429 with reset header is returned.

---

### [VS-033] Override read API: GET overrides for `(url, anchor)` (used by extension + reader)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: backend

**Acceptance Criteria**
- [ ] Given a URL and optional anchor, when queried, then approved corrections are returned as JSON.
- [ ] Given the endpoint, when measured, then P95 ≤200ms (PRD §6).
- [ ] Given a malformed URL, when queried, then 400 with reason.

---

## Phase 1 — Browser Extension (read-only, MV3)

### [VS-040] MV3 extension scaffold (Chrome + Firefox)
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: extension

**Acceptance Criteria**
- [ ] Given the unpacked extension, when loaded in Chrome and Firefox, then the icon and popup render.
- [ ] Given a build, when produced, then a signed `.zip` for each store is emitted by CI.

---

### [VS-041] Content script: query override API and inject overlay
**Phase**: 1-mvp · **Priority**: High · **Complexity**: Medium
**Labels**: extension, frontend

**Acceptance Criteria**
- [ ] Given a Wikipedia article in the browser, when the page loads, then the extension calls `/api/overrides` and injects chips on matched sections.
- [ ] Given a click on an injected chip, when triggered, then the correction panel renders inline (Shadow DOM isolation).
- [ ] Given a non-matched site, when loaded, then no UI is injected and no API call fires.

**Dependencies**
- Blocked by: VS-033.

---

### [VS-042] Extension settings: enable/disable per domain, opt-out
**Phase**: 1-mvp · **Priority**: Low · **Complexity**: Small
**Labels**: extension

**Acceptance Criteria**
- [ ] Given a user toggles off `wikipedia.org`, when visiting that domain, then no overlay is injected.

---

## Phase 1 — Closed-Beta Authoring (gated)

### [VS-050] Side-by-side correction editor (FR-CE-1)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Medium
**Labels**: frontend

**Acceptance Criteria**
- [ ] Given a section, when authoring, then source paragraph is read-only on the left and rich-text editor on the right.
- [ ] Given submitted content, when saved, then markdown is the canonical store.
- [ ] Given supported toolbar (bold, italic, blockquote, links, inline citations), when used, then output round-trips.

---

### [VS-051] Verity Score slider + rationale (FR-CE-2)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Small
**Labels**: frontend, backend

**Acceptance Criteria**
- [ ] Given submission, when score is missing or rationale <40 chars, then submit is blocked client-side and server-side.
- [ ] Given a stored correction, when read, then score is per-section, not per-article.

---

### [VS-052] Reference attachment + validation (FR-CE-3)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Medium
**Labels**: frontend, backend

**Acceptance Criteria**
- [ ] Given a URL reference, when added, then the server fetches it (HEAD/GET, 10s timeout) and rejects non-2xx.
- [ ] Given a DOI/ISBN, when added, then it is resolved against an identifier service (CrossRef/OpenLibrary).
- [ ] Given the source article domain, when used as a reference, then it is rejected.
- [ ] Given submit, when zero references attached, then submit is blocked.
- [ ] Given a reference, when stored, then title/author/publish-date/accessed-date are persisted.

---

### [VS-053] Submit state machine: Draft / Submitted / Approved / Rejected / Needs Revision (FR-CE-4)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Small
**Labels**: backend

**Acceptance Criteria**
- [ ] Given any state, when transitioning, then only PRD-allowed edges succeed.
- [ ] Given an audit log, when any state change occurs, then the actor and timestamp are recorded.

---

## Phase 1 — AI Verification Toolset

### [VS-060] Provider abstraction layer (FR-AI-2)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Medium
**Labels**: ai, backend

**Acceptance Criteria**
- [ ] Given a `ProviderClient` interface, when implemented for Anthropic, OpenAI, Gemini, OpenRouter, then each passes a shared contract test.
- [ ] Given a config, when toggling provider, then the editor's Verify call routes accordingly with no UI change.

---

### [VS-061] Anthropic Claude adapter (default) with web search + tool use (FR-AI-2)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Medium
**Labels**: ai, backend

**Acceptance Criteria**
- [ ] Given a verify request, when run, then web search and tool use are exercised and evidence is returned.
- [ ] Given a tool error, when raised, then it is logged and surfaced as a non-blocking warning to the user.

---

### [VS-062] "Verify with AI" editor action: supporting + contradicting + synthesis (FR-AI-1)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Medium
**Labels**: ai, frontend

**Acceptance Criteria**
- [ ] Given the editor, when clicking Verify, then supporting evidence list is rendered with source/snippet/relevance.
- [ ] Given the same call, when complete, then contradicting evidence list renders.
- [ ] Given synthesis, when present, then it is clearly labeled "AI-generated — must be edited before submit."

---

### [VS-063] AI-publishes-nothing enforcement (FR-AI-4)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Small
**Labels**: ai, frontend, backend

**Acceptance Criteria**
- [ ] Given AI-staged content, when unedited, then the submit button is disabled.
- [ ] Given the "I have reviewed and edited" checkbox, when ticked, then submit enables.
- [ ] Given the server, when receiving a submit, then it independently checks the edit-distance from the staged AI content and rejects if zero.

---

### [VS-064] Cost telemetry per AI call (FR-AI-5)
**Phase**: 1-beta · **Priority**: Medium · **Complexity**: Small
**Labels**: ai, backend

**Acceptance Criteria**
- [ ] Given any AI call, when complete, then `provider`, `model`, `tokens_in`, `tokens_out`, `cost_estimate_usd` are written to `ai_runs`.
- [ ] Given the user, when visiting settings, then their monthly AI spend is visible.

---

### [VS-065] Scenario presets: Fast Check / Academic / Adversarial (FR-AI-3)
**Phase**: 1-beta · **Priority**: Medium · **Complexity**: Medium
**Labels**: ai, backend

**Acceptance Criteria**
- [ ] Given an admin, when configuring presets, then `(provider, model, retrieval, prompt)` is stored.
- [ ] Given a user with quota, when running Academic preset, then Semantic Scholar / CrossRef tools are invoked.
- [ ] Given Adversarial, when run, then supporting and contradicting passes are separate then reconciled.

---

### [VS-066] BYO key encrypted storage (KMS) per user (FR-AI-2, §6 security)
**Phase**: 1-beta · **Priority**: Medium · **Complexity**: Medium
**Labels**: ai, security, backend

**Acceptance Criteria**
- [ ] Given a user, when entering an API key, then it is encrypted at rest with a KMS-managed key (AES-256).
- [ ] Given decryption, when called, then plaintext is held only in-memory for the call.
- [ ] Given the user, when removing the key, then ciphertext is deleted and a tombstone is logged.

---

### [VS-067] Daily AI quota counter in Redis (FR-LIM-1)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Small
**Labels**: ai, backend

**Acceptance Criteria**
- [ ] Given a deep verify call, when made, then `INCR quota:ai:{user}:{yyyymmdd}` runs with EXPIRE to next UTC midnight.
- [ ] Given >10 deep calls in a UTC day, when attempted, then the API returns 429 with reset time.
- [ ] Given Fast Check, when called, then it tracks against an independent counter (default cap 50).

---

### [VS-068] Quota-aware UI: disabled state + tooltip with reset time (FR-LIM-2)
**Phase**: 1-beta · **Priority**: Medium · **Complexity**: Small
**Labels**: ai, frontend

**Acceptance Criteria**
- [ ] Given quota exhausted, when rendering the editor, then the Verify button is disabled with a tooltip showing reset time.

---

### [VS-069] Admin per-user quota override (FR-LIM-3)
**Phase**: 1-beta · **Priority**: Low · **Complexity**: Small
**Labels**: ai, backend

**Acceptance Criteria**
- [ ] Given an admin form, when raising a user's cap, then it overrides the default in Redis lookup.

---

## Phase 1 — Moderation Queue

### [VS-070] Moderator queue UI: correction + source + references + AI trail (FR-GV-1)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Medium
**Labels**: frontend, backend

**Acceptance Criteria**
- [ ] Given the queue, when a moderator opens an item, then they see source paragraph, proposed correction, references, and any AI evidence.
- [ ] Given pagination, when scrolling, then 20 items per page load with stable ordering.

---

### [VS-071] Moderation decisions: Approve / Reject (reason) / Needs Revision (comment) (FR-GV-2)
**Phase**: 1-beta · **Priority**: High · **Complexity**: Small
**Labels**: backend, frontend

**Acceptance Criteria**
- [ ] Given a decision, when submitted, then `moderation_decisions` row is written with actor, decision, reason/comment, timestamp.
- [ ] Given Reject without reason, when submitted, then validation fails.
- [ ] Given an Admin, when reversing a decision, then the original is preserved and a new audit row is added.

---

## Phase 1.1 — Public Contributor Onboarding

### [VS-080] Open contributor registration
**Phase**: 1.1 · **Priority**: High · **Complexity**: Small
**Labels**: backend, frontend

**Acceptance Criteria**
- [ ] Given the public registration page, when a user signs up, then they receive Contributor role on email-verified.
- [ ] Given an unverified email, when authoring, then submit is blocked.

---

### [VS-081] Reputation event recording (FR-GV-3, §14.2)
**Phase**: 1.1 · **Priority**: High · **Complexity**: Small
**Labels**: backend

**Acceptance Criteria**
- [ ] Given any of the §14.2 events (approve, approve-with-edits, reject, revert, spam, cited-as-primary), when triggered, then a `reputation_events` row is written with the spec'd delta.
- [ ] Given the daily +2/cited cap, when exceeded, then further events stop accruing for that day.

---

### [VS-082] Trust Point computation with 180-day half-life decay (§14.2)
**Phase**: 1.1 · **Priority**: High · **Complexity**: Medium
**Labels**: backend

**Acceptance Criteria**
- [ ] Given a nightly job, when run, then `users.trust_points` is recomputed via `Σ delta × 0.5^((now-t)/180d)`.
- [ ] Given the floor 0, when score would go negative, then it clamps to 0.
- [ ] Given an admin, when changing event deltas or thresholds, then the next nightly run uses new values.

---

### [VS-083] Multi-provider selection in user settings (v1.1 unlock)
**Phase**: 1.1 · **Priority**: Medium · **Complexity**: Small
**Labels**: frontend, ai

**Acceptance Criteria**
- [ ] Given a contributor, when changing their preferred provider in settings, then subsequent verify calls route to that provider.

---

### [VS-084] OpenRouter integration (FR-AI-2)
**Phase**: 1.1 · **Priority**: Medium · **Complexity**: Small
**Labels**: ai, backend

**Acceptance Criteria**
- [ ] Given an OpenRouter key, when configured platform-wide, then verify calls route through it for users without BYO.
- [ ] Given OpenRouter model IDs, when listed, then admin can pin per-scenario model choices.

---

## Phase 1.2 — Reputation-Driven Governance

### [VS-090] Topic classification job (LLM, cached per `(article, revision)`) (§14.3)
**Phase**: 1.2 · **Priority**: High · **Complexity**: Medium
**Labels**: ai, backend

**Acceptance Criteria**
- [ ] Given a new snapshot, when stored, then a classification job tags it with up to 3 of the 14 seed topics.
- [ ] Given an existing tag for the same revision, when re-requested, then the cache returns without re-running.
- [ ] Given a topic rename in admin UI, when triggered, then a one-shot reclassification job runs.

---

### [VS-091] Topic-scoped moderator routing (FR-GV-5)
**Phase**: 1.2 · **Priority**: Medium · **Complexity**: Medium
**Labels**: backend

**Acceptance Criteria**
- [ ] Given moderators tagged with topics, when items enter the queue, then routing prefers topic matches.
- [ ] Given no topic-matched moderator available, when older than 24h, then item escalates to global queue.

---

### [VS-092] Auto-approval rules + 24h challenge window (FR-GV-4)
**Phase**: 1.2 · **Priority**: High · **Complexity**: Medium
**Labels**: backend

**Acceptance Criteria**
- [ ] Given a contributor with TP ≥ T1 (150), when submitting a minor edit (same section, ≤20% score delta, no reference removal), then the edit auto-publishes.
- [ ] Given TP ≥ T2 (600) and topic scope match, when submitting any edit, then it auto-publishes.
- [ ] Given an auto-approved edit, when within 24h, then any moderator may revert; revert triggers the −15 reputation event.

---

### [VS-093] Peer-vote unlock for approval
**Phase**: 1.2 · **Priority**: Low · **Complexity**: Medium
**Labels**: backend, frontend

**Acceptance Criteria**
- [ ] Given a draft below auto-approve thresholds, when 3 peers above T1 endorse it, then it routes to a fast-track moderator queue.

---

### [VS-094] Snapshot retention enforcement job (§14.1)
**Phase**: 1.2 · **Priority**: Medium · **Complexity**: Medium
**Labels**: backend, infra

**Acceptance Criteria**
- [ ] Given anchored snapshots, when scanned, then they are retained indefinitely.
- [ ] Given unanchored snapshots, when older than 24h in warm cache, then they are evicted.
- [ ] Given soft-deleted corrections, when 90 days elapse with no other reference, then their anchor snapshot becomes evictable.
- [ ] Given storage usage, when ≥80% of 200GB budget, then an alert fires; ≥100% switches to text-only snapshots for new captures.

---

## Cross-Cutting NFR

### [VS-100] CSP, security headers, and OWASP Top 10 baseline
**Phase**: nfr · **Priority**: High · **Complexity**: Small
**Labels**: security

**Acceptance Criteria**
- [ ] Given any response, when inspected, then CSP, HSTS, X-Content-Type-Options, Referrer-Policy are set.
- [ ] Given OWASP Top 10 checklist, when audited pre-launch, then findings are zero P1/P2 open.

---

### [VS-101] WCAG 2.2 AA audit for reader + editor
**Phase**: nfr · **Priority**: High · **Complexity**: Medium
**Labels**: frontend

**Acceptance Criteria**
- [ ] Given axe-core CI runs, when executed on key pages, then there are zero serious/critical violations.
- [ ] Given keyboard-only nav, when used through reader and editor flows, then all actions are reachable.

---

### [VS-102] i18n string externalization (English-only at launch)
**Phase**: nfr · **Priority**: Low · **Complexity**: Small
**Labels**: frontend

**Acceptance Criteria**
- [ ] Given UI strings, when authored, then they live in a single locale catalogue rather than inline.

---

### [VS-103] Data residency: EU/US region pinning at signup
**Phase**: nfr · **Priority**: Medium · **Complexity**: Medium
**Labels**: backend, infra

**Acceptance Criteria**
- [ ] Given a new user, when signing up, then they choose EU or US and PII writes are routed to that region.
- [ ] Given a region, when running, then DB and Redis reside in the matching region.

---

### [VS-104] SLO dashboards (queue depth, decision time, AI latency)
**Phase**: nfr · **Priority**: Medium · **Complexity**: Small
**Labels**: infra

**Acceptance Criteria**
- [ ] Given the dashboard, when opened, then moderation queue depth, median draft→decision time, and AI P95 are live.
- [ ] Given queue depth ≥ N (admin-set), when sustained, then an alert fires.

---

## Validation Coverage Matrix (PRD → Issues)

| PRD ref | Issue(s) |
|---|---|
| §3 RBAC | VS-002 |
| FR-VW-1 | VS-020 |
| FR-VW-2 | VS-021, VS-022, VS-040–042 |
| FR-VW-3 | VS-023, VS-024 |
| FR-VW-4 | VS-028 |
| FR-VW-5 | VS-025, VS-026, VS-027 |
| FR-VW-6 | VS-029 |
| FR-CE-1..4 | VS-050–053 |
| FR-AI-1..5 | VS-060–066 |
| FR-GV-1..5 | VS-070, VS-071, VS-081–082, VS-091–094 |
| FR-LIM-1..3 | VS-067–069 |
| §6 NFR | VS-029, VS-100–104 |
| §8 schema | VS-003 |
| §14.1 retention | VS-026, VS-094 |
| §14.2 trust points | VS-081, VS-082, VS-092 |
| §14.3 taxonomy | VS-090 |

---

## Notes

- "Public API" (PRD §13) is explicitly deferred — no issues created.
- Mobile-native, monetization, and real-time collab are non-goals — no issues.
- Issues are sized for ≤2 days; anything that drifts larger should split before pickup.
