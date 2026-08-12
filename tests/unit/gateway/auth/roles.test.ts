import { describe, expect, it } from 'vitest';

import { hasPermission, isRole, Role } from '../../../../src/gateway/auth/roles.js';

describe('hasPermission', () => {
  it('allows Admin to access every role level', () => {
    expect(hasPermission(Role.ADMIN, Role.ADMIN)).toBe(true);
    expect(hasPermission(Role.ADMIN, Role.MANAGER)).toBe(true);
    expect(hasPermission(Role.ADMIN, Role.VIEWER)).toBe(true);
    expect(hasPermission(Role.ADMIN, Role.PUBLIC)).toBe(true);
  });

  it('allows Manager to access Manager and Viewer routes but not Admin routes', () => {
    expect(hasPermission(Role.MANAGER, Role.MANAGER)).toBe(true);
    expect(hasPermission(Role.MANAGER, Role.VIEWER)).toBe(true);
    expect(hasPermission(Role.MANAGER, Role.ADMIN)).toBe(false);
  });

  it('denies Viewer access to Manager or Admin routes', () => {
    expect(hasPermission(Role.VIEWER, Role.VIEWER)).toBe(true);
    expect(hasPermission(Role.VIEWER, Role.MANAGER)).toBe(false);
    expect(hasPermission(Role.VIEWER, Role.ADMIN)).toBe(false);
  });

  it('every role satisfies a PUBLIC requirement', () => {
    expect(hasPermission(Role.VIEWER, Role.PUBLIC)).toBe(true);
  });
});

describe('isRole', () => {
  it('accepts every defined role', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('manager')).toBe(true);
    expect(isRole('viewer')).toBe(true);
    expect(isRole('public')).toBe(true);
  });

  it('rejects an unrecognized role string (edge case)', () => {
    expect(isRole('Admin')).toBe(false);
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
  });
});
