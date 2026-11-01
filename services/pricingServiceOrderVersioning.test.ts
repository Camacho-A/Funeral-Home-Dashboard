import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serviceCatalogFixtures } from './__mocks__/pricingFixtures';
import { buildWixServiceCatalogData } from '../lib/wixServiceCatalogMapper';
import { buildWixCaseOrderData } from '../lib/wixCaseOrderMapper';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { CaseOrder } from '../types/caseOrder';

/**
 * Non-destructive order versioning (2026-10, docs/ORDER_VERSIONING.md) —
 * SIMULATED Wix. An in-memory stand-in for the Wix Data collections that
 * honors what the live API does and nothing more: inserts with a fixed id
 * (a duplicate id fails), field-scoped PATCH conditioned on a filter (HTTP
 * 428 when the condition no longer matches — live-verified for single-item
 * conditional patches, see docs/CASE_CONCURRENCY.md §1), no transactions.
 * The ledger, payments and merchandise lookups are stubbed so these tests
 * isolate the order rows themselves.
 */

type Row = Record<string, unknown>;
const store: Record<string, Record<string, Row>> = {};
const calls = { update: [] as Array<{ collection: string; id: string }>, patch: [] as Array<{ collection: string; id: string; fields: Row; filter: Row }>, insert: [] as Array<{ collection: string; id: string }> };
let failNextOrderInsert = false;
/** When set, every caseOrders conditional patch waits until this many have
    arrived — forces two requests to race for the same version. */
let patchBarrier: { needed: number; arrived: number; release: () => void; ready: Promise<void> } | null = null;

function matches(data: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected !== null && typeof expected === 'object' && '$eq' in (expected as Row)) {
      const value = (expected as Row).$eq;
      return value === null ? data[key] === undefined || data[key] === null : data[key] === value;
    }
    return data[key] === expected;
  });
}

function rows(collection: string, filter: Row = {}) {
  return Object.entries(store[collection] ?? {})
    .filter(([, data]) => matches(data, filter))
    .map(([id, data]) => ({ id, dataCollectionId: collection, data: { ...data } }));
}

vi.mock('../lib/wixDataApi', () => ({
  queryWixDataItems: async (collection: string, options: { filter?: Row; paging?: { limit?: number } } = {}) => {
    const found = rows(collection, options.filter ?? {});
    return { dataItems: options.paging?.limit ? found.slice(0, options.paging.limit) : found };
  },
  queryAllWixDataItems: async (collection: string, filter: Row = {}) => rows(collection, filter),
  insertWixDataItem: async (collection: string, data: Row, id: string) => {
    if (collection === 'caseOrders' && failNextOrderInsert) {
      failNextOrderInsert = false;
      throw new Error('Wix Data request failed (HTTP 500)');
    }
    store[collection] = store[collection] ?? {};
    if (store[collection][id]) throw new Error(`WDE0074: an item with id ${id} already exists`);
    store[collection][id] = { ...data };
    calls.insert.push({ collection, id });
    return { id, dataCollectionId: collection, data: { ...data } };
  },
  updateWixDataItem: async (collection: string, id: string, data: Row) => {
    calls.update.push({ collection, id });
    store[collection][id] = { ...data };
    return { id, dataCollectionId: collection, data };
  },
  conditionalPatchWixDataItemFields: async (collection: string, id: string, fields: Row, condition: { filter: Row }) => {
    if (collection === 'caseOrders' && patchBarrier) {
      const barrier = patchBarrier;
      barrier.arrived += 1;
      if (barrier.arrived >= barrier.needed) barrier.release();
      await barrier.ready;
    }
    calls.patch.push({ collection, id, fields, filter: condition.filter });
    const current = store[collection]?.[id];
    if (!current) return { applied: false, status: 404 };
    if (!matches(current, condition.filter)) return { applied: false, status: 428 };
    store[collection][id] = { ...current, ...fields };
    return { applied: true, dataItem: { id, dataCollectionId: collection, data: { ...store[collection][id] } } };
  },
}));

