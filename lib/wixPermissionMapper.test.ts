import { describe, it, expect } from 'vitest';
import { mapWixPermissionItem, buildWixPermissionData } from './wixPermissionMapper';
import type { Permission } from '../types/permission';

const VALID_ITEM = {
  beaconPermissionId: 'perm-1',
  key: 'case.read',
  category: 'case',
  description: 'View case records',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('wixPermissionMapper', () => {
  describe('mapWixPermissionItem', () => {
    it('maps a valid item', () => {
      expect(mapWixPermissionItem(VALID_ITEM)).toEqual({
        id: 'perm-1',
        key: 'case.read',
        category: 'case',
        description: 'View case records',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('returns null for undefined', () => {
      expect(mapWixPermissionItem(undefined)).toBeNull();
    });

    it('returns null for an invalid permission key', () => {
      expect(mapWixPermissionItem({ ...VALID_ITEM, key: 'case.archive' })).toBeNull();
    });

    it('returns null when a required field is missing', () => {
      expect(mapWixPermissionItem({ ...VALID_ITEM, beaconPermissionId: undefined })).toBeNull();
    });
  });

  describe('buildWixPermissionData', () => {
    it('round-trips through map', () => {
      const permission: Permission = { id: 'perm-2', key: 'organization.manage', category: 'organization', description: 'Manage org', createdAt: '2026-01-01T00:00:00.000Z' };
      expect(mapWixPermissionItem(buildWixPermissionData(permission))).toEqual(permission);
    });
  });
});
