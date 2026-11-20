import { describe, expect, it } from 'vitest';
import { resolvePermissions } from './permissionService';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID, getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import type { PermissionKey } from '../domain/rbac/permissionCatalog';

/**
 * Gus role permissions (2026-11): Administrators, Managers and Funeral
 * Directors have the same OPERATIONAL access. Security, financial-authority
 * and configuration permissions stay as they were; Manors is unchanged.
 * Mock mode (the fixtures carry each organization's standing overrides).
 */
const of = (organizationId: string, roleKey: string) => resolvePermissions({ identityId: 'x', organizationId, roleKey }, 'mock');

/** The operational permissions all three must share at Gus. */
const OPERATIONAL: readonly PermissionKey[] = [
  'case.read', 'case.create', 'case.update', 'case.reassign',
  'caseOrder.read', 'caseOrder.update', 'caseOrder.customItems',
  'payment.read', 'payment.collect',
  'document.generate', 'document.view', 'document.upload', 'document.archive',
  'crematory.send', 'fax.send', 'fax.confirm',
  'schedule.read', 'schedule.create', 'schedule.edit', 'schedule.cancel', 'resource.manage',
  'task.assign', 'notification.read', 'notification.send',
  'report.view', 'report.operational', 'report.staff', 'report.export', 'dashboard.manage',
  'audit.read', 'user.read',
  'merchandise.read', 'merchandise.manage', 'inventory.read', 'inventory.manage', 'inventory.adjust',
  'procurement.read', 'procurement.manage',
  'accounting.view', 'accounting.report', 'ap.read',
  // Approved 2026-11-20: workflow, template and case-number management.
  'workflow.edit', 'workflow.publish', 'document.template.manage', 'caseNumber.manage',
];

/** Kept restricted (security, financial authority, configuration, or a recorded decision). */
const RESTRICTED_FROM_FUNERAL_DIRECTOR: readonly PermissionKey[] = [
  'organization.manage', 'settings.manage', 'user.invite', 'user.remove', 'user.manageRoles', 'audit.export',
  'case.delete', 'payment.refund', 'caseOrder.reprice', 'serviceCatalog.edit', 'serviceCatalog.price', 'serviceCatalog.deactivate',
  // Vendor payment authorization stays restricted pending separate approval (2026-11-20).
  'accounting.manage', 'accounting.post', 'accounting.reconcile', 'ap.manage', 'ap.pay',
  'notification.manage', 'notification.admin', 'calendar.manage',
];

describe('Gus: three operational leadership roles', () => {
  it('Administrator, Manager and Funeral Director hold every operational permission', async () => {
    for (const role of ['administrator', 'manager', 'funeralDirector']) {
      const held = await of(GUS_CAMACHO_ORGANIZATION_ID, role);
      const missing = OPERATIONAL.filter((p) => !held.has(p));
      expect(missing, role).toEqual([]);
    }
  });

  it('security, financial-authority and configuration permissions are not handed to the Funeral Director', async () => {
    const fd = await of(GUS_CAMACHO_ORGANIZATION_ID, 'funeralDirector');
    expect(RESTRICTED_FROM_FUNERAL_DIRECTOR.filter((p) => fd.has(p))).toEqual([]);
    const manager = await of(GUS_CAMACHO_ORGANIZATION_ID, 'manager');
    for (const p of ['organization.manage', 'user.manageRoles', 'payment.refund', 'serviceCatalog.edit'] as const) expect(manager.has(p), p).toBe(false);
  });

  it('release requests and holds: the same three roles; the licensed sign-off stays with Funeral Directors (or a granted authorization) plus a verified license', () => {
    const f = getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features;
    expect(f.cremationReleaseOperatorRoleKeys).toEqual(['administrator', 'manager', 'funeralDirector']);
    expect(f.cremationReleaseApproverRoleKeys).toEqual(['funeralDirector']);
    expect(f.funeralDirectorCredentialAdministratorRoleKeys).toEqual(['administrator', 'manager', 'funeralDirector']);
    expect(f.sendToCrematory?.sentStepsByHandRoleKeys).toEqual(['administrator', 'manager', 'funeralDirector']);
    expect(f.funeralDirectorLicenseReverifyDays).toBe(365);
  });

  it('read-only and other roles gain nothing', async () => {
    const readOnly = await of(GUS_CAMACHO_ORGANIZATION_ID, 'readOnly');
    expect(['case.update', 'crematory.send', 'caseOrder.customItems', 'resource.manage'].filter((p) => readOnly.has(p as PermissionKey))).toEqual([]);
    expect(getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features.cremationReleaseOperatorRoleKeys).not.toContain('readOnly');
  });
});

describe('Manors is unchanged', () => {
  it('its Funeral Director and Manager keep exactly the platform defaults for the aligned keys', async () => {
    const fd = await of(MANORS_ORGANIZATION_ID, 'funeralDirector');
    const manager = await of(MANORS_ORGANIZATION_ID, 'manager');
    expect(['caseOrder.customItems', 'resource.manage', 'user.read', 'report.export', 'dashboard.manage', 'merchandise.manage', 'inventory.adjust'].filter((p) => fd.has(p as PermissionKey))).toEqual([]);
    expect(manager.has('accounting.view')).toBe(false);
    expect(['workflow.edit', 'workflow.publish', 'document.template.manage'].filter((p) => fd.has(p as PermissionKey))).toEqual([]);
    expect(manager.has('caseNumber.manage')).toBe(false);
    const f = getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).features;
    expect(f.cremationReleaseOperatorRoleKeys).toEqual([]);
    expect(f.funeralDirectorCredentialAdministratorRoleKeys).toEqual([]);
    expect(f.sendToCrematory?.sentStepsByHandRoleKeys).toBeUndefined();
  });
});
