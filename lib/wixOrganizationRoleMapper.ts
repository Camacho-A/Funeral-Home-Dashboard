import type { OrganizationRoleEnablement } from '../types/organizationRole';

export type WixOrganizationRoleItem = {
  beaconOrganizationRoleId?: unknown;
  organizationId?: unknown;
  roleId?: unknown;
  createdAt?: unknown;
};

export function mapWixOrganizationRoleItem(item: WixOrganizationRoleItem | undefined): OrganizationRoleEnablement | null {
  if (
    !item ||
    typeof item.beaconOrganizationRoleId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.roleId !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconOrganizationRoleId,
    organizationId: item.organizationId,
    roleId: item.roleId,
    createdAt: item.createdAt,
  };
}

export function buildWixOrganizationRoleData(enablement: OrganizationRoleEnablement): WixOrganizationRoleItem {
  return {
    beaconOrganizationRoleId: enablement.id,
    organizationId: enablement.organizationId,
    roleId: enablement.roleId,
    createdAt: enablement.createdAt,
  };
}
