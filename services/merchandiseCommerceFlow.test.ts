import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { caseWriteOffFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import {
  merchandiseProductFixtures,
  inventoryMovementFixtures,
  inventoryReservationFixtures,
  inventoryBalanceFixtures,
  inventoryLockFixtures,
  inventoryWriteClaimFixtures,
} from './__mocks__/merchandiseFixtures';
import { getAccountByNumber } from './chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import { createProduct } from './merchandiseService';
import { receiveStock, syncReservation, fulfillReservation, getStockLevel } from './inventoryService';
import { createCaseOrder, recalculateOrder, listMerchandiseSelectionsForCase } from './pricingService';

let idCounter = 0;
const idFactory = () => `id-${(idCounter += 1)}`;
const NOW = '2026-08-19T00:00:00.000Z';
const CTX = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'identity-1', actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1' };
const CASE = 'case-commerce';
const LOC = 'loc-main';

beforeEach(() => {
  idCounter = 0;
  for (const arr of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, paymentRecordFixtures, activityEventFixtures, caseWriteOffFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, merchandiseProductFixtures, inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures]) {
    arr.length = 0;
  }
});

describe('end-to-end merchandise commerce flow (mirrors the case-merchandise route orchestration)', () => {
  it('reserve → order recalc (merchandise line + merch revenue) → fulfill (COGS)', async () => {
    const product = await createProduct({ organizationId: DEFAULT_ORGANIZATION_ID, sku: 'URN-OAK', name: 'Oak Urn', category: 'urn', cost: 15000, retailPrice: 39000, idFactory, now: NOW }, CTX, 'mock');
    await receiveStock({ organizationId: DEFAULT_ORGANIZATION_ID, productId: product.id, locationId: LOC, quantity: 5, unitCost: 15000, receiptReference: 'PO-1', idFactory, now: NOW }, CTX, 'mock');

    // A service-only order exists first.
    await createCaseOrder({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE, selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false }, performedBy: 'identity-1', idFactory, now: NOW }, 'mock');

    // Route step 1: reserve (validates availability).
    await syncReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE, caseOrderId: 'x', productId: product.id, locationId: LOC, quantity: 1, idFactory, now: NOW }, CTX, 'mock');
    expect((await getStockLevel(DEFAULT_ORGANIZATION_ID, product.id, LOC, 'mock')).available).toBe(4);

    // Route step 2: recalc order with the merchandise.
    const recalc = await recalculateOrder({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE, selections: { merchandise: [{ productId: product.id, locationId: LOC, quantity: 1 }] }, performedBy: 'identity-1', idFactory, now: NOW }, 'mock');
    expect(recalc!.order.total).toBe(89000 + 39000);
    expect(recalc!.lineItems.some((li) => li.lineKind === 'merchandise')).toBe(true);
    // The order's reconstructed merchandise matches.
    expect(await listMerchandiseSelectionsForCase(DEFAULT_ORGANIZATION_ID, CASE, 'mock')).toEqual([{ productId: product.id, locationId: LOC, quantity: 1 }]);

    // Merchandise revenue posted to 4100, service to 4000.
    const merchRev = (await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.MERCHANDISE_REVENUE, 'mock'))!;
    const merchCredit = journalEntryLineFixtures.filter((l) => l.accountId === merchRev.id).reduce((s, l) => s + (l.direction === 'credit' ? l.amount : -l.amount), 0);
    expect(merchCredit).toBe(39000);

    // Route step 3: fulfill → sale movement + COGS.
    await fulfillReservation({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE, productId: product.id, locationId: LOC, idFactory, now: NOW }, CTX, 'mock');
    expect((await getStockLevel(DEFAULT_ORGANIZATION_ID, product.id, LOC, 'mock')).onHand).toBe(4);
    const cogs = (await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.COST_OF_GOODS_SOLD, 'mock'))!;
    const cogsDebit = journalEntryLineFixtures.filter((l) => l.accountId === cogs.id && l.direction === 'debit').reduce((s, l) => s + l.amount, 0);
    expect(cogsDebit).toBe(15000); // 1 × cost
  });
});
