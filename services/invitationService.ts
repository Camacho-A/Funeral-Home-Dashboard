import type { DataAdapterMode } from '../lib/env';
import type { Membership, MembershipRole } from '../types/membership';
import type { Identity } from '../types/identity';
import { findOrCreateIdentity } from './identityService';
import { createMembership, activateMembership } from './membershipService';
import { createVerificationToken, resendVerification, verifyEmailWithToken } from './emailVerificationService';
import { setPassword } from './passwordService';

/**
 * Phase 21 (Identity, Authentication & Session Management). "Organization
 * Administrator -> Invite Staff -> Email sent -> Accept Invitation ->
 * Verify Email -> Create Password -> Membership Activated." There is no
 * dedicated "invitation" Wix collection — an invitation *is* a
 * `Membership` row with `status: 'invited'`, and "Membership Activated"
 * is exactly that row transitioning to `'active'`. See
 * `types/membership.ts`'s own comment.
 */

/**
 * Idempotent: inviting an email already invited/active in this
 * organization returns the existing membership (`isNewMembership: false`)
 * rather than creating a duplicate row or silently re-inviting. Inviting
 * an email that already has an `Identity` (e.g. already a member of a
 * different organization) reuses that identity — never creates a second
 * one for the same person.
 */
export async function inviteToOrganization(
  params: {
    email: string;
    displayName: string;
    organizationId: string;
    role: MembershipRole;
    invitedByIdentityId: string;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<{
  identity: Identity;
  membership: Membership;
  isNewIdentity: boolean;
  isNewMembership: boolean;
  verificationToken: string | null;
}> {
  const { identity, isNew: isNewIdentity } = await findOrCreateIdentity(
    { email: params.email, displayName: params.displayName, idFactory: params.idFactory },
    dataAdapterMode,
  );

  const { membership, isNew: isNewMembership } = await createMembership(
    {
      identityId: identity.id,
      organizationId: params.organizationId,
      role: params.role,
      status: 'invited',
      invitedBy: params.invitedByIdentityId,
      idFactory: params.idFactory,
    },
    dataAdapterMode,
  );

  // Only issue a fresh verification/acceptance token for a genuinely new
  // invitation — re-inviting an already-invited/active membership doesn't
  // spam a new token on every call.
  let verificationToken: string | null = null;
  if (isNewMembership) {
    const { token } = await createVerificationToken(identity.id, params.idFactory, dataAdapterMode);
    verificationToken = token;
  }

  return { identity, membership, isNewIdentity, isNewMembership, verificationToken };
}

/** "Expired invitations may be regenerated" — re-issues an
    acceptance/verification token for the identity behind an existing
    'invited' membership. */
export async function regenerateInvitation(
  membershipId: string,
  identityId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ token: string }> {
  return resendVerification(identityId, idFactory, dataAdapterMode);
}

export type AcceptInvitationResult =
  | { success: true; identityId: string; membership: Membership }
  | { success: false; reason: 'invalid_token' | 'expired_token' | 'already_used' | 'membership_not_found' };

/**
 * "Accept Invitation -> Verify Email -> Create Password -> Membership
 * Activated," as one atomic-from-the-caller's-perspective operation.
 * `membershipId` is required alongside the token because one identity can
 * have more than one pending invitation (multiple organizations) sharing
 * the same email-verification mechanism — the token alone proves email
 * ownership; `membershipId` says which specific invitation is being
 * accepted.
 */
export async function acceptInvitation(
  params: { token: string; membershipId: string; password: string },
  dataAdapterMode: DataAdapterMode,
): Promise<AcceptInvitationResult> {
  const verification = await verifyEmailWithToken(params.token, dataAdapterMode);
  if (!verification.success) return { success: false, reason: verification.reason };

  const activated = await activateMembership(params.membershipId, dataAdapterMode);
  if (!activated || activated.identityId !== verification.identityId) {
    return { success: false, reason: 'membership_not_found' };
  }

  await setPassword(verification.identityId, params.password, dataAdapterMode);

  return { success: true, identityId: verification.identityId, membership: activated };
}
