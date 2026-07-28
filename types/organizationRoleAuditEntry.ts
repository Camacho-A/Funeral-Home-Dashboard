/**
 * Phase 22 (Role-Based Access Control). One row of the
 * `organizationRoleAuditEntries` Wix collection — an append-only record of
 * every role-lifecycle and role-assignment event within an organization,
 * matching the audit-trail pattern already established by Phase 20's
 * `OnboardingAuditEntry` and Phase 21's `LoginActivityEvent`. Never read
 * by any authorization decision — purely a record for the Role Management
 * UI's history view and future investigation.
 */
export type OrganizationRoleAuditAction =
  | 'role_created'
  | 'role_cloned'
  | 'role_updated'
  | 'role_deleted'
  | 'role_assigned'
  | 'role_removed'
  /** Phase 23 (Team Management). A pending invitation was revoked before
      being accepted — see `services/invitationService.ts`'s `revokeInvitation`. */
  | 'invitation_revoked'
  /** Phase 23: `services/roleService.ts`'s `setMembershipStatus` — replaces
      the Phase 22 behavior of recording every status change as
      `role_removed`, which conflated role changes with membership-lifecycle
      changes. */
  | 'membership_disabled'
  | 'membership_reactivated'
  | 'membership_removed';

export type OrganizationRoleAuditEntry = {
  id: string;
  organizationId: string;
  actorIdentityId: string;
  action: OrganizationRoleAuditAction;
  /** The role this event concerns — null only if the role itself was
      deleted and no longer resolvable (kept for the create/update/delete
      family of actions; also set for assign/remove). */
  roleId: string | null;
  /** Set only for role_assigned/role_removed — the membership's identity. */
  targetIdentityId: string | null;
  /** Set only for role_assigned/role_removed — the previous role key, if
      any, that this event replaced. */
  previousRoleKey: string | null;
  createdAt: string;
};
