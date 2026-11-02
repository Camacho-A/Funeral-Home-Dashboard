import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Gus Phase 5C-3 (finalization). The service-level halves of the seven
 * approved decisions: FTC classification (explicit only, snapshotted onto
 * order lines, never restating a saved line), merchandise-to-inventory
 * linking (validation, no stock movement, never sold as a plain service
 * line), the custom-item permission, and a deactivated primary service on
 * an existing case. Demo (mock) data; every price is a fictional test value.
 */

vi.mock('../lib/puppeteerDocumentRenderer', () => ({ puppeteerDocumentRenderer: { renderHtmlToPdf: async () => Buffer.from('%PDF fictional') } }));
vi.mock('../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: { uploadFile: async (key: string) => ({ storageKey: key }), downloadFile: vi.fn(), deleteFile: vi.fn() },
}));

const { GUS_ORGANIZATION_ID, DEFAULT_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
const pricingFixtures = await import('./__mocks__/pricingFixtures');
const { serviceCatalogFixtures, serviceCatalogCategoryFixtures, caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, gusServiceCatalogItemId } = pricingFixtures;
const { merchandiseProductFixtures, inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures } = await import('./__mocks__/merchandiseFixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { caseDocumentFixtures } = await import('./__mocks__/documentFixtures');
const { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } = await import('./__mocks__/ledgerFixtures');
const { paymentRecordFixtures } = await import('./__mocks__/paymentFixtures');
const { createCatalogItem, updateCatalogItem, PriceCatalogError } = await import('./priceCatalogService');
const { createCaseOrder, recalculateOrder, listLineItemsForOrder, CustomItemPermissionError } = await import('./pricingService');
const { previewStatementModel, generateStatement } = await import('./billingDocumentService');

const NOW = '2026-10-22T00:00:00.000Z';
const CASE_ID = 'gus-case-001'; // a fixture case on Direct Cremation
const ctx = { organizationId: GUS_ORGANIZATION_ID, actorIdentityId: 'identity-gus-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' };
let n = 0;
const idFactory = () => `id-${(n += 1)}`;

const snapshots: Array<[unknown[], unknown[]]> = [];
beforeEach(() => {
  n = 0;
  for (const list of [serviceCatalogFixtures, serviceCatalogCategoryFixtures, merchandiseProductFixtures] as unknown[][]) snapshots.push([list, list.map((x) => ({ ...(x as object) }))]);
  for (const list of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, activityEventFixtures, caseDocumentFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, paymentRecordFixtures, inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures] as unknown[][]) {
    list.length = 0;
  }
});
afterEach(() => {
  for (const [list, copy] of snapshots.splice(0)) list.splice(0, list.length, ...copy);
});

const primaryId = gusServiceCatalogItemId('DIRECT_CREMATION');
const revisionOf = (id: string) => serviceCatalogFixtures.find((i) => i.id === id)?.revision ?? 0;
const update = (itemId: string, changes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId, changes, expectedRevision: revisionOf(itemId), now: NOW, ...extra }, ctx, 'mock');
const newItem = (overrides: Record<string, unknown> = {}) =>
  createCatalogItem({ organizationId: GUS_ORGANIZATION_ID, input: { itemCode: 'DEMO_PERMIT', displayName: 'DEMO Permit', pricingType: 'flat', defaultPrice: 2_000, ...overrides }, now: NOW }, ctx, 'mock');
