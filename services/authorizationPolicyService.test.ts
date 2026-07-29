import { describe, it, expect } from 'vitest';
import {
  canEditCase,
  canDeleteCase,
  canCollectPayment,
  canRefundPayment,
  canPublishWorkflow,
  canInviteUser,
  canManageOrganization,
  canManageRoles,
  canReadAuditLog,
  canExportAuditLog,
  isAdminTier,
} from './authorizationPolicyService';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

function params(roleKey: string) {
  return { identityId: `identity-${roleKey}`, organizationId: DEFAULT_ORGANIZATION_ID, roleKey };
}

describe('authorizationPolicyService', () => {
  it('administrator can do everything, including manage roles and the organization', async () => {
    const p = params('administrator');
    expect(await canEditCase(p, 'mock')).toBe(true);
    expect(await canDeleteCase(p, 'mock')).toBe(true);
    expect(await canCollectPayment(p, 'mock')).toBe(true);
    expect(await canRefundPayment(p, 'mock')).toBe(true);
    expect(await canPublishWorkflow(p, 'mock')).toBe(true);
    expect(await canInviteUser(p, 'mock')).toBe(true);
    expect(await canManageOrganization(p, 'mock')).toBe(true);
    expect(await canManageRoles(p, 'mock')).toBe(true);
    expect(await isAdminTier(p, 'mock')).toBe(true);
  });

  it('manager can invite and publish workflows but cannot manage the organization or roles', async () => {
    const p = params('manager');
    expect(await canInviteUser(p, 'mock')).toBe(true);
    expect(await canPublishWorkflow(p, 'mock')).toBe(true);
    expect(await canManageOrganization(p, 'mock')).toBe(false);
    expect(await canManageRoles(p, 'mock')).toBe(false);
    expect(await isAdminTier(p, 'mock')).toBe(false);
  });

  it('accounting can collect and refund payments but cannot edit cases', async () => {
    const p = params('accounting');
    expect(await canCollectPayment(p, 'mock')).toBe(true);
    expect(await canRefundPayment(p, 'mock')).toBe(true);
    expect(await canEditCase(p, 'mock')).toBe(false);
  });

  it('readOnly cannot perform any mutating action', async () => {
    const p = params('readOnly');
    expect(await canEditCase(p, 'mock')).toBe(false);
    expect(await canDeleteCase(p, 'mock')).toBe(false);
    expect(await canCollectPayment(p, 'mock')).toBe(false);
    expect(await canInviteUser(p, 'mock')).toBe(false);
    expect(await canManageOrganization(p, 'mock')).toBe(false);
  });

  it('Phase 24: audit.read is broadly held (matches report.view\'s tier) but audit.export is narrower (matches payment.refund\'s tier)', async () => {
    expect(await canReadAuditLog(params('administrator'), 'mock')).toBe(true);
    expect(await canReadAuditLog(params('manager'), 'mock')).toBe(true);
    expect(await canReadAuditLog(params('funeralDirector'), 'mock')).toBe(true);
    expect(await canReadAuditLog(params('accounting'), 'mock')).toBe(true);
    expect(await canReadAuditLog(params('readOnly'), 'mock')).toBe(true);
    expect(await canReadAuditLog(params('arranger'), 'mock')).toBe(false);
    expect(await canReadAuditLog(params('officeStaff'), 'mock')).toBe(false);

    expect(await canExportAuditLog(params('administrator'), 'mock')).toBe(true);
    expect(await canExportAuditLog(params('manager'), 'mock')).toBe(true);
    expect(await canExportAuditLog(params('accounting'), 'mock')).toBe(true);
    expect(await canExportAuditLog(params('funeralDirector'), 'mock')).toBe(false);
    expect(await canExportAuditLog(params('readOnly'), 'mock')).toBe(false);
  });

  it('legacy owner/administrator role strings resolve identically to the administrator default role', async () => {
    expect(await isAdminTier(params('owner'), 'mock')).toBe(true);
    expect(await isAdminTier(params('administrator'), 'mock')).toBe(true);
    expect(await isAdminTier(params('caseManager'), 'mock')).toBe(false);
    expect(await isAdminTier(params('staff'), 'mock')).toBe(false);
  });
});
