import type { DataAdapterMode } from '../lib/env';
import type { Membership } from '../types/membership';
import type { Identity } from '../types/identity';
import { findOrCreateIdentity, getIdentityById } from './identityService';
import { createMembership, activateMembership, listMembershipsForOrganization, updateMembership } from './membershipService';
import { createVerificationToken, resendVerification, verifyEmailWithToken, listTokensForIdentity, invalidateTokensForIdentity } from './emailVerificationService';
import { setPassword } from './passwordService';
import { insertAuditEntry } from './roleService';

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
    role: string;
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

/**
 * Phase 23 (Team Management). One row per still-`invited` membership in the
 * organization, enriched with what the Team page needs to display and act
 * on it. "Expiration"/"last resent" are derived from
 * `emailVerificationTokens` (there is no separate field for either on
 * `Membership` itself — `createVerificationToken`/`resendVerification` each
 * insert a new token row, never mutating an old one, so the *latest* token
 * by `createdAt` is always the currently-live one). `status: 'expired'` is
 * a UI-only derived label, not a stored `MembershipStatus` value — an
 * expired invitation is still `status: 'invited'` underneath and behaves
 * identically to a live one for every other purpose (including revoke).
 */
export type PendingInvitation = {
  membershipId: string;
  identityId: string;
  email: string;
  displayName: string;
  role: string;
  status: 'pending' | 'expired';
  createdAt: string;
  expiresAt: string | null;
  /** Set only if the invitation was resent at least once — the most
      recent resend's token-issue time. Null for a never-resent invitation. */
  lastResentAt: string | null;
};

export async function listPendingInvitations(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<PendingInvitation[]> {
  const invited = (await listMembershipsForOrganization(organizationId, dataAdapterMode)).filter((m) => m.status === 'invited');

  return Promise.all(
    invited.map(async (membership) => {
      const identity = await getIdentityById(membership.identityId, dataAdapterMode);
      const tokens = (await listTokensForIdentity(membership.identityId, dataAdapterMode)).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const latestToken = tokens[tokens.length - 1] ?? null;
      const expiresAt = latestToken?.expiresAt ?? null;
      const lastResentAt = tokens.length > 1 ? latestToken!.createdAt : null;
      const isExpired = expiresAt !== null && new Date(expiresAt).getTime() < Date.now();

      return {
        membershipId: membership.id,
        identityId: membership.identityId,
        email: identity?.email ?? '',
        displayName: identity?.displayName ?? membership.identityId,
        role: membership.role,
        status: isExpired ? ('expired' as const) : ('pending' as const),
        createdAt: membership.createdAt,
        expiresAt,
        lastResentAt,
      };
    }),
  );
}

export type RevokeInvitationResult =
  | { outcome: 'revoked'; membership: Membership }
  | { outcome: 'already_revoked'; membership: Membership }
  | { outcome: 'already_accepted' }
  | { outcome: 'not_found' };

/**
 * Cancels a still-pending invitation — `status: 'invited'` → `'removed'` —
 * and invalidates any live email-verification/acceptance token for that
 * identity so a previously-sent invite link can never be used afterward.
 * Deliberately does **not** run under `organizationLockService`'s
 * per-organization lock: an invited (not yet active) membership never
 * counts toward the last-administrator invariant
 * (`countActiveAdminTierMembers` only ever considers active memberships),
 * so there is no race for a lock to protect here.
 *
 * Idempotent on an already-revoked invitation (returns `'already_revoked'`,
 * no error, no duplicate audit entry). Refuses — rather than silently
 * no-op'ing — to touch an invitation that has already been accepted
 * (`status: 'active'`): that is a different membership lifecycle entirely
 * (see `setMembershipStatus`), and conflating the two here could otherwise
 * let a stale UI action accidentally deactivate a real, active member.
 */
export async function revokeInvitation(
  params: { organizationId: string; membershipId: string; actorIdentityId: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<RevokeInvitationResult> {
  const memberships = await listMembershipsForOrganization(params.organizationId, dataAdapterMode);
  const membership = memberships.find((m) => m.id === params.membershipId);
  if (!membership) return { outcome: 'not_found' };

  if (membership.status === 'active') return { outcome: 'already_accepted' };
  if (membership.status === 'removed') return { outcome: 'already_revoked', membership };
  if (membership.status !== 'invited') return { outcome: 'not_found' };

  const updated = await updateMembership(membership.id, { status: 'removed' }, dataAdapterMode);
  if (!updated) return { outcome: 'not_found' };

  await invalidateTokensForIdentity(membership.identityId, dataAdapterMode);

  await insertAuditEntry(
    {
      id: params.idFactory(),
      organizationId: params.organizationId,
      actorIdentityId: params.actorIdentityId,
      action: 'invitation_revoked',
      roleId: null,
      targetIdentityId: membership.identityId,
      previousRoleKey: membership.role,
    },
    dataAdapterMode,
  );

  return { outcome: 'revoked', membership: updated };
}
