import { describe, it, expect } from 'vitest';
import { mapWixRoleItem, buildWixRoleData, applyRoleUpdateToWixData } from './wixRoleMapper';
import type { Role } from '../types/role';

const DEFAULT_ROLE: Role = {
  id: 'role-1',
  key: 'administrator',
  name: 'Administrator',
  description: 'Full access',
  organizationId: null,
  isSystemDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const CUSTOM_ROLE: Role = {
  ...DEFAULT_ROLE,
  id: 'role-2',
  key: 'custom_abc',
  organizationId: 'org-1',
  isSystemDefault: false,
};

describe('wixRoleMapper', () => {
  describe('mapWixRoleItem', () => {
    it('maps a platform-default role (organizationId null)', () => {
      const item = buildWixRoleData(DEFAULT_ROLE);
      expect(mapWixRoleItem(item)).toEqual(DEFAULT_ROLE);
    });

    it('maps a custom organization role', () => {
      const item = buildWixRoleData(CUSTOM_ROLE);
      expect(mapWixRoleItem(item)).toEqual(CUSTOM_ROLE);
    });

    it('returns null for undefined', () => {
      expect(mapWixRoleItem(undefined)).toBeNull();
    });

    it('returns null when isSystemDefault is missing', () => {
      const item = buildWixRoleData(DEFAULT_ROLE);
      expect(mapWixRoleItem({ ...item, isSystemDefault: undefined })).toBeNull();
    });
  });

  describe('applyRoleUpdateToWixData', () => {
    it('updates name/description and updatedAt, leaves key/organizationId/isSystemDefault unchanged', () => {
      const existing = buildWixRoleData(CUSTOM_ROLE);
      const updated = applyRoleUpdateToWixData(existing, { name: 'Renamed Role', updatedAt: '2026-02-01T00:00:00.000Z' });
      expect(updated.name).toBe('Renamed Role');
      expect(updated.description).toBe(CUSTOM_ROLE.description);
      expect(updated.updatedAt).toBe('2026-02-01T00:00:00.000Z');
      expect(updated.key).toBe(CUSTOM_ROLE.key);
      expect(updated.organizationId).toBe(CUSTOM_ROLE.organizationId);
      expect(updated.isSystemDefault).toBe(CUSTOM_ROLE.isSystemDefault);
    });
  });
});
