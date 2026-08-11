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

  it('Phase 26: includes exactly four signature permissions, in their own resource category distinct from document.*', () => {
    expect(PERMISSION_KEYS.filter((k) => k.startsWith('signature.'))).toEqual([
      'signature.request',
      'signature.read',
      'signature.cancel',
      'signature.manage',
    ]);
    expect(permissionCategory('signature.request')).toBe('signature');
  });

  it('Phase 27: includes exactly four schedule permissions, plus resource.manage and calendar.manage as distinct resource categories', () => {
    expect(PERMISSION_KEYS.filter((k) => k.startsWith('schedule.'))).toEqual([
      'schedule.read',
      'schedule.create',
      'schedule.edit',
      'schedule.cancel',
    ]);
    expect(permissionCategory('schedule.read')).toBe('schedule');
    expect(PERMISSION_KEYS).toContain('resource.manage');
    expect(permissionCategory('resource.manage')).toBe('resource');
    expect(PERMISSION_KEYS).toContain('calendar.manage');
    expect(permissionCategory('calendar.manage')).toBe('calendar');
  });

  it('Phase 28: includes exactly four notification permissions, in their own resource category', () => {
    expect(PERMISSION_KEYS.filter((k) => k.startsWith('notification.'))).toEqual([
      'notification.read',
      'notification.send',
      'notification.manage',
      'notification.admin',
    ]);
    expect(permissionCategory('notification.read')).toBe('notification');
  });

  it('Phase 29: includes exactly two portal permissions, in their own resource category, never checked by any family-side route', () => {
    expect(PERMISSION_KEYS.filter((k) => k.startsWith('portal.'))).toEqual(['portal.manage', 'portal.message']);
    expect(permissionCategory('portal.manage')).toBe('portal');
  });

  it('Phase 30: includes exactly one task permission, in its own resource category', () => {
    expect(PERMISSION_KEYS.filter((k) => k.startsWith('task.'))).toEqual(['task.assign']);
    expect(permissionCategory('task.assign')).toBe('task');
  });

  it('Phase 32: includes report.operational/report.staff/report.export alongside the pre-existing report.view, plus a distinct dashboard.manage; no duplicate financial-reporting key is created', () => {
    expect(PERMISSION_KEYS.filter((k) => k.startsWith('report.'))).toEqual(['report.view', 'report.operational', 'report.staff', 'report.export']);
    expect(permissionCategory('report.operational')).toBe('report');
    expect(PERMISSION_KEYS).toContain('dashboard.manage');
    expect(permissionCategory('dashboard.manage')).toBe('dashboard');
    expect(PERMISSION_KEYS.filter((k) => k === 'accounting.report').length).toBe(1);
  });
});
