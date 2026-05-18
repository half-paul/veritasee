export { computeAnchor } from './compute';
export type { ComputeAnchorInput } from './compute';
export { locateAnchor, findAllMatches } from './locate';
export { normalizeTextForAnchor, caseFold } from './normalize';
export { serializeAnchor, parseAnchor } from './serialize';
export {
  TEXT_FRAGMENT_PREFIX,
  TEXT_FRAGMENT_MAX_CONTEXT_WORDS,
  TEXT_FRAGMENT_RANGE_THRESHOLD_WORDS,
  TextFragmentError,
} from './types';
export type { TextFragmentAnchor, TextFragmentErrorDetail } from './types';
