import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixMerchandiseProductItem,
  buildWixMerchandiseProductData,
  applyMerchandiseProductUpdateToWixData,
  type WixMerchandiseProductItem,
} from '../lib/wixMerchandiseProductMapper';
import type { MerchandiseProduct } from '../types/merchandiseProduct';
import { isValidMerchandiseCategoryKey, type MerchandiseCategoryKey } from '../domain/merchandise/merchandiseCategoryRegistry';
import {
  recordMerchandiseProductCreated,
  recordMerchandiseProductUpdated,
  recordMerchandiseProductArchived,
  type ActivityContext,
  type FieldChange,
} from './activityService';
import { merchandiseProductFixtures } from './__mocks__/merchandiseFixtures';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Sole writer of the
 * `merchandiseProducts` collection — the org's physical-goods catalog. A
 * product carries an INTERNAL `cost` (never exposed to family; a structural
 * test enforces this). Products archive (`isActive: false`), never delete,
 * so historical CaseOrder line items and inventory movements referencing a
 * product always resolve. See docs/adr/ADR-039-merchandise-inventory-and-commerce.md.
 *
 * Same organization-scoped, dataAdapterMode-branching shape as every other
 * service. Authorization is enforced at the route layer
 * (authorizationPolicyService), never here — this service does data work.
 */

export class MerchandiseServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'duplicate_sku' | 'invalid_input',
  ) {
    super(message);
    this.name = 'MerchandiseServiceError';
  }
}

// --- Reads ------------------------------------------------------------------

export async function listProductsForOrganization(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options: { includeInactive?: boolean } = {},
): Promise<MerchandiseProduct[]> {
  let products: MerchandiseProduct[];
  if (dataAdapterMode === 'mock') {
    products = merchandiseProductFixtures.filter((p) => p.organizationId === organizationId);
  } else {
    const response = await queryWixDataItems<WixMerchandiseProductItem>('merchandiseProducts', { filter: { organizationId } });
    products = response.dataItems
      .map((item) => mapWixMerchandiseProductItem(item.data))
      .filter((p): p is MerchandiseProduct => p !== null);
  }
  const filtered = options.includeInactive ? products : products.filter((p) => p.isActive);
  return filtered.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Active products only — the read services/pricingService.ts uses to price
    merchandise lines, and the reservation/availability read path. */
export function listActiveProductsForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<MerchandiseProduct[]> {
  return listProductsForOrganization(organizationId, dataAdapterMode, { includeInactive: false });
}

export async function getProductById(organizationId: string, productId: string, dataAdapterMode: DataAdapterMode): Promise<MerchandiseProduct | null> {
  if (dataAdapterMode === 'mock') {
    return merchandiseProductFixtures.find((p) => p.organizationId === organizationId && p.id === productId) ?? null;
  }
  const response = await queryWixDataItems<WixMerchandiseProductItem>('merchandiseProducts', {
    filter: { organizationId, beaconMerchandiseProductId: productId },
    paging: { limit: 1 },
  });
  return mapWixMerchandiseProductItem(response.dataItems[0]?.data);
}

async function findProductBySku(organizationId: string, sku: string, dataAdapterMode: DataAdapterMode): Promise<MerchandiseProduct | null> {
  if (dataAdapterMode === 'mock') {
    return merchandiseProductFixtures.find((p) => p.organizationId === organizationId && p.sku === sku) ?? null;
  }
  const response = await queryWixDataItems<WixMerchandiseProductItem>('merchandiseProducts', {
    filter: { organizationId, sku },
    paging: { limit: 1 },
  });
  return mapWixMerchandiseProductItem(response.dataItems[0]?.data);
}

// --- Writes -----------------------------------------------------------------

function assertNonNegativeIntegerCents(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new MerchandiseServiceError(`${field} must be a non-negative integer number of cents.`, 'invalid_input');
  }
}

