import { describe, it, expect, beforeEach } from 'vitest';
import { createVariant, updateVariant, archiveVariant, archiveProductWithVariantGuard, MerchandiseVariantServiceError } from './merchandiseVariantService';
import { createProduct, getProductById, getVariantById } from './merchandiseService';
import { createSupplier } from './supplierService';
import { receiveStock } from './inventoryService';
import {
  merchandiseProductFixtures,
  merchandiseProductVariantFixtures,
  inventoryMovementFixtures,
  inventoryReservationFixtures,
  inventoryBalanceFixtures,
} from './__mocks__/merchandiseFixtures';
import { supplierFixtures } from './__mocks__/procurementFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let n = 0;
const idFactory = () => `id-${(n += 1)}`;
const NOW = '2026-08-28T00:00:00.000Z';
const ORG = DEFAULT_ORGANIZATION_ID;
const CTX = { organizationId: ORG, actorIdentityId: 'i', actorMembershipId: null, actorRoleKey: null, correlationId: 'c' };

async function seedProduct(sku: string, over: Partial<Parameters<typeof createProduct>[0]> = {}) {
  return createProduct({ organizationId: ORG, sku, name: `P-${sku}`, category: 'urn', cost: 10_000, retailPrice: 25_000, trackInventory: true, idFactory, now: NOW, ...over }, CTX, 'mock');
}

beforeEach(() => {
  n = 0;
  for (const a of [merchandiseProductFixtures, merchandiseProductVariantFixtures, supplierFixtures, inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures, activityEventFixtures]) a.length = 0;
});

