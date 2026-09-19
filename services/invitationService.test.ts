import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  identityFixtures,
  membershipFixtures,
  emailVerificationTokenFixtures,
  MANORS_ADMIN_IDENTITY_ID,
} from './__mocks__/identityFixtures';
import { organizationRoleAuditEntryFixtures } from './__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { InviteToOrganizationResult } from './invitationService';

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

type InviteParams = {
  email: string;
  displayName: string;
  organizationId: string;
  role: string;
  invitedByIdentityId: string;
  idFactory: () => string;
};

/** Narrows to the 'invited' branch — the shape almost every pre-existing
    "happy path, brand new invite" test needs — so those tests don't each
    have to repeat the outcome check themselves. */
async function inviteFresh(params: InviteParams) {
  const { inviteToOrganization } = await import('./invitationService');
  const result = await inviteToOrganization(params, 'mock');
  if (result.outcome !== 'invited') throw new Error(`Expected outcome 'invited', got '${result.outcome}'`);
  return result;
}

function baseInvite(overrides: Partial<InviteParams> = {}): InviteParams {
  return {
    email: 'new.staff@example.com',
    displayName: 'New Staff',
    organizationId: DEFAULT_ORGANIZATION_ID,
    role: 'staff',
    invitedByIdentityId: MANORS_ADMIN_IDENTITY_ID,
    idFactory,
    ...overrides,
  };
}