const order = (selections: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  createCaseOrder({ organizationId: GUS_ORGANIZATION_ID, caseId: CASE_ID, selections, performedBy: 'identity-gus-admin', idFactory, now: NOW, ...extra }, 'mock');
const edit = (selections: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  recalculateOrder({ organizationId: GUS_ORGANIZATION_ID, caseId: CASE_ID, selections, performedBy: 'identity-gus-admin', idFactory, now: NOW, ...extra }, 'mock');
const SERVICE = { weightTier: 'under_200', serviceTypeCode: 'DIRECT_CREMATION' };

async function refusal(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PriceCatalogError);
  return error as InstanceType<typeof PriceCatalogError>;
}

describe('FTC classification', () => {
  it('is explicit only: new items start pending review, an administrator sets one of the registry values, and each change is audited', async () => {
    const item = await newItem();
    expect(item.ftcClass).toBeNull();
    expect((await newItem({ itemCode: 'DEMO_TWO', ftcClass: 'unclassified' })).ftcClass).toBeNull();
    expect((await newItem({ itemCode: 'DEMO_THREE', ftcClass: 'cash_advance' })).ftcClass).toBe('cash_advance');
    for (const bad of ['Cash Advance', 'goods', 7]) {
      expect((await refusal(newItem({ itemCode: 'DEMO_BAD', ftcClass: bad }))).status).toBe(400);
      expect((await refusal(update(item.id, { ftcClass: bad }))).status).toBe(400);
    }
    activityEventFixtures.length = 0;
    const { item: classified } = await update(item.id, { ftcClass: 'cash_advance' });
    expect(classified.ftcClass).toBe('cash_advance');
    expect(activityEventFixtures.map((e) => [e.eventType, e.previousValue, e.newValue])).toEqual([
      ['serviceCatalog.item.updated', JSON.stringify({ ftcClass: null }), JSON.stringify({ ftcClass: 'cash_advance' })],
    ]);
  });

  it('a primary service gets no classification from its name or category — it stays pending review until an administrator sets one', async () => {
    await update(primaryId, { defaultPrice: 100_000 });
    await order(SERVICE);
    const model = await previewStatementModel(CASE_ID, ctx, 'mock');
    expect(model.lineItems.map((l) => [l.description, l.ftcClass])).toEqual([['Direct Cremation', 'unclassified']]);
  });

  it('snapshots the explicit classification onto the order line; a later catalog change never restates that line on statements', async () => {
    await update(primaryId, { defaultPrice: 100_000, ftcClass: 'basic_services_fee' });
    const permit = await newItem({ ftcClass: 'cash_advance' });
    const { order: v1, lineItems } = await order({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_PERMIT', quantity: 1 }] });
    expect(lineItems.map((l) => [l.serviceCode, l.metadata?.ftcClass])).toEqual([['DIRECT_CREMATION', 'basic_services_fee'], ['DEMO_PERMIT', 'cash_advance']]);
    const generated = await generateStatement({ caseId: CASE_ID, idFactory }, ctx, 'mock');

    // An administrator re-classifies, re-prices and deactivates afterwards.
    await update(permit.id, { ftcClass: 'goods_and_services', defaultPrice: 9_999 });
    await update(permit.id, { isActive: false });
    await update(primaryId, { ftcClass: 'goods_and_services' });

    const model = await previewStatementModel(CASE_ID, ctx, 'mock');
    expect(model.lineItems.map((l) => [l.description, l.ftcClass, l.unitPriceCents])).toEqual([
      ['Direct Cremation', 'basic_services_fee', 100_000],
      ['DEMO Permit', 'cash_advance', 2_000],
    ]);
    // The saved order and the document generated earlier are untouched.
    expect((await listLineItemsForOrder(GUS_ORGANIZATION_ID, v1.id, 'mock')).map((l) => l.metadata?.ftcClass)).toEqual(['basic_services_fee', 'cash_advance']);
    expect(caseDocumentFixtures.find((d) => d.id === generated.document.id)).toEqual(generated.document);

    // ...and an edit to the order keeps the saved classification too.
    const v2 = await edit({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_PERMIT', quantity: 1 }], weightTier: 'under_200' }, { canEditCustomItems: true });
    expect(v2).not.toBeNull();
    const after = await edit({ customItems: [{ id: 'c1', description: 'Flowers', amountCents: 500 }] }, { canEditCustomItems: true });
    expect(after?.lineItems.filter((l) => l.lineKind === 'service').map((l) => l.metadata?.ftcClass)).toEqual(['basic_services_fee', 'cash_advance']);
  });

  it('a line saved while its item was pending review shows the item’s current classification once reviewed (never a guessed one)', async () => {
    await update(primaryId, { defaultPrice: 100_000 });
    await order(SERVICE);
    expect((await previewStatementModel(CASE_ID, ctx, 'mock')).lineItems[0].ftcClass).toBe('unclassified');
    await update(primaryId, { ftcClass: 'basic_services_fee' });
    expect((await previewStatementModel(CASE_ID, ctx, 'mock')).lineItems[0].ftcClass).toBe('basic_services_fee');
  });
});

describe('merchandise linked to inventory', () => {
  const product = (id: string, overrides: Record<string, unknown> = {}) =>
    ({
      id, organizationId: GUS_ORGANIZATION_ID, sku: `DEMO-${id}`, name: `DEMO Urn ${id}`, description: null, category: 'urn', cost: 10_000, retailPrice: 45_000,
      taxable: false, isActive: true, trackInventory: true, reorderPoint: null, defaultLocationId: null, imageStorageKey: null, familyVisible: false,
      supplierName: null, supplierId: null, parentProductId: null, hasVariants: false, createdAt: NOW, updatedAt: NOW, ...overrides,
    }) as (typeof merchandiseProductFixtures)[number];

  beforeEach(() => {
    merchandiseProductFixtures.push(
      product('p1'),
      product('p-archived', { isActive: false }),
      product('p-variants', { hasVariants: true }),
      product('p-manors', { organizationId: DEFAULT_ORGANIZATION_ID }),
    );
  });

  it('links an unpriced added item to one of this organization’s active products — audited, and without touching stock', async () => {
    const urn = await newItem({ itemCode: 'DEMO_URN', displayName: 'DEMO Urn', defaultPrice: null });
    activityEventFixtures.length = 0;
    const { item } = await update(urn.id, { merchandiseProductId: 'p1' });
    expect(item.merchandiseProductId).toBe('p1');
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(['serviceCatalog.item.updated']);
    expect([inventoryMovementFixtures, inventoryReservationFixtures, inventoryBalanceFixtures].map((l) => l.length)).toEqual([0, 0, 0]);
    // unlink
    expect((await update(urn.id, { merchandiseProductId: null })).item.merchandiseProductId).toBeNull();
  });

  it('refuses: a priced item, a primary service, an archived/variant/other-organization/unknown product, and a product already linked', async () => {
    const priced = await newItem({ itemCode: 'DEMO_PRICED' });
    expect((await refusal(update(priced.id, { merchandiseProductId: 'p1' }))).message).toMatch(/takes its price from that record/);
    expect((await refusal(update(primaryId, { merchandiseProductId: 'p1' }))).reason).toBe('not_allowed');
    const urn = await newItem({ itemCode: 'DEMO_URN', defaultPrice: null });
    for (const id of ['p-archived', 'p-variants', 'p-manors', 'no-such-product']) {
      expect((await refusal(update(urn.id, { merchandiseProductId: id }))).status, id).toBe(400);
    }
    await update(urn.id, { merchandiseProductId: 'p1' });
    const other = await newItem({ itemCode: 'DEMO_OTHER', defaultPrice: null });
    expect((await refusal(update(other.id, { merchandiseProductId: 'p1' }))).status).toBe(409);
    // ...and a linked item can't be given its own price.
    expect((await refusal(update(urn.id, { defaultPrice: 1 }))).status).toBe(400);
  });

  it('a linked item is never sold as a plain service line (that would bypass the stock reservation)', async () => {
    await update(primaryId, { defaultPrice: 100_000 });
    const urn = await newItem({ itemCode: 'DEMO_URN', defaultPrice: null });
    await update(urn.id, { merchandiseProductId: 'p1' });
    const { order: v1, lineItems } = await order({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_URN', quantity: 1 }] });
    expect(lineItems.map((l) => l.serviceCode)).toEqual(['DIRECT_CREMATION']);
    expect(v1.total).toBe(100_000);
    expect(inventoryReservationFixtures).toHaveLength(0);
  });

  it('an item already on an order stays there, at its saved price, if it is linked to inventory later', async () => {
    await update(primaryId, { defaultPrice: 100_000 });
    const urn = await newItem({ itemCode: 'DEMO_URN', defaultPrice: 30_000 });
    await order({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_URN', quantity: 1 }] });
    await update(urn.id, { defaultPrice: null });
    await update(urn.id, { merchandiseProductId: 'p1' });
    const result = await edit({ customItems: [{ id: 'c1', description: 'Flowers', amountCents: 500 }] }, { canEditCustomItems: true });
    expect(result?.lineItems.find((l) => l.serviceCode === 'DEMO_URN')).toMatchObject({ unitPrice: 30_000, lineKind: 'service' });
  });
});

describe('custom items — Administrator and Manager only', () => {
  beforeEach(async () => {
    await update(primaryId, { defaultPrice: 100_000 });
  });
  const CUSTOM = [{ id: 'c1', description: 'Extra keepsake', amountCents: 2_500 }];

  it('without the permission: creating with, adding, changing or removing a custom item is refused and writes nothing', async () => {
    await expect(order({ ...SERVICE, customItems: CUSTOM })).rejects.toBeInstanceOf(CustomItemPermissionError);
    expect(caseOrderFixtures).toHaveLength(0);

    await order({ ...SERVICE, customItems: CUSTOM }, { canEditCustomItems: true });
    const before = JSON.stringify([caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures]);
    for (const customItems of [[...CUSTOM, { id: 'c2', description: 'Another', amountCents: 100 }], [{ ...CUSTOM[0], amountCents: 1 }], [{ ...CUSTOM[0], description: 'Renamed' }], []]) {
      await expect(edit({ ...SERVICE, customItems })).rejects.toBeInstanceOf(CustomItemPermissionError);
    }
    expect(JSON.stringify([caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures])).toBe(before);
  });

  it('without the permission: ordinary order edits still work, carrying the existing custom items forward (sent back unchanged, or not sent at all)', async () => {
    const { lineItems } = await order({ ...SERVICE, customItems: CUSTOM }, { canEditCustomItems: true });
    const saved = lineItems.filter((l) => l.lineKind === 'custom').map((l) => ({ id: l.id, description: l.description, amountCents: l.unitPrice }));
    const permit = await newItem();
    const withPermit = await edit({ ...SERVICE, customItems: saved, catalogItems: [{ serviceCode: permit.serviceCode, quantity: 1 }] });
    expect(withPermit?.order.total).toBe(100_000 + 2_000 + 2_500);
    const again = await edit({ ...SERVICE, catalogItems: [] });
    expect(again?.lineItems.filter((l) => l.lineKind === 'custom').map((l) => [l.description, l.unitPrice])).toEqual([['EXTRA KEEPSAKE', 2_500]]);
  });

  it('with the permission (Administrator or Manager): add, change and remove are allowed and audited', async () => {
    await order(SERVICE, { canEditCustomItems: true });
    const added = await edit({ ...SERVICE, customItems: CUSTOM }, { canEditCustomItems: true });
    expect(added?.auditEntries.map((e) => e.action)).toEqual(['custom_item_added']);
    const removed = await edit({ ...SERVICE, customItems: [] }, { canEditCustomItems: true });
    expect(removed?.auditEntries.map((e) => e.action)).toEqual(['custom_item_removed']);
  });
});

describe('a deactivated primary service on an existing case', () => {
  it('the case can still create and edit its order on that service; it is no longer chosen for anything else', async () => {
    await update(primaryId, { defaultPrice: 100_000 });
    await update(primaryId, { isActive: false }, { confirmPrimaryServiceDeactivation: true });

    // Without the case's own service, an inactive service type is never charged.
    const { lineItems: none } = await createCaseOrder({ organizationId: GUS_ORGANIZATION_ID, caseId: 'gus-case-002', selections: SERVICE, performedBy: 'u', idFactory, now: NOW }, 'mock');
    expect(none).toEqual([]);

    const { order: v1, lineItems } = await order(SERVICE, { caseServiceTypeCode: 'DIRECT_CREMATION' });
    expect(lineItems.map((l) => [l.serviceCode, l.unitPrice])).toEqual([['DIRECT_CREMATION', 100_000]]);
    const permit = await newItem();
    const v2 = await edit({ ...SERVICE, catalogItems: [{ serviceCode: permit.serviceCode, quantity: 1 }] }, { caseServiceTypeCode: 'DIRECT_CREMATION' });
    expect(v2?.order.total).toBe(102_000);
    expect(v2?.order.version).toBe(v1.version + 1);
  });
});
