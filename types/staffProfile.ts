/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification).
 * `StaffProfile` is the **operational profile** layer in Beacon's canonical
 * identity chain: `Identity` (authentication) → `Membership` (organizational
 * authorization) → `StaffProfile` (operational profile, this type) →
 * operational assignments (`Case.assignedStaffId`/`intakeOwnerId`/`createdBy`,
 * `CaseTask.assigneeStaffId`, `Appointment.ownerStaffProfileId`,
 * `Resource.linkedStaffProfileId`). See
 * docs/adr/ADR-034-identity-model-hardening-and-staff-assignment-architecture.md
 * for the full architecture.
 *
 * **Hard layering invariant**: no operational-assignment field anywhere in
 * this codebase is ever allowed to reference `Identity.id` directly — every
 * one terminates at `StaffProfile.id`, and only `StaffProfile` itself
 * resolves further, through `identityId`/`membershipId`, into
 * `Membership`/`Identity`. This is orthogonal to (and does not change) the
 * separate, pre-existing **actor-attribution** fields elsewhere in this
 * codebase (`Appointment.createdBy`/`lastModifiedBy`/`cancelledBy`,
 * `CaseDocument.generatedBy`/`uploadedBy`, `SignatureRequest.requestedBy`/
 * `cancelledBy`), which correctly stay `Identity.id`-space — those encode
 * "which authenticated session performed this action," not "who is
 * operationally responsible for this."
 *
 * `role` (`StaffRole`) is **display-only, never authorization-relevant** —
 * it has no RBAC legacy-alias mapping (unlike `OrganizationRole`/
 * `Membership.role`, which both do) and must never be compared as a string
 * to decide assignment eligibility. Every eligibility check resolves the
 * *real* role via the linked `Membership`/`OrganizationMembership` and the
 * existing RBAC permission system instead — see
 * `services/staffProfileService.ts#assertAssignableStaffProfile`.
 */
export type StaffRole = 'admin' | 'funeral_director' | 'staff';

export type StaffProfile = {
  id: string;
  organizationId: string;
  /** The canonical authenticated-identity id space — literally
      `AuthorizationContext.userId`'s space, already normalized across every
      `AUTH_ADAPTER` mode by `lib/auth/requireAuthorizedOrganization.ts`. A
      real `Identity.id` in identity-mode; the legacy `AuthenticatedUser.id`/
      `OrganizationMembership.userId` space in mock/wix-mode. Required —
      every `StaffProfile` is identity-backed. */
  identityId: string;
  /** -> Membership.id. Set only when a real `Membership` row exists
      (identity-mode only) — null in mock/wix auth mode, where no such row
      is ever created. Never a substitute for resolving the real
      `Membership`; this field only records which one this profile is
      linked to. */
  membershipId: string | null;
  displayName: string;
  /** Display-only — see this file's own header comment. */
  role: StaffRole;
  /** The only lifecycle transition — a `StaffProfile` is never hard-deleted,
      only ever deactivated, so historical assignments remain attributable
      forever. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
