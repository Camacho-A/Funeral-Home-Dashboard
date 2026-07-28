import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  identityFixtures,
  membershipFixtures,
  emailVerificationTokenFixtures,
  MANORS_ADMIN_IDENTITY_ID,
} from './__mocks__/identityFixtures';
import { organizationRoleAuditEntryFixtures } from './__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `invite-test-${idCounter}`;
}

let lengths: { identity: number; membership: number; tokens: number; audit: number };
beforeEach(() => {
  idCounter = 0;
  lengths = {
    identity: identityFixtures.length,
    membership: membershipFixtures.length,
    tokens: emailVerificationTokenFixtures.length,
    audit: organizationRoleAuditEntryFixtures.length,
  };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  emailVerificationTokenFixtures.length = lengths.tokens;
  organizationRoleAuditEntryFixtures.length = lengths.audit;
});

describe('inviteToOrganization', () => {
  it('creates a new identity and an invited membership, and issues a token', async () => {
    const { inviteToOrganization } = await import('./invitationService');
    const result = await inviteToOrganization(
      { email: 'new.staff@example.com', displayName: 'New Staff', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(result.isNewIdentity).toBe(true);
    expect(result.isNewMembership).toBe(true);
    expect(result.membership.status).toBe('invited');
    expect(result.verificationToken).not.toBeNull();
  });

  it('reuses an existing identity when inviting an already-known email to a different organization', async () => {
    const { inviteToOrganization } = await import('./invitationService');
    // Manor's admin's own email, invited to a second organization.
    const result = await inviteToOrganization(
      { email: 'dana@managedcremations.test', displayName: 'Dana', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(result.isNewIdentity).toBe(false);
    expect(result.identity.id).toBe(MANORS_ADMIN_IDENTITY_ID);
    expect(result.membership.organizationId).toBe(SECOND_MOCK_ORGANIZATION_ID);

    // Identity was never duplicated.
    expect(identityFixtures.filter((i) => i.id === MANORS_ADMIN_IDENTITY_ID)).toHaveLength(1);
  });

  it('is idempotent — inviting the same email to the same organization twice never duplicates the membership or reissues a token', async () => {
    const { inviteToOrganization } = await import('./invitationService');
    const input = { email: 'repeat.invite@example.com', displayName: 'Repeat', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff' as const, invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory };
    const first = await inviteToOrganization(input, 'mock');
    const second = await inviteToOrganization(input, 'mock');

    expect(second.isNewMembership).toBe(false);
    expect(second.membership.id).toBe(first.membership.id);
    expect(second.verificationToken).toBeNull(); // no fresh token spammed for a repeat invite
  });
});

describe('acceptInvitation', () => {
  it('verifies email, sets password, and activates the membership', async () => {
    const { inviteToOrganization, acceptInvitation } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'accept.me@example.com', displayName: 'Accept Me', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );

    const result = await acceptInvitation({ token: invited.verificationToken!, membershipId: invited.membership.id, password: 'BrandNew1!' }, 'mock');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.membership.status).toBe('active');
      expect(result.membership.joinedAt).not.toBeNull();
    }

    const { verifyPassword } = await import('./passwordService');
    expect(await verifyPassword(invited.identity.id, 'BrandNew1!', 'mock')).toBe(true);

    const { getIdentityById } = await import('./identityService');
    expect((await getIdentityById(invited.identity.id, 'mock'))?.emailVerified).toBe(true);
  });

  it('rejects an invalid token', async () => {
    const { inviteToOrganization, acceptInvitation } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'bad.token@example.com', displayName: 'Bad Token', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    const result = await acceptInvitation({ token: 'forged', membershipId: invited.membership.id, password: 'X1!' }, 'mock');
    expect(result.success).toBe(false);
  });
});

describe('regenerateInvitation', () => {
  it('issues a fresh, working token for an expired invitation', async () => {
    const { inviteToOrganization, regenerateInvitation, acceptInvitation } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'expired.invite@example.com', displayName: 'Expired Invite', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    // Force the original token to be expired.
    const originalRecord = emailVerificationTokenFixtures.find((t) => t.identityId === invited.identity.id)!;
    originalRecord.expiresAt = new Date(Date.now() - 1000).toISOString();

    const { token: freshToken } = await regenerateInvitation(invited.membership.id, invited.identity.id, idFactory, 'mock');
    const result = await acceptInvitation({ token: freshToken, membershipId: invited.membership.id, password: 'Fresh1!' }, 'mock');
    expect(result.success).toBe(true);
  });
});

describe('listPendingInvitations', () => {
  it('lists an invited membership with the fields the Team page needs, and derives lastResentAt only after a resend', async () => {
    const { inviteToOrganization, listPendingInvitations } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'pending.one@example.com', displayName: 'Pending One', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );

    const beforeResend = await listPendingInvitations(DEFAULT_ORGANIZATION_ID, 'mock');
    const row = beforeResend.find((r) => r.membershipId === invited.membership.id)!;
    expect(row).toBeTruthy();
    expect(row.email).toBe('pending.one@example.com');
    expect(row.displayName).toBe('Pending One');
    expect(row.role).toBe('staff');
    expect(row.status).toBe('pending');
    expect(row.expiresAt).not.toBeNull();
    expect(row.lastResentAt).toBeNull(); // never resent yet

    const { regenerateInvitation } = await import('./invitationService');
    await regenerateInvitation(invited.membership.id, invited.identity.id, idFactory, 'mock');

    const afterResend = await listPendingInvitations(DEFAULT_ORGANIZATION_ID, 'mock');
    const rowAfter = afterResend.find((r) => r.membershipId === invited.membership.id)!;
    expect(rowAfter.lastResentAt).not.toBeNull();
  });

  it('marks an invitation whose token has lapsed as expired, without changing its underlying membership status', async () => {
    const { inviteToOrganization, listPendingInvitations } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'pending.expired@example.com', displayName: 'Pending Expired', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    const tokenRecord = emailVerificationTokenFixtures.find((t) => t.identityId === invited.identity.id)!;
    tokenRecord.expiresAt = new Date(Date.now() - 1000).toISOString();

    const rows = await listPendingInvitations(DEFAULT_ORGANIZATION_ID, 'mock');
    const row = rows.find((r) => r.membershipId === invited.membership.id)!;
    expect(row.status).toBe('expired');
    expect(membershipFixtures.find((m) => m.id === invited.membership.id)?.status).toBe('invited'); // still 'invited' underneath
  });

  it('excludes invitations from other organizations and excludes already-active memberships', async () => {
    const { inviteToOrganization, acceptInvitation, listPendingInvitations } = await import('./invitationService');
    const otherOrgInvite = await inviteToOrganization(
      { email: 'other.org@example.com', displayName: 'Other Org', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    const acceptedInvite = await inviteToOrganization(
      { email: 'already.active@example.com', displayName: 'Already Active', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    await acceptInvitation({ token: acceptedInvite.verificationToken!, membershipId: acceptedInvite.membership.id, password: 'Active1!' }, 'mock');

    const rows = await listPendingInvitations(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(rows.some((r) => r.membershipId === otherOrgInvite.membership.id)).toBe(false);
    expect(rows.some((r) => r.membershipId === acceptedInvite.membership.id)).toBe(false);
  });
});

describe('revokeInvitation', () => {
  it('revokes a pending invitation, invalidates its token, and records an invitation_revoked audit entry', async () => {
    const { inviteToOrganization, revokeInvitation, acceptInvitation } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'revoke.me@example.com', displayName: 'Revoke Me', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );

    const result = await revokeInvitation(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: invited.membership.id, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(result.outcome).toBe('revoked');
    if (result.outcome === 'revoked') expect(result.membership.status).toBe('removed');

    // The original invitation token can no longer be used to accept.
    const acceptResult = await acceptInvitation({ token: invited.verificationToken!, membershipId: invited.membership.id, password: 'TooLate1!' }, 'mock');
    expect(acceptResult.success).toBe(false);

    const audit = organizationRoleAuditEntryFixtures.filter((e) => e.targetIdentityId === invited.identity.id && e.action === 'invitation_revoked');
    expect(audit).toHaveLength(1);
  });

  it('is idempotent when the invitation was already revoked', async () => {
    const { inviteToOrganization, revokeInvitation } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'revoke.twice@example.com', displayName: 'Revoke Twice', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    const first = await revokeInvitation(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: invited.membership.id, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(first.outcome).toBe('revoked');

    const second = await revokeInvitation(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: invited.membership.id, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(second.outcome).toBe('already_revoked');

    const audit = organizationRoleAuditEntryFixtures.filter((e) => e.targetIdentityId === invited.identity.id && e.action === 'invitation_revoked');
    expect(audit).toHaveLength(1); // no duplicate audit entry on the idempotent second call
  });

  it('refuses to revoke an already-accepted invitation, leaving the active member untouched', async () => {
    const { inviteToOrganization, acceptInvitation, revokeInvitation } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'already.accepted@example.com', displayName: 'Already Accepted', organizationId: DEFAULT_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    await acceptInvitation({ token: invited.verificationToken!, membershipId: invited.membership.id, password: 'Accepted1!' }, 'mock');

    const result = await revokeInvitation(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: invited.membership.id, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(result.outcome).toBe('already_accepted');
    expect(membershipFixtures.find((m) => m.id === invited.membership.id)?.status).toBe('active'); // untouched
  });

  it('returns not_found for an unknown membershipId or one belonging to a different organization', async () => {
    const { inviteToOrganization, revokeInvitation } = await import('./invitationService');
    const invited = await inviteToOrganization(
      { email: 'cross.org.revoke@example.com', displayName: 'Cross Org', organizationId: SECOND_MOCK_ORGANIZATION_ID, role: 'staff', invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );

    const unknown = await revokeInvitation(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: 'no-such-membership', actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(unknown.outcome).toBe('not_found');

    // Genuine row, but scoped to a *different* organization than requested.
    const crossOrg = await revokeInvitation(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: invited.membership.id, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(crossOrg.outcome).toBe('not_found');
  });
});
