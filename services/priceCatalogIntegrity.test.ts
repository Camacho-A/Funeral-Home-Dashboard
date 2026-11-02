import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { caseOrderAuditFixtures, caseOrderFixtures, caseOrderLineItemFixtures, catalogPriceChangeFixtures, MANORS_SERVICE_CATALOG_ID_PREFIX, serviceCatalogFixtures } from './__mocks__/pricingFixtures';
import type { ActivityContext } from './activityService';

/**
 * Price catalog (2026-11) — order integrity and price history, mock data.
 * The default fixture organization is switched to the platform pricing
 * defaults (`granular`, line prices locked) for the "granular" cases; the
 * `legacy` cases switch it back to exactly the real Manors profile, so they
 * prove Manors' behaviour is unchanged.
 */
const model = vi.hoisted(() => ({ granular: true }));
vi.mock('../domain/organization/organizationProfiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/organization/organizationProfiles')>();
  const { withGranularPricing } = await import('../lib/testing/granularPricingProfile');
  const granular = withGranularPricing(actual, (await import('./__mocks__/organizationIds')).DEFAULT_ORGANIZATION_ID);
  return { ...actual, getRegisteredOrganizationProfile: (id: string | null | undefined) => (model.granular ? granular : actual).getRegisteredOrganizationProfile(id) };
});

const { createCaseOrder, recalculateOrder, repriceCaseOrder, updateServiceCatalogItemPrice, RepriceNotAllowedError, CaseOrderConflictError } = await import('./pricingService');
const { listCatalogPriceHistory } = await import('./catalogPriceHistoryService');
const { pricingPermissionFor } = await import('../domain/pricing/pricingPermissions');

const ORG = DEFAULT_ORGANIZATION_ID;
const CASE = 'case-fictional-price-integrity';
const BASE_ID = `${MANORS_SERVICE_CATALOG_ID_PREFIX}-direct-cremation`;
const CERT_ID = `${MANORS_SERVICE_CATALOG_ID_PREFIX}-extra-death-cert`;
const ctx: ActivityContext = { organizationId: ORG, actorIdentityId: 'identity-fictional-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' };
let n = 0;
const ids = () => `fictional-${++n}`;
const SELECTIONS = { weightTier: 'under_200', extraDeathCertificateQuantity: 1, mailCremated: false };

const snapshot = () => ({
  catalog: structuredClone(serviceCatalogFixtures),
  orders: structuredClone(caseOrderFixtures),
  lines: structuredClone(caseOrderLineItemFixtures),
  audit: structuredClone(caseOrderAuditFixtures),
  history: structuredClone(catalogPriceChangeFixtures),
});
let saved: ReturnType<typeof snapshot>;
beforeEach(() => {
  model.granular = true;
  saved = snapshot();
});
afterEach(() => {
  serviceCatalogFixtures.splice(0, serviceCatalogFixtures.length, ...saved.catalog);
  caseOrderFixtures.splice(0, caseOrderFixtures.length, ...saved.orders);
  caseOrderLineItemFixtures.splice(0, caseOrderLineItemFixtures.length, ...saved.lines);
  caseOrderAuditFixtures.splice(0, caseOrderAuditFixtures.length, ...saved.audit);
  catalogPriceChangeFixtures.splice(0, catalogPriceChangeFixtures.length, ...saved.history);
});

async function orderAtTodaysPrices() {
  return createCaseOrder({ organizationId: ORG, caseId: CASE, selections: SELECTIONS, performedBy: 'identity-fictional-admin', idFactory: ids }, 'mock');
}
const linePrice = (lines: Array<{ serviceCode: string; unitPrice: number }>, code: string) => lines.find((l) => l.serviceCode === code)?.unitPrice;

