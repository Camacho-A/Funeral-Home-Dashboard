import type { Organization, OrganizationContext } from '../types/organization';
import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems } from '../lib/wixDataApi';
import { mapWixOrganizationItem, type WixOrganizationItem } from '../lib/wixOrganizationMapper';
import { mockOrganizationFixtures } from './__mocks__/authFixtures';

/**
 * Phase 15A (Wix Organization Read Integration). Unlike every other
 * `services/*` module, this one never branches on `DATA_ADAPTER` itself —
 * it always calls the `/api/organizations/[organizationId]` Route
 * Handler. That's deliberate: this service is called from a Client
 * Component hook (useOrganizationRecord), and `DATA_ADAPTER` (unlike a
 * `NEXT_PUBLIC_*` variable) is never visible in the browser bundle, so a
 * client-side branch on it would silently always take the mock path
 * regardless of the real server configuration. The Route Handler is the
 * one place that reads the real, server-side `DATA_ADAPTER` and decides
 * whether to read the mock fixture or query Wix — the same pattern
 * app/api/wix-health/route.ts already established in Phase 12. Nothing
 * about the Wix response shape leaks past that boundary: this function's
 * return type is the same `Organization` domain type mock mode always
 * returned.
 */
export async function get(context: OrganizationContext): Promise<Organization | null> {
  const response = await fetch(`/api/organizations/${encodeURIComponent(context.organizationId)}`);

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Failed to load organization.');
  }

  const body = (await response.json()) as { organization: Organization | null };
  return body.organization;
}

/**
 * Phase 33 (Real Notification Delivery). A server-safe counterpart to
 * `get()` above — discovered necessary for the same reason
 * `casesService.ts#listForOrganization` was in Phase 32:
 * `get()`'s own body is a client-only HTTP wrapper (`fetch('/api/organizations/...')`,
 * meant for `hooks/useOrganizationRecord.ts` running in a browser).
 * `services/notificationService.ts`/`services/notificationDigestService.ts`
 * (which run inside Route Handlers/a cron-triggered job, never a
 * browser) call this function instead — mirrors
 * `services/documentService.ts`'s own private `getOrganizationForMerge`
 * helper exactly, exported here since more than one caller now needs it.
 */
export async function getForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode = 'mock'): Promise<Organization | null> {
  if (dataAdapterMode === 'mock') {
    return mockOrganizationFixtures.find((org) => org.id === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationItem>('organizations', {
    filter: { beaconOrganizationId: organizationId },
    paging: { limit: 1 },
  });
  return mapWixOrganizationItem(response.dataItems[0]?.data);
}

export const organizationsService = { get, getForOrganization };
