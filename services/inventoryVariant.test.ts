import { describe, it, expect, beforeEach } from 'vitest';
import { receiveStock, getStockLevel, syncReservation } from './inventoryService';
import { stockLineLockKey } from './inventoryLockService';
import { createProduct } from './merchandiseService';
import { createVariant } from './merchandiseVariantService';
import {
  merchandiseProductFixtures,
  merchandiseProductVariantFixtures,
  inventoryMovementFixtures,
  inventoryReservationFixtures,
  inventoryBalanceFixtures,
} from './__mocks__/merchandiseFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { journalEntryFixtures, journalEntryLineFixtures, ledgerAccountFixtures } from './__mocks__/ledgerFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let n = 0;
const idFactory = () => `id-${(n += 1)}`;
const NOW = '2026-08-28T00:00:00.000Z';
const ORG = DEFAULT_ORGANIZATION_ID;
const LOC = 'loc-1';
const CTX = { organizationId: ORG, actorIdentityId: 'i', actorMembershipId: null, actorRoleKey: null, correlationId: 'c' };

beforeEach(() => {
  n = 0;
  for (const a of [merchandiseProductFixtures, merchandiseProductVariantFixtures, inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures, activityEventFixtures, journalEntryFixtures, journalEntryLineFixtures, ledgerAccountFixtures]) a.length = 0;
});

describe('Phase 37 variant-aware inventory', () => {
  it('tracks each variant of one product as an independent stock line', async () => {
    const product = await createProduct({ organizationId: ORG, sku: 'URN', name: 'Urn', category: 'urn', cost: 10_000, retailPrice: 25_000, trackInventory: true, idFactory, now: NOW }, CTX, 'mock');
    const bronze = await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-BRONZE', name: 'Bronze', idFactory, now: NOW }, CTX, 'mock');
    const silver = await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-SILVER', name: 'Silver', idFactory, now: NOW }, CTX, 'mock');

    await receiveStock({ organizationId: ORG, productId: product.id, variantId: bronze.id, locationId: LOC, quantity: 5, unitCost: 10_000, receiptReference: 'r-bronze', idFactory, now: NOW }, CTX, 'mock');
    await receiveStock({ organizationId: ORG, productId: product.id, variantId: silver.id, locationId: LOC, quantity: 3, unitCost: 12_000, receiptReference: 'r-silver', idFactory, now: NOW }, CTX, 'mock');

    const bronzeLevel = await getStockLevel(ORG, product.id, LOC, 'mock', bronze.id);
    const silverLevel = await getStockLevel(ORG, product.id, LOC, 'mock', silver.id);
    expect(bronzeLevel.onHand).toBe(5);
    expect(silverLevel.onHand).toBe(3);
    // Product-level (variantId null) read sees neither variant's stock.
    expect((await getStockLevel(ORG, product.id, LOC, 'mock', null)).onHand).toBe(0);
  });

  it('reserves one variant without touching a sibling variant availability', async () => {
    const product = await createProduct({ organizationId: ORG, sku: 'URN', name: 'Urn', category: 'urn', cost: 10_000, retailPrice: 25_000, trackInventory: true, idFactory, now: NOW }, CTX, 'mock');
    const bronze = await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-BRONZE', name: 'Bronze', idFactory, now: NOW }, CTX, 'mock');
    const silver = await createVariant({ organizationId: ORG, productId: product.id, sku: 'URN-SILVER', name: 'Silver', idFactory, now: NOW }, CTX, 'mock');
    await receiveStock({ organizationId: ORG, productId: product.id, variantId: bronze.id, locationId: LOC, quantity: 5, unitCost: 10_000, receiptReference: 'r1', idFactory, now: NOW }, CTX, 'mock');
    await receiveStock({ organizationId: ORG, productId: product.id, variantId: silver.id, locationId: LOC, quantity: 5, unitCost: 10_000, receiptReference: 'r2', idFactory, now: NOW }, CTX, 'mock');

    await syncReservation({ organizationId: ORG, caseId: 'case-1', caseOrderId: 'o1', productId: product.id, variantId: bronze.id, locationId: LOC, quantity: 4, idFactory, now: NOW }, CTX, 'mock');
    expect((await getStockLevel(ORG, product.id, LOC, 'mock', bronze.id)).available).toBe(1);
    expect((await getStockLevel(ORG, product.id, LOC, 'mock', silver.id)).available).toBe(5);
  });

  it('gives each variant a distinct per-stock-line lock key (no cross-variant locking)', () => {
    const kNull = stockLineLockKey(ORG, LOC, 'prod');
    const kA = stockLineLockKey(ORG, LOC, 'prod', 'vA');
    const kB = stockLineLockKey(ORG, LOC, 'prod', 'vB');
    expect(kA).not.toBe(kB);
    expect(kNull).not.toBe(kA);
    // Backward-compatible: a null variant reproduces the exact Phase 35 key.
    expect(kNull).toBe(`${ORG}-${LOC}-prod`);
  });
});