describe('granular organization — a price change never reprices an existing order', () => {
  it('an edit keeps every existing line at its agreed price; a NEW order uses the current price', async () => {
    const { order } = await orderAtTodaysPrices();
    await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: BASE_ID, defaultPrice: 95_000, ctx }, 'mock');
    await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: CERT_ID, defaultPrice: 3_000, ctx }, 'mock');

    // Edit: one more death certificate.
    const edited = await recalculateOrder(
      { organizationId: ORG, caseId: CASE, selections: { ...SELECTIONS, extraDeathCertificateQuantity: 2 }, performedBy: 'identity-fictional-admin', idFactory: ids, expectedOrderId: order.id },
      'mock',
    );
    expect(linePrice(edited!.lineItems, 'DIRECT_CREMATION')).toBe(89_000); // agreed, not 95,000
    expect(linePrice(edited!.lineItems, 'EXTRA_DEATH_CERTIFICATE')).toBe(2_500);
    // The superseded version is untouched.
    expect(caseOrderFixtures.find((o) => o.id === order.id)).toMatchObject({ status: 'superseded', total: order.total });

    const other = await createCaseOrder({ organizationId: ORG, caseId: `${CASE}-2`, selections: SELECTIONS, performedBy: 'identity-fictional-admin', idFactory: ids }, 'mock');
    expect(linePrice(other.lineItems, 'DIRECT_CREMATION')).toBe(95_000);
  });

  it('a reprice previews without writing, then writes one new version with an audit entry per moved line', async () => {
    const { order } = await orderAtTodaysPrices();
    await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: BASE_ID, defaultPrice: 95_000, ctx }, 'mock');
    const ordersBefore = caseOrderFixtures.length;

    const preview = await repriceCaseOrder({ organizationId: ORG, caseId: CASE, expectedOrderId: order.id, performedBy: 'identity-fictional-admin', idFactory: ids, confirm: false }, 'mock');
    expect(preview).toMatchObject({ applied: false, changes: [{ description: expect.any(String), previousUnitPrice: 89_000, newUnitPrice: 95_000, amountDeltaCents: 6_000 }] });
    expect(caseOrderFixtures.length).toBe(ordersBefore);

    const applied = await repriceCaseOrder({ organizationId: ORG, caseId: CASE, expectedOrderId: order.id, performedBy: 'identity-fictional-admin', idFactory: ids, confirm: true }, 'mock');
    expect(applied!.applied).toBe(true);
    expect(applied!.order).toMatchObject({ version: order.version + 1, total: order.total + 6_000 });
    expect(caseOrderFixtures.find((o) => o.id === order.id)).toMatchObject({ status: 'superseded', total: order.total });
    const audit = caseOrderAuditFixtures.filter((e) => e.caseOrderId === applied!.order.id);
    expect(audit.map((e) => [e.action, e.amountDeltaCents])).toEqual([['line_repriced', 6_000]]);

    // Pinned: repricing the superseded version again is refused, nothing written.
    await expect(repriceCaseOrder({ organizationId: ORG, caseId: CASE, expectedOrderId: order.id, performedBy: 'x', idFactory: ids, confirm: true }, 'mock')).rejects.toBeInstanceOf(CaseOrderConflictError);
  });

  it('a reprice is refused when an item on the order now has no price set — never billed at $0', async () => {
    const { order } = await orderAtTodaysPrices();
    await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: BASE_ID, defaultPrice: null, ctx }, 'mock');
    await expect(repriceCaseOrder({ organizationId: ORG, caseId: CASE, expectedOrderId: order.id, performedBy: 'x', idFactory: ids, confirm: true }, 'mock')).rejects.toThrow(/No price is set/);
  });
});

describe('granular organization — merchandise keeps its agreed price too', () => {
  it('a retail price change is recorded in the price history and never reaches an existing order line', async () => {
    const { merchandiseProductFixtures } = await import('./__mocks__/merchandiseFixtures');
    const { updateProduct } = await import('./merchandiseService');
    const before = structuredClone(merchandiseProductFixtures);
    merchandiseProductFixtures.push({
      id: 'product-fictional-urn',
      organizationId: ORG,
      sku: 'FICT-URN-1',
      name: 'FICTIONAL URN',
      description: null,
      category: 'urns',
      cost: 5_000,
      retailPrice: 20_000,
      taxable: false,
      isActive: true,
      trackInventory: false,
      reorderPoint: null,
      defaultLocationId: null,
      imageStorageKey: null,
      familyVisible: false,
      supplierName: null,
      supplierId: null,
      parentProductId: null,
      hasVariants: false,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    } as never);
    try {
      const { order } = await createCaseOrder(
        { organizationId: ORG, caseId: CASE, selections: { services: SELECTIONS, merchandise: [{ productId: 'product-fictional-urn', quantity: 1, locationId: 'loc-1' }] }, performedBy: 'x', idFactory: ids },
        'mock',
      );
      await updateProduct(ORG, 'product-fictional-urn', { retailPrice: 26_000 }, ctx, 'mock');
      const edited = await recalculateOrder(
        { organizationId: ORG, caseId: CASE, selections: { services: { ...SELECTIONS, extraDeathCertificateQuantity: 2 } }, performedBy: 'x', idFactory: ids, expectedOrderId: order.id },
        'mock',
      );
      expect(edited!.lineItems.find((l) => l.lineKind === 'merchandise')?.unitPrice).toBe(20_000);
      const history = await listCatalogPriceHistory(ORG, { itemType: 'merchandise_product', itemId: 'product-fictional-urn' }, 'mock');
      expect(history.map((h) => [h.previousPrice, h.newPrice])).toEqual([[20_000, 26_000]]);
    } finally {
      merchandiseProductFixtures.splice(0, merchandiseProductFixtures.length, ...before);
    }
  });
});

