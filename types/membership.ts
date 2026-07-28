/**
 * Phase 21 (Identity, Authentication & Session Management). The
 * identity-mode membership model — a genuinely new type, deliberately
 * *not* a rename of `types/organization.ts`'s pre-existing
 * `OrganizationMembership` (`{organizationId, userId, role, isActive}`),
 * which `AUTH_ADAPTER='mock'|'wix'` sessions and
 * `lib/auth/authorize.ts`'s `resolveAuthorizationContext` keep reading
 * completely unchanged. `Membership` is what an `AUTH_ADAPTER='identity'`
 * session resolves its organization access through instead (see
 * `lib/auth/resolveMembershipAuthorizationContext.ts`) — coexisting with,
 * never replacing, the older model. See ADR-025 for why two membership
 * shapes exist side by side rather than one being migrated onto the
 * other.
 *
 * An **invitation is simply a `Membership` row with `status: 'invited'`**
 * — there is no separate Wix collection for invitations. "Membership
 * Activated" in the phase's own invitation-flow diagram is exactly this
 * row's `status` transitioning `invited` -> `active` once the invitee
 * verifies their email and sets a password (see
 * `services/invitationService.ts`).
 */
export type MembershipStatus = 'invited' | 'active' | 'disabled' | 'removed';

/** The original, closed five-value vocabulary this field held before
    Phase 22 (Role-Based Access Control) — kept only as a documented,
    still-valid subset (see `domain/rbac/legacyRoleAliases.ts`, which maps
    every one of these onto a Phase 22 default role key), not as the
    exhaustive type of `Membership.role` any more. */
export type MembershipRole = 'owner' | 'administrator' | 'caseManager' | 'staff' | 'readOnly';

export type Membership = {
  id: string;
  identityId: string;
  organizationId: string;
  /**
   * Phase 22 (Role-Based Access Control): widened from the closed
   * `MembershipRole` union to a plain role *key* — any of the five legacy
   * values above, one of `domain/rbac/defaultRoles.ts`'s seven Phase 22
   * default role keys, or a generated custom-role key
   * (`services/roleService.ts`'s `createCustomRole`/`cloneRole`). No
   * existing row's value needs to change: every legacy value keeps
   * resolving to the exact same permission set it always implied, via
   * `domain/rbac/legacyRoleAliases.ts`. `services/roleService.ts`
   * (`assignRole`/`removeRole`) is the only place this field should ever
   * be written from application logic — never assign it directly.
   */
  role: string;
  status: MembershipStatus;
  /** The identityId of whoever sent the invitation — null for a
      membership that was never invited (e.g. created directly by a
      migration). */
  invitedBy: string | null;
  /** Set only once status reaches 'active' for the first time — null for
      a still-pending invitation. */
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
