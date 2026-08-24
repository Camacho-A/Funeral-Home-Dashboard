import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { MANORS_PRIMARY_LOCATION_ID } from './__mocks__/onboardingFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { merchandiseProductFixtures, inventoryMovementFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures } from './__mocks__/merchandiseFixtures';
import { supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures, vendorBillFixtures, vendorBillLineItemFixtures, billPaymentFixtures } from './__mocks__/procurementFixtures';
import { createProduct } from './merchandiseService';
import { listMovementsByType } from './inventoryService';
import { createSupplier } from './supplierService';
import { createPurchaseOrder, submitPurchaseOrder, receiveAgainstPurchaseOrder, listLineItemsForPurchaseOrder } from './purchaseOrderService';
import { createVendorBill, recordBillPayment } from './accountsPayableService';
import { accountsPayableBalance, accountsPayableOverdue, goodsReceivedNotInvoiced, openPurchaseOrderValue, accountsPayableAging } from './accountsPayableReportingService';

let idCounter = 0;
const idFactory = () => `id-${(idCounter += 1)}`;
const NOW = '2026-08-21T00:00:00.000Z';
const ORG = DEFAULT_ORGANIZATION_ID;
const LOC = MANORS_PRIMARY_LOCATION_ID;
const CTX = { organizationId: ORG, actorIdentityId: 'i', actorMembershipId: null, actorRoleKey: null, correlationId: 'c' };

beforeEach(() => {
  idCounter = 0;
  for (const a of [ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, activityEventFixtures, merchandiseProductFixtures, inventoryMovementFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures, supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures, vendorBillFixtures, vendorBillLineItemFixtures, billPaymentFixtures]) a.length = 0;
});

describe('accountsPayableReportingService — ledger/commitment-derived', () => {
  it('reflects GRNI, AP balance, overdue, open-PO value, and aging', async () => {
    const supplier = await createSupplier({ organizationId: ORG, name: 'Rep Co', idFactory, now: NOW }, CTX, 'mock');
    const product = await createProduct({ organizationId: ORG, sku: 'RP', name: 'P', category: 'urn', cost: 10000, retailPrice: 20000, idFactory, now: NOW }, CTX, 'mock');
    const { purchaseOrder } = await createPurchaseOrder({ organizationId: ORG, supplierId: supplier.id, locationId: LOC, orderDate: NOW, lines: [{ productId: product.id, quantityOrdered: 5, unitCostCents: 10000 }], idFactory, now: NOW }, CTX, 'mock');
    await submitPurchaseOrder(ORG, purchaseOrder.id, CTX, 'mock', NOW);

    // Before receiving: open PO commitment = 50000, GRNI/AP = 0.
    expect(await openPurchaseOrderValue(ORG, 'mock')).toBe(50000);
    expect(await goodsReceivedNotInvoiced(ORG, 'mock')).toBe(0);

    const line = (await listLineItemsForPurchaseOrder(ORG, purchaseOrder.id, 'mock'))[0];
    await receiveAgainstPurchaseOrder({ organizationId: ORG, purchaseOrderId: purchaseOrder.id, receiptReference: 'r', receipts: [{ purchaseOrderLineItemId: line.id, quantity: 5 }], idFactory, now: NOW }, CTX, 'mock');
    // After receiving: GRNI = 50000 (received not invoiced), AP still 0.
    expect(await goodsReceivedNotInvoiced(ORG, 'mock')).toBe(50000);
    expect(await accountsPayableBalance(ORG, 'mock')).toBe(0);

    const receipt = (await listMovementsByType(ORG, 'receiving', 'mock'))[0];
    // Bill it, due in the past → overdue.
    const { bill } = await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-R', billDate: '2026-06-01', dueDate: '2026-06-15', goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 5, billedUnitCostCents: 10000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    expect(await goodsReceivedNotInvoiced(ORG, 'mock')).toBe(0); // GRNI cleared
    expect(await accountsPayableBalance(ORG, 'mock')).toBe(50000); // now owed
    expect(await accountsPayableOverdue(ORG, 'mock', NOW)).toBe(50000); // due 2026-06-15 < now

    const aging = await accountsPayableAging(ORG, 'mock', NOW);
    // Due 2026-06-15, as-of 2026-08-21 ≈ 67 days overdue → lands in a single bucket; total is what matters.
    expect(Object.values(aging).reduce((s, n) => s + n, 0)).toBe(50000);
    expect(aging['61-90']).toBe(50000);

    // Pay part → AP drops.
    await recordBillPayment({ organizationId: ORG, vendorBillId: bill.id, amountCents: 20000, paymentDate: NOW, method: 'ach', cashAccountNumber: '1000', idFactory, now: NOW }, CTX, 'mock');
    expect(await accountsPayableBalance(ORG, 'mock')).toBe(30000);
    expect(await accountsPayableOverdue(ORG, 'mock', NOW)).toBe(30000);
  });
});
