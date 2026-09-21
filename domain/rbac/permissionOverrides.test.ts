import { describe, expect, it } from 'vitest';
import { applyPermissionOverrides, grantedPermissionKeys, revokedPermissionKeys } from './permissionOverrides';
import type { PermissionKey } from './permissionCatalog';

const BASE: PermissionKey[] = ['case.read', 'case.update', 'ap.read'];

describe('applyPermissionOverrides', () => {
  it('returns the base set unchanged with no overrides', () => {
    const result = applyPermissionOverrides(BASE, []);
    expect([...result].sort()).toEqual([...BASE].sort());
  });

  it('a grant override adds a permission not in the base set', () => {
    const result = applyPermissionOverrides(BASE, [{ permissionKey: 'caseOrder.update', action: 'grant' }]);
    expect(result.has('caseOrder.update')).toBe(true);
    expect(result.size).toBe(BASE.length + 1);
  });

  it('a revoke override removes a base permission', () => {
    const result = applyPermissionOverrides(BASE, [{ permissionKey: 'ap.read', action: 'revoke' }]);
    expect(result.has('ap.read')).toBe(false);
    expect(result.size).toBe(BASE.length - 1);
  });

  it('revoke wins over a conflicting grant for the same key (malformed state safety)', () => {
    const result = applyPermissionOverrides(BASE, [
      { permissionKey: 'accounting.view', action: 'grant' },
      { permissionKey: 'accounting.view', action: 'revoke' },
    ]);
    expect(result.has('accounting.view')).toBe(false);
  });

  it('revoke wins regardless of array order', () => {
    const result = applyPermissionOverrides(BASE, [
      { permissionKey: 'accounting.view', action: 'revoke' },
      { permissionKey: 'accounting.view', action: 'grant' },
    ]);
    expect(result.has('accounting.view')).toBe(false);
  });

  it('a revoke of a permission not in the base set is a safe no-op', () => {
    const result = applyPermissionOverrides(BASE, [{ permissionKey: 'accounting.manage', action: 'revoke' }]);
    expect([...result].sort()).toEqual([...BASE].sort());
  });

  it('grants and revokes for different permissions compose independently', () => {
    const result = applyPermissionOverrides(BASE, [
      { permissionKey: 'caseOrder.update', action: 'grant' },
      { permissionKey: 'ap.read', action: 'revoke' },
    ]);
    expect([...result].sort()).toEqual(['case.read', 'case.update', 'caseOrder.update'].sort());
  });
});

describe('grantedPermissionKeys / revokedPermissionKeys', () => {
  const overrides = [
    { permissionKey: 'caseOrder.update' as PermissionKey, action: 'grant' as const },
    { permissionKey: 'ap.read' as PermissionKey, action: 'revoke' as const },
  ];

  it('grantedPermissionKeys returns only the grant actions', () => {
    expect(grantedPermissionKeys(overrides)).toEqual(['caseOrder.update']);
  });

  it('revokedPermissionKeys returns only the revoke actions', () => {
    expect(revokedPermissionKeys(overrides)).toEqual(['ap.read']);
  });
});