describe('legacy organization (Manors) — exactly as today', () => {
  it('an edit applies the current price to every line, as it always has; repricing is not offered', async () => {
    model.granular = false;
    const { order } = await orderAtTodaysPrices();
    await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: BASE_ID, defaultPrice: 95_000, ctx }, 'mock');
    const edited = await recalculateOrder(
      { organizationId: ORG, caseId: CASE, selections: { ...SELECTIONS, extraDeathCertificateQuantity: 2 }, performedBy: 'x', idFactory: ids, expectedOrderId: order.id },
      'mock',
    );
    expect(linePrice(edited!.lineItems, 'DIRECT_CREMATION')).toBe(95_000);
    await expect(repriceCaseOrder({ organizationId: ORG, caseId: CASE, expectedOrderId: edited!.order.id, performedBy: 'x', idFactory: ids, confirm: false }, 'mock')).rejects.toBeInstanceOf(RepriceNotAllowedError);
  });

  it('the permission each pricing action takes is the one Manors already used', () => {
    model.granular = false;
    expect(pricingPermissionFor(ORG, 'catalog.price')).toBe('serviceCatalog.edit');
    expect(pricingPermissionFor(ORG, 'catalog.price', { merchandise: true })).toBe('merchandise.manage');
    expect(pricingPermissionFor(ORG, 'catalog.deactivate')).toBe('serviceCatalog.edit');
    expect(pricingPermissionFor(ORG, 'order.customItems')).toBe('caseOrder.update');
    expect(pricingPermissionFor(ORG, 'order.reprice')).toBeNull();
    model.granular = true;
    expect(pricingPermissionFor(ORG, 'catalog.price')).toBe('serviceCatalog.price');
    expect(pricingPermissionFor(ORG, 'catalog.deactivate')).toBe('serviceCatalog.deactivate');
    expect(pricingPermissionFor(ORG, 'order.customItems')).toBe('caseOrder.customItems');
    expect(pricingPermissionFor(ORG, 'order.reprice')).toBe('caseOrder.reprice');
  });
});

describe('price history', () => {
  it('every change keeps the previous value, who and when — newest first; no change records nothing', async () => {
    await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: BASE_ID, defaultPrice: 95_000, ctx, reason: 'Fictional annual review', now: '2026-11-02T10:00:00.000Z' }, 'mock');
    await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: BASE_ID, defaultPrice: 97_000, ctx, now: '2026-11-03T10:00:00.000Z' }, 'mock');
    await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: BASE_ID, defaultPrice: 97_000, ctx, now: '2026-11-04T10:00:00.000Z' }, 'mock');
    const history = await listCatalogPriceHistory(ORG, { itemType: 'service', itemId: BASE_ID }, 'mock');
    expect(history.map((h) => [h.previousPrice, h.newPrice, h.changedBy, h.reason])).toEqual([
      [95_000, 97_000, 'identity-fictional-admin', null],
      [89_000, 95_000, 'identity-fictional-admin', 'Fictional annual review'],
    ]);
    // Organization isolation: another organization sees none of it.
    expect(await listCatalogPriceHistory(SECOND_MOCK_ORGANIZATION_ID, { itemType: 'service', itemId: BASE_ID }, 'mock')).toEqual([]);
  });
});
