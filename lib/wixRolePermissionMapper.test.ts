import { describe, it, expect } from 'vitest';
import {
  mapWixRolePermissionItem,
  buildWixRolePermissionData,
  ROLE_PERMISSION_CREATED_AT_FALLBACK,
} from './wixRolePermissionMapper';
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

  it('returns null for an invalid permissionKey (security-critical: fail closed)', () => {
    expect(mapWixRolePermissionItem({ ...buildWixRolePermissionData(ROLE_PERMISSION), permissionKey: 'not.real' })).toBeNull();
  });

  it('returns null for a stale permissionKey no longer in the catalog (fail closed)', () => {
    // A key that was once valid but has since been removed must not resolve.
    expect(mapWixRolePermissionItem({ ...buildWixRolePermissionData(ROLE_PERMISSION), permissionKey: 'legacy.removed' })).toBeNull();
  });

  it('returns null for a missing/non-string beaconRolePermissionId (fail closed)', () => {
    expect(mapWixRolePermissionItem({ ...buildWixRolePermissionData(ROLE_PERMISSION), beaconRolePermissionId: undefined })).toBeNull();
    expect(mapWixRolePermissionItem({ ...buildWixRolePermissionData(ROLE_PERMISSION), beaconRolePermissionId: 42 })).toBeNull();
  });

  it('returns null for a missing/non-string roleId (fail closed)', () => {
    expect(mapWixRolePermissionItem({ ...buildWixRolePermissionData(ROLE_PERMISSION), roleId: undefined })).toBeNull();
    expect(mapWixRolePermissionItem({ ...buildWixRolePermissionData(ROLE_PERMISSION), roleId: 7 })).toBeNull();
  });

  it('Phase 38: a missing createdAt does NOT drop a valid grant — normalizes to the sentinel', () => {
    const grant = mapWixRolePermissionItem({
      beaconRolePermissionId: 'rp-legacy',
      roleId: 'role-administrator',
      permissionKey: 'merchandise.manage',
      // createdAt absent — the historical live-data defect
    });
    expect(grant).not.toBeNull();
    expect(grant).toEqual({
      id: 'rp-legacy',
      roleId: 'role-administrator',
      permissionKey: 'merchandise.manage',
      createdAt: ROLE_PERMISSION_CREATED_AT_FALLBACK,
    });
  });

  it('Phase 38: a non-string createdAt is normalized, not fatal', () => {
    const grant = mapWixRolePermissionItem({
      beaconRolePermissionId: 'rp-legacy-2',
      roleId: 'role-accounting',
      permissionKey: 'inventory.read',
      createdAt: null,
    });
    expect(grant?.createdAt).toBe(ROLE_PERMISSION_CREATED_AT_FALLBACK);
    expect(grant?.permissionKey).toBe('inventory.read');
  });

  it('preserves a real createdAt when present (sentinel only fills a gap)', () => {
    const grant = mapWixRolePermissionItem(buildWixRolePermissionData(ROLE_PERMISSION));
    expect(grant?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