const journalEntries: Array<{ organizationId: string; caseId: string | undefined; lines: unknown[] }> = [];
vi.mock('./generalLedgerService', () => ({
  createAndPostJournalEntry: async (organizationId: string, params: { caseId?: string; lines: unknown[] }) => {
    journalEntries.push({ organizationId, caseId: params.caseId, lines: params.lines });
    return { entry: { id: `je-${journalEntries.length}`, entryNumber: journalEntries.length } };
  },
}));
vi.mock('./chartOfAccountsService', () => ({
  getAccountByNumber: async (_organizationId: string, accountNumber: string) => ({ id: `acct-${accountNumber}` }),
  seedChartOfAccounts: async () => undefined,
}));
let payments: Array<{ id: string; caseId: string; caseOrderId: string; amount: number; status: string; organizationId: string }> = [];
vi.mock('./paymentsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./paymentsService')>()),
  listPaymentRecordsForCase: async (organizationId: string, caseId: string) =>
    payments.filter((p) => p.organizationId === organizationId && p.caseId === caseId),
}));
vi.mock('./merchandiseService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./merchandiseService')>()),
  listActiveProductsForOrganization: async () => [],
  getVariantById: async () => null,
}));
const recordCaseOrderChanged = vi.fn();
vi.mock('./activityService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./activityService')>()),
  recordCaseOrderChanged: (...args: unknown[]) => recordCaseOrderChanged(...args),
  recordJournalEntryPosted: async () => undefined,
}));

const pricing = await import('./pricingService');
const { createCaseOrder, recalculateOrder, getActiveCaseOrder, listActiveCaseOrdersForOrganization, listCaseOrderVersions, listLineItemsForOrder, CaseOrderConflictError, CaseOrderCommitError, UnpricedCatalogItemError } = pricing;

const ORG = DEFAULT_ORGANIZATION_ID;
const CASE_ID = 'case-versioning-1';
const BASE = { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, keepsakeTransferQuantity: 0, urnTransfer: false, shipping: false };
let nextId = 0;
const idFactory = () => `id-${++nextId}`;
const params = (selections: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  caseId: CASE_ID,
  selections,
  performedBy: 'staff-1',
  idFactory,
  ...extra,
});

