import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, isPermissionKey, permissionCategory, PERMISSION_DESCRIPTIONS } from './permissionCatalog';

describe('permissionCatalog', () => {
  it('has no duplicate permission keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('has a description for every permission key', () => {
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSION_DESCRIPTIONS[key]).toBeTruthy();
    }
  });

  describe('isPermissionKey', () => {
    it('accepts every catalog key', () => {
      for (const key of PERMISSION_KEYS) {
        expect(isPermissionKey(key)).toBe(true);
      }
    });

    it('rejects an unknown string', () => {
      expect(isPermissionKey('case.archive')).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(isPermissionKey(42)).toBe(false);
      expect(isPermissionKey(null)).toBe(false);
      expect(isPermissionKey(undefined)).toBe(false);
    });
  });

  describe('permissionCategory', () => {
    it('extracts the resource prefix', () => {
      expect(permissionCategory('case.read')).toBe('case');
      expect(permissionCategory('caseOrder.update')).toBe('caseOrder');
      expect(permissionCategory('organization.manage')).toBe('organization');
    });
  });
});
