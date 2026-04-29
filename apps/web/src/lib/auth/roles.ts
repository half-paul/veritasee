export type Role = 'reader' | 'contributor' | 'moderator' | 'admin';

export const DEFAULT_ROLE: Role = 'contributor';

type ClaimsLike = { metadata?: { role?: unknown } } | null | undefined;

export function resolveRole(claims: ClaimsLike): Role {
  const r = claims?.metadata?.role;
  if (r === 'admin' || r === 'moderator' || r === 'contributor' || r === 'reader') return r;
  return DEFAULT_ROLE;
}
