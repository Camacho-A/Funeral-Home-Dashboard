import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). Server-side authority over
 * service-type selection and unpriced catalog items, plus org-scoped price
 * editing (updateServiceCatalogItemPrice) in both adapter modes. The Wix
 * Data layer is replaced by spies — no network.
 */

const wix = vi.hoisted(() => ({
  queryWixDataItems: vi.fn(),
  queryAllWixDataItems: vi.fn(),
  insertWixDataItem: vi.fn(),
  updateWixDataItem: vi.fn(),
  conditionalPatchWixDataItemFields: vi.fn(),
}));
vi.mock('../lib/wixDataApi', () => wix);

const { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
const {
  serviceCatalogFixtures,
  caseOrderFixtures,
  caseOrderLineItemFixtures,
  caseOrderAuditFixtures,
  gusServiceCatalogItemId,
} = await import('./__mocks__/pricingFixtures');
const { paymentRecordFixtures } = await import('./__mocks__/paymentFixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { caseWriteOffFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } = await import('./__mocks__/ledgerFixtures');
const { buildWixServiceCatalogData } = await import('../lib/wixServiceCatalogMapper');
const {
  createCaseOrder,
  recalculateOrder,
  getActiveCaseOrder,
  updateServiceCatalogItemPrice,
  isValidServiceCatalogPrice,
  UnpricedCatalogItemError,
} = await import('./pricingService');

let idCounter = 0;
const idFactory = () => `id-${++idCounter}`;
const NOW = '2026-10-15T00:00:00.000Z';
const ctx = (organizationId: string) => ({
  organizationId,
  actorIdentityId: 'identity-admin',
  actorMembershipId: null,
  actorRoleKey: 'administrator',
  correlationId: 'corr-1',
});

let catalogSnapshot: typeof serviceCatalogFixtures;
beforeEach(() => {
  idCounter = 0;
  catalogSnapshot = serviceCatalogFixtures.map((item) => ({ ...item }));
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  paymentRecordFixtures.length = 0;
  activityEventFixtures.length = 0;
  caseWriteOffFixtures.length = 0;
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
  Object.values(wix).forEach((fn) => fn.mockReset());
});
afterEach(() => {
  serviceCatalogFixtures.length = 0;
  serviceCatalogFixtures.push(...catalogSnapshot);
});

async function setGusPrice(serviceCode: string, cents: number | null) {
  const result = await updateServiceCatalogItemPrice(
    { organizationId: GUS_ORGANIZATION_ID, itemId: gusServiceCatalogItemId(serviceCode), defaultPrice: cents, ctx: ctx(GUS_ORGANIZATION_ID) },
    'mock',
  );
  expect(result).not.toBeNull();
}

function createGusOrder(selections: Record<string, unknown>) {
  return createCaseOrder({ organizationId: GUS_ORGANIZATION_ID, caseId: 'gus-case-1', selections, performedBy: 'identity-gus-admin', idFactory, now: NOW }, 'mock');
}

describe('createCaseOrder — unpriced service type', () => {
  it('refuses with a clear message and persists nothing (no order, line, audit or journal entry)', async () => {
    const error = await createGusOrder({ weightTier: 'under_200', serviceTypeCode: 'CREMATION_WITH_VIEWING' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnpricedCatalogItemError);
    expect((error as Error).message).toBe(
      'No price is set for "Cremation with Viewing". An administrator must set its price in Settings › Price Catalog before it can be added to a case order.',
    );
    expect((error as InstanceType<typeof UnpricedCatalogItemError>).unpricedItems.map((i) => i.serviceCode)).toEqual(['CREMATION_WITH_VIEWING']);
    expect(caseOrderFixtures).toHaveLength(0);
    expect(caseOrderLineItemFixtures).toHaveLength(0);
    expect(caseOrderAuditFixtures).toHaveLength(0);
    expect(journalEntryFixtures).toHaveLength(0);
  });

  it('saves the chosen service type once its price is set', async () => {
    await setGusPrice('CREMATION_WITH_VIEWING', 495_000);
    const { order, lineItems } = await createGusOrder({ weightTier: 'under_200', serviceTypeCode: 'CREMATION_WITH_VIEWING' });
    expect(order.total).toBe(495_000);
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]).toMatchObject({
      organizationId: GUS_ORGANIZATION_ID,
      serviceCode: 'CREMATION_WITH_VIEWING',
      description: 'Cremation with Viewing',
      unitPrice: 495_000,
      metadata: { serviceRole: 'service_type' },
    });
  });

  it('treats a code that is not an active service_type row of THIS org as none (never charged)', async () => {
    // A Manors-only code, and Manors' own base code, submitted by Gus.
    const { order, lineItems } = await createGusOrder({ weightTier: '201_250', serviceTypeCode: 'WEIGHT_SURCHARGE_201_250' });
    expect(lineItems).toEqual([]);
    expect(order.total).toBe(0);
  });

  it('Manors is unaffected: a submitted Gus service-type code is ignored, the base service still charged', async () => {
    const { order, lineItems } = await createCaseOrder(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'manors-case-1', selections: { weightTier: 'under_200', serviceTypeCode: 'CREMATION_WITH_VIEWING' }, performedBy: 'u', idFactory, now: NOW },
      'mock',
    );
    expect(lineItems.map((l) => l.serviceCode)).toEqual(['DIRECT_CREMATION']);
    expect(lineItems[0].metadata).toBeNull();
    expect(order.total).toBe(89_000);
  });
});

