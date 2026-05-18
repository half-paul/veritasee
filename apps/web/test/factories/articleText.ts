// Test fixtures for the `text-fragment` anchor module. All strings are
// already in the canonical post-`normalizeTextForAnchor` form (single
// spaces between words, no leading/trailing whitespace, no HTML tags,
// original casing preserved) so tests can pass them straight through.

export const SHORT_ARTICLE =
  'Veritasee is a contributor-driven platform that overlays human-verified ' +
  'corrections onto third-party articles without modifying the original sources. ' +
  'Corrections are stored as text-fragment anchors against a snapshotted revision, ' +
  'so a reader can audit the trail from the live page back to the moderation queue. ' +
  'No proprietary CMS, no rewriting upstream content, and no automated publishing.';

// Contains the substring "the cat sat" three times within close range, each
// surrounded by distinguishable context. Used to pin AC #2 of LEX-75:
// adjacent identical phrases must disambiguate via prefix/suffix and locate
// to the *correct* occurrence.
export const ADJACENT_IDENTICAL =
  'Around the quiet house, the cat sat by the window. Then, the cat sat ' +
  'near the door, and finally the cat sat in the kitchen. All three are common.';

// A 5-word phrase repeated 30 times. The disambiguation cap (12 context
// words on each side) is not enough to make any single occurrence unique
// because every window of 24 words on either side is identical to every
// other. Used to assert the `not_disambiguatable` failure mode.
export const HEAVY_REPETITION = Array.from(
  { length: 30 },
  () => 'the alpha bravo charlie delta',
).join(' ');

// ≥5 KB of plain-text paragraphs. Each paragraph begins with a unique
// identifier ("Section N:") so that disambiguating any selection within
// it requires only a handful of context words — the 12-word cap is enough
// to reach the section header from anywhere reasonable inside. This keeps
// the fuzz over LARGE_ARTICLE useful (most selections resolve to a unique
// anchor) without making the corpus pathologically uniform.
export const LARGE_ARTICLE = (() => {
  const themes = [
    'a revision hash pins the snapshot so drift between the live page and the moderation record cannot silently invalidate every correction',
    'source classifiers route MediaWiki hosts to the API path while everything else falls through the generic Readability extractor with a sharp boundary',
    'text fragments encode a tuple of prefix, textStart, textEnd, and suffix that survives small mid-range edits because textEnd is a separator-style anchor',
    'moderation is human-in-the-loop by design where AI may gather evidence but publishing a correction always requires a contributor with an authenticated account',
    'quotas exist at the role tier instead of the request tier because a burst is fine but a sustained flood is what we throttle to protect upstream budgets',
    'snapshots persist to object storage using content-addressed keys and reads go through a thin S3-compatible wrapper that abstracts R2 and AWS uniformly',
    'the proxy viewer reconstructs the article DOM from the snapshot and overlays correction badges anchored by text fragments at render time without mutation',
    'verification flows are governed by a state machine where each transition is reversible until publication and publication itself is permanently audit-logged',
    'observability spans request logs, structured events, and a small dashboard of business metrics that flag governance drift before it propagates to the queue',
    'the parser dispatcher exists so that a single source URL can be normalized, classified, fetched, and reduced to canonical text in one composable pipeline',
    'role permissions are granted by team rather than user, and every grant is journaled so a security review can trace authority for any past action in the system',
    'redis underpins the session and quota counters because the latency budget for an authenticated read is below what Postgres can offer under realistic load',
    'snapshots include both the rendered HTML and the normalized text so that a correction anchored against the normalized form survives small CSS-only changes upstream',
    'the AI router is intentionally thin: it picks a provider, applies a timeout, and surfaces the raw evidence to the moderator without summarizing or auto-publishing',
    'a correction is never displayed inline; it lives in a separate panel anchored to the source span so that the reader can distinguish original text from overlay',
    'the moderation queue prioritizes by source authority, contributor track record, and the apparent severity of the proposed change rather than first-in-first-out',
    'rate limits use a leaky bucket so that the failure mode under abuse is throttling rather than outright denial, which preserves operator visibility into the load',
    'feature flags are scoped to user, team, and environment, and the resolver short-circuits when a higher-priority scope already determines the rollout state',
    'every database migration ships with a backward-compatible read path so that the application can deploy ahead of the schema change without breaking live traffic',
    'the search index is rebuilt lazily and snapshots reference the index revision they were captured against so a corrections list can render even after reindex',
  ];
  const out: string[] = [];
  let length = 0;
  let i = 0;
  while (length < 6000) {
    const theme = themes[i % themes.length]!;
    const paragraph = `Section ${i + 1}: ${theme}.`;
    out.push(paragraph);
    length += paragraph.length + 1;
    i++;
  }
  return out.join(' ');
})();