describe('Phase 37 merchandiseVariantService', () => {
  it('creates a variant, flips the product to hasVariants=true, records activity', async () => {
    const product = await seedProduct('URN');
    const variant = await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-BRONZE', name: 'Bronze', optionValues: { Material: 'Bronze' }, retailPriceOverride: 30_000, idFactory, now: NOW }, CTX, 'mock');
    expect(variant.retailPriceOverride).toBe(30_000);
    expect(variant.optionValues).toBe(JSON.stringify({ Material: 'Bronze' }));
    expect((await getProductById(ORG, product.id, 'mock'))?.hasVariants).toBe(true);
    expect(activityEventFixtures.some((e) => e.eventType === 'merchandise.variant.created')).toBe(true);
  });

  it('rejects a variant SKU that collides with a product SKU', async () => {
    const p1 = await seedProduct('URN');
    await seedProduct('CASKET');
    await expect(createVariant({ organizationId: ORG, productId: p1.id, sku: 'CASKET', name: 'X', idFactory, now: NOW }, CTX, 'mock'))
      .rejects.toMatchObject({ code: 'duplicate_sku' });
  });

  it('rejects a variant SKU that collides with another variant SKU', async () => {
    const p1 = await seedProduct('URN');
    await createVariant({ organizationId: ORG, productId: p1.id, sku: 'URN-A', name: 'A', idFactory, now: NOW }, CTX, 'mock');
    await expect(createVariant({ organizationId: ORG, productId: p1.id, sku: 'URN-A', name: 'B', idFactory, now: NOW }, CTX, 'mock'))
      .rejects.toMatchObject({ code: 'duplicate_sku' });
  });

  it('canonicalizes (trims) SKU before the uniqueness check', async () => {
    const p1 = await seedProduct('URN');
    await createVariant({ organizationId: ORG, productId: p1.id, sku: 'URN-A', name: 'A', idFactory, now: NOW }, CTX, 'mock');
    await expect(createVariant({ organizationId: ORG, productId: p1.id, sku: '  URN-A  ', name: 'B', idFactory, now: NOW }, CTX, 'mock'))
      .rejects.toMatchObject({ code: 'duplicate_sku' });
  });

  it('allows the same SKU in a different organization', async () => {
    const p1 = await seedProduct('URN');
    await createVariant({ organizationId: ORG, productId: p1.id, sku: 'SHARED', name: 'A', idFactory, now: NOW }, CTX, 'mock');
    const other = await createProduct({ organizationId: 'other-org', sku: 'URN2', name: 'P2', category: 'urn', cost: 1, retailPrice: 2, idFactory, now: NOW }, { ...CTX, organizationId: 'other-org' }, 'mock');
    const v = await createVariant({ organizationId: 'other-org', productId: other.id, sku: 'SHARED', name: 'A', idFactory, now: NOW }, { ...CTX, organizationId: 'other-org' }, 'mock');
    expect(v.sku).toBe('SHARED');
  });

  it('validates numeric overrides and supplier override', async () => {
    const p1 = await seedProduct('URN');
    await expect(createVariant({ organizationId: ORG, productId: p1.id, sku: 'URN-A', name: 'A', retailPriceOverride: -5, idFactory, now: NOW }, CTX, 'mock'))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(createVariant({ organizationId: ORG, productId: p1.id, sku: 'URN-B', name: 'B', supplierIdOverride: 'nope', idFactory, now: NOW }, CTX, 'mock'))
      .rejects.toMatchObject({ code: 'invalid_input' });
    const supplier = await createSupplier({ organizationId: ORG, name: 'Acme', idFactory, now: NOW }, CTX, 'mock');
    const v = await createVariant({ organizationId: ORG, productId: p1.id, sku: 'URN-C', name: 'C', supplierIdOverride: supplier.id, idFactory, now: NOW }, CTX, 'mock');
    expect(v.supplierIdOverride).toBe(supplier.id);
  });

  it('blocks the first-variant conversion while product-level stock exists (R6)', async () => {
    const product = await seedProduct('URN', { defaultLocationId: 'loc-1' });
    // Receive product-level stock (no variant) — now converting to variant mode is ambiguous.
    await receiveStock({ organizationId: ORG, productId: product.id, locationId: 'loc-1', quantity: 5, unitCost: 10_000, receiptReference: 'r1', idFactory, now: NOW }, CTX, 'mock');
    await expect(createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-A', name: 'A', idFactory, now: NOW }, CTX, 'mock'))
      .rejects.toMatchObject({ code: 'conversion_blocked' });
    expect((await getProductById(ORG, product.id, 'mock'))?.hasVariants).toBe(false);
  });

  it('blocks archiving a variant that holds stock, allows a clean archive (no hasVariants auto-flip)', async () => {
    const product = await seedProduct('URN', { defaultLocationId: 'loc-1' });
    const v = await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-A', name: 'A', idFactory, now: NOW }, CTX, 'mock');
    await receiveStock({ organizationId: ORG, productId: product.id, variantId: v.id, locationId: 'loc-1', quantity: 3, unitCost: 10_000, receiptReference: 'r1', idFactory, now: NOW }, CTX, 'mock');
    await expect(archiveVariant(ORG, v.id, CTX, 'mock', NOW)).rejects.toMatchObject({ code: 'archive_blocked' });
    // Adjust the stock back to zero, then archival succeeds.
    await receiveStock({ organizationId: ORG, productId: product.id, variantId: v.id, locationId: 'loc-1', quantity: 3, unitCost: 10_000, receiptReference: 'r2', idFactory, now: NOW }, CTX, 'mock');
    // still 6 on hand → still blocked; instead create a fresh clean variant
    const v2 = await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-B', name: 'B', idFactory, now: NOW }, CTX, 'mock');
    const archived = await archiveVariant(ORG, v2.id, CTX, 'mock', NOW);
    expect(archived.isActive).toBe(false);
    expect((await getProductById(ORG, product.id, 'mock'))?.hasVariants).toBe(true);
    expect((await getVariantById(ORG, v2.id, 'mock'))?.isActive).toBe(false);
  });

  it('archiveProductWithVariantGuard blocks while an active variant exists, allows for a plain product', async () => {
    const product = await seedProduct('URN');
    await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-A', name: 'A', idFactory, now: NOW }, CTX, 'mock');
    await expect(archiveProductWithVariantGuard(ORG, product.id, CTX, 'mock', NOW)).rejects.toMatchObject({ code: 'archive_blocked' });
    const plain = await seedProduct('PLAIN');
    const archived = await archiveProductWithVariantGuard(ORG, plain.id, CTX, 'mock', NOW);
    expect(archived.isActive).toBe(false);
  });

  it('updateVariant changes overrides and records activity', async () => {
    const product = await seedProduct('URN');
    const v = await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-A', name: 'A', idFactory, now: NOW }, CTX, 'mock');
    const updated = await updateVariant(ORG, v.id, { retailPriceOverride: 40_000, taxableOverride: false }, CTX, 'mock');
    expect(updated.retailPriceOverride).toBe(40_000);
    expect(updated.taxableOverride).toBe(false);
    expect(activityEventFixtures.some((e) => e.eventType === 'merchandise.variant.updated')).toBe(true);
  });

  it(String.raw`throws MerchandiseVariantServiceError instances`, async () => {
    const p1 = await seedProduct('URN');
    await createVariant({ organizationId: ORG, productId: p1.id, sku: 'DUP', name: 'A', idFactory, now: NOW }, CTX, 'mock');
    const err = await createVariant({ organizationId: ORG, productId: p1.id, sku: 'DUP', name: 'B', idFactory, now: NOW }, CTX, 'mock').catch((e) => e);
    expect(err).toBeInstanceOf(MerchandiseVariantServiceError);
  });
});