export type CreateMerchandiseProductInput = {
  organizationId: string;
  sku: string;
  name: string;
  description?: string | null;
  category: string;
  cost: number;
  retailPrice: number;
  taxable?: boolean;
  trackInventory?: boolean;
  reorderPoint?: number | null;
  defaultLocationId?: string | null;
  familyVisible?: boolean;
  supplierName?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function createProduct(
  input: CreateMerchandiseProductInput,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<MerchandiseProduct> {
  const sku = input.sku.trim();
  const name = input.name.trim();
  if (sku.length === 0) throw new MerchandiseServiceError('SKU is required.', 'invalid_input');
  if (name.length === 0) throw new MerchandiseServiceError('Name is required.', 'invalid_input');
  if (!isValidMerchandiseCategoryKey(input.category)) throw new MerchandiseServiceError(`Unknown merchandise category "${input.category}".`, 'invalid_input');
  assertNonNegativeIntegerCents(input.cost, 'cost');
  assertNonNegativeIntegerCents(input.retailPrice, 'retailPrice');
  if (input.reorderPoint != null && (!Number.isInteger(input.reorderPoint) || input.reorderPoint < 0)) {
    throw new MerchandiseServiceError('reorderPoint must be a non-negative integer or null.', 'invalid_input');
  }

  // SKU uniqueness is application-enforced per organization (Wix single-field
  // unique index is not org-scoped) — check before insert.
  const existing = await findProductBySku(input.organizationId, sku, dataAdapterMode);
  if (existing) throw new MerchandiseServiceError(`A product with SKU "${sku}" already exists.`, 'duplicate_sku');

  const nowIso = input.now ?? new Date().toISOString();
  const product: MerchandiseProduct = {
    id: input.idFactory(),
    organizationId: input.organizationId,
    sku,
    name,
    description: input.description ?? null,
    category: input.category as MerchandiseCategoryKey,
    cost: input.cost,
    retailPrice: input.retailPrice,
    taxable: input.taxable ?? false,
    isActive: true,
    trackInventory: input.trackInventory ?? true,
    reorderPoint: input.reorderPoint ?? null,
    defaultLocationId: input.defaultLocationId ?? null,
    imageStorageKey: null,
    familyVisible: input.familyVisible ?? false,
    supplierName: input.supplierName ?? null,
    parentProductId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const persisted = await persistNewProduct(product, dataAdapterMode);
  await bestEffortActivity(() => recordMerchandiseProductCreated(ctx, persisted.id, { sku: persisted.sku, name: persisted.name }, dataAdapterMode));
  return persisted;
}

export type UpdateMerchandiseProductInput = Partial<
  Pick<MerchandiseProduct, 'name' | 'description' | 'category' | 'cost' | 'retailPrice' | 'taxable' | 'trackInventory' | 'reorderPoint' | 'defaultLocationId' | 'familyVisible' | 'supplierName'>
> & { now?: string };

export async function updateProduct(
  organizationId: string,
  productId: string,
  patch: UpdateMerchandiseProductInput,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<MerchandiseProduct> {
  const existing = await getProductById(organizationId, productId, dataAdapterMode);
  if (!existing) throw new MerchandiseServiceError('Product not found.', 'not_found');

  if (patch.category !== undefined && !isValidMerchandiseCategoryKey(patch.category)) {
    throw new MerchandiseServiceError(`Unknown merchandise category "${patch.category}".`, 'invalid_input');
  }
  if (patch.cost !== undefined) assertNonNegativeIntegerCents(patch.cost, 'cost');
  if (patch.retailPrice !== undefined) assertNonNegativeIntegerCents(patch.retailPrice, 'retailPrice');
  if (patch.reorderPoint !== undefined && patch.reorderPoint !== null && (!Number.isInteger(patch.reorderPoint) || patch.reorderPoint < 0)) {
    throw new MerchandiseServiceError('reorderPoint must be a non-negative integer or null.', 'invalid_input');
  }

  const nowIso = patch.now ?? new Date().toISOString();
  const changedFields: Record<string, FieldChange> = {};
  const updateFields: (keyof UpdateMerchandiseProductInput)[] = ['name', 'description', 'category', 'cost', 'retailPrice', 'taxable', 'trackInventory', 'reorderPoint', 'defaultLocationId', 'familyVisible', 'supplierName'];
  for (const field of updateFields) {
    if (patch[field] !== undefined && patch[field] !== (existing as Record<string, unknown>)[field]) {
      changedFields[field] = { previous: (existing as Record<string, unknown>)[field], next: patch[field] };
    }
  }

  const updated: MerchandiseProduct = {
    ...existing,
    name: patch.name ?? existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    category: (patch.category as MerchandiseCategoryKey | undefined) ?? existing.category,
    cost: patch.cost ?? existing.cost,
    retailPrice: patch.retailPrice ?? existing.retailPrice,
    taxable: patch.taxable ?? existing.taxable,
    trackInventory: patch.trackInventory ?? existing.trackInventory,
    reorderPoint: patch.reorderPoint !== undefined ? patch.reorderPoint : existing.reorderPoint,
    defaultLocationId: patch.defaultLocationId !== undefined ? patch.defaultLocationId : existing.defaultLocationId,
    familyVisible: patch.familyVisible ?? existing.familyVisible,
    supplierName: patch.supplierName !== undefined ? patch.supplierName : existing.supplierName,
    updatedAt: nowIso,
  };

  const persisted = await persistProductUpdate(organizationId, productId, updated, {
    name: patch.name,
    description: patch.description,
    category: patch.category as MerchandiseCategoryKey | undefined,
    cost: patch.cost,
    retailPrice: patch.retailPrice,
    taxable: patch.taxable,
    trackInventory: patch.trackInventory,
    reorderPoint: patch.reorderPoint,
    defaultLocationId: patch.defaultLocationId,
    familyVisible: patch.familyVisible,
    supplierName: patch.supplierName,
    updatedAt: nowIso,
  }, dataAdapterMode);

  if (Object.keys(changedFields).length > 0) {
    await bestEffortActivity(() => recordMerchandiseProductUpdated(ctx, productId, changedFields, dataAdapterMode));
  }
  return persisted;
}

/** Archive (or restore). Products are never hard-deleted — historical
    references must always resolve. */
export async function setProductArchived(
  organizationId: string,
  productId: string,
  archived: boolean,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
  now?: string,
): Promise<MerchandiseProduct> {
  const existing = await getProductById(organizationId, productId, dataAdapterMode);
  if (!existing) throw new MerchandiseServiceError('Product not found.', 'not_found');
  const nowIso = now ?? new Date().toISOString();
  const updated: MerchandiseProduct = { ...existing, isActive: !archived, updatedAt: nowIso };
  const persisted = await persistProductUpdate(organizationId, productId, updated, { isActive: !archived, updatedAt: nowIso }, dataAdapterMode);
  if (archived && existing.isActive) {
    await bestEffortActivity(() => recordMerchandiseProductArchived(ctx, productId, dataAdapterMode));
  }
  return persisted;
}

/** Sets a product's image storage key after the bytes are stored by the
    route (via DocumentStorageProvider). Kept minimal — the route owns the
    upload; this only persists the reference. */
export async function setProductImageStorageKey(
  organizationId: string,
  productId: string,
  imageStorageKey: string | null,
  dataAdapterMode: DataAdapterMode,
  now?: string,
): Promise<MerchandiseProduct> {
  const existing = await getProductById(organizationId, productId, dataAdapterMode);
  if (!existing) throw new MerchandiseServiceError('Product not found.', 'not_found');
  const nowIso = now ?? new Date().toISOString();
  const updated: MerchandiseProduct = { ...existing, imageStorageKey, updatedAt: nowIso };
  return persistProductUpdate(organizationId, productId, updated, { imageStorageKey, updatedAt: nowIso }, dataAdapterMode);
}

// --- Persistence ------------------------------------------------------------

async function persistNewProduct(product: MerchandiseProduct, dataAdapterMode: DataAdapterMode): Promise<MerchandiseProduct> {
  if (dataAdapterMode === 'mock') {
    merchandiseProductFixtures.push(product);
    return product;
  }
  const inserted = await insertWixDataItem<WixMerchandiseProductItem>('merchandiseProducts', buildWixMerchandiseProductData(product), product.id);
  const mapped = mapWixMerchandiseProductItem(inserted.data);
  if (!mapped) throw new MerchandiseServiceError('Failed to create merchandise product.', 'invalid_input');
  return mapped;
}

async function persistProductUpdate(
  organizationId: string,
  productId: string,
  fullUpdated: MerchandiseProduct,
  patch: Parameters<typeof applyMerchandiseProductUpdateToWixData>[1],
  dataAdapterMode: DataAdapterMode,
): Promise<MerchandiseProduct> {
  if (dataAdapterMode === 'mock') {
    const index = merchandiseProductFixtures.findIndex((p) => p.organizationId === organizationId && p.id === productId);
    if (index === -1) throw new MerchandiseServiceError('Product not found.', 'not_found');
    merchandiseProductFixtures[index] = fullUpdated;
    return fullUpdated;
  }
  const response = await queryWixDataItems<WixMerchandiseProductItem>('merchandiseProducts', {
    filter: { organizationId, beaconMerchandiseProductId: productId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new MerchandiseServiceError('Product not found.', 'not_found');
  const merged = applyMerchandiseProductUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixMerchandiseProductItem>('merchandiseProducts', existingItem.id, merged);
  const mapped = mapWixMerchandiseProductItem(updated.data);
  if (!mapped) throw new MerchandiseServiceError('Failed to update merchandise product.', 'invalid_input');
  return mapped;
}

async function bestEffortActivity(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error('Failed to record merchandise activity event:', error instanceof Error ? error.message : error);
  }
}
