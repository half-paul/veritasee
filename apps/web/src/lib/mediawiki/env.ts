import {
  MEDIAWIKI_DEFAULT_USER_AGENT,
  MEDIAWIKI_TIMEOUT_DEFAULT_MS,
  MEDIAWIKI_TIMEOUT_MAX_MS,
  MEDIAWIKI_TIMEOUT_MIN_MS,
} from './types';

export function getTimeoutMs(): number {
  const raw = process.env.MEDIAWIKI_API_TIMEOUT_MS;
  if (!raw) return MEDIAWIKI_TIMEOUT_DEFAULT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return MEDIAWIKI_TIMEOUT_DEFAULT_MS;
  if (n < MEDIAWIKI_TIMEOUT_MIN_MS) return MEDIAWIKI_TIMEOUT_MIN_MS;
  if (n > MEDIAWIKI_TIMEOUT_MAX_MS) return MEDIAWIKI_TIMEOUT_MAX_MS;
  return n;
}

export function getUserAgent(): string {
  const raw = process.env.MEDIAWIKI_USER_AGENT;
  return raw && raw.length > 0 ? raw : MEDIAWIKI_DEFAULT_USER_AGENT;
}
