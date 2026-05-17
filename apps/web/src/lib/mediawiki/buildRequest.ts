import type { MediaWikiSource } from '@/lib/source-classifier';
import { getUserAgent } from './env';

export type MediaWikiRequest = {
  url: string;
  headers: Record<string, string>;
};

// Single `action=parse` call: returns sections, full HTML, revision id, and
// displaytitle. `formatversion=2` pins to the stable v2 response shape;
// `redirects=1` follows server-side page renames.
export function buildMediaWikiRequest(source: MediaWikiSource): MediaWikiRequest {
  const params = new URLSearchParams({
    action: 'parse',
    page: source.pageTitle,
    prop: 'sections|text|revid|displaytitle',
    format: 'json',
    formatversion: '2',
    redirects: '1',
  });
  return {
    url: `${source.apiEndpoint}?${params.toString()}`,
    headers: {
      Accept: 'application/json',
      'User-Agent': getUserAgent(),
    },
  };
}
