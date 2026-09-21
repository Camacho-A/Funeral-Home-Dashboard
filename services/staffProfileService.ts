import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixStaffProfileItem, buildWixStaffProfileData, applyStaffProfileUpdateToWixData, type WixStaffProfileItem } from '../lib/wixStaffProfileMapper';
import type { StaffProfile } from '../types/staffProfile';
import type { AuthorizationContext } from '../types/authorization';
import type { PermissionKey } from '../domain/rbac/permissionCatalog';
import { resolveRoleKeyAlias } from '../domain/rbac/legacyRoleAliases';
import { hasPermission, type ResolvePermissionsParams } from './permissionService';
import { getMembershipById } from './membershipService';
import { staffFixtures } from './__mocks__/fixtures';

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification).
 * Replaces `services/staffService.ts` (deleted this phase). Owns the
 * `StaffProfile` operational-profile layer of Solis's canonical identity
 * chain — `Identity` -> `Membership` -> `StaffProfile` -> operational
 * assignments (see `types/staffProfile.ts`'s own header comment and
 * `docs/adr/ADR-034-identity-model-hardening-and-staff-assignment-architecture.md`).
 *
 * `assertAssignableStaffProfile` is the *only* place any operational
 * assignment (`Case.assignedStaffId`/`intakeOwnerId`, `CaseTask.assigneeStaffId`,
 * `Appointment.ownerStaffProfileId`, `Resource.linkedStaffProfileId`) is
 * ever validated against — one shared *mechanism*, parameterized by the
 * domain-appropriate permission key, never one shared permission (case
 * assignment gates on `case.update`; appointment-owner assignment gates on
 * `schedule.edit`; task assignment gates on `task.assign`).
 *
 * **No caching, by deliberate, precedented choice** — mirrors
 * `services/permissionService.ts`'s own "always resolves fresh, every
 * call, with no shared state" rule (removed after the Phase 22 stale-cache
 * incident). `resolveStaffProfileForCaller` and `assertAssignableStaffProfile`
 * are two distinct lookups (the caller's own profile vs. a target
 * profile), never memoized together.
 */
export class StaffAssignmentError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

