import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Price history journal (2026-11) — failure handling on the LIVE (Wix-mode)
 * path, against the in-memory Wix stand-in (lib/testing/inMemoryWixData.ts,
 * which models the live-verified single-item conditional patch). Fictional
 * rows only; no network. Live history storage is switched on for these
 * tests only — in the application it stays off until the collection exists.
 */

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
vi.mock('@/lib/wixDataApi', () => wix.api);

const { buildWixServiceCatalogData } = await import('../lib/wixServiceCatalogMapper');
const { updateServiceCatalogItemPrice, CatalogPriceConflictError } = await import('./pricingService');
const {
  setCatalogPriceHistoryLiveForTests,
  reconcileCatalogPriceChanges,
  CatalogPriceChangeInProgressError,
  DuplicatePriceChangeRequestError,
  PENDING_PRICE_CHANGE_STALE_AFTER_MS,
  catalogPriceChangeIdFor,
} = await import('./catalogPriceChangeJournal');
const { listCatalogPriceHistory } = await import('./catalogPriceHistoryService');

const ORG = 'fictional-funeral-home';
const OTHER_ORG = 'other-fictional-home';
const ITEM = 'svc-fictional-base';
const WIX_ID = 'wix-svc-fictional-base';
const T0 = '2026-11-01T10:00:00.000Z';
const ctx = (correlationId = 'corr-1') => ({ organizationId: ORG, actorIdentityId: 'identity-fictional-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId });

function seedItem(price: number | null, org = ORG, wixId = WIX_ID, itemId = ITEM) {
  wix.seed('serviceCatalog', wixId, {
    ...buildWixServiceCatalogData({
      id: itemId,
      organizationId: org,
      serviceCode: 'DIRECT_CREMATION',
      displayName: 'Direct Cremation (fictional)',
      category: 'base',
      pricingType: 'flat',
      defaultPrice: price,
      isActive: true,
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  } as Record<string, unknown>);
}
const item = () => wix.get('serviceCatalog', WIX_ID)!;
const historyRows = () => wix.rows('catalogPriceChanges').map((r) => r.data);
const setPrice = (defaultPrice: number | null, extra: { now?: string; requestKey?: string; correlationId?: string } = {}) =>
  updateServiceCatalogItemPrice({ organizationId: ORG, itemId: ITEM, defaultPrice, ctx: ctx(extra.correlationId), now: extra.now ?? T0, requestKey: extra.requestKey }, 'wix');
const minutesAfterT0 = (m: number) => Date.parse(T0) + m * 60_000;

beforeEach(() => {
  wix.reset();
  setCatalogPriceHistoryLiveForTests(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  setCatalogPriceHistoryLiveForTests(false);
  vi.restoreAllMocks();
});

describe('price history journal — live path', () => {
  it('records the change pending first, writes price and marker together, then settles applied', async () => {
    seedItem(100_000);
    const order: string[] = [];
    wix.onBeforeOp((op) => { if (op.op !== 'query' && op.op !== 'count') order.push(`${op.op}:${op.collection}`); });

    const result = await setPrice(125_000);

    expect(result?.item.defaultPrice).toBe(125_000);
    expect(order.slice(0, 3)).toEqual(['insert:catalogPriceChanges', 'patch:serviceCatalog', 'patch:catalogPriceChanges']);
    const [row] = historyRows();
    expect(row).toMatchObject({ previousPrice: 100_000, newPrice: 125_000, status: 'applied', outcome: 'applied', changedBy: 'identity-fictional-admin' });
    expect(item().priceChangeId).toBe(row.beaconCatalogPriceChangeId);
    // The price write was conditioned on the price and marker just read.
    const priceWrite = wix.conditions.find((c) => c.collection === 'serviceCatalog')!;
    expect(priceWrite.filter).toMatchObject({ organizationId: { $eq: ORG }, defaultPrice: { $eq: 100_000 }, priceChangeId: { $eq: null } });
  });

  it('concurrent edit: someone else changes the price first — 409, nothing overwritten, history says not applied', async () => {
    seedItem(100_000);
    let interleaved = false;
    wix.onBeforeOp((op) => {
      if (!interleaved && op.op === 'patch' && op.collection === 'serviceCatalog') {
        interleaved = true;
        wix.seed('serviceCatalog', WIX_ID, { ...item(), defaultPrice: 110_000 });
      }
    });

    await expect(setPrice(125_000)).rejects.toBeInstanceOf(CatalogPriceConflictError);

    expect(item().defaultPrice).toBe(110_000);
    expect(historyRows()).toEqual([expect.objectContaining({ newPrice: 125_000, status: 'not_applied', outcome: 'conflict' })]);
  });

  it('concurrent edit: a second change while another is still pending (fresh) is refused, and changes nothing', async () => {
    seedItem(100_000);
    wix.seed('catalogPriceChanges', 'cpc-in-flight', {
      beaconCatalogPriceChangeId: 'cpc-in-flight', organizationId: ORG, itemType: 'service', itemId: ITEM, itemCode: 'DIRECT_CREMATION', itemName: 'Direct Cremation (fictional)',
      previousPrice: 100_000, newPrice: 110_000, changedBy: 'identity-fictional-manager', changedAt: T0, reason: null, correlationId: 'corr-in-flight',
      status: 'pending', outcome: null, settledAt: null, requestKey: null,
    });
    const before = wix.snapshot();

    await expect(setPrice(150_000, { now: new Date(minutesAfterT0(1)).toISOString() })).rejects.toBeInstanceOf(CatalogPriceChangeInProgressError);

    expect(wix.snapshot()).toEqual(before);
  });

  it('concurrent edit: two requests racing — the second never overwrites the first', async () => {
    seedItem(100_000);
    let second: Promise<unknown> | null = null;
    wix.onBeforeOp((op) => {
      // The first request has recorded its pending row and is about to write the price.
      if (!second && op.op === 'patch' && op.collection === 'serviceCatalog') {
        second = setPrice(150_000, { correlationId: 'corr-2' }).catch((error) => error);
      }
    });

    await setPrice(125_000);
    const secondResult = await second!;

    expect([CatalogPriceChangeInProgressError, CatalogPriceConflictError].some((E) => secondResult instanceof E)).toBe(true);
    expect(item().defaultPrice).toBe(125_000);
    const rows = historyRows();
    expect(rows.filter((r) => r.status === 'applied')).toEqual([expect.objectContaining({ newPrice: 125_000 })]);
    expect(rows.filter((r) => r.status === 'pending')).toEqual([]);
  });

  it('failed history write: the price is not changed and nothing is recorded', async () => {
    seedItem(100_000);
    wix.failNext('insert', 'catalogPriceChanges', 500);

    await expect(setPrice(125_000)).rejects.toThrow();

    expect(item().defaultPrice).toBe(100_000);
    expect(item().priceChangeId).toBeUndefined();
    expect(historyRows()).toEqual([]);
    expect(wix.writes().filter((w) => w.collection === 'serviceCatalog')).toEqual([]);
  });

  it('failed price update: the error is reported, the price is unchanged, and the history row is settled not applied', async () => {
    seedItem(100_000);
    wix.failNext('patch', 'serviceCatalog', 500);

    await expect(setPrice(125_000)).rejects.toThrow(/HTTP 500/);

    expect(item().defaultPrice).toBe(100_000);
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'not_applied', outcome: 'write_failed' })]);
  });

  it('lost response: the price write landed but its answer was lost — read back from the marker, reported as saved', async () => {
    seedItem(100_000);
    wix.failNext('patch', 'serviceCatalog', 504, { afterWrite: true });

    const result = await setPrice(125_000);

    expect(result?.item.defaultPrice).toBe(125_000);
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'applied', outcome: 'applied' })]);
  });

  it('interrupted after the price was written (settling failed): the row stays pending, then reconciliation settles it applied', async () => {
    seedItem(100_000);
    wix.failNext('patch', 'catalogPriceChanges', 503);

    const result = await setPrice(125_000);
    expect(result?.item.defaultPrice).toBe(125_000);
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'pending' })]);

    // Within two minutes the change may still be running: reported, left alone.
    const early = await reconcileCatalogPriceChanges(ORG, 'wix', { apply: true, nowMs: minutesAfterT0(1) });
    expect(early.pending).toEqual([expect.objectContaining({ resolution: 'in_progress' })]);
    expect(historyRows()[0].status).toBe('pending');

    const dryRun = await reconcileCatalogPriceChanges(ORG, 'wix', { apply: false, nowMs: minutesAfterT0(5) });
    expect(dryRun.pending).toEqual([expect.objectContaining({ resolution: 'applied' })]);
    expect(historyRows()[0].status).toBe('pending');

    const report = await reconcileCatalogPriceChanges(ORG, 'wix', { apply: true, nowMs: minutesAfterT0(5) });
    expect(report.pending).toEqual([expect.objectContaining({ resolution: 'applied' })]);
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'applied', outcome: 'reconciled_applied' })]);
    expect(item().defaultPrice).toBe(125_000);
  });

  it('interrupted before the price was written: the row stays pending, then reconciliation settles it not applied — the price is never touched', async () => {
    seedItem(100_000);
    // The price write fails and so does the read-back: the outcome is unknown.
    wix.failNext('patch', 'serviceCatalog', 500);
    wix.failNext('query', 'serviceCatalog', 500, { when: () => wix.rows('catalogPriceChanges').length === 1 });

    await expect(setPrice(125_000)).rejects.toThrow();
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'pending' })]);

    const before = wix.get('serviceCatalog', WIX_ID);
    const report = await reconcileCatalogPriceChanges(ORG, 'wix', { apply: true, nowMs: minutesAfterT0(5) });
    expect(report.pending).toEqual([expect.objectContaining({ resolution: 'not_applied' })]);
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'not_applied', outcome: 'reconciled_not_applied' })]);
    expect(wix.get('serviceCatalog', WIX_ID)).toEqual(before);
  });

  it('a later change settles an interrupted (stale) one first, then proceeds', async () => {
    seedItem(100_000);
    wix.failNext('patch', 'catalogPriceChanges', 503);
    await setPrice(125_000);
    expect(historyRows()[0].status).toBe('pending');

    await setPrice(130_000, { now: new Date(minutesAfterT0(10)).toISOString(), correlationId: 'corr-2' });

    const rows = historyRows().sort((a, b) => String(a.changedAt).localeCompare(String(b.changedAt)));
    expect(rows).toEqual([
      expect.objectContaining({ previousPrice: 100_000, newPrice: 125_000, status: 'applied', outcome: 'reconciled_applied' }),
      expect.objectContaining({ previousPrice: 125_000, newPrice: 130_000, status: 'applied', outcome: 'applied' }),
    ]);
    expect(item().defaultPrice).toBe(130_000);
  });

  it('duplicate request (same idempotency key): the price is changed once; the repeat reports the saved change', async () => {
    seedItem(100_000);
    await setPrice(125_000, { requestKey: 'req-fictional-1' });
    const writesAfterFirst = wix.writes().length;

    const repeat = await setPrice(125_000, { requestKey: 'req-fictional-1' }).catch((error) => error);

    expect(repeat).toBeInstanceOf(DuplicatePriceChangeRequestError);
    expect((repeat as InstanceType<typeof DuplicatePriceChangeRequestError>).row.status).toBe('applied');
    expect(historyRows()).toHaveLength(1);
    expect(historyRows()[0].beaconCatalogPriceChangeId).toBe(catalogPriceChangeIdFor(ORG, 'service', ITEM, 'req-fictional-1'));
    expect(wix.writes().length).toBe(writesAfterFirst);
  });

  it('duplicate request racing in at the same moment: the twin loses the insert (409) and changes nothing', async () => {
    seedItem(100_000);
    const id = catalogPriceChangeIdFor(ORG, 'service', ITEM, 'req-fictional-2');
    let raced = false;
    wix.onBeforeOp((op) => {
      if (!raced && op.op === 'insert' && op.collection === 'catalogPriceChanges') {
        raced = true;
        // The twin request inserted the same deterministic row a moment earlier.
        wix.seed('catalogPriceChanges', id, {
          beaconCatalogPriceChangeId: id, organizationId: ORG, itemType: 'service', itemId: ITEM, itemCode: 'DIRECT_CREMATION', itemName: 'Direct Cremation (fictional)',
          previousPrice: 100_000, newPrice: 125_000, changedBy: 'identity-fictional-admin', changedAt: T0, reason: null, correlationId: 'corr-twin',
          status: 'pending', outcome: null, settledAt: null, requestKey: 'req-fictional-2',
        });
      }
    });

    const result = await setPrice(125_000, { requestKey: 'req-fictional-2' }).catch((error) => error);

    expect(result).toBeInstanceOf(DuplicatePriceChangeRequestError);
    expect(item().defaultPrice).toBe(100_000);
    expect(wix.writes().filter((w) => w.collection === 'serviceCatalog')).toEqual([]);
  });

  it('a write that landed after its request settled it "not applied" is corrected by reconciliation', async () => {
    seedItem(100_000);
    wix.failNext('patch', 'serviceCatalog', 500);
    await expect(setPrice(125_000)).rejects.toThrow();
    const [row] = historyRows();
    expect(row.status).toBe('not_applied');
    // The delayed write lands afterwards.
    wix.seed('serviceCatalog', WIX_ID, { ...item(), defaultPrice: 125_000, priceChangeId: row.beaconCatalogPriceChangeId });

    const report = await reconcileCatalogPriceChanges(ORG, 'wix', { apply: true, nowMs: minutesAfterT0(5) });

    expect(report.markerMismatches).toEqual([expect.objectContaining({ id: row.beaconCatalogPriceChangeId })]);
    expect(historyRows()[0]).toMatchObject({ status: 'applied', outcome: 'reconciled_applied' });
  });

  it('a price changed outside SOLIS is reported as drift and never "fixed"', async () => {
    seedItem(100_000);
    await setPrice(125_000);
    wix.seed('serviceCatalog', WIX_ID, { ...item(), defaultPrice: 999 });
    const before = wix.snapshot();

    const report = await reconcileCatalogPriceChanges(ORG, 'wix', { apply: true, nowMs: minutesAfterT0(5) });

    expect(report.priceDrift).toEqual([expect.objectContaining({ itemId: ITEM, recordedPrice: 125_000, currentPrice: 999 })]);
    expect(wix.snapshot()).toEqual(before);
  });

  it('is organization-scoped: another organization sees no history and reconciles nothing', async () => {
    seedItem(100_000);
    wix.failNext('patch', 'catalogPriceChanges', 503);
    await setPrice(125_000);

    const other = await reconcileCatalogPriceChanges(OTHER_ORG, 'wix', { apply: true, nowMs: minutesAfterT0(5) });
    expect(other).toMatchObject({ pending: [], markerMismatches: [], priceDrift: [] });
    expect(await listCatalogPriceHistory(OTHER_ORG, { itemType: 'service', itemId: ITEM }, 'wix')).toEqual([]);
    expect(historyRows()[0].status).toBe('pending');
    // And another organization's item can't be priced through this one.
    seedItem(50_000, OTHER_ORG, 'wix-other', 'svc-other');
    expect(await updateServiceCatalogItemPrice({ organizationId: ORG, itemId: 'svc-other', defaultPrice: 1, ctx: ctx(), now: T0 }, 'wix')).toBeNull();
    expect(wix.get('serviceCatalog', 'wix-other')!.defaultPrice).toBe(50_000);
  });

  it('with live history storage off (Production today) nothing is written to the history collection', async () => {
    setCatalogPriceHistoryLiveForTests(false);
    seedItem(100_000);

    await setPrice(125_000);

    expect(item().defaultPrice).toBe(125_000);
    expect(wix.writes().some((w) => w.collection === 'catalogPriceChanges')).toBe(false);
    expect(item().priceChangeId).toBeUndefined();
  });

  it('the stale threshold is two minutes', () => {
    expect(PENDING_PRICE_CHANGE_STALE_AFTER_MS).toBe(120_000);
  });
});

