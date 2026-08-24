import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { MANORS_PRIMARY_LOCATION_ID } from './__mocks__/onboardingFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { merchandiseProductFixtures, inventoryMovementFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures } from './__mocks__/merchandiseFixtures';
import { supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures, vendorBillFixtures, vendorBillLineItemFixtures, billPaymentFixtures } from './__mocks__/procurementFixtures';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { getAccountByNumber } from './chartOfAccountsService';
import { getAccountBalance } from './generalLedgerService';
import { createProduct } from './merchandiseService';
import { listMovementsByType } from './inventoryService';
import { createSupplier } from './supplierService';
import { createPurchaseOrder, submitPurchaseOrder, receiveAgainstPurchaseOrder, listLineItemsForPurchaseOrder } from './purchaseOrderService';
import { createVendorBill } from './accountsPayableService';

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

async function bal(n: string) {
  const a = await getAccountByNumber(ORG, n, 'mock');
  return a ? getAccountBalance(ORG, a.id, 'mock') : 0;
}
async function receivePO(cost: number, ordered: number, receiveQty: number) {
  const supplier = await createSupplier({ organizationId: ORG, name: `Sup-${idCounter}`, idFactory, now: NOW }, CTX, 'mock');
  const product = await createProduct({ organizationId: ORG, sku: `SK-${idCounter}`, name: 'P', category: 'urn', cost, retailPrice: cost * 2, idFactory, now: NOW }, CTX, 'mock');
  const { purchaseOrder } = await createPurchaseOrder({ organizationId: ORG, supplierId: supplier.id, locationId: LOC, orderDate: NOW, lines: [{ productId: product.id, quantityOrdered: ordered, unitCostCents: cost }], idFactory, now: NOW }, CTX, 'mock');
  await submitPurchaseOrder(ORG, purchaseOrder.id, CTX, 'mock', NOW);
  const line = (await listLineItemsForPurchaseOrder(ORG, purchaseOrder.id, 'mock'))[0];
  await receiveAgainstPurchaseOrder({ organizationId: ORG, purchaseOrderId: purchaseOrder.id, receiptReference: `r-${idCounter}`, receipts: [{ purchaseOrderLineItemId: line.id, quantity: receiveQty }], idFactory, now: NOW }, CTX, 'mock');
  const receipt = (await listMovementsByType(ORG, 'receiving', 'mock')).slice(-1)[0];
  return { supplier, purchaseOrder, line, receipt };
}

/** Every posted journal entry must balance (Σdebit === Σcredit). */
function assertAllEntriesBalance() {
  for (const entry of journalEntryFixtures) {
    const lines = journalEntryLineFixtures.filter((l) => l.journalEntryId === entry.id);
    const debit = lines.filter((l) => l.direction === 'debit').reduce((s, l) => s + l.amount, 0);
    const credit = lines.filter((l) => l.direction === 'credit').reduce((s, l) => s + l.amount, 0);
    expect(debit, `entry ${entry.entryNumber} unbalanced`).toBe(credit);
  }
}

describe('Phase 36 accounting scenarios', () => {
  it('partial receipt: GRNI reflects only the received quantity', async () => {
    await receivePO(10000, 5, 2); // ordered 5, received 2
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET)).toBe(20000); // Dr 1300 for 2 units
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(-20000); // Cr 2100 GRNI for 2 units
    const po = purchaseOrderFixtures[0];
    expect(po.status).toBe('partially_received');
    assertAllEntriesBalance();
  });

  it('quantity variance (partial bill of a receipt): GRNI cleared pro-rata, remainder stays', async () => {
    const { supplier, receipt } = await receivePO(10000, 5, 5); // GRNI 50000
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'INV-Q', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 3, billedUnitCostCents: 10000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    // Billed 3 of 5 → 2100 reduced by 30000, 20000 GRNI remains; AP = 30000.
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(-20000);
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(-30000);
    assertAllEntriesBalance();
  });

  it('multiple bills against one PO receipt accumulate AP and fully clear GRNI', async () => {
    const { supplier, receipt } = await receivePO(10000, 5, 5); // GRNI 50000
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'M-1', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 2, billedUnitCostCents: 10000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'M-2', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 3, billedUnitCostCents: 10000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    expect(await bal(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING)).toBe(0); // fully cleared
    expect(await bal(STARTER_ACCOUNT_NUMBERS.ACCOUNTS_PAYABLE)).toBe(-50000); // both bills owed
    expect(vendorBillFixtures.length).toBe(2);
    assertAllEntriesBalance();
  });

  it('duplicate invoice prevention: same supplier + bill number is rejected', async () => {
    const { supplier, receipt } = await receivePO(10000, 2, 2);
    await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'DUP-1', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 1, billedUnitCostCents: 10000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    await expect(
      createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'dup-1', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 1, billedUnitCostCents: 10000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock'),
    ).rejects.toMatchObject({ code: 'duplicate_bill' });
  });

  it('idempotent bill posting: the deterministic ap-bill source reference posts a bill entry exactly once', async () => {
    const { supplier, receipt } = await receivePO(10000, 2, 2);
    const { bill } = await createVendorBill({ organizationId: ORG, supplierId: supplier.id, billNumber: 'IDEM-1', billDate: NOW, dueDate: NOW, goodsLines: [{ receiptMovementId: receipt.id, quantityBilled: 2, billedUnitCostCents: 10000 }], expenseLines: [], idFactory, now: NOW }, CTX, 'mock');
    const billEntries = journalEntryFixtures.filter((e) => e.sourceType === 'bill' && e.sourceReferenceId === `ap-bill-${bill.id}`);
    expect(billEntries.length).toBe(1);
    assertAllEntriesBalance();
  });
});
