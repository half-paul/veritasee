import { getRedis } from '@veritasee/redis';
import { proxyCacheKey } from './keys';
import {
  MAX_PAYLOAD_BYTES,
  PROXY_CACHE_TTL_SECONDS,
  type CachedProxyResponse,
} from './types';

/**
 * Read a cached proxy response. Callers must compare `revisionHash` against
 * the current upstream revision to detect drift, or use {@link getCachedFresh}.
 * Throws on Upstash infra failure — callers should treat thrown errors as a
 * cache miss for serving purposes while still emitting an alert.
 */
export async function getCached(normalizedUrl: string): Promise<CachedProxyResponse | null> {
  const result = await getRedis().get<CachedProxyResponse>(proxyCacheKey(normalizedUrl));
  return result ?? null;
}

/**
 * Store a cached proxy response with TTL = 900s. Returns `false` (without
 * writing) when the payload exceeds {@link MAX_PAYLOAD_BYTES} so the warm
 * tier (R2/S3) can handle oversize blobs. Throws on Upstash infra failure.
 */
export async function setCached(
  normalizedUrl: string,
  entry: CachedProxyResponse,
): Promise<boolean> {
  const bytes = Buffer.byteLength(entry.payload, 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) return false;
  await getRedis().set(proxyCacheKey(normalizedUrl), entry, { ex: PROXY_CACHE_TTL_SECONDS });
  return true;
}

/**
 * Delete the cached entry for a normalized URL. No-op if the key is absent.
 * Throws on Upstash infra failure.
 */
export async function invalidateCached(normalizedUrl: string): Promise<void> {
  await getRedis().del(proxyCacheKey(normalizedUrl));
}

/**
 * Read + revision-check in one call. If `expectedRevisionHash` is supplied
 * and differs from the cached entry, the stale key is invalidated and `null`
 * is returned so the caller falls through to a fresh origin fetch.
 */
export async function getCachedFresh(
  normalizedUrl: string,
  expectedRevisionHash?: string,
): Promise<CachedProxyResponse | null> {
  const cached = await getCached(normalizedUrl);
  if (!cached) return null;
  if (expectedRevisionHash === undefined) return cached;
  if (cached.revisionHash === expectedRevisionHash) return cached;
  await invalidateCached(normalizedUrl);
  return null;
}
