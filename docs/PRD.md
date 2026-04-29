# Veritasee Override — Product Requirements Document

**Version:** 0.1 (Draft)
**Date:** 2026-04-28
**Owner:** Paul
**Status:** Initial draft pending stakeholder review

---

## 1. Executive Summary

Veritasee Override is a community-governed correction overlay for online encyclopedias (Wikipedia, Britannica, Citizendium, and arbitrary article-shaped pages). Humans author corrections and a granular **Verity Score** (0–100%) for individual sections of source articles; AI tooling assists with evidence gathering but does not author published content. Approved corrections are surfaced to readers via a proxy viewer and an optional browser extension overlay.

**Strategic frame:** humans hold the pen; AI is a research instrument. Governance is staged — moderator review at launch, reputation-weighted auto-approval as the contributor base matures.

---

## 2. Goals & Non-Goals

### 2.1 Goals
- Let any reader see a community-vetted Verity Score and corrections layered on top of an encyclopedia article.
- Give contributors a low-friction authoring surface with AI-assisted evidence retrieval.
- Make moderation scale from a hand-curated queue to a reputation-weighted network without re-architecting.
- Ship a Reader-first MVP that proves demand before investing in heavy contributor tooling.

### 2.2 Non-Goals (v1)
- Hosting original encyclopedia content (we overlay, we do not republish).
- Real-time collaborative editing of corrections.
- Mobile-native apps (responsive web only at launch).
- A public REST/GraphQL API for third-party clients.
- Monetization features (paid tiers, ads, sponsorships).

---

## 3. Target Users & Roles (RBAC)

| Role | Auth | Capabilities |
| :--- | :--- | :--- |
| **Reader** | Anonymous | View overrides, Verity Scores, sources. Submit "report inaccuracy" flags (rate-limited by IP). |
| **Contributor** | Required | Author corrections, attach references, request AI verification, submit drafts. |
| **Moderator** | Granted | Approve/reject drafts, assign topic scopes, demote bad actors. |
| **Admin** | Granted | Manage users, providers, rate limits, taxonomies, platform config. |

---

## 4. MVP Scope (Reader-First)

The v1 release prioritizes the **read path**. Authoring exists in a closed beta for a seed group of contributors so we can populate enough corrections to validate the reader experience.

### v1 (MVP) — public
- Proxy viewer for any pasted URL (server-side fetch + sanitize + rewrite).
- Reader UI: highlighted sections with Verity Score chips, expandable correction panel, source citations.
- Drift banner ("Source has changed since this correction was written").
- Read-only browser extension that injects overrides on the original site.
- Anonymous flag-for-review.
- Auth (Clerk or Auth0) for invited contributors only.

### v1 (MVP) — closed beta (gated)
- Correction editor + AI Verify tool (single provider initially, OpenRouter wired).
- Single moderator queue.
- Reference attachment (≥1 non-encyclopedia primary source required).

### v1.1 — public contributor onboarding
- Open registration for Contributor role.
- Reputation engine activated (Trust Points).
- Multi-provider AI selection in user settings.

### v1.2 — reputation-driven governance
- Auto-approve thresholds for high-rep contributors on minor edits.
- Topic-scoped moderators.
- Peer-vote unlocks for approval.

---

## 5. Functional Requirements

### 5.1 Multi-Source Proxy Viewer

**FR-VW-1 — Universal URL Entry.** The dashboard accepts any HTTP(S) URL. Server validates scheme, length, and against a denylist (malware feeds, adult content, internal IP ranges).

**FR-VW-2 — Hybrid Delivery.**
- **Default (proxy):** Backend fetches the article server-side, strips `X-Frame-Options` / `Content-Security-Policy: frame-ancestors`, rewrites relative URLs, sanitizes scripts, and serves a sandboxed view from our domain. Proxy responses are cached for ≥15 min keyed by `(url, source-revision)`.
- **Power users (extension):** Browser extension injects the override UI directly on the original site by querying our API for `(url, anchor)` matches. No proxy round-trip; preserves source ToS posture.

