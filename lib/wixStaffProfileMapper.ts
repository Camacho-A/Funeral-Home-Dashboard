import type { StaffProfile, StaffRole } from '../types/staffProfile';

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification).
 * Standard mapper pair for the `staffProfiles` collection, matching every
 * existing mapper's full runtime type-guarding, null-not-throw convention.
 * `beaconStaffProfileId` is set as the item's own system `_id` at insert
 * time (the established `cases`/`beaconCaseId` trick), so no separate
 * unique-index field is spent on it.
 */

export type WixStaffProfileItem = {
  beaconStaffProfileId?: unknown;
  organizationId?: unknown;
  identityId?: unknown;
  membershipId?: unknown;
  displayName?: unknown;
  role?: unknown;
  isActive?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_ROLES: readonly string[] = ['admin', 'funeral_director', 'staff'];

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && VALID_ROLES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixStaffProfileItem(item: WixStaffProfileItem | undefined): StaffProfile | null {
  if (
    !item ||
    typeof item.beaconStaffProfileId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.identityId !== 'string' ||
    !isStringOrNull(item.membershipId) ||
    typeof item.displayName !== 'string' ||
    !isStaffRole(item.role) ||
    typeof item.isActive !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconStaffProfileId,
    organizationId: item.organizationId,
    identityId: item.identityId,
    membershipId: item.membershipId,
    displayName: item.displayName,
    role: item.role,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixStaffProfileData(staffProfile: StaffProfile): WixStaffProfileItem {
  return {
    beaconStaffProfileId: staffProfile.id,
    organizationId: staffProfile.organizationId,
    identityId: staffProfile.identityId,
    membershipId: staffProfile.membershipId,
    displayName: staffProfile.displayName,
    role: staffProfile.role,
    isActive: staffProfile.isActive,
    createdAt: staffProfile.createdAt,
    updatedAt: staffProfile.updatedAt,
  };
}

/** The only fields `staffProfileService.ts`'s `deactivate` ever changes on
    an existing row — `StaffProfile` is never hard-deleted. */
export function applyStaffProfileUpdateToWixData(
  existing: WixStaffProfileItem,
  patch: Partial<Pick<WixStaffProfileItem, 'displayName' | 'role' | 'isActive' | 'updatedAt'>>,
): WixStaffProfileItem {
  return { ...existing, ...patch };
}
