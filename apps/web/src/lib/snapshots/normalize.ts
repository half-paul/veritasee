// Shared text normalization for the snapshot revision hash.
//
// Same algorithm as parseGenericArticle.ts:17-19 (stripTags + collapse ws +
// lowercase + trim), generalized over the ParsedArticle discriminated union
// so MediaWiki and generic articles produce the same canonical text when
// they carry the same content.
//
// Lowercasing is intentional: case-only diffs must not register as snapshot
// drift (see .agents/plans/completed/lex-75-text-fragment-anchor.plan.md
// line 117). Do not confuse this with the LEX-75 anchor normalizer — that
// one is deliberately separate.

import type { ParsedArticle } from '@/lib/parser';

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

export function normalizeArticleText(article: ParsedArticle): string {
  const joined = article.sections.map((s) => s.html).join('\n');
  return stripTags(joined).replace(/\s+/g, ' ').toLowerCase().trim();
}
