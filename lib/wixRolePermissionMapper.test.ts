import { describe, it, expect } from 'vitest';
import { mapWixRolePermissionItem, buildWixRolePermissionData } from './wixRolePermissionMapper';
import type { RolePermission } from '../types/rolePermission';

const ROLE_PERMISSION: RolePermission = {
  id: 'rp-1',
  roleId: 'role-1',
  permissionKey: 'case.read',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('wixRolePermissionMapper', () => {
  it('round-trips a valid role-permission grant', () => {
    expect(mapWixRolePermissionItem(buildWixRolePermissionData(ROLE_PERMISSION))).toEqual(ROLE_PERMISSION);
  });

  it('returns null for undefined', () => {
    expect(mapWixRolePermissionItem(undefined)).toBeNull();
  });

  it('returns null for an invalid permissionKey', () => {
    expect(mapWixRolePermissionItem({ ...buildWixRolePermissionData(ROLE_PERMISSION), permissionKey: 'not.real' })).toBeNull();
  });
});
