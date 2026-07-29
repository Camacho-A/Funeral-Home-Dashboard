import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLE_KEYS, DEFAULT_ROLE_DEFINITIONS, isDefaultRoleKey, defaultRoleDefinition } from './defaultRoles';
import { isPermissionKey } from './permissionCatalog';

describe('defaultRoles', () => {
  it('defines exactly the seven roles named in the phase spec', () => {
    expect(DEFAULT_ROLE_KEYS).toEqual(['administrator', 'manager', 'funeralDirector', 'arranger', 'officeStaff', 'accounting', 'readOnly']);
    expect(DEFAULT_ROLE_DEFINITIONS).toHaveLength(7);
  });

  it('every definition only references real permission keys', () => {
    for (const def of DEFAULT_ROLE_DEFINITIONS) {
      for (const permission of def.permissions) {
        expect(isPermissionKey(permission)).toBe(true);
      }
    }
  });

  it('every definition has no duplicate permissions', () => {
    for (const def of DEFAULT_ROLE_DEFINITIONS) {
      expect(new Set(def.permissions).size).toBe(def.permissions.length);
    }
  });

  it('administrator grants every permission', () => {
    const admin = defaultRoleDefinition('administrator');
    expect(admin.permissions).toHaveLength(24); // Phase 24: 22 + audit.read + audit.export
  });

  it('readOnly grants only *.read/*.view permissions', () => {
    const readOnly = defaultRoleDefinition('readOnly');
    for (const permission of readOnly.permissions) {
      expect(permission.endsWith('.read') || permission.endsWith('.view')).toBe(true);
    }
  });

  it('only administrator and manager may invite users; only administrator may manage roles or the organization', () => {
    for (const def of DEFAULT_ROLE_DEFINITIONS) {
      if (def.key !== 'administrator') {
        expect(def.permissions.includes('organization.manage')).toBe(false);
        expect(def.permissions.includes('user.manageRoles')).toBe(false);
        expect(def.permissions.includes('settings.manage')).toBe(false);
      }
    }
  });

  describe('isDefaultRoleKey', () => {
    it('accepts every default key', () => {
      for (const key of DEFAULT_ROLE_KEYS) {
        expect(isDefaultRoleKey(key)).toBe(true);
      }
    });

    it('rejects a custom-role-shaped key', () => {
      expect(isDefaultRoleKey('custom_abc123')).toBe(false);
    });
  });

  describe('defaultRoleDefinition', () => {
    it('throws for an unknown key', () => {
      // @ts-expect-error deliberately invalid input
      expect(() => defaultRoleDefinition('bogus')).toThrow();
    });
  });
});
