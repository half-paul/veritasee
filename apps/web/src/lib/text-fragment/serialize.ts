// Serialize a `TextFragmentAnchor` to and from the canonical W3C URL form:
//   :~:text=[prefix-,]textStart[,textEnd][,-suffix]
//
// `,` and `&` are reserved punctuation in the fragment grammar, and `-` is
// the structural separator between prefix/suffix and their adjacent text
// segment. `encodeURIComponent` already escapes `,` and `&`, but not `-`,
// so we additionally percent-encode `-` inside the user-content portions —
// the writer's output is therefore unambiguous: any literal `-` we emit is
// a structural separator, never content.
//
// We hand-roll the parser instead of `URLSearchParams` because the grammar
// uses `,` (not `&`) as the part separator and the leading/trailing `-` is
// positional, not key-based.

import { TEXT_FRAGMENT_PREFIX, type TextFragmentAnchor } from './types';

export function serializeAnchor(anchor: TextFragmentAnchor): string {
  const parts: string[] = [];
  if (anchor.prefix !== undefined && anchor.prefix.length > 0) {
    parts.push(encodeContent(anchor.prefix) + '-');
  }
  parts.push(encodeContent(anchor.textStart));
  if (anchor.textEnd !== undefined && anchor.textEnd.length > 0) {
    parts.push(encodeContent(anchor.textEnd));
  }
  if (anchor.suffix !== undefined && anchor.suffix.length > 0) {
    parts.push('-' + encodeContent(anchor.suffix));
  }
  return TEXT_FRAGMENT_PREFIX + parts.join(',');
}

export function parseAnchor(fragment: string): TextFragmentAnchor | null {
  const stripped = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!stripped.startsWith(TEXT_FRAGMENT_PREFIX)) return null;
  const body = stripped.slice(TEXT_FRAGMENT_PREFIX.length);
  if (body.length === 0) return null;

  const segments = body.split(',');
  if (segments.length < 1 || segments.length > 4) return null;

  let prefix: string | undefined;
  let suffix: string | undefined;
  const textSegments: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isFirst = i === 0;
    const isLast = i === segments.length - 1;
    const multi = segments.length > 1;

    if (isFirst && multi && seg.endsWith('-')) {
      const decoded = safeDecode(seg.slice(0, -1));
      if (decoded === null) return null;
      prefix = decoded;
    } else if (isLast && multi && seg.startsWith('-')) {
      const decoded = safeDecode(seg.slice(1));
      if (decoded === null) return null;
      suffix = decoded;
    } else {
      const decoded = safeDecode(seg);
      if (decoded === null) return null;
      textSegments.push(decoded);
    }
  }

  if (textSegments.length === 0 || textSegments.length > 2) return null;
  const textStart = textSegments[0]!;
  if (textStart.length === 0) return null;

  const anchor: TextFragmentAnchor = { textStart };
  if (textSegments.length === 2) {
    const textEnd = textSegments[1]!;
    if (textEnd.length === 0) return null;
    anchor.textEnd = textEnd;
  }
  if (prefix !== undefined && prefix.length > 0) anchor.prefix = prefix;
  if (suffix !== undefined && suffix.length > 0) anchor.suffix = suffix;
  return anchor;
}

function encodeContent(s: string): string {
  return encodeURIComponent(s).replace(/-/g, '%2D');
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
