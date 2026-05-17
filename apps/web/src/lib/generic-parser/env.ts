import {
  GENERIC_PARSER_DEFAULT_USER_AGENT,
  GENERIC_PARSER_MAX_BYTES_DEFAULT,
  GENERIC_PARSER_MAX_BYTES_MAX,
  GENERIC_PARSER_MAX_BYTES_MIN,
  GENERIC_PARSER_TIMEOUT_DEFAULT_MS,
  GENERIC_PARSER_TIMEOUT_MAX_MS,
  GENERIC_PARSER_TIMEOUT_MIN_MS,
} from './types';

export function getTimeoutMs(): number {
  const raw = process.env.GENERIC_PARSER_TIMEOUT_MS;
  if (!raw) return GENERIC_PARSER_TIMEOUT_DEFAULT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return GENERIC_PARSER_TIMEOUT_DEFAULT_MS;
  if (n < GENERIC_PARSER_TIMEOUT_MIN_MS) return GENERIC_PARSER_TIMEOUT_MIN_MS;
  if (n > GENERIC_PARSER_TIMEOUT_MAX_MS) return GENERIC_PARSER_TIMEOUT_MAX_MS;
  return n;
}

export function getUserAgent(): string {
  const raw = process.env.GENERIC_PARSER_USER_AGENT;
  return raw && raw.length > 0 ? raw : GENERIC_PARSER_DEFAULT_USER_AGENT;
}

export function getMaxBytes(): number {
  const raw = process.env.GENERIC_PARSER_MAX_BYTES;
  if (!raw) return GENERIC_PARSER_MAX_BYTES_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return GENERIC_PARSER_MAX_BYTES_DEFAULT;
  if (n < GENERIC_PARSER_MAX_BYTES_MIN) return GENERIC_PARSER_MAX_BYTES_MIN;
  if (n > GENERIC_PARSER_MAX_BYTES_MAX) return GENERIC_PARSER_MAX_BYTES_MAX;
  return n;
}
