import type { Membership, MembershipRole, MembershipStatus } from '../types/membership';

const VALID_STATUSES: MembershipStatus[] = ['invited', 'active', 'disabled', 'removed'];
const VALID_ROLES: MembershipRole[] = ['owner', 'administrator', 'caseManager', 'staff', 'readOnly'];

function isValidStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}
function isValidRole(value: unknown): value is MembershipRole {
  return typeof value === 'string' && (VALID_ROLES as string[]).includes(value);
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
