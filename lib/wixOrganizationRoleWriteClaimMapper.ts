import type { OrganizationRoleWriteClaim } from '../types/organizationRoleWriteClaim';

export type WixOrganizationRoleWriteClaimItem = {
  organizationId?: unknown;
  lockToken?: unknown;
  fenceToken?: unknown;
  claimedAt?: unknown;
  expiresAt?: unknown;
};

export function mapWixOrganizationRoleWriteClaimItem(item: WixOrganizationRoleWriteClaimItem | undefined): OrganizationRoleWriteClaim | null {
  if (
    !item ||
    typeof item.organizationId !== 'string' ||
    typeof item.lockToken !== 'string' ||
    typeof item.fenceToken !== 'number' ||
    typeof item.claimedAt !== 'string' ||
    typeof item.expiresAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.organizationId,
    organizationId: item.organizationId,
    lockToken: item.lockToken,
    fenceToken: item.fenceToken,
    claimedAt: item.claimedAt,
    expiresAt: item.expiresAt,
  };
}

export function buildWixOrganizationRoleWriteClaimData(claim: OrganizationRoleWriteClaim): WixOrganizationRoleWriteClaimItem {
  return {
    organizationId: claim.organizationId,
    lockToken: claim.lockToken,
    fenceToken: claim.fenceToken,
    claimedAt: claim.claimedAt,
    expiresAt: claim.expiresAt,
  };
}