export async function list(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<StaffProfile[]> {
  if (dataAdapterMode === 'mock') {
    return staffFixtures.filter((s) => s.organizationId === organizationId && s.isActive);
  }
  const response = await queryWixDataItems<WixStaffProfileItem>('staffProfiles', { filter: { organizationId, isActive: true } });
  return response.dataItems.map((item) => mapWixStaffProfileItem(item.data)).filter((s): s is StaffProfile => s !== null);
}

export async function getById(organizationId: string, staffProfileId: string, dataAdapterMode: DataAdapterMode): Promise<StaffProfile | null> {
  if (dataAdapterMode === 'mock') {
    return staffFixtures.find((s) => s.id === staffProfileId && s.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixStaffProfileItem>('staffProfiles', {
    filter: { organizationId, beaconStaffProfileId: staffProfileId },
    paging: { limit: 1 },
  });
  return mapWixStaffProfileItem(response.dataItems[0]?.data);
}

/**
 * The `(organizationId, identityId)` lookup — the canonical replacement
 * for `hooks/useSession.ts`'s hardcoded `staffFixtures[0]` stub. Called
 * server-side only, inside a Route Handler, since `AuthorizationContext`
 * only ever exists there (never from a client component directly — see
 * `lib/auth/requireAuthorizedOrganization.ts`).
 */
/**
 * Solis go-live checkpoint (2026-09) — staff provisioning fix. Derives
 * `StaffProfile.role` (the display-only cosmetic label — see
 * `types/staffProfile.ts`'s own header comment) from a real
 * `Membership.role`/RBAC role key, for the one place that label needs to
 * be invented rather than supplied: auto-provisioning a `StaffProfile` the
 * moment a Membership activates (`ensureStaffProfileForActivatedMembership`
 * below). Resolves legacy aliases first (`owner`/`caseManager`/`staff`/
 * `readOnly` -> their Phase 22 default-role equivalents) so a pre-Phase-22
 * membership row maps exactly as it would today, then: `administrator` (or
 * its alias `owner`) -> `'admin'`; `funeralDirector` (or its alias
 * `caseManager`) -> `'funeral_director'`; every other role (manager,
 * arranger, officeStaff, accounting, readOnly, dispatch, or any custom
 * role) -> `'staff'`, the honest generic default — this label is never
 * read by any authorization decision, so a role without a dedicated title
 * getting the generic one is correct, not a loss of information.
 */
export function deriveDisplayRoleFromMembershipRole(membershipRole: string): StaffProfile['role'] {
  const resolved = resolveRoleKeyAlias(membershipRole);
  if (resolved === 'administrator') return 'admin';
  if (resolved === 'funeralDirector') return 'funeral_director';
  return 'staff';
}

/**
 * Solis go-live checkpoint (2026-09) — staff provisioning fix. Root cause
 * of "an active staff Membership can exist with no linked StaffProfile":
 * `services/invitationService.ts#acceptInvitation` flipped a Membership to
 * `'active'` and set a password, but never created the `StaffProfile` that
 * every operational-assignment/case-creation path requires (confirmed via
 * a live audit — the Manager and Office Staff memberships accepted through
 * this exact path had none, while the one StaffProfile that *did* exist
 * was provisioned by a different, earlier path). This is the fix: called
 * from `acceptInvitation` immediately after `activateMembership` succeeds,
 * so "Membership Activated" and "StaffProfile exists" become one
 * guaranteed outcome instead of two independent, silently-divergible ones.
 *
 * Idempotent by construction — checks for an existing profile first via
 * the same `(organizationId, identityId)` lookup `resolveStaffProfileForCaller`
 * uses, so retrying this call (e.g. after a prior partial failure) never
 * creates a duplicate. Never overwrites an existing profile's role/
 * displayName — if one already exists (however it got there), it is left
 * exactly as-is.
 */
export async function ensureStaffProfileForActivatedMembership(
  params: { organizationId: string; identityId: string; membershipId: string; displayName: string; membershipRole: string; idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<StaffProfile> {
  const existing = await resolveStaffProfileForCaller(
    { userId: params.identityId, organizationId: params.organizationId, role: params.membershipRole },
    dataAdapterMode,
  );
  if (existing) return existing;

  return create(
    params.organizationId,
    {
      identityId: params.identityId,
      membershipId: params.membershipId,
      displayName: params.displayName,
      role: deriveDisplayRoleFromMembershipRole(params.membershipRole),
      idFactory: params.idFactory,
      now: params.now,
    },
    dataAdapterMode,
  );
}

export async function resolveStaffProfileForCaller(context: AuthorizationContext, dataAdapterMode: DataAdapterMode): Promise<StaffProfile | null> {
  if (dataAdapterMode === 'mock') {
    return staffFixtures.find((s) => s.organizationId === context.organizationId && s.identityId === context.userId) ?? null;
  }
  const response = await queryWixDataItems<WixStaffProfileItem>('staffProfiles', {
    filter: { organizationId: context.organizationId, identityId: context.userId },
    paging: { limit: 1 },
  });
  return mapWixStaffProfileItem(response.dataItems[0]?.data);
}

/**
 * Throws `StaffAssignmentError` unless every one of the following holds:
 * the row exists and belongs to `organizationId`; `isActive === true`;
 * if `membershipId` is set, the linked `Membership.status === 'active'`
 * *and* its `organizationId` independently matches (defense-in-depth
 * against a stale cross-org link — closes the one dormant, unvalidated
 * bridge `Resource.linkedMembershipId` already had); and the caller holds
 * `permission` (resolved through the caller's *real* role via
 * `permissionService.ts` — never a `StaffProfile.role` string comparison).
 * Returns the validated `StaffProfile` on success, so callers don't need a
 * second lookup.
 */
/**
 * The identity-space half of `assertAssignableStaffProfile` below, with no
 * permission check — exists for the handful of call sites that have no
 * real RBAC actor to check against at all: `services/casesService.ts`/
 * `services/tasksService.ts`'s **mock branches**, which (per this
 * codebase's Phase 4-era client-fetch shape — see those files' own header
 * comments) execute directly in the browser via a client hook, using
 * `hooks/useSession.ts`'s pre-Phase-30 `{staffId, displayName}` stub, not
 * a real `AuthorizationContext`. That stub is itself a named, unresolved
 * gap (see ADR-034's "known limitations" section) — RBAC enforcement for
 * mock-mode case/task mutation has never existed beyond "the UI doesn't
 * expose the control," and retrofitting it is explicitly out of scope for
 * this phase (the user's own instructions: reuse existing authorization,
 * do not redesign RBAC). This function closes the *identity* half of the
 * gap this phase actually targets — a nonexistent/inactive/cross-org
 * `StaffProfile.id` is still rejected everywhere, including that path —
 * without inventing a new permission gate for a code path that has no
 * real actor to check one against.
 */
export async function assertStaffProfileIsActiveAndInOrganization(
  organizationId: string,
  staffProfileId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<StaffProfile> {
  const profile = await getById(organizationId, staffProfileId, dataAdapterMode);
  if (!profile) {
    throw new StaffAssignmentError(`No staff profile "${staffProfileId}" exists in this organization.`);
  }
  if (!profile.isActive) {
    throw new StaffAssignmentError(`Staff profile "${staffProfileId}" is not active and cannot be assigned new work.`);
  }
  if (profile.membershipId) {
    const membership = await getMembershipById(profile.membershipId, dataAdapterMode);
    if (!membership || membership.organizationId !== organizationId || membership.status !== 'active') {
      throw new StaffAssignmentError(`Staff profile "${staffProfileId}" no longer has an active membership in this organization.`);
    }
  }
  return profile;
}

export async function assertAssignableStaffProfile(
  params: {
    organizationId: string;
    staffProfileId: string;
    permission: PermissionKey;
    actor: ResolvePermissionsParams;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<StaffProfile> {
  const { organizationId, staffProfileId, permission, actor } = params;

  const profile = await assertStaffProfileIsActiveAndInOrganization(organizationId, staffProfileId, dataAdapterMode);

  const allowed = await hasPermission(actor, dataAdapterMode, permission);
  if (!allowed) {
    throw new StaffAssignmentError(`Caller lacks the "${permission}" permission required to assign this staff profile.`);
  }

  return profile;
}

export async function create(
  organizationId: string,
  params: { identityId: string; membershipId?: string | null; displayName: string; role: StaffProfile['role']; idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<StaffProfile> {
  const now = params.now ?? nowIso();
  const staffProfile: StaffProfile = {
    id: params.idFactory(),
    organizationId,
    identityId: params.identityId,
    membershipId: params.membershipId ?? null,
    displayName: params.displayName,
    role: params.role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  if (dataAdapterMode === 'mock') {
    staffFixtures.push(staffProfile);
    return staffProfile;
  }
  await insertWixDataItem<WixStaffProfileItem>('staffProfiles', buildWixStaffProfileData(staffProfile), staffProfile.id);
  return staffProfile;
}

/** The only lifecycle transition — a `StaffProfile` is never hard-deleted,
    so historical assignments (`Case.assignedStaffId`/`createdBy`, etc.)
    remain attributable forever; deactivating only removes it from future
    assignment eligibility (`assertAssignableStaffProfile` above). */
export async function deactivate(organizationId: string, staffProfileId: string, dataAdapterMode: DataAdapterMode): Promise<StaffProfile> {
  const now = nowIso();
  if (dataAdapterMode === 'mock') {
    const index = staffFixtures.findIndex((s) => s.id === staffProfileId && s.organizationId === organizationId);
    if (index === -1) throw new StaffAssignmentError(`No staff profile "${staffProfileId}" exists in this organization.`);
    staffFixtures[index] = { ...staffFixtures[index], isActive: false, updatedAt: now };
    return staffFixtures[index];
  }
  const response = await queryWixDataItems<WixStaffProfileItem>('staffProfiles', {
    filter: { organizationId, beaconStaffProfileId: staffProfileId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new StaffAssignmentError(`No staff profile "${staffProfileId}" exists in this organization.`);
  const merged = applyStaffProfileUpdateToWixData(existingItem.data, { isActive: false, updatedAt: now });
  const updated = await updateWixDataItem<WixStaffProfileItem>('staffProfiles', existingItem.id, merged);
  const mapped = mapWixStaffProfileItem(updated.data);
  if (!mapped) throw new StaffAssignmentError('Failed to deactivate staff profile.');
  return mapped;
}
