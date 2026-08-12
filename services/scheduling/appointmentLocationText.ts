import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems } from '../../lib/wixDataApi';
import { mapWixOrganizationLocationItem, type WixOrganizationLocationItem } from '../../lib/wixOrganizationLocationMapper';
import { organizationLocationFixtures } from '../__mocks__/onboardingFixtures';

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders). A small, focused, read-only helper — resolves
 * `Appointment.locationId` to real address text for ICS's `LOCATION`
 * property (§9 of the plan: "the real OrganizationLocation address
 * text, never the raw internal id"), reused by every ICS route (staff
 * single-event, personal feed, family single-event) rather than
 * duplicating the query in each. Mirrors
 * `appointmentReminderService.ts#getOrganizationForReminder`'s own
 * "small private read, not owned by the collection's real service"
 * pattern — this never writes to `organizationLocations`, only
 * `organizationProvisioningService.ts` does that.
 */
export async function resolveLocationText(organizationId: string, locationId: string | null, dataAdapterMode: DataAdapterMode): Promise<string | null> {
  if (!locationId) return null;

  if (dataAdapterMode === 'mock') {
    const location = organizationLocationFixtures.find((l) => l.id === locationId && l.organizationId === organizationId);
    return location ? formatAddress(location) : null;
  }

  const response = await queryWixDataItems<WixOrganizationLocationItem>('organizationLocations', {
    filter: { organizationId, beaconLocationId: locationId },
    paging: { limit: 1 },
  });
  const location = mapWixOrganizationLocationItem(response.dataItems[0]?.data);
  return location ? formatAddress(location) : null;
}

function formatAddress(location: { addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string }): string {
  const line2 = location.addressLine2 ? `, ${location.addressLine2}` : '';
  return `${location.addressLine1}${line2}, ${location.city}, ${location.state} ${location.postalCode}`;
}