describe('price history journal — merchandise (full-replace writes)', () => {
  const PRODUCT = 'product-fictional-urn';
  const PRODUCT_WIX = 'wix-product-fictional-urn';
  async function seedProduct(retailPrice: number) {
    const { buildWixMerchandiseProductData } = await import('../lib/wixMerchandiseProductMapper');
    wix.seed('merchandiseProducts', PRODUCT_WIX, buildWixMerchandiseProductData({
      id: PRODUCT, organizationId: ORG, sku: 'URN-FICTIONAL', name: 'FICTIONAL URN', description: null, category: 'urn', cost: 5_000, retailPrice,
      taxable: true, isActive: true, trackInventory: false, reorderPoint: null, defaultLocationId: null, imageStorageKey: null, familyVisible: false,
      supplierName: null, supplierId: null, parentProductId: null, hasVariants: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }) as Record<string, unknown>);
  }
  const product = () => wix.get('merchandiseProducts', PRODUCT_WIX)!;

  it('records pending, writes the price with its marker, settles applied', async () => {
    const { updateProduct } = await import('./merchandiseService');
    await seedProduct(20_000);
    await updateProduct(ORG, PRODUCT, { retailPrice: 25_000, now: T0 }, ctx(), 'wix');
    const [row] = historyRows();
    expect(row).toMatchObject({ itemType: 'merchandise_product', previousPrice: 20_000, newPrice: 25_000, status: 'applied' });
    expect(product()).toMatchObject({ retailPrice: 25_000, priceChangeId: row.beaconCatalogPriceChangeId });
  });

  it('keeps the marker through a later edit that does not change the price', async () => {
    const { updateProduct } = await import('./merchandiseService');
    await seedProduct(20_000);
    await updateProduct(ORG, PRODUCT, { retailPrice: 25_000, now: T0 }, ctx(), 'wix');
    const marker = product().priceChangeId;
    await updateProduct(ORG, PRODUCT, { name: 'Fictional urn, brass', now: T0 }, ctx('corr-2'), 'wix');
    expect(product().priceChangeId).toBe(marker);
    expect(historyRows()).toHaveLength(1);
  });

  it('failed write: the price is unchanged and the row is settled not applied', async () => {
    const { updateProduct } = await import('./merchandiseService');
    await seedProduct(20_000);
    wix.failNext('patch', 'merchandiseProducts', 500);
    await expect(updateProduct(ORG, PRODUCT, { retailPrice: 25_000, now: T0 }, ctx(), 'wix')).rejects.toThrow();
    expect(product().retailPrice).toBe(20_000);
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'not_applied', outcome: 'write_failed' })]);
  });

  it('a price change is a conditional field patch, never a full replace: a concurrent price change makes it 409 and nothing is overwritten', async () => {
    const { updateProduct } = await import('./merchandiseService');
    await seedProduct(20_000);
    let interleaved = false;
    wix.onBeforeOp((op) => {
      if (!interleaved && op.op === 'patch' && op.collection === 'merchandiseProducts') {
        interleaved = true;
        wix.seed('merchandiseProducts', PRODUCT_WIX, { ...product(), retailPrice: 22_000, name: 'CHANGED ELSEWHERE' });
      }
    });
    await expect(updateProduct(ORG, PRODUCT, { retailPrice: 25_000, now: T0 }, ctx(), 'wix')).rejects.toBeInstanceOf(CatalogPriceConflictError);
    expect(product()).toMatchObject({ retailPrice: 22_000, name: 'CHANGED ELSEWHERE' });
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'not_applied', outcome: 'conflict' })]);
    expect(wix.writes().some((w) => w.op === 'update' && w.collection === 'merchandiseProducts')).toBe(false);
  });

  it('lost response on a merchandise price write: settled from the marker, reported saved', async () => {
    const { updateProduct } = await import('./merchandiseService');
    await seedProduct(20_000);
    wix.failNext('patch', 'merchandiseProducts', 504, { afterWrite: true });
    const saved = await updateProduct(ORG, PRODUCT, { retailPrice: 25_000, now: T0 }, ctx(), 'wix');
    expect(saved.retailPrice).toBe(25_000);
    expect(historyRows()).toEqual([expect.objectContaining({ status: 'applied' })]);
  });

  it('failed history write: the product is not touched', async () => {
    const { updateProduct } = await import('./merchandiseService');
    await seedProduct(20_000);
    wix.failNext('insert', 'catalogPriceChanges', 500);
    await expect(updateProduct(ORG, PRODUCT, { retailPrice: 25_000, now: T0 }, ctx(), 'wix')).rejects.toThrow();
    expect(product().retailPrice).toBe(20_000);
    expect(wix.writes().filter((w) => w.collection === 'merchandiseProducts')).toEqual([]);
  });
});
