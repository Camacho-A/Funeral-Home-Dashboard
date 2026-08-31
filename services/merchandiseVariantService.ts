import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixMerchandiseProductVariantItem,
  buildWixMerchandiseProductVariantData,
  applyMerchandiseProductVariantUpdateToWixData,
  type WixMerchandiseProductVariantItem,
} from '../lib/wixMerchandiseProductVariantMapper';
import type { MerchandiseProductVariant } from '../types/merchandiseProductVariant';
import {
  getProductById,
  getVariantById,
  listVariantsForProduct,
  productExistsWithSku,
  setProductHasVariants,
  setProductArchived,
} from './merchandiseService';
import type { MerchandiseProduct } from '../types/merchandiseProduct';
import { getSupplierById } from './supplierService';
import { productLevelStockInUse, variantStockInUse } from './inventoryService';
import { hasOpenLineForProductVariant } from './purchaseOrderService';
import {
  recordMerchandiseVariantCreated,
  recordMerchandiseVariantUpdated,
  recordMerchandiseVariantArchived,
  type ActivityContext,
  type FieldChange,
} from './activityService';
import { merchandiseProductVariantFixtures } from './__mocks__/merchandiseFixtures';

/**
 * Phase 37 (Product Variants, Sales Tax & Merchandise Pricing — ADR-041). The
 * SOLE writer of the `merchandiseProductVariants` collection. It also is the
 * sole authority that flips `MerchandiseProduct.hasVariants` (decision R3), and
 * enforces the strict product/variant bifurcation and its transition/archival
 * guards (decision R6). It never hard-deletes a variant (history stays
 * resolvable); archival is `isActive: false`, fail-closed when operational
 * state exists.
 *
 * SKU uniqueness (decision R4) is application-enforced, organization-scoped,
 * across BOTH `merchandiseProducts` and `merchandiseProductVariants`. Wix's
 * single-field unique index cannot span two collections, so a residual
 * check-then-insert (TOCTOU) race remains — the same class already accepted for
 * the Phase 35 product-SKU check, and disclosed, never claimed as a DB-level
 * guarantee.
 */
export class MerchandiseVariantServiceError extends Error {
  constructor(message: string, public readonly code: 'not_found' | 'invalid_input' | 'duplicate_sku' | 'conversion_blocked' | 'archive_blocked') {
    super(message);
    this.name = 'MerchandiseVariantServiceError';
  }
}

/** Canonicalize a SKU consistently before any uniqueness check — trim only,
    matching the existing Phase 35 product-SKU convention (case-sensitive). */
function canonicalizeSku(sku: string): string {
  return sku.trim();
}

async function variantExistsWithSku(organizationId: string, sku: string, excludeVariantId: string | null, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  let variants: MerchandiseProductVariant[];
  if (dataAdapterMode === 'mock') {
    variants = merchandiseProductVariantFixtures.filter((v) => v.organizationId === organizationId && v.sku === sku);
  } else {
    const response = await queryWixDataItems<WixMerchandiseProductVariantItem>('merchandiseProductVariants', { filter: { organizationId, sku } });
    variants = response.dataItems.map((i) => mapWixMerchandiseProductVariantItem(i.data)).filter((v): v is MerchandiseProductVariant => v !== null);
  }
  return variants.some((v) => v.id !== excludeVariantId);
}

/** The cross-collection uniqueness guard: a SKU may collide with neither a
    product SKU nor any OTHER variant SKU in the same organization. */
async function assertSkuAvailable(organizationId: string, sku: string, excludeVariantId: string | null, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (await productExistsWithSku(organizationId, sku, dataAdapterMode)) {
    throw new MerchandiseVariantServiceError(`SKU "${sku}" is already used by a product.`, 'duplicate_sku');
  }
  if (await variantExistsWithSku(organizationId, sku, excludeVariantId, dataAdapterMode)) {
    throw new MerchandiseVariantServiceError(`SKU "${sku}" is already used by another variant.`, 'duplicate_sku');
  }
}

