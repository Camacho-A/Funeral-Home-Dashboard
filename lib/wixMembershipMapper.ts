import type { Membership, MembershipStatus } from '../types/membership';

const VALID_STATUSES: MembershipStatus[] = ['invited', 'active', 'disabled', 'removed'];

function isValidStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}

/**
 * Phase 22 (Role-Based Access Control): `Membership.role` is no longer a
 * closed compile-time union — it's a role *key* that can name any of the
 * five legacy values, one of the seven Phase 22 default roles, or a
 * generated custom-role key, and the full set of custom keys is
 * per-organization and dynamic. A mapper is a synchronous, data-free
 * function and can't query `roles`/`organizationRoles` to check
 * membership in that dynamic set, so this only validates the field is a
 * non-empty string — semantic validation ("does this key actually resolve
 * to a real, org-visible role") happens where it can be done with a real
 * lookup: `services/permissionService.ts`'s `resolveRoleForKey` (read
 * paths) and `services/roleService.ts`'s `assignRole` (write paths).
 */
function isValidRole(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export type WixMembershipItem = {
  beaconMembershipId?: unknown;
  identityId?: unknown;
  organizationId?: unknown;
  role?: unknown;
  status?: unknown;
  invitedBy?: unknown;
  joinedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixMembershipItem(item: WixMembershipItem | undefined): Membership | null {
  if (
    !item ||
    typeof item.beaconMembershipId !== 'string' ||
    typeof item.identityId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    !isValidRole(item.role) ||
    !isValidStatus(item.status) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconMembershipId,
    identityId: item.identityId,
    organizationId: item.organizationId,
    role: item.role,
    status: item.status,
    invitedBy: typeof item.invitedBy === 'string' ? item.invitedBy : null,
    joinedAt: typeof item.joinedAt === 'string' ? item.joinedAt : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixMembershipData(membership: Membership): WixMembershipItem {
  return {
    beaconMembershipId: membership.id,
    identityId: membership.identityId,
    organizationId: membership.organizationId,
    role: membership.role,
    status: membership.status,
    invitedBy: membership.invitedBy,
    joinedAt: membership.joinedAt,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

/** Merges a partial patch onto the existing full Wix item. */
export function applyMembershipUpdateToWixData(existing: WixMembershipItem, patch: Partial<Membership>): WixMembershipItem {
  const next: WixMembershipItem = { ...existing };
  if (patch.role !== undefined) next.role = patch.role;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.joinedAt !== undefined) next.joinedAt = patch.joinedAt;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
