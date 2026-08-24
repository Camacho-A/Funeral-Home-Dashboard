import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { MANORS_PRIMARY_LOCATION_ID } from './__mocks__/onboardingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { merchandiseProductFixtures, inventoryMovementFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures } from './__mocks__/merchandiseFixtures';
import { supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures } from './__mocks__/procurementFixtures';
import { createProduct } from './merchandiseService';
import { createSupplier, updateSupplier, setSupplierArchived, listSuppliersForOrganization, SupplierServiceError } from './supplierService';
import { createPurchaseOrder, submitPurchaseOrder, receiveAgainstPurchaseOrder, cancelPurchaseOrder, listLineItemsForPurchaseOrder } from './purchaseOrderService';

let idCounter = 0;
const idFactory = () => `id-${(idCounter += 1)}`;
const NOW = '2026-08-21T00:00:00.000Z';
const ORG = DEFAULT_ORGANIZATION_ID;
const LOC = MANORS_PRIMARY_LOCATION_ID;
const CTX = { organizationId: ORG, actorIdentityId: 'i-1', actorMembershipId: null, actorRoleKey: null, correlationId: 'c-1' };

beforeEach(() => {
  idCounter = 0;
  for (const arr of [activityEventFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, merchandiseProductFixtures, inventoryMovementFixtures, inventoryBalanceFixtures, inventoryLockFixtures, inventoryWriteClaimFixtures, supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures]) arr.length = 0;
});

describe('supplierService', () => {
  it('enforces per-org unique name (case-insensitive) and archives, never deletes', async () => {
    await createSupplier({ organizationId: ORG, name: 'Acme Caskets', idFactory, now: NOW }, CTX, 'mock');
    await expect(createSupplier({ organizationId: ORG, name: 'acme caskets', idFactory, now: NOW }, CTX, 'mock')).rejects.toMatchObject({ code: 'duplicate_name' });
    const s = supplierFixtures[0];
    await setSupplierArchived(ORG, s.id, true, CTX, 'mock', NOW);
    expect((await listSuppliersForOrganization(ORG, 'mock')).length).toBe(0); // archived hidden by default
    expect((await listSuppliersForOrganization(ORG, 'mock', { includeInactive: true })).length).toBe(1); // still exists
  });

  it('rejects renaming onto another supplier name', async () => {
    await createSupplier({ organizationId: ORG, name: 'A', idFactory, now: NOW }, CTX, 'mock');
    const b = await createSupplier({ organizationId: ORG, name: 'B', idFactory, now: NOW }, CTX, 'mock');
    await expect(updateSupplier(ORG, b.id, { name: 'A' }, CTX, 'mock')).rejects.toBeInstanceOf(SupplierServiceError);
  });
});

describe('purchaseOrderService', () => {
  async function seedPo(qty: number) {
    const supplier = await createSupplier({ organizationId: ORG, name: `S-${idCounter}`, idFactory, now: NOW }, CTX, 'mock');
    const product = await createProduct({ organizationId: ORG, sku: `SK-${idCounter}`, name: 'P', category: 'urn', cost: 1000, retailPrice: 2000, idFactory, now: NOW }, CTX, 'mock');
    const { purchaseOrder } = await createPurchaseOrder({ organizationId: ORG, supplierId: supplier.id, locationId: LOC, orderDate: NOW, lines: [{ productId: product.id, quantityOrdered: qty, unitCostCents: 1000 }], idFactory, now: NOW }, CTX, 'mock');
    return purchaseOrder;
  }

  it('mints sequential per-org PO numbers', async () => {
    const a = await seedPo(1);
    const b = await seedPo(1);
    expect(a.poNumber).toBe('PO-000001');
    expect(b.poNumber).toBe('PO-000002');
  });

  it('blocks over-receipt beyond ordered quantity', async () => {
    const po = await seedPo(3);
    await submitPurchaseOrder(ORG, po.id, CTX, 'mock', NOW);
    const line = (await listLineItemsForPurchaseOrder(ORG, po.id, 'mock'))[0];
    await expect(
      receiveAgainstPurchaseOrder({ organizationId: ORG, purchaseOrderId: po.id, receiptReference: 'r1', receipts: [{ purchaseOrderLineItemId: line.id, quantity: 5 }], idFactory, now: NOW }, CTX, 'mock'),
    ).rejects.toMatchObject({ code: 'over_receipt' });
  });

  it('partial receipt sets partially_received; cannot receive on a draft', async () => {
    const po = await seedPo(4);
    const line = (await listLineItemsForPurchaseOrder(ORG, po.id, 'mock'))[0];
    // draft PO can't receive
    await expect(receiveAgainstPurchaseOrder({ organizationId: ORG, purchaseOrderId: po.id, receiptReference: 'r0', receipts: [{ purchaseOrderLineItemId: line.id, quantity: 1 }], idFactory, now: NOW }, CTX, 'mock')).rejects.toMatchObject({ code: 'invalid_state' });
    await submitPurchaseOrder(ORG, po.id, CTX, 'mock', NOW);
    const updated = await receiveAgainstPurchaseOrder({ organizationId: ORG, purchaseOrderId: po.id, receiptReference: 'r1', receipts: [{ purchaseOrderLineItemId: line.id, quantity: 2 }], idFactory, now: NOW }, CTX, 'mock');
    expect(updated.status).toBe('partially_received');
  });

  it('cannot cancel a PO that has received goods', async () => {
    const po = await seedPo(2);
    await submitPurchaseOrder(ORG, po.id, CTX, 'mock', NOW);
    const line = (await listLineItemsForPurchaseOrder(ORG, po.id, 'mock'))[0];
    await receiveAgainstPurchaseOrder({ organizationId: ORG, purchaseOrderId: po.id, receiptReference: 'r1', receipts: [{ purchaseOrderLineItemId: line.id, quantity: 1 }], idFactory, now: NOW }, CTX, 'mock');
    await expect(cancelPurchaseOrder(ORG, po.id, CTX, 'mock', NOW)).rejects.toMatchObject({ code: 'invalid_state' });
  });
});
