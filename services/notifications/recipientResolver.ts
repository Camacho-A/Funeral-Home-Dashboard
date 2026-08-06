import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems } from '../../lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '../../lib/wixCaseMapper';
import { listMembershipsForOrganization, isActiveMembership } from '../membershipService';
import { getById as getStaffProfileById } from '../staffProfileService';
import { caseFixtures } from '../__mocks__/fixtures';
import type { Case } from '../../types/case';
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
  /** Required when recipientScope === 'portal_user' (Phase 29 — Family
      Portal & External Collaboration). A `PortalUser.id`, never an
      `Identity.id` — see `types/notification.ts`'s own `RecipientScope`
      comment. */
  recipientPortalUserId?: string;
  /** Required when recipientScope === 'role'. */
  recipientRoleKey?: string;
  /** Required when recipientScope === 'case_participants' — see below;
      accepted as a parameter now so the call site doesn't change once
      this scope is actually implemented. */
  caseId?: string;
};

/** A server-side orchestration step mid-request needs its own small
    mock/wix-branching reader, never a `fetch()` call to this app's own
    API — mirrors `services/signatureService.ts`'s identical
    `getCaseForNotification` precedent exactly. */
async function getCaseForRecipientResolution(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted) ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', { filter: { beaconCaseId: caseId, organizationId, isArchived: false }, paging: { limit: 1 } });
  return mapWixCaseItem(response.dataItems[0]?.data);
}

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification):
 * resolves `Case.assignedStaffId`/`intakeOwnerId` — both `StaffProfile.id`-
 * space (see `types/staffProfile.ts`'s hard layering invariant) — through
 * `StaffProfile.identityId`, deduplicated. This is the read-side half of
 * this phase's `StaffProfile` bridge; the write-side half
 * (`assertAssignableStaffProfile`) is what guarantees these fields only
 * ever *start out* pointing at a real, active, in-organization profile —
 * but a row can still go stale after the fact (deactivated later, or a
 * pre-Phase-30 fixture edge case), so this resolution step follows the
 * same read-side policy every other scope here already does: an
 * unresolvable or deactivated `StaffProfile.id` is silently dropped, never
 * thrown. A case with neither field resolvable (or no case at all) yields
 * an empty recipient list — a valid, non-error outcome, exactly like
 * `organization_wide`/`role` already treat "nobody matched."
 */
export async function resolveRecipientIdentityIds(params: ResolveRecipientsParams, dataAdapterMode: DataAdapterMode): Promise<string[]> {
  const { organizationId, recipientScope } = params;

  if (recipientScope === 'individual') {
    if (!params.recipientIdentityId) throw new RecipientResolverError('recipientIdentityId is required for recipientScope "individual".');
    return [params.recipientIdentityId];
  }

  /** Phase 29 (Family Portal & External Collaboration). Resolved
      identically to 'individual' — zero validation beyond presence,
      matching that scope's own permissive precedent exactly. The one
      difference is what the returned string means: a `PortalUser.id`,
      never an `Identity.id`. Every downstream consumer of the resolved
      list (`NotificationRecipient.identityId`, `NotificationPreference.
      identityId`) already treats this as an opaque lookup key, so no
      further change is needed there — only `notificationService.ts`'s
      `dispatchChannel` email-resolution step needs an explicit fallback
      (see that function's own comment). */
  if (recipientScope === 'portal_user') {
    if (!params.recipientPortalUserId) throw new RecipientResolverError('recipientPortalUserId is required for recipientScope "portal_user".');
    return [params.recipientPortalUserId];
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
    if (!params.caseId) throw new RecipientResolverError('caseId is required for recipientScope "case_participants".');
    const targetCase = await getCaseForRecipientResolution(organizationId, params.caseId, dataAdapterMode);
    if (!targetCase) return [];

    const staffProfileIds = [...new Set([targetCase.assignedStaffId, targetCase.intakeOwnerId].filter((id): id is string => !!id))];
    const identityIds: string[] = [];
    for (const staffProfileId of staffProfileIds) {
      const profile = await getStaffProfileById(organizationId, staffProfileId, dataAdapterMode);
      if (!profile || !profile.isActive) continue;
      identityIds.push(profile.identityId);
    }
    return [...new Set(identityIds)];
  }

  throw new RecipientResolverError(`Unrecognized recipientScope: "${recipientScope}".`);
}
