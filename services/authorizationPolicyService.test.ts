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
  canGenerateDocument,
  canViewDocument,
  canUploadDocument,
  canArchiveDocument,
  canReadDocumentTemplate,
  canManageDocumentTemplate,
  canRequestSignature,
  canReadSignature,
  canCancelSignature,
  canManageSignature,
  canReadSchedule,
  canCreateAppointment,
  canEditAppointment,
  canCancelAppointment,
  canManageResources,
  canManageCalendar,
  canReadNotifications,
  canSendNotification,
  canManageNotifications,
  canAdminNotifications,
  canManagePortal,
  canSendPortalMessage,
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

  it('Phase 25: document.view/document.generate/document.upload exclude accounting but include readOnly for view/generate only, never upload', async () => {
    expect(await canViewDocument(params('accounting'), 'mock')).toBe(false);
    expect(await canGenerateDocument(params('accounting'), 'mock')).toBe(false);
    expect(await canUploadDocument(params('accounting'), 'mock')).toBe(false);

    expect(await canViewDocument(params('readOnly'), 'mock')).toBe(true);
    expect(await canGenerateDocument(params('readOnly'), 'mock')).toBe(false);
    expect(await canUploadDocument(params('readOnly'), 'mock')).toBe(false);

    expect(await canUploadDocument(params('arranger'), 'mock')).toBe(true);
    expect(await canUploadDocument(params('officeStaff'), 'mock')).toBe(true);
  });

  it('Phase 25: document.archive is narrower — administrator/manager/funeralDirector only', async () => {
    expect(await canArchiveDocument(params('administrator'), 'mock')).toBe(true);
    expect(await canArchiveDocument(params('manager'), 'mock')).toBe(true);
    expect(await canArchiveDocument(params('funeralDirector'), 'mock')).toBe(true);
    expect(await canArchiveDocument(params('arranger'), 'mock')).toBe(false);
    expect(await canArchiveDocument(params('officeStaff'), 'mock')).toBe(false);
    expect(await canArchiveDocument(params('accounting'), 'mock')).toBe(false);
    expect(await canArchiveDocument(params('readOnly'), 'mock')).toBe(false);
  });

  it('Phase 25: document.template.read is broader than document.template.manage', async () => {
    expect(await canReadDocumentTemplate(params('administrator'), 'mock')).toBe(true);
    expect(await canReadDocumentTemplate(params('manager'), 'mock')).toBe(true);
    expect(await canReadDocumentTemplate(params('funeralDirector'), 'mock')).toBe(true);
    expect(await canReadDocumentTemplate(params('arranger'), 'mock')).toBe(false);
    expect(await canReadDocumentTemplate(params('accounting'), 'mock')).toBe(false);

    expect(await canManageDocumentTemplate(params('administrator'), 'mock')).toBe(true);
    expect(await canManageDocumentTemplate(params('manager'), 'mock')).toBe(true);
    expect(await canManageDocumentTemplate(params('funeralDirector'), 'mock')).toBe(false);
  });

  it('Phase 26: signature.request mirrors document.generate\'s tier (every role except accounting/readOnly)', async () => {
    expect(await canRequestSignature(params('administrator'), 'mock')).toBe(true);
    expect(await canRequestSignature(params('manager'), 'mock')).toBe(true);
    expect(await canRequestSignature(params('funeralDirector'), 'mock')).toBe(true);
    expect(await canRequestSignature(params('arranger'), 'mock')).toBe(true);
    expect(await canRequestSignature(params('officeStaff'), 'mock')).toBe(true);
    expect(await canRequestSignature(params('accounting'), 'mock')).toBe(false);
    expect(await canRequestSignature(params('readOnly'), 'mock')).toBe(false);
  });

  it('Phase 26: signature.read mirrors document.view\'s tier (every role except accounting)', async () => {
    expect(await canReadSignature(params('readOnly'), 'mock')).toBe(true);
    expect(await canReadSignature(params('accounting'), 'mock')).toBe(false);
  });

  it('Phase 26: signature.cancel is narrower than signature.request — administrator/manager/funeralDirector only', async () => {
    expect(await canCancelSignature(params('administrator'), 'mock')).toBe(true);
    expect(await canCancelSignature(params('manager'), 'mock')).toBe(true);
    expect(await canCancelSignature(params('funeralDirector'), 'mock')).toBe(true);
    expect(await canCancelSignature(params('arranger'), 'mock')).toBe(false);
    expect(await canCancelSignature(params('officeStaff'), 'mock')).toBe(false);
  });

  it('Phase 26: signature.manage is narrower still — administrator/manager only', async () => {
    expect(await canManageSignature(params('administrator'), 'mock')).toBe(true);
    expect(await canManageSignature(params('manager'), 'mock')).toBe(true);
    expect(await canManageSignature(params('funeralDirector'), 'mock')).toBe(false);
  });

  it('Phase 27: schedule.read/.create/.edit mirror document.generate\'s tier (every role except accounting/readOnly for create/edit)', async () => {
    expect(await canReadSchedule(params('readOnly'), 'mock')).toBe(true);
    expect(await canReadSchedule(params('accounting'), 'mock')).toBe(false);
    expect(await canCreateAppointment(params('administrator'), 'mock')).toBe(true);
    expect(await canCreateAppointment(params('arranger'), 'mock')).toBe(true);
    expect(await canCreateAppointment(params('officeStaff'), 'mock')).toBe(true);
    expect(await canCreateAppointment(params('accounting'), 'mock')).toBe(false);
    expect(await canCreateAppointment(params('readOnly'), 'mock')).toBe(false);
    expect(await canEditAppointment(params('funeralDirector'), 'mock')).toBe(true);
  });

  it('Phase 27: schedule.cancel is narrower — administrator/manager/funeralDirector only', async () => {
    expect(await canCancelAppointment(params('administrator'), 'mock')).toBe(true);
    expect(await canCancelAppointment(params('manager'), 'mock')).toBe(true);
    expect(await canCancelAppointment(params('funeralDirector'), 'mock')).toBe(true);
    expect(await canCancelAppointment(params('arranger'), 'mock')).toBe(false);
    expect(await canCancelAppointment(params('officeStaff'), 'mock')).toBe(false);
  });

  it('Phase 27: resource.manage/calendar.manage are narrower still — administrator/manager only', async () => {
    expect(await canManageResources(params('administrator'), 'mock')).toBe(true);
    expect(await canManageResources(params('manager'), 'mock')).toBe(true);
    expect(await canManageResources(params('funeralDirector'), 'mock')).toBe(false);
    expect(await canManageCalendar(params('administrator'), 'mock')).toBe(true);
    expect(await canManageCalendar(params('manager'), 'mock')).toBe(true);
    expect(await canManageCalendar(params('funeralDirector'), 'mock')).toBe(false);
  });

  it('Phase 28: notification.read mirrors audit.read\'s tier, notification.send mirrors document.generate/schedule.create\'s tier', async () => {
    expect(await canReadNotifications(params('administrator'), 'mock')).toBe(true);
    expect(await canReadNotifications(params('funeralDirector'), 'mock')).toBe(true);
    expect(await canReadNotifications(params('accounting'), 'mock')).toBe(true);
    expect(await canReadNotifications(params('arranger'), 'mock')).toBe(false);
    expect(await canSendNotification(params('officeStaff'), 'mock')).toBe(true);
    expect(await canSendNotification(params('accounting'), 'mock')).toBe(false);
    expect(await canSendNotification(params('readOnly'), 'mock')).toBe(false);
  });

  it('Phase 28: notification.manage/.admin are narrower still — administrator/manager only', async () => {
    expect(await canManageNotifications(params('administrator'), 'mock')).toBe(true);
    expect(await canManageNotifications(params('manager'), 'mock')).toBe(true);
    expect(await canManageNotifications(params('funeralDirector'), 'mock')).toBe(false);
    expect(await canAdminNotifications(params('administrator'), 'mock')).toBe(true);
    expect(await canAdminNotifications(params('manager'), 'mock')).toBe(true);
    expect(await canAdminNotifications(params('funeralDirector'), 'mock')).toBe(false);
  });

  it('Phase 29: portal.manage is administrator/manager only; portal.message reaches every role except accounting/readOnly', async () => {
    expect(await canManagePortal(params('administrator'), 'mock')).toBe(true);
    expect(await canManagePortal(params('manager'), 'mock')).toBe(true);
    expect(await canManagePortal(params('funeralDirector'), 'mock')).toBe(false);
    expect(await canManagePortal(params('accounting'), 'mock')).toBe(false);
    expect(await canSendPortalMessage(params('administrator'), 'mock')).toBe(true);
    expect(await canSendPortalMessage(params('manager'), 'mock')).toBe(true);
    expect(await canSendPortalMessage(params('funeralDirector'), 'mock')).toBe(true);
    expect(await canSendPortalMessage(params('arranger'), 'mock')).toBe(true);
    expect(await canSendPortalMessage(params('officeStaff'), 'mock')).toBe(true);
    expect(await canSendPortalMessage(params('accounting'), 'mock')).toBe(false);
    expect(await canSendPortalMessage(params('readOnly'), 'mock')).toBe(false);
  });

  it('legacy owner/administrator role strings resolve identically to the administrator default role', async () => {
    expect(await isAdminTier(params('owner'), 'mock')).toBe(true);
    expect(await isAdminTier(params('administrator'), 'mock')).toBe(true);
    expect(await isAdminTier(params('caseManager'), 'mock')).toBe(false);
    expect(await isAdminTier(params('staff'), 'mock')).toBe(false);
  });
});
