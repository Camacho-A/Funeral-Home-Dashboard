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

  it('Phase 24: includes exactly two audit permissions, not a third case-scoped one', () => {
    expect(PERMISSION_KEYS.filter((k) => k.startsWith('audit.'))).toEqual(['audit.read', 'audit.export']);
    expect(permissionCategory('audit.read')).toBe('audit');
  });

  it('Phase 25: includes document.upload/document.archive alongside the previously-dead document.generate/document.view', () => {
    expect(PERMISSION_KEYS).toEqual(
      expect.arrayContaining(['document.generate', 'document.view', 'document.upload', 'document.archive']),
    );
  });

  it('Phase 25: includes exactly two document-template permissions, distinct from the case-scoped document.* ones', () => {
    expect(PERMISSION_KEYS.filter((k) => k.startsWith('document.template.'))).toEqual(['document.template.read', 'document.template.manage']);
    expect(permissionCategory('document.template.read')).toBe('document');
  });
});
