import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { caseWriteOffFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { merchandiseProductFixtures, inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures } from './__mocks__/merchandiseFixtures';
import { createProduct } from './merchandiseService';
import { receiveStock, syncReservation, fulfillReservation } from './inventoryService';
import { createCaseOrder, recalculateOrder } from './pricingService';
import { merchandiseRevenue, merchandiseCogs, merchandiseGrossMargin, inventoryAssetValue, inventoryOnHandUnits, lowStockProductCount } from './merchandiseReportingService';

let idCounter = 0;
const idFactory = () => `id-${(idCounter += 1)}`;
const NOW = '2026-08-19T00:00:00.000Z';
const CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'i1', actorMembershipId: null, actorRoleKey: null, correlationId: 'c1' };
const LOC = 'loc-main';

beforeEach(() => {
  idCounter = 0;
  for (const arr of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, paymentRecordFixtures, activityEventFixtures, caseWriteOffFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, merchandiseProductFixtures, inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures]) arr.length = 0;
});

describe('merchandiseReportingService', () => {
  it('derives revenue/COGS/margin from the ledger and inventory figures from balances', async () => {
    const product = await createProduct({ organizationId: DEFAULT_ORGANIZATION_ID, sku: 'URN', name: 'Urn', category: 'urn', cost: 15000, retailPrice: 39000, reorderPoint: 3, idFactory, now: NOW }, CTX, 'mock');
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: product.id, locationId: LOC, quantity: 5, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    await createCaseOrder({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false }, performedBy: 'i1', idFactory, now: NOW }, 'mock');
    await syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', caseOrderId: 'o', productId: product.id, locationId: LOC, quantity: 2, idFactory, now: NOW }, CTX, 'mock');
    await recalculateOrder({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', selections: { merchandise: [{ productId: product.id, locationId: LOC, quantity: 2 }] }, performedBy: 'i1', idFactory, now: NOW }, 'mock');
    await fulfillReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', productId: product.id, locationId: LOC, idFactory, now: NOW }, CTX, 'mock');

    // Revenue = 2 × 39000; COGS = 2 × 15000; margin = revenue − cogs.
    expect(await merchandiseRevenue(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(78000);
    expect(await merchandiseCogs(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(30000);
    expect(await merchandiseGrossMargin(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(48000);
    // On hand after fulfillment: 5 − 2 = 3 units; asset value 3 × 15000.
    expect(await inventoryOnHandUnits(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(3);
    expect(await inventoryAssetValue(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(45000);
    // reorderPoint 3, onHand 3 → low stock.
    expect(await lowStockProductCount(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(1);
  });
});
