import type { OrganizationLocation, OrganizationLocationType } from '../types/organizationLocation';

const VALID_LOCATION_TYPES: OrganizationLocationType[] = ['office', 'funeral_home', 'crematory', 'mailing_only'];

function isValidLocationType(value: unknown): value is OrganizationLocationType {
  return typeof value === 'string' && (VALID_LOCATION_TYPES as string[]).includes(value);
}

export type WixOrganizationLocationItem = {
  beaconLocationId?: unknown;
  organizationId?: unknown;
  name?: unknown;
  locationType?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  state?: unknown;
  postalCode?: unknown;
  country?: unknown;
  phone?: unknown;
  email?: unknown;
  isPrimary?: unknown;
  isActive?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixOrganizationLocationItem(item: WixOrganizationLocationItem | undefined): OrganizationLocation | null {
  if (
    !item ||
    typeof item.beaconLocationId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.name !== 'string' ||
    !isValidLocationType(item.locationType) ||
    typeof item.addressLine1 !== 'string' ||
    typeof item.city !== 'string' ||
    typeof item.state !== 'string' ||
    typeof item.postalCode !== 'string' ||
    typeof item.country !== 'string' ||
    typeof item.phone !== 'string' ||
    typeof item.isPrimary !== 'boolean' ||
    typeof item.isActive !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconLocationId,
    organizationId: item.organizationId,
    name: item.name,
    locationType: item.locationType,
    addressLine1: item.addressLine1,
    addressLine2: typeof item.addressLine2 === 'string' ? item.addressLine2 : null,
    city: item.city,
    state: item.state,
    postalCode: item.postalCode,
    country: item.country,
    phone: item.phone,
    email: typeof item.email === 'string' ? item.email : null,
    isPrimary: item.isPrimary,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixOrganizationLocationData(location: OrganizationLocation): WixOrganizationLocationItem {
  return {
    beaconLocationId: location.id,
    organizationId: location.organizationId,
    name: location.name,
    locationType: location.locationType,
    addressLine1: location.addressLine1,
    addressLine2: location.addressLine2,
    city: location.city,
    state: location.state,
    postalCode: location.postalCode,
    country: location.country,
    phone: location.phone,
    email: location.email,
    isPrimary: location.isPrimary,
    isActive: location.isActive,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  };
}

/** Settings → Organization Profile (2026-09). Merges a partial patch onto
    the existing full Wix item — same full-replace safety as
    `applyOrganizationUpdateToWixData` (Wix Data's `updateDataItem` fully
    replaces `data`, never merges). Deliberately omits `beaconLocationId`,
    `organizationId`, `isPrimary`, `isActive`, and `createdAt` from the
    fields it will ever apply, even if a caller's patch object somehow
    carried one — this editor never changes which location is primary,
    never reassigns a location to a different organization, and never
    touches active/creation bookkeeping. */
export function applyOrganizationLocationUpdateToWixData(
  existing: WixOrganizationLocationItem,
  patch: Partial<OrganizationLocation>,
): WixOrganizationLocationItem {
  const next: WixOrganizationLocationItem = { ...existing };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.locationType !== undefined) next.locationType = patch.locationType;
  if (patch.addressLine1 !== undefined) next.addressLine1 = patch.addressLine1;
  if (patch.addressLine2 !== undefined) next.addressLine2 = patch.addressLine2;
  if (patch.city !== undefined) next.city = patch.city;
  if (patch.state !== undefined) next.state = patch.state;
  if (patch.postalCode !== undefined) next.postalCode = patch.postalCode;
  if (patch.country !== undefined) next.country = patch.country;
  if (patch.phone !== undefined) next.phone = patch.phone;
  if (patch.email !== undefined) next.email = patch.email;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
