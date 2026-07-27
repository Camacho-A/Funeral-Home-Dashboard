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
