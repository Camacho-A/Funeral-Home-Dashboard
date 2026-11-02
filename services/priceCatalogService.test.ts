import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). The catalog
 * configuration service (items, categories, revisions, audit) and its
 * integration with case orders: catalog items are priced from the catalog,
 * and an order keeps the prices it was saved with. Demo (mock) data only;
 * every price is a fictional test value, never a Gus price.
 */

const { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
const { serviceCatalogFixtures, serviceCatalogCategoryFixtures, caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, gusServiceCatalogItemId, gusCatalogCategoryId } =
  await import('./__mocks__/pricingFixtures');
const { paymentRecordFixtures } = await import('./__mocks__/paymentFixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } = await import('./__mocks__/ledgerFixtures');
const service = await import('./priceCatalogService');
const activity = await import('./activityService');
const { createCaseOrder, recalculateOrder, listCaseOrderVersions, listLineItemsForOrder, UnpricedCatalogItemError } = await import('./pricingService');

const { createCatalogItem, updateCatalogItem, createCatalogCategory, updateCatalogCategory, listCatalogCategories, PriceCatalogError, PriceCatalogUnavailableError } = service;

const NOW = '2026-10-22T00:00:00.000Z';
const ctx = (organizationId = GUS_ORGANIZATION_ID) => ({
  organizationId,
  actorIdentityId: 'identity-gus-admin',
  actorMembershipId: null,
  actorRoleKey: 'administrator',
  correlationId: 'corr-1',
});
let idCounter = 0;
const idFactory = () => `id-${++idCounter}`;

let catalogSnapshot: typeof serviceCatalogFixtures;
let categorySnapshot: typeof serviceCatalogCategoryFixtures;
beforeEach(() => {
  idCounter = 0;
  catalogSnapshot = serviceCatalogFixtures.map((item) => ({ ...item }));
  categorySnapshot = serviceCatalogCategoryFixtures.map((category) => ({ ...category }));
  for (const list of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, paymentRecordFixtures, activityEventFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures]) {
    list.length = 0;
  }
});
afterEach(() => {
  serviceCatalogFixtures.splice(0, serviceCatalogFixtures.length, ...catalogSnapshot);
  serviceCatalogCategoryFixtures.splice(0, serviceCatalogCategoryFixtures.length, ...categorySnapshot);
  vi.restoreAllMocks();
});

const newItem = (overrides: Record<string, unknown> = {}) =>
  createCatalogItem(
    {
      organizationId: GUS_ORGANIZATION_ID,
      input: { itemCode: 'demo_copy', displayName: '  DEMO   Certified Copy ', pricingType: 'per_unit', defaultPrice: 2_550, categoryId: gusCatalogCategoryId('Documents and Permits'), ...overrides },
      now: NOW,
    },
    ctx(),
    'mock',
  );

async function refusal(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PriceCatalogError);
  return error as InstanceType<typeof PriceCatalogError>;
}

describe('initial catalog', () => {
  it('Gus starts with the seven suggested categories, no added items, and no prices', async () => {
    const categories = await listCatalogCategories(GUS_ORGANIZATION_ID, 'mock');
    expect(categories.map((c) => c.name)).toEqual([
      'Funeral Services',
      'Cremation Services',
      'Burial Services',
      'Merchandise',
      'Transportation',
      'Documents and Permits',
      'Additional Services',
    ]);
    const gus = serviceCatalogFixtures.filter((i) => i.organizationId === GUS_ORGANIZATION_ID);
    expect(gus.every((i) => i.category === 'service_type' && i.defaultPrice === null)).toBe(true);
    expect(await listCatalogCategories(DEFAULT_ORGANIZATION_ID, 'mock')).toEqual([]);
  });
});

