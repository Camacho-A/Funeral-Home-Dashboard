import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems } from '../lib/wixDataApi';
import { mapWixOrganizationLocationItem, type WixOrganizationLocationItem } from '../lib/wixOrganizationLocationMapper';
import type { OrganizationLocation } from '../types/organizationLocation';
import { organizationLocationFixtures } from './__mocks__/onboardingFixtures';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Server-safe multi-location
 * reads. Phase 20 only ever needed `getPrimaryLocation`
 * (services/organizationProvisioningService.ts); merchandise inventory is
 * PER-LOCATION, so it needs the full list of an org's locations — a product
 * can hold independent stock at the primary funeral home, a secondary home,
 * a storage room, a warehouse, etc. (ADR-039 §6/§9). Read-only; the
 * `organizationLocations` collection's one writer stays
 * organizationProvisioningService.ts.
 */

export async function listLocationsForOrganization(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options: { includeInactive?: boolean } = {},
): Promise<OrganizationLocation[]> {
  let locations: OrganizationLocation[];
  if (dataAdapterMode === 'mock') {
    locations = organizationLocationFixtures.filter((l) => l.organizationId === organizationId);
  } else {
    const response = await queryWixDataItems<WixOrganizationLocationItem>('organizationLocations', { filter: { organizationId } });
    locations = response.dataItems
      .map((item) => mapWixOrganizationLocationItem(item.data))
      .filter((l): l is OrganizationLocation => l !== null);
  }
  const filtered = options.includeInactive ? locations : locations.filter((l) => l.isActive);
  // Primary first, then alphabetical — a stable, predictable order for the
  // location picker.
  return filtered.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

export async function getLocationById(
  organizationId: string,
  locationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<OrganizationLocation | null> {
  if (dataAdapterMode === 'mock') {
    return organizationLocationFixtures.find((l) => l.organizationId === organizationId && l.id === locationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationLocationItem>('organizationLocations', {
    filter: { organizationId, beaconLocationId: locationId },
    paging: { limit: 1 },
  });
  return mapWixOrganizationLocationItem(response.dataItems[0]?.data);
}
