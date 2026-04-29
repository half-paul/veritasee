export type Role = 'reader' | 'contributor' | 'moderator' | 'admin';

export const DEFAULT_ROLE: Role = 'contributor';

type ClaimsLike = { metadata?: unknown } | null | undefined;

export function resolveRole(claims: ClaimsLike): Role {
  const metadata = claims?.metadata;
  const r =
    metadata && typeof metadata === 'object' && 'role' in metadata
      ? (metadata as { role?: unknown }).role
      : undefined;
  if (r === 'admin' || r === 'moderator' || r === 'contributor' || r === 'reader') return r;
  return DEFAULT_ROLE;
}
