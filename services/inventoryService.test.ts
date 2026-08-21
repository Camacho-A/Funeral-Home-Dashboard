import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import {
  merchandiseProductFixtures,
  inventoryMovementFixtures,
  inventoryReservationFixtures,
  inventoryBalanceFixtures,
  inventoryLockFixtures,
  inventoryWriteClaimFixtures,
} from './__mocks__/merchandiseFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { getAccountByNumber } from './chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { assertJournalEntryBalances } from '../domain/ledger/balancing';
import {
  receiveStock,
  syncReservation,
  fulfillReservation,
  returnFulfilled,
  adjustStock,
  transferStock,
  reconcileStockLine,
  getStockLevel,
  InventoryServiceError,
} from './inventoryService';

let idCounter = 0;
const idFactory = () => `id-${(idCounter += 1)}`;
const NOW = '2026-08-19T00:00:00.000Z';
const CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'identity-1', actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1' };
const PRODUCT = 'prod-urn';
const LOC = 'loc-main';

beforeEach(async () => {
  idCounter = 0;
  merchandiseProductFixtures.length = 0;
  inventoryMovementFixtures.length = 0;
  inventoryReservationFixtures.length = 0;
  inventoryBalanceFixtures.length = 0;
  inventoryLockFixtures.length = 0;
  inventoryWriteClaimFixtures.length = 0;
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
  activityEventFixtures.length = 0;
  // A tracked product with cost 15000, retail 39000, reorderPoint 2.
  merchandiseProductFixtures.push({
    id: PRODUCT, organizationId: DEFAULT_ORGANIZATION_ID, sku: 'URN-OAK', name: 'Oak Urn', description: null, category: 'urn',
    cost: 15000, retailPrice: 39000, taxable: false, isActive: true, trackInventory: true, reorderPoint: 2, defaultLocationId: LOC,
    imageStorageKey: null, familyVisible: false, supplierName: null, parentProductId: null, createdAt: NOW, updatedAt: NOW,
  });
});

async function accountId(number: string) {
  return (await getAccountByNumber(DEFAULT_ORGANIZATION_ID, number, 'mock'))!.id;
}
function assertAllEntriesBalance() {
  for (const entry of journalEntryFixtures) {
    const lines = journalEntryLineFixtures.filter((l) => l.journalEntryId === entry.id).map((l) => ({ direction: l.direction, amount: l.amount, accountId: l.accountId }));
    expect(() => assertJournalEntryBalances(lines)).not.toThrow();
  }
}

describe('receiveStock', () => {
  it('appends a receiving movement, raises on-hand, and posts Dr Inventory / Cr Clearing', async () => {
    const { balance } = await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 10, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    expect(balance.onHand).toBe(10);
    const inv = await accountId(STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET);
    const clearing = await accountId(STARTER_ACCOUNT_NUMBERS.INVENTORY_CLEARING);
    const receiptEntry = journalEntryFixtures.find((e) => e.sourceType === 'inventory_receipt');
    expect(receiptEntry).toBeDefined();
    const lines = journalEntryLineFixtures.filter((l) => l.journalEntryId === receiptEntry!.id);
    expect(lines.find((l) => l.accountId === inv)!.direction).toBe('debit');
    expect(lines.find((l) => l.accountId === clearing)!.direction).toBe('credit');
    expect(lines.reduce((s, l) => s + (l.direction === 'debit' ? l.amount : 0), 0)).toBe(150000);
    assertAllEntriesBalance();
  });

  it('is idempotent on the same receiptReference (no double receive, no double post)', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 10, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 10, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    expect((await getStockLevel(DEFAULT_ORGANIZATION_ID, PRODUCT, LOC, 'mock')).onHand).toBe(10);
    expect(journalEntryFixtures.filter((e) => e.sourceType === 'inventory_receipt')).toHaveLength(1);
  });
});

describe('reservation availability', () => {
  it('reserves within availability and rejects an oversell', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 5, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    const { balance } = await syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', caseOrderId: 'ord-1', productId: PRODUCT, locationId: LOC, quantity: 3, idFactory, now: NOW }, CTX, 'mock');
    expect(balance.reserved).toBe(3);
    expect((await getStockLevel(DEFAULT_ORGANIZATION_ID, PRODUCT, LOC, 'mock')).available).toBe(2);
    // A different case reserving 3 more must fail (only 2 available).
    await expect(syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-2', caseOrderId: 'ord-2', productId: PRODUCT, locationId: LOC, quantity: 3, idFactory, now: NOW }, CTX, 'mock')).rejects.toMatchObject({ code: 'insufficient_stock' });
  });

  it('raising a reservation you already hold does not falsely fail', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 5, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    await syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', caseOrderId: 'ord-1', productId: PRODUCT, locationId: LOC, quantity: 3, idFactory, now: NOW }, CTX, 'mock');
    const { balance } = await syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', caseOrderId: 'ord-1', productId: PRODUCT, locationId: LOC, quantity: 5, idFactory, now: NOW }, CTX, 'mock');
    expect(balance.reserved).toBe(5); // re-synced, not double-reserved
    expect(inventoryReservationFixtures.filter((r) => r.caseId === 'case-1')).toHaveLength(1);
  });

  it('concurrent reservations for the same stock line never oversell (serialized under the lease)', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 3, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    const results = await Promise.allSettled([
      syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-A', caseOrderId: 'ord-A', productId: PRODUCT, locationId: LOC, quantity: 2, idFactory, now: NOW }, CTX, 'mock'),
      syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-B', caseOrderId: 'ord-B', productId: PRODUCT, locationId: LOC, quantity: 2, idFactory, now: NOW }, CTX, 'mock'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // At most one of the two 2-unit reservations can succeed against 3 units.
    expect(fulfilled.length).toBe(1);
    expect((await getStockLevel(DEFAULT_ORGANIZATION_ID, PRODUCT, LOC, 'mock')).reserved).toBe(2);
  });
});

