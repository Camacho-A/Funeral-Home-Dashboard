import type { DataAdapterMode } from '../../lib/env';
import { listMembershipsForOrganization, isActiveMembership } from '../membershipService';
import type { RecipientScope } from '../../types/notification';

/**
 * Phase 28 (Communications & Notifications). Pure recipient-resolution
 * logic, no writes — imported only by `services/notificationService.ts`
 * (structurally enforced, see that file's own test). Every result is
 * resolved **once** and handed back as a plain list of identity ids;
 * `notificationService.ts` is the one that snapshots it into immutable
 * `NotificationRecipient` rows. See `types/notification.ts`'s own header
 * comment for why this snapshot is never recomputed later.
 *
 * Reads `Membership` (Phase 21's real identity-mode model — `organizationId`/
 * `identityId`/`role`/`status`), never the legacy mock/wix-mode
 * `OrganizationMembership` shape, and never duplicates or caches either.
 */
export class RecipientResolverError extends Error {}

export type ResolveRecipientsParams = {
  organizationId: string;
  recipientScope: RecipientScope;
  /** Required when recipientScope === 'individual'. */
  recipientIdentityId?: string;
  /** Required when recipientScope === 'role'. */
  recipientRoleKey?: string;
  /** Required when recipientScope === 'case_participants' — see below;
      accepted as a parameter now so the call site doesn't change once
      this scope is actually implemented. */
  caseId?: string;
};

/**
 * `case_participants` is a real value in `RecipientScope` (kept for
 * future-readiness) but **deliberately not implemented this phase**:
 * `Case.assignedStaffId`/`intakeOwnerId` reference `StaffProfile.id` (a
 * separate, pre-Identity-model, mock-only concept — `types/staffProfile.ts`),
 * not an `Identity.id`/`Membership.id`, and no mapping between the two
 * exists anywhere in this codebase today (the same gap
 * `docs/AUTHENTICATION.md`'s own Known Limitations section already names).
 * Reserved and throws a clear error, exactly like a future `external`
 * (family/next-of-kin) scope would — never a silent, papered-over
 * mapping. Confirmed with the user before implementation as the correct
 * resolution to this ambiguity rather than building new
 * StaffProfile-to-Identity plumbing out of scope for this phase.
 */
export async function resolveRecipientIdentityIds(params: ResolveRecipientsParams, dataAdapterMode: DataAdapterMode): Promise<string[]> {
  const { organizationId, recipientScope } = params;

  if (recipientScope === 'individual') {
    if (!params.recipientIdentityId) throw new RecipientResolverError('recipientIdentityId is required for recipientScope "individual".');
    return [params.recipientIdentityId];
  }

  if (recipientScope === 'role') {
    if (!params.recipientRoleKey) throw new RecipientResolverError('recipientRoleKey is required for recipientScope "role".');
    const memberships = await listMembershipsForOrganization(organizationId, dataAdapterMode);
    return memberships.filter((m) => isActiveMembership(m) && m.role === params.recipientRoleKey).map((m) => m.identityId);
  }

  if (recipientScope === 'organization_wide') {
    const memberships = await listMembershipsForOrganization(organizationId, dataAdapterMode);
    return memberships.filter(isActiveMembership).map((m) => m.identityId);
  }

  if (recipientScope === 'case_participants') {
    throw new RecipientResolverError(
      'recipientScope "case_participants" is reserved but not yet supported — Case.assignedStaffId/intakeOwnerId reference StaffProfile.id, with no mapping to a real Identity/Membership yet.',
    );
  }

  throw new RecipientResolverError(`Unrecognized recipientScope: "${recipientScope}".`);
}