describe('recalculateOrder — unpriced service type', () => {
  it('refuses switching to an unpriced service type and leaves the active order untouched', async () => {
    await setGusPrice('DIRECT_CREMATION', 300_000);
    const { order: v1 } = await createGusOrder({ weightTier: 'under_200', serviceTypeCode: 'DIRECT_CREMATION' });

    await expect(
      recalculateOrder({ organizationId: GUS_ORGANIZATION_ID, caseId: 'gus-case-1', selections: { weightTier: 'under_200', serviceTypeCode: 'DIRECT_ENTOMBMENT' }, performedBy: 'u', idFactory, now: NOW }, 'mock'),
    ).rejects.toBeInstanceOf(UnpricedCatalogItemError);

    const active = await getActiveCaseOrder(GUS_ORGANIZATION_ID, 'gus-case-1', 'mock');
    expect(active?.id).toBe(v1.id);
    expect(active?.version).toBe(1);
    expect(caseOrderFixtures).toHaveLength(1);
  });

  it('records the service type change in the audit trail once both are priced', async () => {
    await setGusPrice('DIRECT_CREMATION', 300_000);
    await setGusPrice('GRAVESIDE_BURIAL_SERVICE_ONLY', 250_000);
    await createGusOrder({ weightTier: 'under_200', serviceTypeCode: 'DIRECT_CREMATION' });
    const result = await recalculateOrder(
      { organizationId: GUS_ORGANIZATION_ID, caseId: 'gus-case-1', selections: { weightTier: 'under_200', serviceTypeCode: 'GRAVESIDE_BURIAL_SERVICE_ONLY' }, performedBy: 'u', idFactory, now: NOW },
      'mock',
    );
    expect(result?.order.version).toBe(2);
    expect(result?.order.total).toBe(250_000);
    expect(result?.auditEntries.map((e) => e.action)).toEqual(['service_type_changed']);
    expect(result?.auditEntries[0].amountDeltaCents).toBe(-50_000);
  });

  // Gus Phase 5C-3: an order keeps the prices it was saved with. Before
  // 5C-3 this edit was refused (the service type was re-priced from the
  // live catalog, whose price had since been cleared).
  it('a merchandise-only edit carries the service type forward at its saved price, even after the catalog price was cleared', async () => {
    await setGusPrice('DIRECT_CREMATION', 300_000);
    await createGusOrder({ weightTier: 'under_200', serviceTypeCode: 'DIRECT_CREMATION' });
    await setGusPrice('DIRECT_CREMATION', null);
    const result = await recalculateOrder(
      { organizationId: GUS_ORGANIZATION_ID, caseId: 'gus-case-1', selections: { customItems: [{ id: 'c1', description: 'Flowers', amountCents: 5_000 }] }, performedBy: 'u', idFactory, now: NOW, canEditCustomItems: true },
      'mock',
    );
    expect(result?.order.total).toBe(305_000);
    expect(result?.lineItems.find((l) => l.serviceCode === 'DIRECT_CREMATION')).toMatchObject({ unitPrice: 300_000, description: 'Direct Cremation' });
    expect(result?.auditEntries.map((e) => e.action)).toEqual(['custom_item_added']);
  });
});

describe('updateServiceCatalogItemPrice — mock', () => {
  it('sets, then clears, a price on the org\'s own row and records an activity event', async () => {
    const itemId = gusServiceCatalogItemId('DIRECT_CREMATION');
    const set = await updateServiceCatalogItemPrice({ organizationId: GUS_ORGANIZATION_ID, itemId, defaultPrice: 299_500, ctx: ctx(GUS_ORGANIZATION_ID), now: NOW }, 'mock');
    expect(set).toMatchObject({ previousPrice: null, item: { id: itemId, defaultPrice: 299_500, updatedAt: NOW } });
    expect(serviceCatalogFixtures.find((i) => i.id === itemId)?.defaultPrice).toBe(299_500);

    const cleared = await updateServiceCatalogItemPrice({ organizationId: GUS_ORGANIZATION_ID, itemId, defaultPrice: null, ctx: ctx(GUS_ORGANIZATION_ID) }, 'mock');
    expect(cleared).toMatchObject({ previousPrice: 299_500, item: { defaultPrice: null } });

    const events = activityEventFixtures.filter((e) => e.eventType === 'serviceCatalog.price.updated');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ organizationId: GUS_ORGANIZATION_ID, category: 'administration', resourceId: itemId });
    expect(events[1].description).toBe('Price for "Direct Cremation" changed from $2,995.00 to not set');
  });

  it("never touches another organization's row (returns null)", async () => {
    const gusItemId = gusServiceCatalogItemId('DIRECT_CREMATION');
    const result = await updateServiceCatalogItemPrice({ organizationId: DEFAULT_ORGANIZATION_ID, itemId: gusItemId, defaultPrice: 1, ctx: ctx(DEFAULT_ORGANIZATION_ID) }, 'mock');
    expect(result).toBeNull();
    expect(serviceCatalogFixtures.find((i) => i.id === gusItemId)?.defaultPrice).toBeNull();
    expect(activityEventFixtures).toHaveLength(0);
  });

  it('rejects anything but a non-negative integer number of cents or null', async () => {
    for (const bad of [-1, 10.5, Number.NaN, '100', undefined, 100_000_001]) {
      expect(isValidServiceCatalogPrice(bad)).toBe(false);
    }
    expect(isValidServiceCatalogPrice(0)).toBe(true);
    expect(isValidServiceCatalogPrice(null)).toBe(true);
    await expect(
      updateServiceCatalogItemPrice({ organizationId: GUS_ORGANIZATION_ID, itemId: gusServiceCatalogItemId('DIRECT_CREMATION'), defaultPrice: -5, ctx: ctx(GUS_ORGANIZATION_ID) }, 'mock'),
    ).rejects.toThrow();
  });
});

