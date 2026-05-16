import { MEDIAWIKI_HOSTS, type MediaWikiHostEntry } from './hosts';
import type { SourceClass } from './types';

function matchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function findMediaWikiEntry(host: string): MediaWikiHostEntry | null {
  for (const entry of MEDIAWIKI_HOSTS) {
    if (matchesSuffix(host, entry.suffix)) return entry;
  }
  return null;
}

// MediaWiki article paths are `/wiki/{Title}`. We do not strip namespaces
// for v1 — Talk:, User:, etc. round-trip through the API as part of the
// title and the parser stays unopinionated.
function extractPageTitle(pathname: string): string | null {
  if (!pathname.startsWith('/wiki/')) return null;
  const raw = pathname.slice('/wiki/'.length);
  if (raw.length === 0) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function classifySource(input: string): SourceClass {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { kind: 'generic', hostname: '' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const entry = findMediaWikiEntry(hostname);
  if (entry === null) {
    return { kind: 'generic', hostname };
  }

  const pageTitle = extractPageTitle(parsed.pathname);
  if (pageTitle === null) {
    return { kind: 'generic', hostname };
  }

  return {
    kind: 'mediawiki',
    hostname,
    apiEndpoint: `https://${hostname}${entry.apiPath}`,
    pageTitle,
  };
}
