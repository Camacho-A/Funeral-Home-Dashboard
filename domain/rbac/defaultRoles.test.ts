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
    expect(admin.permissions).toHaveLength(45); // Phase 30: 44 + task.assign
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

  it('Phase 26: signature.request mirrors document.generate\'s tier, signature.cancel is narrower (mirrors document.archive), signature.manage narrower still', () => {
    const arranger = defaultRoleDefinition('arranger');
    expect(arranger.permissions.includes('signature.request')).toBe(true);
    expect(arranger.permissions.includes('signature.read')).toBe(true);
    expect(arranger.permissions.includes('signature.cancel')).toBe(false);

    const officeStaff = defaultRoleDefinition('officeStaff');
    expect(officeStaff.permissions.includes('signature.request')).toBe(true);
    expect(officeStaff.permissions.includes('signature.cancel')).toBe(false);

    const funeralDirector = defaultRoleDefinition('funeralDirector');
    expect(funeralDirector.permissions.includes('signature.cancel')).toBe(true);
    expect(funeralDirector.permissions.includes('signature.manage')).toBe(false);

    const manager = defaultRoleDefinition('manager');
    expect(manager.permissions.includes('signature.manage')).toBe(true);

    const accounting = defaultRoleDefinition('accounting');
    expect(accounting.permissions.some((p) => p.startsWith('signature.'))).toBe(false);
  });

  it('Phase 26: readOnly is granted signature.read (a pure view action) but not signature.request/.cancel, mirroring its document.view-but-not-.upload precedent', () => {
    const readOnly = defaultRoleDefinition('readOnly');
    expect(readOnly.permissions.includes('signature.read')).toBe(true);
    expect(readOnly.permissions.includes('signature.request')).toBe(false);
    expect(readOnly.permissions.includes('signature.cancel')).toBe(false);
  });

  it('Phase 27: schedule.read/.create/.edit mirror document.generate/.view\'s tier, schedule.cancel is narrower (mirrors document.archive)', () => {
    const arranger = defaultRoleDefinition('arranger');
    expect(arranger.permissions.includes('schedule.read')).toBe(true);
    expect(arranger.permissions.includes('schedule.create')).toBe(true);
    expect(arranger.permissions.includes('schedule.edit')).toBe(true);
    expect(arranger.permissions.includes('schedule.cancel')).toBe(false);

    const officeStaff = defaultRoleDefinition('officeStaff');
    expect(officeStaff.permissions.includes('schedule.create')).toBe(true);
    expect(officeStaff.permissions.includes('schedule.cancel')).toBe(false);

    const funeralDirector = defaultRoleDefinition('funeralDirector');
    expect(funeralDirector.permissions.includes('schedule.cancel')).toBe(true);
    expect(funeralDirector.permissions.includes('resource.manage')).toBe(false);

    const manager = defaultRoleDefinition('manager');
    expect(manager.permissions.includes('resource.manage')).toBe(true);
    expect(manager.permissions.includes('calendar.manage')).toBe(true);

    const accounting = defaultRoleDefinition('accounting');
    expect(accounting.permissions.some((p) => p.startsWith('schedule.') || p === 'resource.manage' || p === 'calendar.manage')).toBe(false);
  });

  it('Phase 27: readOnly is granted schedule.read (a pure view action) but not schedule.create/.edit/.cancel or resource.manage/calendar.manage', () => {
    const readOnly = defaultRoleDefinition('readOnly');
    expect(readOnly.permissions.includes('schedule.read')).toBe(true);
    expect(readOnly.permissions.includes('schedule.create')).toBe(false);
    expect(readOnly.permissions.includes('schedule.edit')).toBe(false);
    expect(readOnly.permissions.includes('schedule.cancel')).toBe(false);
    expect(readOnly.permissions.includes('resource.manage')).toBe(false);
    expect(readOnly.permissions.includes('calendar.manage')).toBe(false);
  });

  it('Phase 28: notification.read mirrors audit.read\'s tier, notification.send mirrors document.generate/schedule.create\'s tier, notification.manage/.admin are narrower still', () => {
    const manager = defaultRoleDefinition('manager');
    expect(manager.permissions.includes('notification.read')).toBe(true);
    expect(manager.permissions.includes('notification.send')).toBe(true);
    expect(manager.permissions.includes('notification.manage')).toBe(true);
    expect(manager.permissions.includes('notification.admin')).toBe(true);

    const funeralDirector = defaultRoleDefinition('funeralDirector');
    expect(funeralDirector.permissions.includes('notification.read')).toBe(true);
    expect(funeralDirector.permissions.includes('notification.send')).toBe(true);
    expect(funeralDirector.permissions.includes('notification.manage')).toBe(false);

    const arranger = defaultRoleDefinition('arranger');
    expect(arranger.permissions.includes('notification.send')).toBe(true);
    expect(arranger.permissions.includes('notification.read')).toBe(false);

    const accounting = defaultRoleDefinition('accounting');
    expect(accounting.permissions.includes('notification.read')).toBe(true);
    expect(accounting.permissions.includes('notification.send')).toBe(false);
  });

  it('Phase 28: readOnly is granted notification.read (a pure view action, the org-wide log) but not notification.send/.manage/.admin', () => {
    const readOnly = defaultRoleDefinition('readOnly');
    expect(readOnly.permissions.includes('notification.read')).toBe(true);
    expect(readOnly.permissions.includes('notification.send')).toBe(false);
    expect(readOnly.permissions.includes('notification.manage')).toBe(false);
    expect(readOnly.permissions.includes('notification.admin')).toBe(false);
  });

  it('Phase 29: portal.manage is administrator/manager only; portal.message reaches every role except accounting/readOnly', () => {
    const manager = defaultRoleDefinition('manager');
    expect(manager.permissions.includes('portal.manage')).toBe(true);
    expect(manager.permissions.includes('portal.message')).toBe(true);

    const funeralDirector = defaultRoleDefinition('funeralDirector');
    expect(funeralDirector.permissions.includes('portal.manage')).toBe(false);
    expect(funeralDirector.permissions.includes('portal.message')).toBe(true);

    const arranger = defaultRoleDefinition('arranger');
    expect(arranger.permissions.includes('portal.message')).toBe(true);

    const officeStaff = defaultRoleDefinition('officeStaff');
    expect(officeStaff.permissions.includes('portal.message')).toBe(true);

    const accounting = defaultRoleDefinition('accounting');
    expect(accounting.permissions.includes('portal.manage')).toBe(false);
    expect(accounting.permissions.includes('portal.message')).toBe(false);

    const readOnly = defaultRoleDefinition('readOnly');
    expect(readOnly.permissions.includes('portal.manage')).toBe(false);
    expect(readOnly.permissions.includes('portal.message')).toBe(false);
  });

  it('Phase 30: task.assign is tiered like schedule.edit — every role except accounting/readOnly', () => {
    for (const def of DEFAULT_ROLE_DEFINITIONS) {
      const expected = def.key !== 'accounting' && def.key !== 'readOnly';
      expect(def.permissions.includes('task.assign')).toBe(expected);
    }
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
