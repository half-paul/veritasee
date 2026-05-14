// Hostname denylist for the proxy URL validation endpoint.
//
// Lookup is case-insensitive and matches on the exact hostname OR any
// subdomain (a host matches an entry `e` when `host === e` OR `host` ends
// with `.${e}`). The default seed contains cloud-metadata endpoints and
// `localhost`; deployments can extend it via the `URL_DENYLIST_EXTRA`
// environment variable (comma-separated). External feed integration
// (Spamhaus / adult lists) is a separate later issue.

export const DEFAULT_DENYLIST = [
  'localhost',
  'metadata.google.internal',
  'metadata.aws.internal',
  '169.254.169.254',
] as const;

let cached: ReadonlySet<string> | null = null;

export function loadDenylist(): ReadonlySet<string> {
  if (cached) return cached;
  const extras = (process.env.URL_DENYLIST_EXTRA ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const seed = DEFAULT_DENYLIST.map((s) => s.toLowerCase());
  cached = new Set<string>([...seed, ...extras]);
  return cached;
}

// Test/utility hook: clears the memoized set so subsequent calls re-read env.
export function clearDenylistCache(): void {
  cached = null;
}

export function isDenylisted(hostname: string, list: ReadonlySet<string>): boolean {
  const host = hostname.toLowerCase();
  if (list.has(host)) return true;
  for (const entry of list) {
    if (host.endsWith(`.${entry}`)) return true;
  }
  return false;
}