**FR-VW-3 — Generic Article Detection.** A scraper (Readability-style) identifies the main content block on non-MediaWiki pages. MediaWiki pages use the API for clean section structure; other sites fall back to heuristic block detection (`<article>`, `<main>`, longest text density).

**FR-VW-4 — Section Selection.** Users click any paragraph/section to open the correction panel. Selected ranges are normalized to the anchoring scheme below.

**FR-VW-5 — Anchoring & Versioning.**
- **Primary anchor:** W3C Text Fragments (`prefix-,start,end,-suffix`). Cheap to compute, browser-native, resilient to small edits.
- **Snapshot pin:** Every correction stores the `source_revision_hash` (sha256 of normalized article text) at write time.
- **Drift detection:** On read, recompute hash. If different, attempt fuzzy re-anchor; on failure, render correction with a **"Source has changed"** banner and link to the pinned snapshot.

**FR-VW-6 — Read Latency.** P95 first-paint of proxied article ≤ 2.5 s on a cached source; ≤ 5 s on cold fetch.

### 5.2 Human-Led Correction Engine

**FR-CE-1 — Correction Editor.** Side-by-side: source paragraph (left, read-only) and correction (right, rich text — bold, italics, blockquote, links, inline citations). Markdown stored canonically.

**FR-CE-2 — Verity Score.** Required slider 0–100% with required short rationale (≥40 chars). Score is per-section, not per-article.

**FR-CE-3 — Reference Management.** ≥1 reference required. References must:
- Resolve to a fetchable URL (HTTP 2xx within 10s) or a DOI/ISBN.
- Not be from the same encyclopedia domain as the source article.
- Carry metadata: title, author (best-effort), publish date, accessed date.

**FR-CE-4 — Submit States.** `Draft` → `Submitted` → (`Approved` | `Rejected` | `Needs Revision`).

### 5.3 AI Verification Toolset (Agent-on-Demand)

**FR-AI-1 — "Verify with AI" Action.** Available inside the editor. Returns:
- Supporting evidence list (source, snippet, relevance score).
- Contradicting evidence list.
- Optional one-paragraph synthesis (clearly labeled AI-generated; must be human-edited before submission).

