import { describe, it, expect } from 'vitest';
import { mapWixPortalAccessItem, buildWixPortalAccessData, applyPortalAccessUpdateToWixData } from './wixPortalAccessMapper';
import type { PortalAccess } from '../types/portalAccess';

const PORTAL_ACCESS: PortalAccess = {
  id: 'portal-access-1',
  portalUserId: null,
  organizationId: 'org-1',
  caseId: 'case-1',
  relationshipType: 'primary_next_of_kin',
  status: 'pending',
  grantedFromInvitationId: 'invitation-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('wixPortalAccessMapper', () => {
  it('round-trips a pending grant with a null portalUserId', () => {
    expect(mapWixPortalAccessItem(buildWixPortalAccessData(PORTAL_ACCESS))).toEqual(PORTAL_ACCESS);
  });

  it('round-trips an activated grant with a real portalUserId', () => {
    const active: PortalAccess = { ...PORTAL_ACCESS, portalUserId: 'portal-user-1', status: 'active' };
    expect(mapWixPortalAccessItem(buildWixPortalAccessData(active))).toEqual(active);
  });

  it('returns null for undefined', () => {
    expect(mapWixPortalAccessItem(undefined)).toBeNull();
  });

  it('returns null for an invalid relationshipType or status', () => {
    expect(mapWixPortalAccessItem({ ...buildWixPortalAccessData(PORTAL_ACCESS), relationshipType: 'bogus' })).toBeNull();
    expect(mapWixPortalAccessItem({ ...buildWixPortalAccessData(PORTAL_ACCESS), status: 'bogus' })).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    expect(mapWixPortalAccessItem({ ...buildWixPortalAccessData(PORTAL_ACCESS), caseId: undefined })).toBeNull();
  });

  it('applyPortalAccessUpdateToWixData only patches portalUserId/status/updatedAt — never organizationId/caseId/relationshipType/grantedFromInvitationId', () => {
    const existing = buildWixPortalAccessData(PORTAL_ACCESS);
    const patched = applyPortalAccessUpdateToWixData(existing, { portalUserId: 'portal-user-1', status: 'active' });
    expect(patched.portalUserId).toBe('portal-user-1');
    expect(patched.status).toBe('active');
    expect(patched.caseId).toBe(PORTAL_ACCESS.caseId);
    expect(patched.relationshipType).toBe(PORTAL_ACCESS.relationshipType);
    expect(patched.grantedFromInvitationId).toBe(PORTAL_ACCESS.grantedFromInvitationId);
  });
});
