import type { OrganizationRoleAuditAction, OrganizationRoleAuditEntry } from '../types/organizationRoleAuditEntry';

const VALID_ACTIONS: OrganizationRoleAuditAction[] = [
  'role_created',
  'role_cloned',
  'role_updated',
  'role_deleted',
  'role_assigned',
  'role_removed',
  'invitation_revoked',
  'membership_disabled',
  'membership_reactivated',
  'membership_removed',
];

function isValidAction(value: unknown): value is OrganizationRoleAuditAction {
  return typeof value === 'string' && (VALID_ACTIONS as string[]).includes(value);
}

export type WixOrganizationRoleAuditEntryItem = {
  beaconAuditEntryId?: unknown;
  organizationId?: unknown;
  actorIdentityId?: unknown;
  action?: unknown;
  roleId?: unknown;
  targetIdentityId?: unknown;
  previousRoleKey?: unknown;
  createdAt?: unknown;
};

export function mapWixOrganizationRoleAuditEntryItem(item: WixOrganizationRoleAuditEntryItem | undefined): OrganizationRoleAuditEntry | null {
  if (
    !item ||
    typeof item.beaconAuditEntryId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.actorIdentityId !== 'string' ||
    !isValidAction(item.action) ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconAuditEntryId,
    organizationId: item.organizationId,
    actorIdentityId: item.actorIdentityId,
    action: item.action,
    roleId: typeof item.roleId === 'string' ? item.roleId : null,
    targetIdentityId: typeof item.targetIdentityId === 'string' ? item.targetIdentityId : null,
    previousRoleKey: typeof item.previousRoleKey === 'string' ? item.previousRoleKey : null,
    createdAt: item.createdAt,
  };
}

export function buildWixOrganizationRoleAuditEntryData(entry: OrganizationRoleAuditEntry): WixOrganizationRoleAuditEntryItem {
  return {
    beaconAuditEntryId: entry.id,
    organizationId: entry.organizationId,
    actorIdentityId: entry.actorIdentityId,
    action: entry.action,
    roleId: entry.roleId,
    targetIdentityId: entry.targetIdentityId,
    previousRoleKey: entry.previousRoleKey,
    createdAt: entry.createdAt,
  };
}
