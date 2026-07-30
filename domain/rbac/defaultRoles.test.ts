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
    expect(admin.permissions).toHaveLength(28); // Phase 25: 24 + document.upload + document.archive + document.template.read + document.template.manage
  });

  it('Phase 25: readOnly is not granted document.upload — the one write action document.view\'s tier would otherwise include', () => {
    const readOnly = defaultRoleDefinition('readOnly');
    expect(readOnly.permissions.includes('document.upload')).toBe(false);
    expect(readOnly.permissions.includes('document.view')).toBe(true);
  });

  it('Phase 25: document.archive and document.template.* are narrower than document.view/generate\'s tier', () => {
    const arranger = defaultRoleDefinition('arranger');
    expect(arranger.permissions.includes('document.upload')).toBe(true);
    expect(arranger.permissions.includes('document.archive')).toBe(false);
    expect(arranger.permissions.includes('document.template.read')).toBe(false);

    const funeralDirector = defaultRoleDefinition('funeralDirector');
    expect(funeralDirector.permissions.includes('document.archive')).toBe(true);
    expect(funeralDirector.permissions.includes('document.template.read')).toBe(true);
    expect(funeralDirector.permissions.includes('document.template.manage')).toBe(false);

    const manager = defaultRoleDefinition('manager');
    expect(manager.permissions.includes('document.template.manage')).toBe(true);

    const accounting = defaultRoleDefinition('accounting');
    expect(accounting.permissions.some((p) => p.startsWith('document.'))).toBe(false);
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
