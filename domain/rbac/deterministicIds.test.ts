import { describe, it, expect } from 'vitest';
import { customRolePermissionId, defaultRolePermissionFixtureId } from './deterministicIds';

describe('customRolePermissionId (Phase 38)', () => {
  it('is deterministic for the same (roleId, permissionKey)', () => {
    expect(customRolePermissionId('role-abc', 'case.read')).toBe(customRolePermissionId('role-abc', 'case.read'));
  });

  it('differs for different roleIds or different permission keys (no cross-grant collision)', () => {
    const a = customRolePermissionId('role-abc', 'case.read');
    const b = customRolePermissionId('role-xyz', 'case.read');
    const c = customRolePermissionId('role-abc', 'case.update');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('stays within Wix\'s 128-char _id cap even for a long roleId', () => {
    const longRoleId = 'role-' + 'x'.repeat(400);
    const id = customRolePermissionId(longRoleId, 'document.template.manage');
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('uses the readable form for a normal UUID-shaped custom role id', () => {
    const id = customRolePermissionId('550e8400-e29b-41d4-a716-446655440000', 'merchandise.manage');
    expect(id).toBe('rolepermission-550e8400-e29b-41d4-a716-446655440000-merchandise.manage');
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('a custom-grant id never collides with a platform-default grant id', () => {
    // Default grants key on the role *key* (e.g. "administrator"); custom
    // grants key on the role *id* (a UUID), so their id spaces are disjoint.
    const defaultId = defaultRolePermissionFixtureId('administrator', 'case.read');
    const customId = customRolePermissionId('550e8400-e29b-41d4-a716-446655440000', 'case.read');
    expect(defaultId).not.toBe(customId);
  });
});
