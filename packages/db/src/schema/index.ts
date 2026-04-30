export * from './users';
export * from './articles';
export * from './corrections';
export * from './ai';
export * from './moderation';

import * as users from './users';
import * as articles from './articles';
import * as corrections from './corrections';
import * as ai from './ai';
import * as moderation from './moderation';

export const schema = {
  ...users,
  ...articles,
  ...corrections,
  ...ai,
  ...moderation,
};
