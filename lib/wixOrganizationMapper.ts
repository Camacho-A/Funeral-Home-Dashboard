import type { Organization } from '../types/organization';

/**
 * Phase 15A (Wix Organization Read Integration). Split out of
 * app/api/organizations/[organizationId]/route.ts because Next.js Route
 * Handler files may only export recognized route fields (GET/POST/etc.) —
 * a plain named export like this one fails the build ("not a valid Route
 * export field"), so the mapping logic lives here instead and the route
 * imports it.
 *
 * The adapter boundary: converts one raw Wix Data item into Beacon's
 * Organization domain type, or returns null if the item is missing
 * required fields. `beaconOrganizationId`/`name`/`isActive` are read
 * explicitly by name — the item's own Wix-managed `_id` is never used as
 * Beacon's id, and never treated as a display name, per this phase's
 * "do not treat Wix record IDs as display names" requirement.
 */
export type WixOrganizationItem = {
  beaconOrganizationId?: unknown;
  name?: unknown;
  isActive?: unknown;
};

export function mapWixOrganizationItem(item: WixOrganizationItem | undefined): Organization | null {
  if (
    !item ||
    typeof item.beaconOrganizationId !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.isActive !== 'boolean'
  ) {
    return null;
  }

  return {
    id: item.beaconOrganizationId,
    name: item.name,
    isActive: item.isActive,
  };
}
