import type { MerchandiseProductVariant } from '../types/merchandiseProductVariant';

/**
 * Phase 37 (Product Variants, Sales Tax & Merchandise Pricing — ADR-041). The
 * one place a raw Wix `merchandiseProductVariants` item is touched. Standard
 * map/build/apply shape; a row that fails validation maps to null (drops on
 * read rather than corrupting it). Override fields are nullable — a null
 * override inherits the parent product's value at read time (see
 * domain/merchandise/variantEconomics.ts). `merchandiseVariantService` is the
 * sole writer.
 */
export type WixMerchandiseProductVariantItem = {
  beaconMerchandiseProductVariantId?: unknown;
  organizationId?: unknown;
  productId?: unknown;
  sku?: unknown;
  name?: unknown;
  optionValues?: unknown;
  retailPriceOverride?: unknown;
  costOverride?: unknown;
  taxableOverride?: unknown;
  supplierIdOverride?: unknown;
  isActive?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function mapWixMerchandiseProductVariantItem(
  item: WixMerchandiseProductVariantItem | undefined,
): MerchandiseProductVariant | null {
  if (
    !item ||
    typeof item.beaconMerchandiseProductVariantId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.productId !== 'string' ||
    typeof item.sku !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.isActive !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconMerchandiseProductVariantId,
    organizationId: item.organizationId,
    productId: item.productId,
    sku: item.sku,
    name: item.name,
    optionValues: nullableString(item.optionValues),
    retailPriceOverride: nullableNumber(item.retailPriceOverride),
    costOverride: nullableNumber(item.costOverride),
    taxableOverride: nullableBoolean(item.taxableOverride),
    supplierIdOverride: nullableString(item.supplierIdOverride),
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixMerchandiseProductVariantData(
  variant: MerchandiseProductVariant,
): WixMerchandiseProductVariantItem {
  return {
    beaconMerchandiseProductVariantId: variant.id,
    organizationId: variant.organizationId,
    productId: variant.productId,
    sku: variant.sku,
    name: variant.name,
    optionValues: variant.optionValues,
    retailPriceOverride: variant.retailPriceOverride,
    costOverride: variant.costOverride,
    taxableOverride: variant.taxableOverride,
    supplierIdOverride: variant.supplierIdOverride,
    isActive: variant.isActive,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

/** Mutable fields only — id/organizationId/productId/sku/createdAt are
    immutable; a full merged object is produced for the full-replace update. */
export function applyMerchandiseProductVariantUpdateToWixData(
  existing: WixMerchandiseProductVariantItem,
  patch: Partial<
    Pick<
      MerchandiseProductVariant,
      'name' | 'optionValues' | 'retailPriceOverride' | 'costOverride' | 'taxableOverride' | 'supplierIdOverride' | 'isActive' | 'updatedAt'
    >
  >,
): WixMerchandiseProductVariantItem {
  const next: WixMerchandiseProductVariantItem = { ...existing };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.optionValues !== undefined) next.optionValues = patch.optionValues;
  if (patch.retailPriceOverride !== undefined) next.retailPriceOverride = patch.retailPriceOverride;
  if (patch.costOverride !== undefined) next.costOverride = patch.costOverride;
  if (patch.taxableOverride !== undefined) next.taxableOverride = patch.taxableOverride;
  if (patch.supplierIdOverride !== undefined) next.supplierIdOverride = patch.supplierIdOverride;
  if (patch.isActive !== undefined) next.isActive = patch.isActive;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