**FR-AI-2 — Provider Abstraction.** A pluggable provider layer with first-class support for:
- **Anthropic Claude** (default; web search + tool use).
- **OpenAI**.
- **Google Gemini**.
- **OpenRouter** (single key → many models; recommended for cost-sensitive deployments).
- **BYO key** per user (stored encrypted; overrides platform default for that user's calls).

Provider, model, and budget are configurable platform-wide (admin) and per-user (settings).

**FR-AI-3 — Scenario Presets.** Admin-defined verification scenarios bundle (provider, model, retrieval strategy, prompt template). Initial presets:
- *Fast Check* — small model, single web pass.
- *Academic* — adds Semantic Scholar / CrossRef tool calls.
- *Adversarial* — runs supporting and contradicting passes separately, reconciles.

**FR-AI-4 — AI Never Publishes.** AI output is staged into the editor; the human must edit and explicitly check "I have reviewed and edited this content" before submit is enabled.

**FR-AI-5 — Cost Telemetry.** Each AI call records `provider`, `model`, `tokens_in`, `tokens_out`, `cost_estimate_usd` against the user and the correction.

### 5.4 Content Governance

**FR-GV-1 — Moderation Queue (v1).** Single global queue. Moderators see correction, source, references, AI evidence trail.

**FR-GV-2 — Decisions.** `Approve`, `Reject (with reason)`, `Needs Revision (with comment)`. All decisions are auditable and reversible by Admin.

**FR-GV-3 — Reputation Engine (v1.1).** Trust Points awarded on approval, deducted on rejection. Score formula and decay are admin-configurable.

**FR-GV-4 — Auto-Approval (v1.2).** Contributors above threshold T1 may auto-publish minor edits (defined as: same section, ≤20% Verity Score delta, no reference removal). Above T2, auto-publish on any edit they're topically scoped to. All auto-approvals enter a 24h challenge window during which any moderator can revert.

**FR-GV-5 — Topic Scopes (v1.2).** Moderators are tagged with topics (history, science, politics, etc.). Article topic is detected via the scraper (LLM classification cached per article). Routing prefers topic-matched moderators.

### 5.5 Usage Limits

**FR-LIM-1 — Background Analysis Quota.** 10 deep AI verifications per user per UTC day. Tracked via Redis counter `quota:ai:{user_id}:{yyyymmdd}` with `EXPIRE` to next UTC midnight.

**FR-LIM-2 — Disabled UI State.** When quota is hit, "Verify with AI" renders disabled with tooltip showing reset time. Quota applies to the *deep* scenario; *Fast Check* may have a higher independent quota (TBD, default 50/day).

**FR-LIM-3 — Admin Overrides.** Admins can raise per-user quotas (e.g., for trusted researchers).

---

## 6. Non-Functional Requirements

| Area | Target |
| :--- | :--- |
| **Availability** | 99.5% monthly for read path; 99.0% for AI verify (provider-bounded). |
| **Read P95 latency** | ≤ 2.5s cached, ≤ 5s cold (proxy); ≤ 200ms for extension API lookup. |
| **AI call P95** | ≤ 12s for Fast Check; ≤ 45s for Academic. |
| **Data residency** | EU + US regions; user choice at signup. |
| **Accessibility** | WCAG 2.2 AA for reader and editor surfaces. |
| **i18n** | English at launch; UI strings externalized for later locales. |
| **Security** | OWASP Top 10 baseline; CSP on proxied content; tenant isolation for BYO keys (AES-256 at rest, KMS-managed). |

---

## 7. Architecture (High Level)

```
┌────────────────────┐    ┌────────────────────┐
│ Browser Extension  │    │  Web App (Next.js) │
│ (overlay injector) │    │  Reader + Editor   │
└─────────┬──────────┘    └─────────┬──────────┘
          │                         │
          │   ┌─────────────────────▼─────────────────┐
          └──▶│  API Gateway (Auth via Clerk/Auth0)  │
              └────┬─────────┬─────────┬──────────────┘
                   │         │         │
              ┌────▼───┐ ┌───▼────┐ ┌──▼──────────┐
              │ Proxy  │ │Override│ │ AI Provider │
              │Service │ │  API   │ │   Router    │
              └────┬───┘ └───┬────┘ └──┬──────────┘
                   │         │         │
                   ▼         ▼         ▼
              ┌────────────────────────────────┐
              │ Postgres (corrections, users,  │
              │ reputation, snapshots)         │
              │ Redis (quotas, cache)          │
              │ Object store (snapshots, refs) │
              └────────────────────────────────┘
```

**Stack assumptions:**
- Frontend: Next.js (App Router) + TypeScript + Tailwind.
- Backend: Single Next.js API surface for v1; extract services only if a workload demands it.
- DB: Managed Postgres (Neon or Supabase) with `pgvector` for evidence semantic search later.
- Cache/quota: Upstash Redis (serverless, region-pinned).
- Object store: S3-compatible (Cloudflare R2 or AWS S3) for snapshots and reference assets.
- Auth: Clerk or Auth0 (managed).
- AI Router: thin abstraction over Anthropic / OpenAI / Gemini / OpenRouter SDKs.
- Hosting: **Vercel** for the Next.js app. Long-running AI scenarios (Academic, Adversarial) run as background functions/queue workers to stay within Vercel function limits.
- Extension: WebExtension Manifest V3 (Chrome + Firefox).

---

## 8. Data Model (Sketch)

- `users(id, role, trust_points, byok_provider, byok_key_encrypted, ...)`
- `articles(id, source_url, source_domain, current_revision_hash, topic_tags[], last_fetched_at)`
- `snapshots(id, article_id, revision_hash, content, fetched_at)`
- `corrections(id, article_id, snapshot_id, anchor_text_fragment, anchor_prefix, anchor_suffix, body_md, verity_score, rationale, status, author_id, created_at)`
- `references(id, correction_id, url_or_identifier, title, author, published_at, accessed_at)`
- `ai_runs(id, correction_id, provider, model, scenario, tokens_in, tokens_out, cost_usd, evidence_json, created_at)`
- `moderation_decisions(id, correction_id, moderator_id, decision, reason, created_at)`
- `reputation_events(id, user_id, delta, reason, correction_id, created_at)`
- `quotas` lives in Redis, not Postgres.

---

## 9. Key Risks & Open Questions

| Risk | Mitigation |
| :--- | :--- |
| **Legal/ToS** of proxying third-party encyclopedias | Pre-launch legal review; respect `robots.txt`; honor takedown requests; extension path as fallback if proxy must be restricted. |
| **Source drift breaks anchors** | Versioned snapshots + fuzzy re-anchor + drift banner (already specified). |
| **Sybil attacks on reputation** | Managed auth + email verification + rate limits at v1.1; consider phone/MFA gate before enabling auto-approve at v1.2. |
| **AI cost overruns** | Per-user quotas, per-platform monthly cap, OpenRouter for cheap routing, BYO key for power users. |
| **Moderator burnout / queue backlog** | Reputation engine path is the explicit pressure release; SLA dashboards from day one. |
| **Misinformation laundering via Veritasee** | Reference requirements, Verity Score rationale, audit trail, Admin reversal. |

### Resolved (see §14 Operational Policies)
1. ✅ Snapshot retention — bounded, compressed, anchored-to-corrections.
2. ✅ Trust Point formula — additive deltas with exponential decay.
3. ✅ Topic taxonomy — curated seed list + LLM classification.
4. Public API design and timeline (deferred until after v1.2 — see §13).

---

## 10. Success Metrics

**Reader-first MVP (v1):**
- ≥ 1,000 unique readers / week within 8 weeks of launch.
- ≥ 60% of proxied article views render at least one approved override.
- Reader NPS ≥ 30.

**Contributor expansion (v1.1):**
- ≥ 100 active contributors / month.
- Median draft → decision time ≤ 48h.
- ≥ 70% of submissions approved or revised (not rejected outright) — proxy for submission quality.

**Governance maturity (v1.2):**
- ≥ 25% of approved corrections via reputation auto-approval.
- < 2% auto-approval reversal rate within the 24h challenge window.

---

## 11. Rollout Plan

1. **Weeks 1–4:** Proxy + reader UI + extension read-only + invited-contributor authoring + single AI provider.
2. **Weeks 5–8:** Closed beta seeds 200–500 corrections across Wikipedia, Britannica, Citizendium.
3. **Week 9:** Public reader launch.
4. **Weeks 10–14:** Open contributor registration, reputation engine on, OpenRouter + multi-provider live.
5. **Weeks 15+:** Topic moderators, auto-approval, peer voting.

---

## 12. Decisions Locked in This PRD

- **Viewer:** Hybrid proxy + browser extension.
- **Anchoring:** W3C Text Fragments + versioned snapshots + drift banner.
- **AI providers:** Multi-provider with scenarios; OpenRouter included; BYO key supported.
- **Moderation:** Hybrid — single queue at v1, reputation-weighted auto-approval at v1.2.
- **MVP shape:** Reader-first; contributor authoring in closed beta during v1.
- **Auth:** Managed (Clerk or Auth0); final pick deferred to implementation.
- **Hosting:** Vercel (Next.js) + managed Postgres (Neon or Supabase) + Upstash Redis + S3-compatible object store.
- **Public API:** Out of scope through v1.2. Internal API only; revisit after governance maturity metrics are met.

---

## 13. Public API — Deferred

A public API is **not** in scope for v1, v1.1, or v1.2. Rationale:

- Schema for `corrections`, `references`, and reputation events will churn through the first three releases.
- Abuse-surface modeling (rate limits, auth, write-path quotas) needs production traffic data we don't have yet.
- The browser extension already covers the primary "read overrides on third-party sites" use case without exposing a public contract.

**Re-evaluation trigger:** revisit a public read-only API once v1.2 success metrics are met (≥25% auto-approval rate, <2% reversal). Write API decisions follow only after read-API abuse patterns are observed in the wild.

---

## 14. Operational Policies

### 14.1 Snapshot Retention

Article snapshots are cheap (text, zstd-compressed) but unbounded fetches can explode storage. Policy:

- **Anchored snapshots** (referenced by ≥1 correction in any state): **retained indefinitely**. Required to render historical corrections after source drift.
- **Unanchored snapshots** (proxy-cache only, no correction attached): **15-minute hot cache (Redis), 24-hour warm cache (R2/S3), then evicted**.
- **Soft-deleted corrections** still retain their anchor snapshot for **90 days**, then the snapshot becomes eligible for eviction if no other correction references it.
- **Compression:** all stored snapshots use zstd level 6 (typical 4–6× ratio on HTML).
- **Storage budget:** target ≤ 200 GB compressed snapshots through v1.2. Alert at 80%. At budget, switch from full HTML snapshots to text-only normalized snapshots for new captures.
- **Per-source revision dedupe:** snapshots are keyed by `(article_id, sha256(normalized_text))` so identical revisions are stored once.

### 14.2 Trust Point Formula

Goal: simple, gameable-resistant, decays so old reputation doesn't ossify.

**Event deltas:**
| Event | Delta |
| :--- | :--- |
| Correction approved | **+10** |
| Correction approved with edits ("Needs Revision" → resubmitted → approved) | **+6** |
| Correction rejected | **−5** |
| Correction reverted in 24h auto-approval challenge window | **−15** |
| Moderator marks submission as spam/abuse | **−25** |
| Reference cited as primary in another contributor's approved correction | **+2** (max +20/day) |

**Decay:** exponential with **180-day half-life**, applied nightly.
`current_score = Σ (delta_i × 0.5^((now - t_i) / 180_days))`

**Floor:** 0 (cannot go negative — abusive accounts are suspended, not just deranked).

**Thresholds:**
- **T1 = 150** — auto-approve minor edits (per FR-GV-4 definition).
- **T2 = 600** — auto-approve any edit within topic scope.
- **Moderator eligibility floor = 400** (Admin still grants/revokes).

All thresholds and event deltas are admin-configurable; defaults above are the launch values.

### 14.3 Topic Taxonomy

**Approach:** curated seed list + LLM classification against that fixed list. Avoids open-vocabulary drift and Sybil-tagged topics, while not requiring ongoing manual curation per article.

**Seed taxonomy (v1 — 14 top-level topics):**
History · Science · Technology · Medicine & Health · Politics & Government · Law · Economics & Business · Arts & Culture · Religion & Philosophy · Geography · Sports · Biography · Society & Social Issues · Other.

**Classification:**
- Run once per `(article_id, source_revision_hash)`; cached on `articles.topic_tags`.
- Multi-label allowed (max 3 tags per article).
- Cheap model (Haiku-class or OpenRouter equivalent) — input is article title + first 2k chars + section headings.
- Re-classify only on snapshot drift, not on every read.

**Governance:** Admins can add/rename/merge top-level topics through a config UI; renames trigger a one-shot reclassification job. Subtopics are **out of scope through v1.2** — flat taxonomy keeps moderator routing simple.
