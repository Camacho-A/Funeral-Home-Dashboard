import type { ServiceCatalogItem } from '../types/serviceCatalog';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The one place a
 * raw Wix `serviceCatalog` item is ever touched — same
 * WixXItem/mapWixXItem/buildWixXData pattern as every other collection
 * mapper (see lib/wixPaymentRecordMapper.ts). `category`/`pricingType` are
 * passed through as plain strings, matching types/serviceCatalog.ts's own
 * deliberately-open typing — an unrecognized value is simply invisible to
 * domain/pricing/calculateOrder.ts, never a mapping failure here.
 */
export type WixServiceCatalogItem = {
  beaconServiceCatalogId?: unknown;
  organizationId?: unknown;
  serviceCode?: unknown;
  displayName?: unknown;
  category?: unknown;
  pricingType?: unknown;
  defaultPrice?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixServiceCatalogItem(item: WixServiceCatalogItem | undefined): ServiceCatalogItem | null {
  if (
    !item ||
    typeof item.beaconServiceCatalogId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.serviceCode !== 'string' ||
    typeof item.displayName !== 'string' ||
    typeof item.category !== 'string' ||
    typeof item.pricingType !== 'string' ||
    typeof item.defaultPrice !== 'number' ||
    typeof item.isActive !== 'boolean' ||
    typeof item.sortOrder !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconServiceCatalogId,
    organizationId: item.organizationId,
    serviceCode: item.serviceCode,
    displayName: item.displayName,
    category: item.category,
    pricingType: item.pricingType,
    defaultPrice: item.defaultPrice,
    isActive: item.isActive,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixServiceCatalogData(entry: ServiceCatalogItem): WixServiceCatalogItem {
  return {
    beaconServiceCatalogId: entry.id,
    organizationId: entry.organizationId,
    serviceCode: entry.serviceCode,
    displayName: entry.displayName,
    category: entry.category,
    pricingType: entry.pricingType,
    defaultPrice: entry.defaultPrice,
    isActive: entry.isActive,
    sortOrder: entry.sortOrder,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