describe('updateServiceCatalogItemPrice — wix', () => {
  const gusRow = buildWixServiceCatalogData({
    id: 'gus-svc-1', organizationId: GUS_ORGANIZATION_ID, serviceCode: 'DIRECT_CREMATION', displayName: 'Direct Cremation',
    category: 'service_type', pricingType: 'flat', defaultPrice: null, isActive: true, sortOrder: 1, createdAt: NOW, updatedAt: NOW,
  });

  it('queries by organizationId + item id and writes only defaultPrice/updatedAt', async () => {
    wix.queryWixDataItems.mockResolvedValue({ dataItems: [{ id: 'wix-row-1', data: gusRow }] });
    wix.conditionalPatchWixDataItemFields.mockImplementation(async (_c: string, id: string, fields: Record<string, unknown>) => ({ applied: true, dataItem: { id, data: { ...gusRow, ...fields } } }));
    wix.insertWixDataItem.mockResolvedValue({});

    const result = await updateServiceCatalogItemPrice({ organizationId: GUS_ORGANIZATION_ID, itemId: 'gus-svc-1', defaultPrice: 410_000, ctx: ctx(GUS_ORGANIZATION_ID), now: NOW }, 'wix');

    expect(wix.queryWixDataItems).toHaveBeenCalledWith('serviceCatalog', {
      filter: { organizationId: GUS_ORGANIZATION_ID, beaconServiceCatalogId: 'gus-svc-1' },
      paging: { limit: 1 },
    });
    // Price catalog (2026-11): one field-scoped patch, only while the price
    // is still the one read — never a full replace.
    expect(wix.updateWixDataItem).not.toHaveBeenCalled();
    expect(wix.conditionalPatchWixDataItemFields).toHaveBeenCalledWith('serviceCatalog', 'wix-row-1', { defaultPrice: 410_000, updatedAt: NOW }, {
      filter: { organizationId: { $eq: GUS_ORGANIZATION_ID }, beaconServiceCatalogId: { $eq: 'gus-svc-1' }, defaultPrice: { $eq: null } },
    });
    expect(result?.item.defaultPrice).toBe(410_000);
    expect(result?.previousPrice).toBeNull();
  });

  it('refuses to write a row whose own organizationId is not the caller\'s, even if the query returned it', async () => {
    wix.queryWixDataItems.mockResolvedValue({ dataItems: [{ id: 'wix-row-1', data: { ...gusRow, organizationId: DEFAULT_ORGANIZATION_ID } }] });
    const result = await updateServiceCatalogItemPrice({ organizationId: GUS_ORGANIZATION_ID, itemId: 'gus-svc-1', defaultPrice: 1, ctx: ctx(GUS_ORGANIZATION_ID) }, 'wix');
    expect(result).toBeNull();
    expect(wix.updateWixDataItem).not.toHaveBeenCalled();
  });

  it('a price someone else changed since it was read is refused (409), nothing written', async () => {
    wix.queryWixDataItems.mockResolvedValue({ dataItems: [{ id: 'wix-row-1', data: gusRow }] });
    wix.conditionalPatchWixDataItemFields.mockResolvedValue({ applied: false, status: 428 });
    await expect(updateServiceCatalogItemPrice({ organizationId: GUS_ORGANIZATION_ID, itemId: 'gus-svc-1', defaultPrice: 1, ctx: ctx(GUS_ORGANIZATION_ID) }, 'wix')).rejects.toThrow(/changed by someone else/);
  });

  it('returns null for a missing row without writing', async () => {
    wix.queryWixDataItems.mockResolvedValue({ dataItems: [] });
    expect(await updateServiceCatalogItemPrice({ organizationId: GUS_ORGANIZATION_ID, itemId: 'nope', defaultPrice: 1, ctx: ctx(GUS_ORGANIZATION_ID) }, 'wix')).toBeNull();
    expect(wix.updateWixDataItem).not.toHaveBeenCalled();
  });
});
