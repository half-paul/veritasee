import { createHash } from 'node:crypto';

// Hash the URL into the key (rather than inlining it) so a 2 KB URL doesn't
// bloat every Redis key and can't collide with the namespace separator.
const KEY_PREFIX = 'proxy:cache:v1:';

export function proxyCacheKey(normalizedUrl: string): string {
  const digest = createHash('sha256').update(normalizedUrl).digest('hex');
  return `${KEY_PREFIX}${digest}`;
}
