import { describe, it, expect } from 'vitest';
import { mapWixPortalMessageItem, buildWixPortalMessageData, applyPortalMessageReadReceiptToWixData } from './wixPortalMessageMapper';
import type { PortalMessage } from '../types/portalMessage';

const STAFF_MESSAGE: PortalMessage = {
  id: 'message-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  senderType: 'staff',
  senderStaffIdentityId: 'identity-1',
  senderPortalUserId: null,
  senderPortalAccessId: null,
  senderRelationshipTypeAtSend: null,
  body: 'Hello family',
  attachmentDocumentId: null,
  readByStaffAt: '2026-08-01T00:00:00.000Z',
  readByFamilyAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const FAMILY_MESSAGE: PortalMessage = {
  ...STAFF_MESSAGE,
  id: 'message-2',
  senderType: 'family',
  senderStaffIdentityId: null,
  senderPortalUserId: 'portal-user-1',
  senderPortalAccessId: 'access-1',
  senderRelationshipTypeAtSend: 'primary_next_of_kin',
  readByStaffAt: null,
  readByFamilyAt: '2026-08-01T00:00:00.000Z',
};

describe('wixPortalMessageMapper', () => {
  it('round-trips a staff-sent message', () => {
    expect(mapWixPortalMessageItem(buildWixPortalMessageData(STAFF_MESSAGE))).toEqual(STAFF_MESSAGE);
  });

  it('round-trips a family-sent message with its relationship snapshot', () => {
    expect(mapWixPortalMessageItem(buildWixPortalMessageData(FAMILY_MESSAGE))).toEqual(FAMILY_MESSAGE);
  });

  it('returns null for undefined', () => {
    expect(mapWixPortalMessageItem(undefined)).toBeNull();
  });

  it('returns null for an invalid senderType', () => {
    expect(mapWixPortalMessageItem({ ...buildWixPortalMessageData(STAFF_MESSAGE), senderType: 'bogus' })).toBeNull();
  });

  it('returns null for an invalid senderRelationshipTypeAtSend', () => {
    expect(mapWixPortalMessageItem({ ...buildWixPortalMessageData(FAMILY_MESSAGE), senderRelationshipTypeAtSend: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    expect(mapWixPortalMessageItem({ ...buildWixPortalMessageData(STAFF_MESSAGE), body: undefined })).toBeNull();
  });

  it('applyPortalMessageReadReceiptToWixData only patches readByStaffAt/readByFamilyAt, never the body', () => {
    const existing = buildWixPortalMessageData(STAFF_MESSAGE);
    const patched = applyPortalMessageReadReceiptToWixData(existing, { readByFamilyAt: '2026-08-02T00:00:00.000Z' });
    expect(patched.readByFamilyAt).toBe('2026-08-02T00:00:00.000Z');
    expect(patched.body).toBe(STAFF_MESSAGE.body);
  });

  it('exposes no generic update/apply function beyond the narrow read-receipt setter — every other field is immutable', async () => {
    const moduleExports = await import('./wixPortalMessageMapper');
    const exportNames = Object.keys(moduleExports);
    expect(exportNames.filter((name) => /^apply/i.test(name))).toEqual(['applyPortalMessageReadReceiptToWixData']);
  });
});
