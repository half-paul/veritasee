import { createHash } from 'node:crypto';

export const SNAPSHOT_REVISION_PREFIX = 'sha256:';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function revisionHashFor(normalizedText: string): string {
  return `${SNAPSHOT_REVISION_PREFIX}${sha256Hex(normalizedText)}`;
}
