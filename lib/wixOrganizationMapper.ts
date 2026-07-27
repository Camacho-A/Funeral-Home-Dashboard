import type { Organization, OrganizationStatus } from '../types/organization';

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
 *
 * Phase 20 (Organization Onboarding & Tenant Provisioning) extends this
 * with the richer profile fields onboarding collects, plus, for the first
 * time, write-side helpers (`buildWixOrganizationData`/
 * `applyOrganizationUpdateToWixData`) — this collection was read-only
 * before this phase. Every new field is read defensively (falls back to
 * `undefined`, never fails validation) so a pre-Phase-20 live row —
 * Manor's Cremation's own, at the time this phase began — remains a fully
 * valid, mappable `Organization` with just the new fields absent, until
 * the Phase 20 migration backfills them.
 */
const VALID_STATUSES: OrganizationStatus[] = ['draft', 'onboarding', 'active', 'suspended', 'archived'];

function isValidStatus(value: unknown): value is OrganizationStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}

export type WixOrganizationItem = {
  beaconOrganizationId?: unknown;
  name?: unknown;
  isActive?: unknown;
  legalName?: unknown;
  slug?: unknown;
  status?: unknown;
  timezone?: unknown;
  defaultCurrency?: unknown;
  primaryEmail?: unknown;
  primaryPhone?: unknown;
  website?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
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
    legalName: typeof item.legalName === 'string' ? item.legalName : undefined,
    slug: typeof item.slug === 'string' ? item.slug : undefined,
    status: isValidStatus(item.status) ? item.status : undefined,
    timezone: typeof item.timezone === 'string' ? item.timezone : undefined,
    defaultCurrency: typeof item.defaultCurrency === 'string' ? item.defaultCurrency : undefined,
    primaryEmail: typeof item.primaryEmail === 'string' ? item.primaryEmail : undefined,
    primaryPhone: typeof item.primaryPhone === 'string' ? item.primaryPhone : undefined,
    website: typeof item.website === 'string' ? item.website : item.website === null ? null : undefined,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
  };
}

export function buildWixOrganizationData(organization: Organization): WixOrganizationItem {
  return {
    beaconOrganizationId: organization.id,
    name: organization.name,
    isActive: organization.isActive,
    legalName: organization.legalName,
    slug: organization.slug,
    status: organization.status,
    timezone: organization.timezone,
    defaultCurrency: organization.defaultCurrency,
    primaryEmail: organization.primaryEmail,
    primaryPhone: organization.primaryPhone,
    website: organization.website,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

/** Merges a partial patch onto the existing full Wix item — Wix Data's
    updateDataItem is a full replace, same reasoning as every other mapper
    in this codebase. */
export function applyOrganizationUpdateToWixData(
  existing: WixOrganizationItem,
  patch: Partial<Organization>,
): WixOrganizationItem {
  const next: WixOrganizationItem = { ...existing };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.isActive !== undefined) next.isActive = patch.isActive;
  if (patch.legalName !== undefined) next.legalName = patch.legalName;
  if (patch.slug !== undefined) next.slug = patch.slug;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.timezone !== undefined) next.timezone = patch.timezone;
  if (patch.defaultCurrency !== undefined) next.defaultCurrency = patch.defaultCurrency;
  if (patch.primaryEmail !== undefined) next.primaryEmail = patch.primaryEmail;
  if (patch.primaryPhone !== undefined) next.primaryPhone = patch.primaryPhone;
  if (patch.website !== undefined) next.website = patch.website;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
