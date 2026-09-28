import type { DataAdapterMode } from '../lib/env';
import { getOrganization } from './organizationProvisioningService';
import { isFamilyPortalEnabled, ORGANIZATION_OVERRIDES } from '../domain/organization/familyPortalCapability';

/**
 * Handwritten item #3 (2026-09, Family Portal removal for Manors). Server-
 * side sibling of `domain/organization/familyPortalCapability.ts`'s pure
 * `isFamilyPortalEnabled` — for the many staff/family routes and services
 * that only have an `organizationId` string, not an already-loaded
 * Organization record. Short-circuits on the disclosed override without
 * ever fetching the Organization for an overridden id.
 */
export async function isFamilyPortalEnabledForOrganizationId(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  if (organizationId in ORGANIZATION_OVERRIDES) {
    return ORGANIZATION_OVERRIDES[organizationId];
  }
  const organization = await getOrganization(organizationId, dataAdapterMode);
  return isFamilyPortalEnabled(organization ? { id: organization.id, familyPortalEnabled: organization.familyPortalEnabled } : null);
}