describe('createCatalogItem', () => {
  it('creates an active catalog item with a normalized code and name, and audits it', async () => {
    const item = await newItem();
    expect(item).toMatchObject({
      organizationId: GUS_ORGANIZATION_ID,
      serviceCode: 'DEMO_COPY',
      displayName: 'DEMO Certified Copy',
      category: 'catalog_item',
      pricingType: 'per_unit',
      defaultPrice: 2_550,
      isActive: true,
      revision: 0,
      categoryId: gusCatalogCategoryId('Documents and Permits'),
    });
    expect(item.sortOrder).toBeGreaterThanOrEqual(1000);
    expect(serviceCatalogFixtures.some((i) => i.id === item.id)).toBe(true);
    expect(activityEventFixtures.map((e) => [e.eventType, e.resourceId, e.category])).toEqual([['serviceCatalog.item.created', item.id, 'administration']]);
    expect(activityEventFixtures[0].description).toBe('Catalog item "DEMO Certified Copy" (DEMO_COPY) added — price $25.50 each');
  });

  it('allows "price not set" (null) — never a made-up price', async () => {
    expect((await newItem({ defaultPrice: null })).defaultPrice).toBeNull();
    expect((await newItem({ itemCode: 'DEMO_TWO', defaultPrice: undefined })).defaultPrice).toBeNull();
  });

  it('refuses a duplicate code (case-insensitively, including the primary services) and writes nothing', async () => {
    await newItem();
    const count = serviceCatalogFixtures.length;
    expect((await refusal(newItem({ itemCode: 'Demo_Copy' }))).reason).toBe('duplicate_code');
    expect((await refusal(newItem({ itemCode: 'direct_cremation' }))).status).toBe(409);
    expect(serviceCatalogFixtures).toHaveLength(count);
    expect(activityEventFixtures).toHaveLength(1);
  });

  it('a code is unique per organization, not across organizations', async () => {
    await newItem();
    const manors = await createCatalogItem(
      { organizationId: DEFAULT_ORGANIZATION_ID, input: { itemCode: 'DEMO_COPY', displayName: 'Copy', pricingType: 'flat', defaultPrice: 1 } },
      ctx(DEFAULT_ORGANIZATION_ID),
      'mock',
    );
    expect(manors.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it.each([
    ['a negative price', { defaultPrice: -1 }],
    ['a fractional cent', { defaultPrice: 10.5 }],
    ['a price as text', { defaultPrice: '25.50' }],
    ['an absurd price', { defaultPrice: 100_000_001 }],
    ['a missing code', { itemCode: '' }],
    ['a malformed code', { itemCode: 'has space' }],
    ['a one-letter code', { itemCode: 'A' }],
    ['a reserved engine code', { itemCode: 'SHIPPING' }],
    ['a blank name', { displayName: '   ' }],
    ['a too-long name', { displayName: 'x'.repeat(121) }],
    ['a too-long description', { description: 'x'.repeat(501) }],
    ['an unknown pricing type', { pricingType: 'percent' }],
    ['an unknown category', { categoryId: 'no-such-category' }],
    ["another organization's category", { categoryId: 'managed-cremations-cat-x' }],
  ])('refuses %s with 400 and writes nothing', async (_label, overrides) => {
    const count = serviceCatalogFixtures.length;
    expect((await refusal(newItem(overrides))).status).toBe(400);
    expect(serviceCatalogFixtures).toHaveLength(count);
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('refuses an inactive category for a new item', async () => {
    const category = serviceCatalogCategoryFixtures.find((c) => c.id === gusCatalogCategoryId('Merchandise'))!;
    category.isActive = false;
    expect((await refusal(newItem({ categoryId: category.id }))).status).toBe(400);
  });

  it('is demo data only: live (Wix) data refuses with PriceCatalogUnavailableError', async () => {
    await expect(createCatalogItem({ organizationId: GUS_ORGANIZATION_ID, input: { itemCode: 'X1' } }, ctx(), 'wix')).rejects.toBeInstanceOf(PriceCatalogUnavailableError);
  });

  it('is audited before it is written: if the audit record fails, no item is created', async () => {
    vi.spyOn(activity, 'recordServiceCatalogChange').mockRejectedValueOnce(new Error('audit store down'));
    const count = serviceCatalogFixtures.length;
    await expect(newItem()).rejects.toThrow('audit store down');
    expect(serviceCatalogFixtures).toHaveLength(count);
  });
});

describe('updateCatalogItem', () => {
  it('edits name, description, category and price, bumps the revision, and audits each kind of change', async () => {
    const item = await newItem();
    activityEventFixtures.length = 0;
    const { item: updated, changed } = await updateCatalogItem(
      {
        organizationId: GUS_ORGANIZATION_ID,
        itemId: item.id,
        changes: { displayName: 'DEMO Copy', description: 'Fictional', categoryId: null, defaultPrice: 3_000 },
        expectedRevision: 0,
        now: NOW,
      },
      ctx(),
      'mock',
    );
    expect(changed).toEqual(['displayName', 'description', 'categoryId', 'defaultPrice']);
    expect(updated).toMatchObject({ displayName: 'DEMO Copy', description: 'Fictional', categoryId: null, defaultPrice: 3_000, revision: 1, serviceCode: 'DEMO_COPY' });
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(['serviceCatalog.price.updated', 'serviceCatalog.item.updated']);
    expect(JSON.parse(activityEventFixtures[1].previousValue!)).toEqual({ displayName: 'DEMO Certified Copy', description: null, categoryId: gusCatalogCategoryId('Documents and Permits') });
  });

  it('deactivates and reactivates an item, audited as such', async () => {
    const item = await newItem();
    activityEventFixtures.length = 0;
    const off = await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: item.id, changes: { isActive: false }, expectedRevision: 0 }, ctx(), 'mock');
    expect(off.item.isActive).toBe(false);
    const on = await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: item.id, changes: { isActive: true }, expectedRevision: 1 }, ctx(), 'mock');
    expect(on.item).toMatchObject({ isActive: true, revision: 2 });
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(['serviceCatalog.item.deactivated', 'serviceCatalog.item.reactivated']);
  });

  it('refuses a stale revision (someone else edited it first) and writes nothing', async () => {
    const item = await newItem();
    await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: item.id, changes: { defaultPrice: 3_000 }, expectedRevision: 0 }, ctx(), 'mock');
    const events = activityEventFixtures.length;
    const error = await refusal(updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: item.id, changes: { defaultPrice: 4_000 }, expectedRevision: 0 }, ctx(), 'mock'));
    expect([error.status, error.reason]).toEqual([409, 'revision_conflict']);
    expect(serviceCatalogFixtures.find((i) => i.id === item.id)?.defaultPrice).toBe(3_000);
    expect(activityEventFixtures).toHaveLength(events);
  });

  it('never changes the code or pricing type', async () => {
    const item = await newItem();
    for (const changes of [{ serviceCode: 'NEW' }, { itemCode: 'NEW' }, { pricingType: 'flat' }, { category: 'service_type' }]) {
      expect((await refusal(updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: item.id, changes, expectedRevision: 0 }, ctx(), 'mock'))).reason).toBe('not_allowed');
    }
    // A primary service can be priced and renamed.
    const primary = gusServiceCatalogItemId('DIRECT_CREMATION');
    const priced = await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: primary, changes: { defaultPrice: 1_000 }, expectedRevision: 0 }, ctx(), 'mock');
    expect(priced.item.defaultPrice).toBe(1_000);
  });

  it('deactivating a primary service takes an explicit confirmation; reactivating does not; both are audited', async () => {
    const primary = gusServiceCatalogItemId('CREMATION_WITH_VIEWING');
    const unconfirmed = await refusal(updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: primary, changes: { isActive: false }, expectedRevision: 0 }, ctx(), 'mock'));
    expect([unconfirmed.status, unconfirmed.reason]).toEqual([409, 'confirmation_required']);
    expect(unconfirmed.message).toMatch(/NEW cases.*Existing cases on it keep working/);
    expect(serviceCatalogFixtures.find((i) => i.id === primary)?.isActive).toBe(true);
    expect(activityEventFixtures).toHaveLength(0);

    for (const notTrue of ['yes', 1]) {
      await refusal(updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: primary, changes: { isActive: false }, expectedRevision: 0, confirmPrimaryServiceDeactivation: notTrue }, ctx(), 'mock'));
    }
    const off = await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: primary, changes: { isActive: false }, expectedRevision: 0, confirmPrimaryServiceDeactivation: true }, ctx(), 'mock');
    expect(off.item).toMatchObject({ isActive: false, revision: 1 });
    const on = await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: primary, changes: { isActive: true }, expectedRevision: 1 }, ctx(), 'mock');
    expect(on.item.isActive).toBe(true);
    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(['serviceCatalog.item.deactivated', 'serviceCatalog.item.reactivated']);
  });

  it("is organization-scoped: another organization's item is not found and untouched", async () => {
    const primary = gusServiceCatalogItemId('DIRECT_CREMATION');
    const error = await refusal(updateCatalogItem({ organizationId: DEFAULT_ORGANIZATION_ID, itemId: primary, changes: { defaultPrice: 1 }, expectedRevision: 0 }, ctx(DEFAULT_ORGANIZATION_ID), 'mock'));
    expect(error.status).toBe(404);
    expect(serviceCatalogFixtures.find((i) => i.id === primary)?.defaultPrice).toBeNull();
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('an unchanged edit writes and audits nothing', async () => {
    const item = await newItem();
    activityEventFixtures.length = 0;
    const result = await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: item.id, changes: { defaultPrice: 2_550 }, expectedRevision: 0 }, ctx(), 'mock');
    expect(result.changed).toEqual([]);
    expect(result.item.revision).toBe(0);
    expect(activityEventFixtures).toHaveLength(0);
  });
});

