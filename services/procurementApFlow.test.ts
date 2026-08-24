import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { MANORS_PRIMARY_LOCATION_ID } from './__mocks__/onboardingFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import {
  merchandiseProductFixtures,
  inventoryMovementFixtures,
  inventoryReservationFixtures,
  inventoryBalanceFixtures,
  inventoryLockFixtures,
  inventoryWriteClaimFixtures,
} from './__mocks__/merchandiseFixtures';
import { supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures, vendorBillFixtures, vendorBillLineItemFixtures, billPaymentFixtures } from './__mocks__/procurementFixtures';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { getAccountByNumber } from './chartOfAccountsService';
import { getAccountBalance } from './generalLedgerService';
import { createProduct } from './merchandiseService';
import { getStockLevel, listMovementsByType } from './inventoryService';
import { createSupplier } from './supplierService';
import { createPurchaseOrder, submitPurchaseOrder, receiveAgainstPurchaseOrder, listLineItemsForPurchaseOrder } from './purchaseOrderService';
import { createVendorBill, voidVendorBill, recordBillPayment, billedQuantityForReceipt, getBillById } from './accountsPayableService';

let idCounter = 0;
const idFactory = () => `id-${(idCounter += 1)}`;
const NOW = '2026-08-21T00:00:00.000Z';
const ORG = DEFAULT_ORGANIZATION_ID;
const LOC = MANORS_PRIMARY_LOCATION_ID;
const CTX = { organizationId: ORG, actorIdentityId: 'identity-1', actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1' };

beforeEach(() => {
  idCounter = 0;
  for (const arr of [ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, activityEventFixtures, merchandiseProductFixtures, inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures, supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures, vendorBillFixtures, vendorBillLineItemFixtures, billPaymentFixtures]) {
    arr.length = 0;
  }
});

/** Debit-positive balance of an account by its number. 2100/2000 are
    credit-normal so a credit shows as negative. */
async function bal(accountNumber: string): Promise<number> {
  const acct = await getAccountByNumber(ORG, accountNumber, 'mock');
  if (!acct) return 0;
  return getAccountBalance(ORG, acct.id, 'mock');
}

async function setup(cost: number, qty: number) {
  const supplier = await createSupplier({ organizationId: ORG, name: 'Bronze Casket Co', idFactory, now: NOW }, CTX, 'mock');
  const product = await createProduct({ organizationId: ORG, sku: `SKU-${idCounter}`, name: 'Bronze Urn', category: 'urn', cost, retailPrice: cost * 2, defaultLocationId: LOC, idFactory, now: NOW }, CTX, 'mock');
  const { purchaseOrder } = await createPurchaseOrder({ organizationId: ORG, supplierId: supplier.id, locationId: LOC, orderDate: NOW, lines: [{ productId: product.id, quantityOrdered: qty, unitCostCents: cost }], idFactory, now: NOW }, CTX, 'mock');
  await submitPurchaseOrder(ORG, purchaseOrder.id, CTX, 'mock', NOW);
  await receiveAgainstPurchaseOrder({ organizationId: ORG, purchaseOrderId: purchaseOrder.id, receiptReference: `rcpt-${idCounter}`, receipts: [{ purchaseOrderLineItemId: (await listLineItemsForPurchaseOrder(ORG, purchaseOrder.id, 'mock'))[0].id, quantity: qty }], idFactory, now: NOW }, CTX, 'mock');
  const receipt = (await listMovementsByType(ORG, 'receiving', 'mock'))[0];
  return { supplier, product, purchaseOrder, receipt };
}

describe('Phase 36 procurement → AP full accounting loop (mock)', () => {
  it('PO is non-posting; receiving posts Dr 1300 / Cr 2100', async () => {
    const { purchaseOrder, receipt } = await setup(20000, 5);
    // PO created + submitted posted NOTHING to the GL until receiving.
    expect(receipt.movementType).toBe('receiving');
    expect((await getStockLevel(ORG, receipt.productId, LOC, 'mock')).onHand).toBe(5);
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET)).toBe(100000); // Dr 1300
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(-100000); // Cr 2100 (GRNI)
    const lines = await listLineItemsForPurchaseOrder(ORG, purchaseOrder.id, 'mock');
    expect(lines[0].quantityReceived).toBe(5);
    const po = purchaseOrderFixtures.find((p) => p.id === purchaseOrder.id)!;
    expect(po.status).toBe('received');
  });

  it('exact-match bill clears GRNI into AP (no PPV); AP never touches inventory', async () => {
    const { supplier, receipt } = await setup(20000, 5);
    const onHandBefore = (await getStockLevel(ORG, receipt.productId, LOC, 'mock')).onHand;
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-1', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 5, billedUnitCostCents: 20000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(0); // 2100 GRNI cleared
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(-100000); // Cr 2000
    expect(await bal(STARTER_ACCOUNT_NUMBERS.PURCHASE_PRICE_VARIANCE)).toBe(0); // no variance
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET)).toBe(100000); // 1300 unchanged by the bill
    // AP did not change physical stock.
    expect((await getStockLevel(ORG, receipt.productId, LOC, 'mock')).onHand).toBe(onHandBefore);
  });

  it('UNFAVORABLE variance debits 5120 and the entry balances', async () => {
    const { supplier, receipt } = await setup(10000, 2); // GRNI 20000
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-2', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 2, billedUnitCostCents: 12000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(0); // cleared 20000
    expect(await bal(STARTER_ACCOUNT_NUMBERS.PURCHASE_PRICE_VARIANCE)).toBe(4000); // Dr 5120 (unfavorable)
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(-24000); // Cr 2000
  });

  it('FAVORABLE variance credits 5120 and the entry balances', async () => {
    const { supplier, receipt } = await setup(10000, 2); // GRNI 20000
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-3', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 2, billedUnitCostCents: 9000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(0);
    expect(await bal(STARTER_ACCOUNT_NUMBERS.PURCHASE_PRICE_VARIANCE)).toBe(-2000); // Cr 5120 (favorable)
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(-18000);
  });

  it('partial billing is first-class; over-billing a receipt is blocked', async () => {
    const { supplier, receipt } = await setup(20000, 5);
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-4a', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 3, billedUnitCostCents: 20000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    expect(await billedQuantityForReceipt(ORG, receipt.id, 'mock')).toBe(3);
    // 2 remain billable on the receipt; billing 3 more must fail.
    await expect(
      createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-4b', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 3, billedUnitCostCents: 20000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock'),
    ).rejects.toMatchObject({ code: 'over_bill' });
    // Billing the remaining 2 succeeds.
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-4c', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 2, billedUnitCostCents: 20000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    expect(await billedQuantityForReceipt(ORG, receipt.id, 'mock')).toBe(5);
  });

  it('void reverses the bill entry (never deletes) and reopens GRNI', async () => {
    const { supplier, receipt } = await setup(20000, 5);
    const { bill } = await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-5', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 5, billedUnitCostCents: 20000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    const entriesBefore = journalEntryFixtures.length;
    await voidVendorBill(ORG, bill.id, CTX, 'mock', { idFactory, now: NOW });
    expect((await getBillById(ORG, bill.id, 'mock'))!.status).toBe('void');
    // The original entry is still present (never deleted) + a reversal was added.
    expect(journalEntryFixtures.length).toBe(entriesBefore + 1);
    expect(journalEntryFixtures.some((e) => e.reversesEntryId === bill.journalEntryId)).toBe(true);
    // GRNI (2100) and AP (2000) net back to their pre-bill state; receipt reopens.
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(-100000);
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(0);
    expect(await billedQuantityForReceipt(ORG, receipt.id, 'mock')).toBe(0);
  });

  it('vendor payment clears AP against cash; partial then full', async () => {
    const { supplier, receipt } = await setup(20000, 5);
    const { bill } = await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-6', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 5, billedUnitCostCents: 20000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    // Partial payment of 40000.
    const p1 = await recordBillPayment({ organizationId: ORG, vendorBillId: bill.id, amountCents: 40000, paymentDate: NOW, method: 'check', referenceNumber: '1001', cashAccountNumber: STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, idFactory, now: NOW }, CTX, 'mock');
    expect(p1.bill.status).toBe('partially_paid');
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(-60000); // 100000 − 40000 still owed
    expect(await bal(STARTER_ACCOUNT_NUMBERS.CASH_OPERATING)).toBe(-40000); // Cr cash
    // Remaining 60000.
    const p2 = await recordBillPayment({ organizationId: ORG, vendorBillId: bill.id, amountCents: 60000, paymentDate: NOW, method: 'ach', cashAccountNumber: STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, idFactory, now: NOW }, CTX, 'mock');
    expect(p2.bill.status).toBe('paid');
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(0);
    // Over-pay is blocked.
    await expect(recordBillPayment({ organizationId: ORG, vendorBillId: bill.id, amountCents: 1, paymentDate: NOW, method: 'cash', cashAccountNumber: STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, idFactory, now: NOW }, CTX, 'mock')).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('expense-only bill posts Dr expense / Cr AP and never touches inventory/GRNI', async () => {
    const supplier = await createSupplier({ organizationId: ORG, name: 'Freight LLC', idFactory, now: NOW }, CTX, 'mock');
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'FREIGHT-1', billDate: NOW, dueDate: NOW, goodsLines: [], expenseLines: [{ accountNumber: STARTER_ACCOUNT_NUMBERS.BANK_FEES_EXPENSE, amountCents: 7500, description: 'Delivery' }], idFactory, now: NOW }, CTX, 'mock');
    expect(await bal(STARTER_ACCOUNT_NUMBERS.BANK_FEES_EXPENSE)).toBe(7500); // Dr expense
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(-7500); // Cr AP
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(0); // untouched
  });

  it('an expense line targeting inventory/GRNI/AP is rejected', async () => {
    const supplier = await createSupplier({ organizationId: ORG, name: 'Sneaky Vendor', idFactory, now: NOW }, CTX, 'mock');
    // Seed the chart so 1300 exists to be (correctly) rejected.
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'OK-1', billDate: NOW, dueDate: NOW, goodsLines: [], expenseLines: [{ accountNumber: STARTER_ACCOUNT_NUMBERS.BANK_FEES_EXPENSE, amountCents: 100 }], idFactory, now: NOW }, CTX, 'mock');
    await expect(
      createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'BAD-1', billDate: NOW, dueDate: NOW, goodsLines: [], expenseLines: [{ accountNumber: STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET, amountCents: 100 }], idFactory, now: NOW }, CTX, 'mock'),
    ).rejects.toMatchObject({ code: 'invalid_account' });
  });
});
