import type { MerchandiseProduct } from '../types/merchandiseProduct';
import { isValidMerchandiseCategoryKey, type MerchandiseCategoryKey } from '../domain/merchandise/merchandiseCategoryRegistry';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). The one place a raw Wix
 * `merchandiseProducts` item is ever touched — standard map/build/apply
 * mapper shape. `mapWixMerchandiseProductItem` returns null on any type
 * mismatch (a row that fails validation silently drops rather than
 * corrupting a read); `category` must be a known registry key.
 * See docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 */
export type WixMerchandiseProductItem = {
  beaconMerchandiseProductId?: unknown;
  organizationId?: unknown;
  sku?: unknown;
  name?: unknown;
  description?: unknown;
  category?: unknown;
  cost?: unknown;
  retailPrice?: unknown;
  taxable?: unknown;
  isActive?: unknown;
  trackInventory?: unknown;
  reorderPoint?: unknown;
  defaultLocationId?: unknown;
  imageStorageKey?: unknown;
  familyVisible?: unknown;
  supplierName?: unknown;
  parentProductId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function mapWixMerchandiseProductItem(item: WixMerchandiseProductItem | undefined): MerchandiseProduct | null {
  if (
    !item ||
    typeof item.beaconMerchandiseProductId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.sku !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.category !== 'string' ||
    !isValidMerchandiseCategoryKey(item.category) ||
    typeof item.cost !== 'number' ||
    typeof item.retailPrice !== 'number' ||
    typeof item.taxable !== 'boolean' ||
    typeof item.isActive !== 'boolean' ||
    typeof item.trackInventory !== 'boolean' ||
    typeof item.familyVisible !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconMerchandiseProductId,
    organizationId: item.organizationId,
    sku: item.sku,
    name: item.name,
    description: nullableString(item.description),
    category: item.category as MerchandiseCategoryKey,
    cost: item.cost,
    retailPrice: item.retailPrice,
    taxable: item.taxable,
    isActive: item.isActive,
    trackInventory: item.trackInventory,
    reorderPoint: nullableNumber(item.reorderPoint),
    defaultLocationId: nullableString(item.defaultLocationId),
    imageStorageKey: nullableString(item.imageStorageKey),
    familyVisible: item.familyVisible,
    supplierName: nullableString(item.supplierName),
    parentProductId: nullableString(item.parentProductId),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixMerchandiseProductData(product: MerchandiseProduct): WixMerchandiseProductItem {
  return {
    beaconMerchandiseProductId: product.id,
    organizationId: product.organizationId,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    cost: product.cost,
    retailPrice: product.retailPrice,
    taxable: product.taxable,
    isActive: product.isActive,
    trackInventory: product.trackInventory,
    reorderPoint: product.reorderPoint,
    defaultLocationId: product.defaultLocationId,
    imageStorageKey: product.imageStorageKey,
    familyVisible: product.familyVisible,
    supplierName: product.supplierName,
    parentProductId: product.parentProductId,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/** Mutable fields only — id/organizationId/createdAt never change; a full
    merged object is produced for `updateWixDataItem`'s full-replace. */
export function applyMerchandiseProductUpdateToWixData(
  existing: WixMerchandiseProductItem,
  patch: Partial<Pick<MerchandiseProduct, 'name' | 'description' | 'category' | 'cost' | 'retailPrice' | 'taxable' | 'isActive' | 'trackInventory' | 'reorderPoint' | 'defaultLocationId' | 'imageStorageKey' | 'familyVisible' | 'supplierName' | 'updatedAt'>>,
): WixMerchandiseProductItem {
  const next: WixMerchandiseProductItem = { ...existing };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.category !== undefined) next.category = patch.category;
  if (patch.cost !== undefined) next.cost = patch.cost;
  if (patch.retailPrice !== undefined) next.retailPrice = patch.retailPrice;
  if (patch.taxable !== undefined) next.taxable = patch.taxable;
  if (patch.isActive !== undefined) next.isActive = patch.isActive;
  if (patch.trackInventory !== undefined) next.trackInventory = patch.trackInventory;
  if (patch.reorderPoint !== undefined) next.reorderPoint = patch.reorderPoint;
  if (patch.defaultLocationId !== undefined) next.defaultLocationId = patch.defaultLocationId;
  if (patch.imageStorageKey !== undefined) next.imageStorageKey = patch.imageStorageKey;
  if (patch.familyVisible !== undefined) next.familyVisible = patch.familyVisible;
  if (patch.supplierName !== undefined) next.supplierName = patch.supplierName;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
