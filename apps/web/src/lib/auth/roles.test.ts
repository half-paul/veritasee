import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE, resolveRole, type Role } from './roles';

describe('resolveRole', () => {
  const KNOWN_ROLES: Role[] = ['reader', 'contributor', 'moderator', 'admin'];

  it.each(KNOWN_ROLES)('returns %s when claims.metadata.role is the same', (role) => {
    expect(resolveRole({ metadata: { role } })).toBe(role);
  });

  it('returns the default role when claims is null', () => {
    expect(resolveRole(null)).toBe(DEFAULT_ROLE);
  });

  it('returns the default role when claims is undefined', () => {
    expect(resolveRole(undefined)).toBe(DEFAULT_ROLE);
  });

  it('returns the default role when metadata is missing', () => {
    expect(resolveRole({})).toBe(DEFAULT_ROLE);
  });

  it('returns the default role when metadata is not an object', () => {
    expect(resolveRole({ metadata: 'admin' })).toBe(DEFAULT_ROLE);
    expect(resolveRole({ metadata: 42 })).toBe(DEFAULT_ROLE);
  });

  it('returns the default role when role is unknown', () => {
    expect(resolveRole({ metadata: { role: 'superuser' } })).toBe(DEFAULT_ROLE);
  });

  it('does not coerce non-string role values', () => {
    expect(resolveRole({ metadata: { role: 1 } })).toBe(DEFAULT_ROLE);
    expect(resolveRole({ metadata: { role: null } })).toBe(DEFAULT_ROLE);
    expect(resolveRole({ metadata: { role: {} } })).toBe(DEFAULT_ROLE);
  });

  it('is case-sensitive — does not accept "Admin"', () => {
    expect(resolveRole({ metadata: { role: 'Admin' } })).toBe(DEFAULT_ROLE);
  });

  it('default role is contributor (PRD §RBAC default)', () => {
    expect(DEFAULT_ROLE).toBe('contributor');
  });
});