describe('inviteToOrganization', () => {
  it('creates a new identity and an invited membership, and issues a token', async () => {
    const result = await inviteFresh(baseInvite());
    expect(result.outcome).toBe('invited');
    expect(result.membership.status).toBe('invited');
    expect(typeof result.verificationToken).toBe('string');
  });

  it('reuses an existing identity when inviting an already-known email to a different organization', async () => {
    // Manor's admin's own email, invited to a second organization.
    const result = await inviteFresh(
      baseInvite({ email: 'dana@managedcremations.test', displayName: 'Dana', organizationId: SECOND_MOCK_ORGANIZATION_ID }),
    );
    expect(result.identity.id).toBe(MANORS_ADMIN_IDENTITY_ID);
    expect(result.membership.organizationId).toBe(SECOND_MOCK_ORGANIZATION_ID);

    // Identity was never duplicated.
    expect(identityFixtures.filter((i) => i.id === MANORS_ADMIN_IDENTITY_ID)).toHaveLength(1);
  });

  it('is idempotent — inviting the same email to the same organization twice never duplicates the membership or reissues a token (outcome: already_invited)', async () => {
    const { inviteToOrganization } = await import('./invitationService');
    const input = baseInvite({ email: 'repeat.invite@example.com', displayName: 'Repeat' });
    const first = await inviteToOrganization(input, 'mock');
    const second = await inviteToOrganization(input, 'mock');

    expect(first.outcome).toBe('invited');
    expect(second.outcome).toBe('already_invited');
    expect(second.membership.id).toBe(first.membership.id);
    // 'already_invited' carries no verificationToken at all (not even null) — TS enforces this at the type level.
    expect('verificationToken' in second).toBe(false);
    // No duplicate membership row was created.
    expect(membershipFixtures.filter((m) => m.id === first.membership.id)).toHaveLength(1);
  });

  it('Manors go-live fix: an already-active member cannot be accidentally re-invited (outcome: already_active), and no second invitation is created', async () => {
    const { inviteToOrganization, acceptInvitation } = await import('./invitationService');
    const invited = await inviteFresh(baseInvite({ email: 'already.active.reinvite@example.com', displayName: 'Already Active' }));
    await acceptInvitation({ token: invited.verificationToken, membershipId: invited.membership.id, password: 'Active1!' }, 'mock');

    const second = await inviteToOrganization(baseInvite({ email: 'already.active.reinvite@example.com', displayName: 'Already Active' }), 'mock');
    expect(second.outcome).toBe('already_active');
    expect(second.membership.id).toBe(invited.membership.id);
    expect(second.membership.status).toBe('active');
    expect('verificationToken' in second).toBe(false);
  });

  it('Manors go-live fix: a disabled membership is never silently reactivated by re-inviting — outcome is explicitly "disabled"', async () => {
    const { inviteToOrganization } = await import('./invitationService');
    const { updateMembership } = await import('./membershipService');
    const invited = await inviteFresh(baseInvite({ email: 'disabled.reinvite@example.com', displayName: 'Disabled Person' }));
    await updateMembership(invited.membership.id, { status: 'disabled' }, 'mock');

    const second = await inviteToOrganization(baseInvite({ email: 'disabled.reinvite@example.com', displayName: 'Disabled Person' }), 'mock');
    expect(second.outcome).toBe('disabled');
    expect(second.membership.id).toBe(invited.membership.id);
    // Still disabled — re-inviting never changed its status.
    expect(membershipFixtures.find((m) => m.id === invited.membership.id)?.status).toBe('disabled');
    expect('verificationToken' in second).toBe(false);
  });

  describe('Manors go-live fix — re-inviting a previously removed membership', () => {
    it('reactivates the existing membership (never a duplicate), applies the newly selected role, and mints a completely fresh token', async () => {
      const { inviteToOrganization, revokeInvitation } = await import('./invitationService');
      const firstInvite = await inviteFresh(baseInvite({ email: 'removed.reinvite@example.com', displayName: 'Removed Person', role: 'staff' }));
      const originalMembershipId = firstInvite.membership.id;
      const originalToken = firstInvite.verificationToken;

      await revokeInvitation(
        { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: originalMembershipId, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
        'mock',
      );
      expect(membershipFixtures.find((m) => m.id === originalMembershipId)?.status).toBe('removed');

      const membershipCountBeforeReinvite = membershipFixtures.length;

      // Re-invite with a DIFFERENT role than originally granted.
      const result = await inviteToOrganization(
        baseInvite({ email: 'removed.reinvite@example.com', displayName: 'Removed Person', role: 'manager' }),
        'mock',
      );

      expect(result.outcome).toBe('reactivated');
      // #10: no duplicate membership — same row id, reused in place, row count unchanged.
      expect(result.membership.id).toBe(originalMembershipId);
      expect(membershipFixtures).toHaveLength(membershipCountBeforeReinvite);
      expect(result.membership.status).toBe('invited');
      // #9: the newly selected role was applied, not the original one.
      expect(result.membership.role).toBe('manager');
      expect(result.membership.joinedAt).toBeNull();

      if (result.outcome !== 'reactivated') throw new Error('unreachable');
      // A completely fresh token — never the old, already-invalidated one.
      expect(result.verificationToken).not.toBe(originalToken);

      // #5: the OLD token (invalidated by revoke) remains permanently unusable
      // even after reactivation — acceptInvitation with it must still fail.
      const { acceptInvitation } = await import('./invitationService');
      const oldTokenResult = await acceptInvitation({ token: originalToken, membershipId: originalMembershipId, password: 'ShouldFail1!' }, 'mock');
      expect(oldTokenResult.success).toBe(false);

      // The fresh token, however, genuinely works.
      const freshTokenResult = await acceptInvitation({ token: result.verificationToken, membershipId: originalMembershipId, password: 'Fresh1!' }, 'mock');
      expect(freshTokenResult.success).toBe(true);
      if (freshTokenResult.success) expect(freshTokenResult.membership.role).toBe('manager');
    });

    it('preserves createdAt (the original membership row, not a new one) while reactivating', async () => {
      const { inviteToOrganization, revokeInvitation } = await import('./invitationService');
      const firstInvite = await inviteFresh(baseInvite({ email: 'removed.preserve.created@example.com', displayName: 'X' }));
      const originalCreatedAt = firstInvite.membership.createdAt;

      await revokeInvitation(
        { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: firstInvite.membership.id, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
        'mock',
      );
      const result = await inviteToOrganization(baseInvite({ email: 'removed.preserve.created@example.com', displayName: 'X' }), 'mock');

      expect(result.membership.createdAt).toBe(originalCreatedAt);
    });
  });
});

describe('acceptInvitation', () => {
  it('verifies email, sets password, and activates the membership', async () => {
    const invited = await inviteFresh(baseInvite({ email: 'accept.me@example.com', displayName: 'Accept Me' }));

    const { acceptInvitation } = await import('./invitationService');
    const result = await acceptInvitation({ token: invited.verificationToken, membershipId: invited.membership.id, password: 'BrandNew1!' }, 'mock');
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
    const invited = await inviteFresh(baseInvite({ email: 'bad.token@example.com', displayName: 'Bad Token' }));
    const { acceptInvitation } = await import('./invitationService');
    const result = await acceptInvitation({ token: 'forged', membershipId: invited.membership.id, password: 'X1!' }, 'mock');
    expect(result.success).toBe(false);
  });
});

describe('regenerateInvitation', () => {
  it('issues a fresh, working token for an expired invitation', async () => {
    const invited = await inviteFresh(baseInvite({ email: 'expired.invite@example.com', displayName: 'Expired Invite' }));
    // Force the original token to be expired.
    const originalRecord = emailVerificationTokenFixtures.find((t) => t.identityId === invited.identity.id)!;
    originalRecord.expiresAt = new Date(Date.now() - 1000).toISOString();

    const { regenerateInvitation, acceptInvitation } = await import('./invitationService');
    const { token: freshToken } = await regenerateInvitation(invited.membership.id, invited.identity.id, idFactory, 'mock');
    const result = await acceptInvitation({ token: freshToken, membershipId: invited.membership.id, password: 'Fresh1!' }, 'mock');
    expect(result.success).toBe(true);
  });
});

describe('listPendingInvitations', () => {
  it('lists an invited membership with the fields the Team page needs, and derives lastResentAt only after a resend', async () => {
    const invited = await inviteFresh(baseInvite({ email: 'pending.one@example.com', displayName: 'Pending One' }));

    const { listPendingInvitations } = await import('./invitationService');
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
    const invited = await inviteFresh(baseInvite({ email: 'pending.expired@example.com', displayName: 'Pending Expired' }));
    const tokenRecord = emailVerificationTokenFixtures.find((t) => t.identityId === invited.identity.id)!;
    tokenRecord.expiresAt = new Date(Date.now() - 1000).toISOString();

    const { listPendingInvitations } = await import('./invitationService');
    const rows = await listPendingInvitations(DEFAULT_ORGANIZATION_ID, 'mock');
    const row = rows.find((r) => r.membershipId === invited.membership.id)!;
    expect(row.status).toBe('expired');
    expect(membershipFixtures.find((m) => m.id === invited.membership.id)?.status).toBe('invited'); // still 'invited' underneath
  });

  it('excludes invitations from other organizations and excludes already-active memberships', async () => {
    const otherOrgInvite = await inviteFresh(baseInvite({ email: 'other.org@example.com', displayName: 'Other Org', organizationId: SECOND_MOCK_ORGANIZATION_ID }));
    const acceptedInvite = await inviteFresh(baseInvite({ email: 'already.active@example.com', displayName: 'Already Active' }));

    const { acceptInvitation, listPendingInvitations } = await import('./invitationService');
    await acceptInvitation({ token: acceptedInvite.verificationToken, membershipId: acceptedInvite.membership.id, password: 'Active1!' }, 'mock');

    const rows = await listPendingInvitations(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(rows.some((r) => r.membershipId === otherOrgInvite.membership.id)).toBe(false);
    expect(rows.some((r) => r.membershipId === acceptedInvite.membership.id)).toBe(false);
  });
});

describe('revokeInvitation', () => {
  it('revokes a pending invitation, invalidates its token, and records an invitation_revoked audit entry', async () => {
    const invited = await inviteFresh(baseInvite({ email: 'revoke.me@example.com', displayName: 'Revoke Me' }));

    const { revokeInvitation, acceptInvitation } = await import('./invitationService');
    const result = await revokeInvitation(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: invited.membership.id, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(result.outcome).toBe('revoked');
    if (result.outcome === 'revoked') expect(result.membership.status).toBe('removed');

    // The original invitation token can no longer be used to accept.
    const acceptResult = await acceptInvitation({ token: invited.verificationToken, membershipId: invited.membership.id, password: 'TooLate1!' }, 'mock');
    expect(acceptResult.success).toBe(false);

    const audit = organizationRoleAuditEntryFixtures.filter((e) => e.targetIdentityId === invited.identity.id && e.action === 'invitation_revoked');
    expect(audit).toHaveLength(1);
  });

  it('is idempotent when the invitation was already revoked', async () => {
    const invited = await inviteFresh(baseInvite({ email: 'revoke.twice@example.com', displayName: 'Revoke Twice' }));

    const { revokeInvitation } = await import('./invitationService');
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
    const invited = await inviteFresh(baseInvite({ email: 'already.accepted@example.com', displayName: 'Already Accepted' }));
    const { acceptInvitation, revokeInvitation } = await import('./invitationService');
    await acceptInvitation({ token: invited.verificationToken, membershipId: invited.membership.id, password: 'Accepted1!' }, 'mock');

    const result = await revokeInvitation(
      { organizationId: DEFAULT_ORGANIZATION_ID, membershipId: invited.membership.id, actorIdentityId: MANORS_ADMIN_IDENTITY_ID, idFactory },
      'mock',
    );
    expect(result.outcome).toBe('already_accepted');
    expect(membershipFixtures.find((m) => m.id === invited.membership.id)?.status).toBe('active'); // untouched
  });

  it('returns not_found for an unknown membershipId or one belonging to a different organization', async () => {
    const invited = await inviteFresh(baseInvite({ email: 'cross.org.revoke@example.com', displayName: 'Cross Org', organizationId: SECOND_MOCK_ORGANIZATION_ID }));
    const { revokeInvitation } = await import('./invitationService');

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

// Compile-time exhaustiveness guard — if a new MembershipStatus is ever
// added, this function stops compiling until inviteToOrganization's own
// switch (and this test file) explicitly accounts for it.
function assertExhaustiveOutcome(outcome: InviteToOrganizationResult['outcome']): void {
  switch (outcome) {
    case 'invited':
    case 'reactivated':
    case 'already_invited':
    case 'already_active':
    case 'disabled':
      return;
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`Unhandled outcome: ${_exhaustive}`);
    }
  }
}
void assertExhaustiveOutcome;