function assertValidOverrides(input: { retailPriceOverride?: number | null; costOverride?: number | null }): void {
  if (input.retailPriceOverride != null && (!Number.isInteger(input.retailPriceOverride) || input.retailPriceOverride < 0)) {
    throw new MerchandiseVariantServiceError('retailPriceOverride must be a non-negative integer number of cents or null.', 'invalid_input');
  }
  if (input.costOverride != null && (!Number.isInteger(input.costOverride) || input.costOverride < 0)) {
    throw new MerchandiseVariantServiceError('costOverride must be a non-negative integer number of cents or null.', 'invalid_input');
  }
}

async function assertValidSupplierOverride(organizationId: string, supplierIdOverride: string | null | undefined, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (supplierIdOverride == null) return;
  const supplier = await getSupplierById(organizationId, supplierIdOverride, dataAdapterMode);
  if (!supplier || supplier.organizationId !== organizationId || !supplier.isActive) {
    throw new MerchandiseVariantServiceError('supplierIdOverride must reference an active supplier in this organization.', 'invalid_input');
  }
}

async function persistNewVariant(variant: MerchandiseProductVariant, dataAdapterMode: DataAdapterMode): Promise<MerchandiseProductVariant> {
  if (dataAdapterMode === 'mock') {
    merchandiseProductVariantFixtures.push(variant);
    return variant;
  }
  const inserted = await insertWixDataItem<WixMerchandiseProductVariantItem>('merchandiseProductVariants', buildWixMerchandiseProductVariantData(variant), variant.id);
  return mapWixMerchandiseProductVariantItem(inserted.data)!;
}