describe('categories', () => {
  it('creates, renames, reorders and deactivates a category — unique names, revisions, audited', async () => {
    const category = await createCatalogCategory({ organizationId: GUS_ORGANIZATION_ID, name: '  DEMO Keepsakes ' }, ctx(), 'mock');
    expect(category).toMatchObject({ name: 'DEMO Keepsakes', isActive: true, revision: 0 });
    expect((await refusal(createCatalogCategory({ organizationId: GUS_ORGANIZATION_ID, name: 'merchandise' }, ctx(), 'mock'))).reason).toBe('duplicate_name');

    const renamed = await updateCatalogCategory({ organizationId: GUS_ORGANIZATION_ID, categoryId: category.id, changes: { name: 'DEMO Memorials', sortOrder: 5 }, expectedRevision: 0 }, ctx(), 'mock');
    expect(renamed).toMatchObject({ name: 'DEMO Memorials', sortOrder: 5, revision: 1 });
    expect((await listCatalogCategories(GUS_ORGANIZATION_ID, 'mock'))[0].name).toBe('DEMO Memorials');

    expect((await refusal(updateCatalogCategory({ organizationId: GUS_ORGANIZATION_ID, categoryId: category.id, changes: { isActive: false }, expectedRevision: 0 }, ctx(), 'mock'))).status).toBe(409);
    await updateCatalogCategory({ organizationId: GUS_ORGANIZATION_ID, categoryId: category.id, changes: { isActive: false }, expectedRevision: 1 }, ctx(), 'mock');
    expect((await listCatalogCategories(GUS_ORGANIZATION_ID, 'mock')).some((c) => c.id === category.id)).toBe(false);
    expect((await listCatalogCategories(GUS_ORGANIZATION_ID, 'mock', { includeInactive: true })).some((c) => c.id === category.id)).toBe(true);

    expect(activityEventFixtures.map((e) => e.eventType)).toEqual(['serviceCatalog.category.created', 'serviceCatalog.category.updated', 'serviceCatalog.category.updated']);
  });

  it('a deactivated category keeps its items', async () => {
    const item = await newItem();
    await updateCatalogCategory({ organizationId: GUS_ORGANIZATION_ID, categoryId: gusCatalogCategoryId('Documents and Permits'), changes: { isActive: false }, expectedRevision: 0 }, ctx(), 'mock');
    expect(serviceCatalogFixtures.find((i) => i.id === item.id)?.categoryId).toBe(gusCatalogCategoryId('Documents and Permits'));
    // the item can keep it when edited, but a new item can't take it
    await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: item.id, changes: { displayName: 'DEMO Copy', categoryId: gusCatalogCategoryId('Documents and Permits') }, expectedRevision: 0 }, ctx(), 'mock');
    expect((await refusal(newItem({ itemCode: 'DEMO_NEW' }))).status).toBe(400);
  });

  it('requires a revision, refuses bad input, and is organization-scoped', async () => {
    const id = gusCatalogCategoryId('Merchandise');
    expect((await refusal(updateCatalogCategory({ organizationId: GUS_ORGANIZATION_ID, categoryId: id, changes: { name: 'X' }, expectedRevision: undefined }, ctx(), 'mock'))).status).toBe(400);
    for (const changes of [{ name: '' }, { sortOrder: -1 }, { sortOrder: 1.5 }, { isActive: 'no' }]) {
      expect((await refusal(updateCatalogCategory({ organizationId: GUS_ORGANIZATION_ID, categoryId: id, changes, expectedRevision: 0 }, ctx(), 'mock'))).status).toBe(400);
    }
    expect((await refusal(updateCatalogCategory({ organizationId: DEFAULT_ORGANIZATION_ID, categoryId: id, changes: { name: 'X' }, expectedRevision: 0 }, ctx(DEFAULT_ORGANIZATION_ID), 'mock'))).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Case order integration
// ---------------------------------------------------------------------------

const CASE_ID = 'gus-case-1';
async function setPrice(itemId: string, defaultPrice: number | null) {
  const current = serviceCatalogFixtures.find((i) => i.id === itemId)!;
  await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId, changes: { defaultPrice }, expectedRevision: current.revision ?? 0 }, ctx(), 'mock');
}
const order = (selections: Record<string, unknown>) =>
  createCaseOrder({ organizationId: GUS_ORGANIZATION_ID, caseId: CASE_ID, selections, performedBy: 'identity-gus-admin', idFactory, now: NOW }, 'mock');
// An Administrator/Manager edit (custom items allowed — see customItemPermission.test.ts).
const edit = (selections: Record<string, unknown>) =>
  recalculateOrder({ organizationId: GUS_ORGANIZATION_ID, caseId: CASE_ID, selections, performedBy: 'identity-gus-admin', idFactory, now: NOW, canEditCustomItems: true }, 'mock');
const SERVICE = { weightTier: 'under_200', serviceTypeCode: 'DIRECT_CREMATION' };

describe('catalog items on a case order', () => {
  it('prices selected items from the catalog with quantities, and audits the order', async () => {
    await setPrice(gusServiceCatalogItemId('DIRECT_CREMATION'), 100_000);
    await newItem();
    const transport = await newItem({ itemCode: 'DEMO_TRANSPORT', displayName: 'DEMO Transport', pricingType: 'flat', defaultPrice: 12_345 });
    const { order: v1, lineItems } = await order({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 4 }, { serviceCode: transport.serviceCode, quantity: 1 }] });
    expect(lineItems.map((l) => [l.serviceCode, l.description, l.quantity, l.unitPrice, l.lineTotal])).toEqual([
      ['DIRECT_CREMATION', 'Direct Cremation', 1, 100_000, 100_000],
      ['DEMO_COPY', 'DEMO Certified Copy', 4, 2_550, 10_200],
      ['DEMO_TRANSPORT', 'DEMO Transport', 1, 12_345, 12_345],
    ]);
    expect(v1.total).toBe(122_545);
    expect(v1.balanceDue).toBe(122_545);
  });

  it('a submitted price or total is ignored — only the catalog prices an item', async () => {
    await setPrice(gusServiceCatalogItemId('DIRECT_CREMATION'), 100_000);
    await newItem();
    const { order: v1 } = await order({ ...SERVICE, total: 1, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 1, unitPrice: 1, defaultPrice: 1 }] });
    expect(v1.total).toBe(102_550);
  });

  it('refuses an order including an unpriced item, saving nothing', async () => {
    await setPrice(gusServiceCatalogItemId('DIRECT_CREMATION'), 100_000);
    await newItem({ defaultPrice: null });
    await expect(order({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 1 }] })).rejects.toBeInstanceOf(UnpricedCatalogItemError);
    expect(caseOrderFixtures).toHaveLength(0);
  });

  it("never charges a deactivated item, or another organization's item, newly selected", async () => {
    await setPrice(gusServiceCatalogItemId('DIRECT_CREMATION'), 100_000);
    const item = await newItem();
    await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: item.id, changes: { isActive: false }, expectedRevision: 0 }, ctx(), 'mock');
    await createCatalogItem({ organizationId: DEFAULT_ORGANIZATION_ID, input: { itemCode: 'DEMO_MANORS', displayName: 'X', pricingType: 'flat', defaultPrice: 50 } }, ctx(DEFAULT_ORGANIZATION_ID), 'mock');
    const { order: v1 } = await order({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 1 }, { serviceCode: 'DEMO_MANORS', quantity: 1 }] });
    expect(v1.total).toBe(100_000);
  });

  it('changing catalog prices never alters an existing order — on its next edit too — while a new item is priced today', async () => {
    const primary = gusServiceCatalogItemId('DIRECT_CREMATION');
    await setPrice(primary, 100_000);
    const copy = await newItem();
    const { order: v1 } = await order({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 2 }] });
    expect(v1.total).toBe(105_100);

    // An administrator re-prices and renames both items afterwards.
    await setPrice(primary, 200_000);
    await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: copy.id, changes: { defaultPrice: 9_999, displayName: 'DEMO Renamed' }, expectedRevision: 0 }, ctx(), 'mock');
    const transport = await newItem({ itemCode: 'DEMO_TRANSPORT', displayName: 'DEMO Transport', pricingType: 'flat', defaultPrice: 12_345 });

    // The saved order is untouched...
    expect((await listLineItemsForOrder(GUS_ORGANIZATION_ID, v1.id, 'mock')).map((l) => l.unitPrice)).toEqual([100_000, 2_550]);

    // ...and editing it (one more copy, plus a new item) keeps the saved prices.
    const result = await edit({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 3 }, { serviceCode: transport.serviceCode, quantity: 1 }] });
    expect(result?.lineItems.map((l) => [l.serviceCode, l.description, l.quantity, l.unitPrice])).toEqual([
      ['DIRECT_CREMATION', 'Direct Cremation', 1, 100_000],
      ['DEMO_COPY', 'DEMO Certified Copy', 3, 2_550],
      ['DEMO_TRANSPORT', 'DEMO Transport', 1, 12_345],
    ]);
    expect(result?.order.total).toBe(100_000 + 7_650 + 12_345);
    expect(result?.auditEntries.map((e) => [e.action, e.amountDeltaCents])).toEqual([
      ['catalog_item_quantity_changed', 2_550],
      ['catalog_item_added', 12_345],
    ]);
    // the old version is kept, unchanged
    const versions = await listCaseOrderVersions(GUS_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(versions.map((v) => [v.version, v.status, v.total])).toEqual(expect.arrayContaining([[1, 'superseded', 105_100], [2, 'active', 119_995]]));
  });

  it('a deactivated item stays on the order, at its saved price, through later edits — until staff remove it', async () => {
    await setPrice(gusServiceCatalogItemId('DIRECT_CREMATION'), 100_000);
    const copy = await newItem();
    await order({ ...SERVICE, catalogItems: [{ serviceCode: 'DEMO_COPY', quantity: 2 }] });
    await updateCatalogItem({ organizationId: GUS_ORGANIZATION_ID, itemId: copy.id, changes: { isActive: false }, expectedRevision: 0 }, ctx(), 'mock');

    // A custom-item-only edit (no catalogItems sent) carries it forward.
    const kept = await edit({ customItems: [{ id: 'c1', description: 'Flowers', amountCents: 1_000 }] });
    expect(kept?.lineItems.find((l) => l.serviceCode === 'DEMO_COPY')).toMatchObject({ quantity: 2, unitPrice: 2_550, description: 'DEMO Certified Copy' });

    // Removing it is an explicit, audited choice.
    const removed = await edit({ ...SERVICE, catalogItems: [] });
    expect(removed?.lineItems.some((l) => l.serviceCode === 'DEMO_COPY')).toBe(false);
    expect(removed?.auditEntries.map((e) => e.action)).toEqual(['catalog_item_removed']);
  });
});
