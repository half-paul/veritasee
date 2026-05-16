export const PROXY_CACHE_TTL_SECONDS = 900;

export const MAX_PAYLOAD_BYTES = 950_000;

export type CachedProxyResponse = {
  url: string;
  /** sha256(normalized_text) of the source page — anchors drift detection per PRD §FR-VW-5. */
  revisionHash: string;
  fetchedAt: string;
  payload: string;
  contentType?: string;
};