async function persistVariantUpdate(organizationId: string, variantId: string, fullUpdated: MerchandiseProductVariant, patch: Parameters<typeof applyMerchandiseProductVariantUpdateToWixData>[1], dataAdapterMode: DataAdapterMode): Promise<MerchandiseProductVariant> {
  if (dataAdapterMode === 'mock') {
    const idx = merchandiseProductVariantFixtures.findIndex((v) => v.organizationId === organizationId && v.id === variantId);
    if (idx === -1) throw new MerchandiseVariantServiceError('Variant not found.', 'not_found');
    merchandiseProductVariantFixtures[idx] = fullUpdated;
    return fullUpdated;
  }
  const response = await queryWixDataItems<WixMerchandiseProductVariantItem>('merchandiseProductVariants', { filter: { organizationId, beaconMerchandiseProductVariantId: variantId }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new MerchandiseVariantServiceError('Variant not found.', 'not_found');
  const merged = applyMerchandiseProductVariantUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixMerchandiseProductVariantItem>('merchandiseProductVariants', existingItem.id, merged);
  return mapWixMerchandiseProductVariantItem(updated.data)!;
}

async function bestEffortActivity(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (error) { console.error('Failed to record variant activity event:', error instanceof Error ? error.message : error); }
}

export type CreateVariantInput = {
  organizationId: string;
  productId: string;
  sku: string;
  name: string;
  optionValues?: Record<string, string> | null;
  retailPriceOverride?: number | null;
  costOverride?: number | null;
  taxableOverride?: boolean | null;
  supplierIdOverride?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function createVariant(input: CreateVariantInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<MerchandiseProductVariant> {
  const product = await getProductById(input.organizationId, input.productId, dataAdapterMode);
  if (!product || !product.isActive) throw new MerchandiseVariantServiceError('Product not found or archived.', 'invalid_input');
  const sku = canonicalizeSku(input.sku);
  if (sku.length === 0) throw new MerchandiseVariantServiceError('A variant requires a non-empty SKU.', 'invalid_input');
  const name = input.name.trim();
  if (name.length === 0) throw new MerchandiseVariantServiceError('A variant requires a name.', 'invalid_input');
  assertValidOverrides(input);
  await assertValidSupplierOverride(input.organizationId, input.supplierIdOverride, dataAdapterMode);
  await assertSkuAvailable(input.organizationId, sku, null, dataAdapterMode);

  // Bifurcation transition guard (R6): adding the FIRST variant flips the
  // product non-variant → variant parent. That must fail closed if the product
  // still holds product-level operational state that would otherwise be
  // orphaned — never silently redistribute it among variants.
  if (!product.hasVariants) {
    if (await productLevelStockInUse(input.organizationId, input.productId, dataAdapterMode)) {
      throw new MerchandiseVariantServiceError('Cannot add a variant while the product still holds product-level stock or active reservations. Resolve product-level inventory first.', 'conversion_blocked');
    }
    if (await hasOpenLineForProductVariant(input.organizationId, input.productId, null, dataAdapterMode)) {
      throw new MerchandiseVariantServiceError('Cannot add a variant while an open (product-level) purchase-order line references this product.', 'conversion_blocked');
    }
  }

  const nowIso = input.now ?? new Date().toISOString();
  const variant: MerchandiseProductVariant = {
    id: input.idFactory(),
    organizationId: input.organizationId,
    productId: input.productId,
    sku,
    name,
    optionValues: input.optionValues ? JSON.stringify(input.optionValues) : null,
    retailPriceOverride: input.retailPriceOverride ?? null,
    costOverride: input.costOverride ?? null,
    taxableOverride: input.taxableOverride ?? null,
    supplierIdOverride: input.supplierIdOverride ?? null,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const persisted = await persistNewVariant(variant, dataAdapterMode);
  // Flip the mode flag AFTER the variant exists, so an interrupted create never
  // leaves hasVariants=true with zero variants (safer ordering under Wix's lack
  // of transactions; a reconciliation test detects any residual drift).
  await setProductHasVariants(input.organizationId, input.productId, true, dataAdapterMode, nowIso);
  await bestEffortActivity(() => recordMerchandiseVariantCreated(ctx, persisted.id, { productId: persisted.productId, sku: persisted.sku, name: persisted.name }, dataAdapterMode));
  return persisted;
}

export type UpdateVariantInput = Partial<
  Pick<MerchandiseProductVariant, 'name' | 'retailPriceOverride' | 'costOverride' | 'taxableOverride' | 'supplierIdOverride'>
> & { optionValues?: Record<string, string> | null; now?: string };

export async function updateVariant(organizationId: string, variantId: string, patch: UpdateVariantInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<MerchandiseProductVariant> {
  const existing = await getVariantById(organizationId, variantId, dataAdapterMode);
  if (!existing) throw new MerchandiseVariantServiceError('Variant not found.', 'not_found');
  assertValidOverrides(patch);
  if (patch.supplierIdOverride !== undefined) await assertValidSupplierOverride(organizationId, patch.supplierIdOverride, dataAdapterMode);

  const nowIso = patch.now ?? new Date().toISOString();
  const nextOptionValues = patch.optionValues !== undefined ? (patch.optionValues ? JSON.stringify(patch.optionValues) : null) : existing.optionValues;
  const changedFields: Record<string, FieldChange> = {};
  const track = (field: string, prev: unknown, next: unknown) => { if (next !== undefined && next !== prev) changedFields[field] = { previous: prev, next }; };
  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
  track('name', existing.name, patch.name !== undefined ? nextName : undefined);
  track('optionValues', existing.optionValues, patch.optionValues !== undefined ? nextOptionValues : undefined);
  track('retailPriceOverride', existing.retailPriceOverride, patch.retailPriceOverride);
  track('costOverride', existing.costOverride, patch.costOverride);
  track('taxableOverride', existing.taxableOverride, patch.taxableOverride);
  track('supplierIdOverride', existing.supplierIdOverride, patch.supplierIdOverride);

  const updated: MerchandiseProductVariant = {
    ...existing,
    name: nextName,
    optionValues: nextOptionValues,
    retailPriceOverride: patch.retailPriceOverride !== undefined ? patch.retailPriceOverride : existing.retailPriceOverride,
    costOverride: patch.costOverride !== undefined ? patch.costOverride : existing.costOverride,
    taxableOverride: patch.taxableOverride !== undefined ? patch.taxableOverride : existing.taxableOverride,
    supplierIdOverride: patch.supplierIdOverride !== undefined ? patch.supplierIdOverride : existing.supplierIdOverride,
    updatedAt: nowIso,
  };
  const persisted = await persistVariantUpdate(organizationId, variantId, updated, {
    name: nextName, optionValues: nextOptionValues,
    retailPriceOverride: updated.retailPriceOverride, costOverride: updated.costOverride,
    taxableOverride: updated.taxableOverride, supplierIdOverride: updated.supplierIdOverride, updatedAt: nowIso,
  }, dataAdapterMode);
  if (Object.keys(changedFields).length > 0) {
    await bestEffortActivity(() => recordMerchandiseVariantUpdated(ctx, variantId, changedFields, dataAdapterMode));
  }
  return persisted;
}

/**
 * Archive (soft-deactivate) a single variant. Fail-closed if the variant still
 * holds stock, active reservations, or an open receivable PO line (decision R6)
 * — never orphan operational inventory. Never hard-deletes; never auto-flips
 * `hasVariants` back (variant → non-variant conversion is out of Phase 37
 * scope), so historical orders/movements/PO/receipts stay resolvable.
 */
export async function archiveVariant(organizationId: string, variantId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string): Promise<MerchandiseProductVariant> {
  const existing = await getVariantById(organizationId, variantId, dataAdapterMode);
  if (!existing) throw new MerchandiseVariantServiceError('Variant not found.', 'not_found');
  if (!existing.isActive) return existing;
  if (await variantStockInUse(organizationId, existing.productId, variantId, dataAdapterMode)) {
    throw new MerchandiseVariantServiceError('Cannot archive a variant that still holds stock or active reservations.', 'archive_blocked');
  }
  if (await hasOpenLineForProductVariant(organizationId, existing.productId, variantId, dataAdapterMode)) {
    throw new MerchandiseVariantServiceError('Cannot archive a variant with an open purchase-order line.', 'archive_blocked');
  }
  const nowIso = now ?? new Date().toISOString();
  const updated: MerchandiseProductVariant = { ...existing, isActive: false, updatedAt: nowIso };
  const persisted = await persistVariantUpdate(organizationId, variantId, updated, { isActive: false, updatedAt: nowIso }, dataAdapterMode);
  await bestEffortActivity(() => recordMerchandiseVariantArchived(ctx, variantId, dataAdapterMode));
  return persisted;
}

/**
 * Guard used by product archival (decision R10): a variant-parent product may
 * not be archived while any active variant, variant stock, active reservation,
 * or open receivable PO line remains — the caller (merchandiseService /
 * route) fails closed on `true`. Read-only; never cascades.
 */
export async function productHasBlockingVariantState(organizationId: string, productId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const activeVariants = await listVariantsForProduct(organizationId, productId, dataAdapterMode, { includeInactive: false });
  if (activeVariants.length > 0) return true;
  const allVariants = await listVariantsForProduct(organizationId, productId, dataAdapterMode, { includeInactive: true });
  for (const v of allVariants) {
    if (await variantStockInUse(organizationId, productId, v.id, dataAdapterMode)) return true;
    if (await hasOpenLineForProductVariant(organizationId, productId, v.id, dataAdapterMode)) return true;
  }
  return false;
}

/**
 * Decision R10: the ONE archival entry point a product-archive route calls. For
 * a variant-parent product it fails closed (never blindly cascades) when any
 * active variant / variant stock / active reservation / open receivable PO line
 * would become inaccessible; otherwise (and for a non-variant product) it
 * delegates to the low-level `setProductArchived`. Keeps the guard in the
 * service layer so the route stays business-logic-free.
 */
export async function archiveProductWithVariantGuard(organizationId: string, productId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string): Promise<MerchandiseProduct> {
  const product = await getProductById(organizationId, productId, dataAdapterMode);
  if (!product) throw new MerchandiseVariantServiceError('Product not found.', 'not_found');
  if (product.hasVariants && (await productHasBlockingVariantState(organizationId, productId, dataAdapterMode))) {
    throw new MerchandiseVariantServiceError('Cannot archive a product while active variants, variant stock, reservations, or open purchase-order lines remain. Archive/resolve those first.', 'archive_blocked');
  }
  return setProductArchived(organizationId, productId, true, ctx, dataAdapterMode, now);
}
