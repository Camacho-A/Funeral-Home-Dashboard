import { describe, it, expect } from 'vitest';
import { mapWixPortalInvitationItem, buildWixPortalInvitationData, applyPortalInvitationUpdateToWixData } from './wixPortalInvitationMapper';
import type { PortalInvitation } from '../types/portalInvitation';

const PORTAL_INVITATION: PortalInvitation = {
  id: 'invitation-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  email: 'family@example.com',
  displayName: 'Pat Family',
  relationshipType: 'primary_next_of_kin',
  status: 'pending',
  tokenHash: 'a'.repeat(64),
  expiresAt: '2026-09-01T00:00:00.000Z',
  invitedByStaffIdentityId: 'identity-1',
  linkedPortalAccessId: 'portal-access-1',
  acceptedAt: null,
  revokedAt: null,
  revokedByStaffIdentityId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('wixPortalInvitationMapper', () => {
  it('round-trips a pending invitation', () => {
    expect(mapWixPortalInvitationItem(buildWixPortalInvitationData(PORTAL_INVITATION))).toEqual(PORTAL_INVITATION);
  });

  it('round-trips an accepted invitation', () => {
    const accepted: PortalInvitation = { ...PORTAL_INVITATION, status: 'accepted', acceptedAt: '2026-08-02T00:00:00.000Z' };
    expect(mapWixPortalInvitationItem(buildWixPortalInvitationData(accepted))).toEqual(accepted);
  });

  it('round-trips a revoked invitation', () => {
    const revoked: PortalInvitation = {
      ...PORTAL_INVITATION,
      status: 'revoked',
      revokedAt: '2026-08-03T00:00:00.000Z',
      revokedByStaffIdentityId: 'identity-2',
    };
    expect(mapWixPortalInvitationItem(buildWixPortalInvitationData(revoked))).toEqual(revoked);
  });

  it('returns null for undefined', () => {
    expect(mapWixPortalInvitationItem(undefined)).toBeNull();
  });

  it('returns null for an invalid status', () => {
    expect(mapWixPortalInvitationItem({ ...buildWixPortalInvitationData(PORTAL_INVITATION), status: 'bogus' })).toBeNull();
  });

  it('returns null when a required field (e.g. tokenHash) is missing', () => {
    expect(mapWixPortalInvitationItem({ ...buildWixPortalInvitationData(PORTAL_INVITATION), tokenHash: undefined })).toBeNull();
  });

  it('never persists a raw token — only tokenHash appears anywhere on the wire shape', () => {
    const built = buildWixPortalInvitationData(PORTAL_INVITATION);
    expect(Object.keys(built)).not.toContain('token');
    expect(built.tokenHash).toBe(PORTAL_INVITATION.tokenHash);
  });

  it('applyPortalInvitationUpdateToWixData only patches status/acceptedAt/revokedAt/revokedByStaffIdentityId/updatedAt', () => {
    const existing = buildWixPortalInvitationData(PORTAL_INVITATION);
    const patched = applyPortalInvitationUpdateToWixData(existing, { status: 'accepted', acceptedAt: '2026-08-02T00:00:00.000Z' });
    expect(patched.status).toBe('accepted');
    expect(patched.acceptedAt).toBe('2026-08-02T00:00:00.000Z');
    expect(patched.email).toBe(PORTAL_INVITATION.email);
    expect(patched.tokenHash).toBe(PORTAL_INVITATION.tokenHash);
  });
});