describe('fulfillment + COGS', () => {
  it('fulfills a reservation, reduces on-hand, posts Dr COGS / Cr Inventory, and flags low-stock crossing', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 3, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    await syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', caseOrderId: 'ord-1', productId: PRODUCT, locationId: LOC, quantity: 2, idFactory, now: NOW }, CTX, 'mock');
    const { balance, lowStockCrossed } = await fulfillReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', productId: PRODUCT, locationId: LOC, idFactory, now: NOW }, CTX, 'mock');
    expect(balance.onHand).toBe(1); // 3 − 2
    expect(balance.reserved).toBe(0); // reservation fulfilled
    expect(lowStockCrossed).toBe(true); // 3 → 1, crosses reorderPoint 2
    const cogs = await accountId(STARTER_ACCOUNT_NUMBERS.COST_OF_GOODS_SOLD);
    const inv = await accountId(STARTER_ACCOUNT_NUMBERS.INVENTORY_ASSET);
    const cogsEntry = journalEntryFixtures.find((e) => e.sourceType === 'cogs');
    const lines = journalEntryLineFixtures.filter((l) => l.journalEntryId === cogsEntry!.id);
    expect(lines.find((l) => l.accountId === cogs)!.direction).toBe('debit');
    expect(lines.find((l) => l.accountId === inv)!.direction).toBe('credit');
    expect(lines.find((l) => l.accountId === cogs)!.amount).toBe(30000); // 2 × 15000
    assertAllEntriesBalance();
  });

  it('return-restock reverses COGS (never deletes) and adds the unit back', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 3, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    await syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', caseOrderId: 'ord-1', productId: PRODUCT, locationId: LOC, quantity: 2, idFactory, now: NOW }, CTX, 'mock');
    await fulfillReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', productId: PRODUCT, locationId: LOC, idFactory, now: NOW }, CTX, 'mock');
    const balance = await returnFulfilled({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', productId: PRODUCT, locationId: LOC, restock: true, idFactory, now: NOW }, CTX, 'mock');
    expect(balance.onHand).toBe(3); // restored
    // Original COGS entry still exists (immutable) plus a reversal entry.
    expect(journalEntryFixtures.filter((e) => e.sourceType === 'cogs')).toHaveLength(1);
    expect(journalEntryFixtures.filter((e) => e.sourceType === 'reversal')).toHaveLength(1);
    assertAllEntriesBalance();
  });
});

describe('adjust + transfer + reconcile', () => {
  it('a shrinkage adjustment lowers on-hand and posts Dr Shrinkage / Cr Inventory', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 5, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    const { balance } = await adjustStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantityDelta: -2, movementType: 'shrinkage', reason: 'Count correction', idFactory, now: NOW }, CTX, 'mock');
    expect(balance.onHand).toBe(3);
    const shrink = await accountId(STARTER_ACCOUNT_NUMBERS.INVENTORY_SHRINKAGE_EXPENSE);
    const entry = journalEntryFixtures.find((e) => e.sourceType === 'inventory_adjustment');
    const lines = journalEntryLineFixtures.filter((l) => l.journalEntryId === entry!.id);
    expect(lines.find((l) => l.accountId === shrink)!.direction).toBe('debit');
    expect(lines.find((l) => l.accountId === shrink)!.amount).toBe(30000);
    assertAllEntriesBalance();
  });

  it('an adjustment requires a reason', async () => {
    await expect(adjustStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantityDelta: -1, movementType: 'damage', reason: '   ', idFactory, now: NOW }, CTX, 'mock')).rejects.toBeInstanceOf(InventoryServiceError);
  });

  it('transfers stock between two locations with no GL impact', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 5, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    const before = journalEntryFixtures.length;
    const { from, to } = await transferStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, fromLocationId: LOC, toLocationId: 'loc-storage', quantity: 2, idFactory, now: NOW }, CTX, 'mock');
    expect(from.onHand).toBe(3);
    expect(to.onHand).toBe(2);
    expect(journalEntryFixtures.length).toBe(before); // no ledger entry for a transfer
  });

  it('reconcile recomputes the snapshot from movements and reports no drift on a healthy line', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 5, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    const { after, drifted } = await reconcileStockLine(DEFAULT_ORGANIZATION_ID, PRODUCT, LOC, CTX, 'mock', NOW);
    expect(after.onHand).toBe(5);
    expect(drifted).toBe(false);
  });

  it('reconcile repairs a manually corrupted snapshot (drift detection)', async () => {
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: PRODUCT, locationId: LOC, quantity: 5, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');
    // Corrupt the snapshot directly, as a lost-race would.
    const bal = inventoryBalanceFixtures.find((b) => b.productId === PRODUCT)!;
    bal.onHand = 99;
    const { drifted, after } = await reconcileStockLine(DEFAULT_ORGANIZATION_ID, PRODUCT, LOC, CTX, 'mock', NOW);
    expect(drifted).toBe(true);
    expect(after.onHand).toBe(5); // repaired from authoritative movements
  });
});
