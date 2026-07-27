import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  identityFixtures,
  membershipFixtures,
  emailVerificationTokenFixtures,
  MANORS_ADMIN_IDENTITY_ID,
} from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `invite-test-${idCounter}`;
}

let lengths: { identity: number; membership: number; tokens: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, membership: membershipFixtures.length, tokens: emailVerificationTokenFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  membershipFixtures.length = lengths.membership;
  emailVerificationTokenFixtures.length = lengths.tokens;
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
