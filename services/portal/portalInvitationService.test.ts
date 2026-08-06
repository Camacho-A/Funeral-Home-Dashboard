import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { portalInvitationFixtures } from '../__mocks__/portalFixtures';
import { portalAccessFixtures } from '../__mocks__/portalFixtures';
import { portalUserFixtures, portalSessionFixtures } from '../__mocks__/portalFixtures';
import type { ActivityContext } from '../activityService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `portal-invitation-test-${idCounter}`;
}

function staffCtx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: 'org-1',
    actorIdentityId: 'staff-identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'funeralDirector',
    correlationId: 'corr-invite',
    ...overrides,
  };
}

let lengths: { invitations: number; access: number; users: number; sessions: number };
beforeEach(() => {
  idCounter = 0;
  lengths = {
    invitations: portalInvitationFixtures.length,
    access: portalAccessFixtures.length,
    users: portalUserFixtures.length,
    sessions: portalSessionFixtures.length,
  };
});
afterEach(() => {
  portalInvitationFixtures.length = lengths.invitations;
  portalAccessFixtures.length = lengths.access;
  portalUserFixtures.length = lengths.users;
  portalSessionFixtures.length = lengths.sessions;
});

describe('portalInvitationService', () => {
  it('issueInvitation creates a pending invitation and its linked pending PortalAccess grant together', async () => {
    const { issueInvitation } = await import('./portalInvitationService');
    const { invitation, rawToken } = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-1', email: 'family@example.com', displayName: 'Pat Family', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );

    expect(invitation.status).toBe('pending');
    expect(typeof rawToken).toBe('string');
    expect(rawToken.length).toBeGreaterThan(0);

    const linkedAccess = portalAccessFixtures.find((a) => a.id === invitation.linkedPortalAccessId);
    expect(linkedAccess?.status).toBe('pending');
    expect(linkedAccess?.portalUserId).toBeNull();
    expect(linkedAccess?.relationshipType).toBe('primary_next_of_kin');
  });

  it('never persists the raw token — only tokenHash is ever stored', async () => {
    const { issueInvitation } = await import('./portalInvitationService');
    const { invitation, rawToken } = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-2', email: 'family2@example.com', displayName: 'Pat Family', relationshipType: 'executor', idFactory },
      staffCtx(),
      'mock',
    );

    expect(invitation.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(invitation)).not.toContain(rawToken);
  });

  it('listPendingInvitationsForCase only returns pending invitations for that case', async () => {
    const { issueInvitation, listPendingInvitationsForCase } = await import('./portalInvitationService');
    await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-list', email: 'a@example.com', displayName: 'A', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );
    await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-other', email: 'b@example.com', displayName: 'B', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );

    const list = await listPendingInvitationsForCase('org-1', 'case-list', 'mock');
    expect(list).toHaveLength(1);
    expect(list[0].email).toBe('a@example.com');
  });

  it('revokeInvitation flips the invitation to revoked and its linked PortalAccess to revoked too — no orphaned pending grant', async () => {
    const { issueInvitation, revokeInvitation } = await import('./portalInvitationService');
    const { invitation } = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-revoke', email: 'revoke@example.com', displayName: 'Revoke Me', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );

    const revoked = await revokeInvitation('org-1', invitation.id, staffCtx(), 'mock');
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedByStaffIdentityId).toBe('staff-identity-1');

    const linkedAccess = portalAccessFixtures.find((a) => a.id === invitation.linkedPortalAccessId);
    expect(linkedAccess?.status).toBe('revoked');
  });

  it('revokeInvitation is idempotent on an already-revoked invitation', async () => {
    const { issueInvitation, revokeInvitation } = await import('./portalInvitationService');
    const { invitation } = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-idempotent', email: 'idempotent@example.com', displayName: 'X', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );
    await revokeInvitation('org-1', invitation.id, staffCtx(), 'mock');
    const secondCall = await revokeInvitation('org-1', invitation.id, staffCtx(), 'mock');
    expect(secondCall.status).toBe('revoked');
  });

  it('expireOverduePortalInvitations flips an overdue pending invitation and its linked grant to expired', async () => {
    const { issueInvitation, expireOverduePortalInvitations } = await import('./portalInvitationService');
    const { invitation } = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-expire', email: 'expire@example.com', displayName: 'X', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );
    const record = portalInvitationFixtures.find((i) => i.id === invitation.id)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();

    const count = await expireOverduePortalInvitations('org-1', 'mock');
    expect(count).toBe(1);

    const updated = portalInvitationFixtures.find((i) => i.id === invitation.id)!;
    expect(updated.status).toBe('expired');
    const linkedAccess = portalAccessFixtures.find((a) => a.id === invitation.linkedPortalAccessId);
    expect(linkedAccess?.status).toBe('expired');
  });

  it('acceptInvitation activates the grant, creates a portal user + fresh session, and marks the invitation accepted', async () => {
    const { issueInvitation, acceptInvitation } = await import('./portalInvitationService');
    const { invitation, rawToken } = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-accept', email: 'accept@example.com', displayName: 'Pat Family', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );

    const result = await acceptInvitation({ token: rawToken, password: 'Password123!', deviceId: 'device-1', idFactory }, 'mock');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.portalUser.email).toBe('accept@example.com');
      expect(result.portalSession.portalUserId).toBe(result.portalUser.id);
    }

    const updatedInvitation = portalInvitationFixtures.find((i) => i.id === invitation.id)!;
    expect(updatedInvitation.status).toBe('accepted');
    expect(updatedInvitation.acceptedAt).not.toBeNull();

    const linkedAccess = portalAccessFixtures.find((a) => a.id === invitation.linkedPortalAccessId)!;
    expect(linkedAccess.status).toBe('active');
    expect(linkedAccess.portalUserId).not.toBeNull();
  });

  it('acceptInvitation rejects an already-accepted invitation (no replay)', async () => {
    const { issueInvitation, acceptInvitation } = await import('./portalInvitationService');
    const { rawToken } = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-replay', email: 'replay@example.com', displayName: 'X', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );
    await acceptInvitation({ token: rawToken, password: 'Password123!', deviceId: 'device-1', idFactory }, 'mock');
    const second = await acceptInvitation({ token: rawToken, password: 'Password123!', deviceId: 'device-2', idFactory }, 'mock');

    expect(second).toEqual({ success: false, reason: 'already_used' });
  });

  it('acceptInvitation rejects a revoked-then-accept attempt', async () => {
    const { issueInvitation, revokeInvitation, acceptInvitation } = await import('./portalInvitationService');
    const { invitation, rawToken } = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-revoked-accept', email: 'revoked-accept@example.com', displayName: 'X', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );
    await revokeInvitation('org-1', invitation.id, staffCtx(), 'mock');

    const result = await acceptInvitation({ token: rawToken, password: 'Password123!', deviceId: 'device-1', idFactory }, 'mock');
    expect(result).toEqual({ success: false, reason: 'invalid_or_expired' });
  });

  it('acceptInvitation rejects an unknown token without distinguishing why', async () => {
    const { acceptInvitation } = await import('./portalInvitationService');
    const result = await acceptInvitation({ token: 'not-a-real-token', password: 'Password123!', deviceId: 'device-1', idFactory }, 'mock');
    expect(result).toEqual({ success: false, reason: 'invalid_or_expired' });
  });

  it('a second invitation acceptance for the same email reuses the existing PortalUser rather than creating a duplicate', async () => {
    const { issueInvitation, acceptInvitation } = await import('./portalInvitationService');
    const first = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-first', email: 'shared-family@example.com', displayName: 'Pat Family', relationshipType: 'primary_next_of_kin', idFactory },
      staffCtx(),
      'mock',
    );
    const firstAccept = await acceptInvitation({ token: first.rawToken, password: 'Password123!', deviceId: 'device-1', idFactory }, 'mock');

    const second = await issueInvitation(
      { organizationId: 'org-1', caseId: 'case-second', email: 'shared-family@example.com', displayName: 'Pat Family', relationshipType: 'secondary_family_member', idFactory },
      staffCtx(),
      'mock',
    );
    const secondAccept = await acceptInvitation({ token: second.rawToken, password: 'DifferentPassword1!', deviceId: 'device-2', idFactory }, 'mock');

    expect(firstAccept.success).toBe(true);
    expect(secondAccept.success).toBe(true);
    if (firstAccept.success && secondAccept.success) {
      expect(secondAccept.portalUser.id).toBe(firstAccept.portalUser.id);
      // A fresh session is minted each time — never reused.
      expect(secondAccept.portalSession.id).not.toBe(firstAccept.portalSession.id);
    }
  });
});