function orderRows(organizationId = ORG, caseId = CASE_ID): CaseOrder[] {
  return rows('caseOrders', { organizationId, caseId }).map((r) => r.data as unknown as CaseOrder);
}
function activeRows(organizationId = ORG, caseId = CASE_ID) {
  return rows('caseOrders', { organizationId, caseId, status: 'active' });
}
function seedOrder(order: Partial<CaseOrder> & { id: string }) {
  const full: CaseOrder = {
    organizationId: ORG,
    caseId: CASE_ID,
    status: 'active',
    subtotal: 89_000,
    discountTotal: 0,
    taxTotal: 0,
    total: 89_000,
    balanceDue: 89_000,
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...order,
  };
  store.caseOrders = store.caseOrders ?? {};
  store.caseOrders[`wix-${order.id}`] = buildWixCaseOrderData(full) as Row;
}
function barrier(needed: number) {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  patchBarrier = { needed, arrived: 0, release, ready };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  store.serviceCatalog = Object.fromEntries(
    serviceCatalogFixtures.filter((item) => item.organizationId === ORG).map((item) => [`wix-${item.id}`, buildWixServiceCatalogData(item) as Row]),
  );
  calls.update.length = 0;
  calls.patch.length = 0;
  calls.insert.length = 0;
  journalEntries.length = 0;
  payments = [];
  failNextOrderInsert = false;
  patchBarrier = null;
  nextId = 0;
  recordCaseOrderChanged.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('order edits never rewrite a previous version (simulated Wix)', () => {
  it('supersedes v1 with ONE field-scoped conditional patch — no full replace, totals and lines untouched', async () => {
    const created = await createCaseOrder(params(BASE), 'wix');
    const v1Before = { ...store.caseOrders[`${created.order.id}`] };
    const v1LinesBefore = rows('caseOrderLineItems', { caseOrderId: created.order.id });

    const edited = await recalculateOrder(params({ ...BASE, extraDeathCertificateQuantity: 2 }, { expectedOrderId: created.order.id }), 'wix');
    expect(edited!.order.version).toBe(2);

    // No full-row update of any order row, ever.
    expect(calls.update.filter((c) => c.collection === 'caseOrders')).toEqual([]);
    // v1's own activation (pending → active, Phase 5A.2) is its creation;
    // after that, exactly one patch: status + supersede metadata only,
    // conditioned on still being active.
    const isSupersede = (p: (typeof calls.patch)[number]) => (p.filter.status as Row | undefined)?.$eq === 'active';
    expect(calls.patch.filter((p) => p.collection === 'caseOrders' && p.id === created.order.id && !isSupersede(p)).map((p) => p.fields.status)).toEqual(['active']);
    const v1Patches = calls.patch.filter((p) => p.collection === 'caseOrders' && p.id === created.order.id && isSupersede(p));
    expect(v1Patches).toHaveLength(1);
    expect(Object.keys(v1Patches[0].fields).sort()).toEqual(['status', 'supersededAt', 'supersededByOrderId', 'updatedAt']);
    expect(v1Patches[0].fields).toMatchObject({ status: 'superseded', supersededByOrderId: edited!.order.id });
    expect(v1Patches[0].filter).toMatchObject({ organizationId: { $eq: ORG }, beaconCaseOrderId: { $eq: created.order.id }, status: { $eq: 'active' } });

    // Every other field of v1 is byte-for-byte what was inserted.
    const v1After = store.caseOrders[created.order.id];
    for (const key of Object.keys(v1Before).filter((k) => !['status', 'updatedAt'].includes(k))) expect(v1After[key]).toEqual(v1Before[key]);
    expect(v1After).toMatchObject({ status: 'superseded', total: 89_000, version: 1, supersededByOrderId: edited!.order.id });
    expect(rows('caseOrderLineItems', { caseOrderId: created.order.id })).toEqual(v1LinesBefore);

    // History: both versions readable, exactly one active, audit appended.
    expect((await listCaseOrderVersions(ORG, CASE_ID, 'wix')).map((o) => [o.version, o.status])).toEqual([[2, 'active'], [1, 'superseded']]);
    expect(activeRows()).toHaveLength(1);
    expect(edited!.auditEntries.length).toBeGreaterThan(0);
    expect(recordCaseOrderChanged).toHaveBeenCalledTimes(1);
  });

  it('a stale expectedOrderId is refused before anything is written (CaseOrderConflictError with the current order)', async () => {
    const created = await createCaseOrder(params(BASE), 'wix');
    const v2 = await recalculateOrder(params({ ...BASE, mailCremated: true }, { expectedOrderId: created.order.id }), 'wix');
    const insertsBefore = calls.insert.length;
    const journalBefore = journalEntries.length;

    const stale = recalculateOrder(params({ ...BASE, extraDeathCertificateQuantity: 3 }, { expectedOrderId: created.order.id }), 'wix');
    await expect(stale).rejects.toBeInstanceOf(CaseOrderConflictError);
    await stale.catch((error: InstanceType<typeof CaseOrderConflictError>) => expect(error.current?.id).toBe(v2!.order.id));

    expect(calls.insert.length).toBe(insertsBefore);
    expect(journalEntries.length).toBe(journalBefore);
    expect(orderRows()).toHaveLength(2);
  });
});

describe('concurrent edits (simulated Wix race)', () => {
  it('two staff edits of the same version: exactly one wins, the other is refused and creates no version', async () => {
    const created = await createCaseOrder(params(BASE), 'wix');
    const journalBefore = journalEntries.length;
    barrier(2);

    const results = await Promise.allSettled([
      recalculateOrder(params({ ...BASE, extraDeathCertificateQuantity: 1 }, { expectedOrderId: created.order.id }), 'wix'),
      recalculateOrder(params({ ...BASE, mailCremated: true }, { expectedOrderId: created.order.id }), 'wix'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(CaseOrderConflictError);

    // Both requests passed the pre-check and reached the compare-and-swap on
    // v1; the store let exactly one through (the other got HTTP 428).
    expect(calls.patch.filter((p) => p.collection === 'caseOrders' && p.id === created.order.id && (p.filter.status as Row | undefined)?.$eq === 'active')).toHaveLength(2);
    // No orphan VERSION: the loser's own row (written pending, Phase 5A.2)
    // was withdrawn — kept as history, never a version, never billed.
    expect((await listCaseOrderVersions(ORG, CASE_ID, 'wix')).map((o) => o.version).sort()).toEqual([1, 2]);
    expect(orderRows().filter((o) => o.status === 'withdrawn')).toHaveLength(1);
    expect(orderRows().filter((o) => o.status === 'pending')).toEqual([]);
    expect(activeRows()).toHaveLength(1);
    expect(journalEntries.length - journalBefore).toBe(1); // only the winner posted revenue
    expect(recordCaseOrderChanged).toHaveBeenCalledTimes(1);
  });

  it('two server-side (unpinned) changes both apply in turn — v2 then v3, never two v2s', async () => {
    await createCaseOrder(params(BASE), 'wix');
    barrier(2);
    const results = await Promise.all([
      recalculateOrder(params({ ...BASE, extraDeathCertificateQuantity: 1 }), 'wix'),
      recalculateOrder(params({ ...BASE, mailCremated: true }), 'wix'),
    ]);
    expect(results.map((r) => r!.order.version).sort()).toEqual([2, 3]);
    expect(new Set(orderRows().map((o) => o.version)).size).toBe(3);
    expect(activeRows()).toHaveLength(1);
  });

  it('two first-order creations racing for one case: exactly one active order stands, the loser posts no revenue', async () => {
    const results = await Promise.allSettled([createCaseOrder(params(BASE), 'wix'), createCaseOrder(params({ ...BASE, mailCremated: true }), 'wix')]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(CaseOrderCommitError);
      expect((r.reason as InstanceType<typeof CaseOrderCommitError>).conflict).toBe(true);
    }
    expect(activeRows().length).toBeLessThanOrEqual(1);
    expect(journalEntries).toHaveLength(results.length - rejected.length);
    // A retry after a both-withdrew outcome creates the order cleanly.
    if (activeRows().length === 0) {
      await createCaseOrder(params(BASE), 'wix');
      expect(activeRows()).toHaveLength(1);
    }
  });
});

describe('retries never duplicate a version', () => {
  it('a retry pinned to the old version after the edit landed is refused, writing nothing', async () => {
    const created = await createCaseOrder(params(BASE), 'wix');
    const edit = params({ ...BASE, mailCremated: true }, { expectedOrderId: created.order.id });
    await recalculateOrder(edit, 'wix');
    const rowsBefore = orderRows().length;
    await expect(recalculateOrder(edit, 'wix')).rejects.toBeInstanceOf(CaseOrderConflictError);
    expect(orderRows()).toHaveLength(rowsBefore);
  });

  it('a retry of the same selections against the new version is a no-op (no version, no audit, no revenue)', async () => {
    const created = await createCaseOrder(params(BASE), 'wix');
    const first = await recalculateOrder(params({ ...BASE, mailCremated: true }, { expectedOrderId: created.order.id }), 'wix');
    const journalBefore = journalEntries.length;
    const again = await recalculateOrder(params({ ...BASE, mailCremated: true }, { expectedOrderId: first!.order.id }), 'wix');
    expect(again!.order.id).toBe(first!.order.id);
    expect(again!.auditEntries).toEqual([]);
    expect(orderRows()).toHaveLength(2);
    expect(journalEntries.length).toBe(journalBefore);
  });
});

describe('failure and compensation', () => {
  it('when the new version cannot be inserted, the previous version is never touched (Phase 5A.2: the new version is written before anything is superseded)', async () => {
    const created = await createCaseOrder(params(BASE), 'wix');
    const patchesBefore = calls.patch.length;
    failNextOrderInsert = true;
    const attempt = recalculateOrder(params({ ...BASE, mailCremated: true }, { expectedOrderId: created.order.id }), 'wix');
    await expect(attempt).rejects.toBeInstanceOf(CaseOrderCommitError);
    await attempt.catch((error: InstanceType<typeof CaseOrderCommitError>) => expect(error.compensated).toBe(true));
    const active = await getActiveCaseOrder(ORG, CASE_ID, 'wix');
    expect(active?.id).toBe(created.order.id);
    expect(store.caseOrders[created.order.id]).toMatchObject({ status: 'active', total: 89_000 });
    expect(store.caseOrders[created.order.id].supersededByOrderId).toBeUndefined();
    expect(calls.patch.slice(patchesBefore).filter((p) => p.collection === 'caseOrders')).toEqual([]);
    expect(orderRows()).toHaveLength(1);
  });

  it('an unpriced selection is refused before any write', async () => {
    const created = await createCaseOrder(params(BASE), 'wix');
    const mail = Object.entries(store.serviceCatalog).find(([, row]) => row.serviceCode === 'MAIL_CREMATED_REMAINS')!;
    store.serviceCatalog[mail[0]] = { ...mail[1], defaultPrice: null };
    const insertsBefore = calls.insert.length;
    const patchesBefore = calls.patch.length;
    await expect(recalculateOrder(params({ ...BASE, mailCremated: true }, { expectedOrderId: created.order.id }), 'wix')).rejects.toBeInstanceOf(UnpricedCatalogItemError);
    expect(calls.insert.length).toBe(insertsBefore);
    expect(calls.patch.slice(patchesBefore).filter((p) => p.collection === 'caseOrders')).toEqual([]);
  });
});

describe('the active version is unambiguous', () => {
  it('legacy data with two active rows resolves to the highest version, logs the ambiguity, and reports count it once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    seedOrder({ id: 'legacy-v1', version: 1, total: 50_000, balanceDue: 50_000 });
    seedOrder({ id: 'legacy-v2', version: 2, total: 60_000, balanceDue: 60_000, createdAt: '2026-10-02T10:00:00.000Z' });

    expect((await getActiveCaseOrder(ORG, CASE_ID, 'wix'))?.id).toBe('legacy-v2');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 active order rows'));
    const orgWide = await listActiveCaseOrdersForOrganization(ORG, 'wix');
    expect(orgWide.filter((o) => o.caseId === CASE_ID).map((o) => o.id)).toEqual(['legacy-v2']);
    // Ties on version fall back to the earliest createdAt, then the id — never query order.
    seedOrder({ id: 'tie-b', caseId: 'case-tie', version: 3, createdAt: '2026-10-03T10:00:00.000Z' });
    seedOrder({ id: 'tie-a', caseId: 'case-tie', version: 3, createdAt: '2026-10-03T10:00:00.000Z' });
    expect((await getActiveCaseOrder(ORG, 'case-tie', 'wix'))?.id).toBe('tie-a');
  });

  it("is organization-scoped: another organization's active row for the same caseId is never returned or superseded", async () => {
    seedOrder({ id: 'other-org-order', organizationId: SECOND_MOCK_ORGANIZATION_ID, version: 7 });
    expect(await getActiveCaseOrder(ORG, CASE_ID, 'wix')).toBeNull();
    const created = await createCaseOrder(params(BASE), 'wix');
    expect(created.order.version).toBe(1); // the other org's history never counts
    await recalculateOrder(params({ ...BASE, mailCremated: true }, { expectedOrderId: created.order.id }), 'wix');
    expect(store.caseOrders['wix-other-org-order']).toMatchObject({ status: 'active', version: 7 });
    expect(calls.patch.some((p) => p.id === 'wix-other-org-order')).toBe(false);
  });

  it('a new order for a case whose versions were all superseded continues the numbering (never a second v1)', async () => {
    seedOrder({ id: 'old-v1', version: 1, status: 'superseded' });
    seedOrder({ id: 'old-v2', version: 2, status: 'superseded' });
    const created = await createCaseOrder(params(BASE), 'wix');
    expect(created.order.version).toBe(3);
  });
});

describe('payments and balances keep their references', () => {
  it('a payment made against v1 still points at v1 and still counts toward v2’s balance; v1’s own totals never change', async () => {
    const created = await createCaseOrder(params(BASE), 'wix');
    payments = [{ id: 'pay-1', organizationId: ORG, caseId: CASE_ID, caseOrderId: created.order.id, amount: 20_000, status: 'succeeded' }];
    const v2 = await recalculateOrder(params({ ...BASE, mailCremated: true }, { expectedOrderId: created.order.id }), 'wix');
    expect(v2!.order.balanceDue).toBe(v2!.order.total - 20_000);
    expect(payments[0].caseOrderId).toBe(created.order.id);
    expect(store.caseOrders[created.order.id]).toMatchObject({ total: 89_000, balanceDue: 89_000 });
    expect((await listLineItemsForOrder(ORG, created.order.id, 'wix')).length).toBeGreaterThan(0);
  });
});
