// MediaWiki host table.
//
// Each entry has a registrable hostname suffix (matched case-insensitively
// against the exact host OR any subdomain) and the API endpoint path on
// that host. Wikimedia properties standardize on `/w/api.php`; Citizendium
// runs from `/wiki/api.php`.
//
// Adding a new MediaWiki host is intentionally a one-line PR — surprises in
// this list change the outbound-call security posture and should go through
// code review rather than an env-var flip. To add a host: append its
// registrable suffix and the wiki's `api.php` path.

export type MediaWikiHostEntry = {
  suffix: string;
  apiPath: string;
};

export const MEDIAWIKI_HOSTS: readonly MediaWikiHostEntry[] = [
  { suffix: 'wikipedia.org', apiPath: '/w/api.php' },
  { suffix: 'wiktionary.org', apiPath: '/w/api.php' },
  { suffix: 'wikimedia.org', apiPath: '/w/api.php' },
  { suffix: 'citizendium.org', apiPath: '/wiki/api.php' },
] as const;

export const MEDIAWIKI_HOST_SUFFIXES = MEDIAWIKI_HOSTS.map((h) => h.suffix);
