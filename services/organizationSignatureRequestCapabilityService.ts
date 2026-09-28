import type { DataAdapterMode } from '../lib/env';
import { getOrganization } from './organizationProvisioningService';
import { isSignatureRequestsEnabled, ORGANIZATION_OVERRIDES } from '../domain/organization/signatureRequestCapability';

/**
 * Handwritten item #4 (2026-09, Request Signature removal for Manors).
 * Server-side sibling of
 * domain/organization/signatureRequestCapability.ts's pure
 * `isSignatureRequestsEnabled` — for the services/routes that only have an
 * `organizationId` string, not an already-loaded Organization record.
 * Short-circuits on the disclosed override without ever fetching the
 * Organization for an overridden id. Mirrors
 * services/organizationFamilyPortalCapabilityService.ts's exact shape
 * (item #3) — a deliberately separate capability, not a shared helper,
 * since Family Portal and Signature Requests are independent platform
 * features.
 */
export async function isSignatureRequestsEnabledForOrganizationId(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  if (organizationId in ORGANIZATION_OVERRIDES) {
    return ORGANIZATION_OVERRIDES[organizationId];
  }
  const organization = await getOrganization(organizationId, dataAdapterMode);
  return isSignatureRequestsEnabled(organization ? { id: organization.id, signatureRequestsEnabled: organization.signatureRequestsEnabled } : null);
}
