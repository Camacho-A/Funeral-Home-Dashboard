import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { mockDefaultUser, mockManagerUser, mockFuneralDirectorUser } from './__mocks__/authFixtures';
import { caseFixtures } from './__mocks__/fixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures, serviceCatalogFixtures } from './__mocks__/pricingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import type { CaseOrder } from '../types/caseOrder';

/**
 * Order recovery (2026-11) — the Manors walkthrough, end to end through the
 * real routes and Manors' real profile (legacy pricing), DATA_ADAPTER=mock,
 * fictional data only:
 *   1. a normal edit;
 *   2. concurrent edits (the stale one is refused, never a second active order);
 *   3. Manors' existing re-pricing on edit, unchanged;
 *   4. an interrupted save (the order locks, billing stays on the last version);
 *   5. recovery — administrators only, own organization only, one repair
 *      even when two run at once, journaled with the administrator, and
 *      payments untouched; editing works again afterwards.
 * docs/ORDER_RECOVERY.md summarizes it.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
vi.mock('./merchandiseService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./merchandiseService')>()),
  listActiveProductsForOrganization: async () => [],
  getVariantById: async () => null,
}));

const orderRoute = await import('@/app/api/cases/[caseId]/order/route');
const report = await import('@/app/api/cases/order-operations/route');
const repair = await import('@/app/api/cases/order-operations/[operationId]/route');
const pricing = await import('./pricingService');
const { recordOrderOperationJournal, listOrderOperations } = await import('./orderOperationJournal');

const ORG = DEFAULT_ORGANIZATION_ID;
const HEADERS = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const BASE = { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, keepsakeTransferQuantity: 0, urnTransfer: false, shipping: false };
const caseId = () => caseFixtures.find((c) => c.organizationId === ORG && !c.isDeleted)!.id;
const as = (user: typeof mockDefaultUser) => {
  mockSession = { user };
};
const rows = (): CaseOrder[] => caseOrderFixtures.filter((o) => o.organizationId === ORG && o.caseId === caseId());
const active = () => rows().filter((o) => o.status === 'active');

const editRequest = (selections: Record<string, unknown>, expectedOrderId?: string) =>
  orderRoute.PATCH(
    new Request(`http://localhost/api/cases/${caseId()}/order`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, selections, ...(expectedOrderId ? { expectedOrderId } : {}) }) }),
    { params: Promise.resolve({ caseId: caseId() }) },
  );
const createRequest = (selections: Record<string, unknown>) =>
  orderRoute.POST(new Request(`http://localhost/api/cases/${caseId()}/order`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId: ORG, selections }) }), {
    params: Promise.resolve({ caseId: caseId() }),
  });
const getOrder = async () =>
  (await orderRoute.GET(new Request(`http://localhost/api/cases/${caseId()}/order?organizationId=${ORG}`), { params: Promise.resolve({ caseId: caseId() }) })).json() as Promise<{
    order: CaseOrder | null;
    interruption: { pendingOrderId: string; stale: boolean } | null;
  }>;
const getReport = (organizationId = ORG, forCase = caseId()) => report.GET(new Request(`http://localhost/api/cases/order-operations?organizationId=${organizationId}&caseId=${encodeURIComponent(forCase)}`));
const postRepair = (operationId: string, action: string, note: string | null = 'Fictional walkthrough', organizationId = ORG) =>
  repair.POST(new Request(`http://localhost/api/cases/order-operations/${operationId}`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ organizationId, action, note }) }), {
    params: Promise.resolve({ operationId }),
  });

const saved = { orders: 0, lines: 0, audit: 0, activity: 0, journal: 0, journalLines: 0, catalog: [] as typeof serviceCatalogFixtures };
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T15:00:00.000Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  as(mockDefaultUser);
  for (const list of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures] as unknown[][]) list.length = 0;
  Object.assign(saved, {
    activity: activityEventFixtures.length,
    journal: journalEntryFixtures.length,
    journalLines: journalEntryLineFixtures.length,
    catalog: structuredClone(serviceCatalogFixtures),
  });
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  for (const list of [caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures] as unknown[][]) list.length = 0;
  activityEventFixtures.length = saved.activity;
  journalEntryFixtures.length = saved.journal;
  journalEntryLineFixtures.length = saved.journalLines;
  serviceCatalogFixtures.splice(0, serviceCatalogFixtures.length, ...saved.catalog);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** What a crash right after "previous version superseded" leaves behind —
    the same state services/orderOperation.mock.test.ts builds. */
async function interruptedSave(v1: CaseOrder) {
  let n = 0;
  const prepared = await pricing.prepareCaseOrderChange(
    { organizationId: ORG, caseId: caseId(), selections: { ...BASE, extraDeathCertificateQuantity: 2 }, performedBy: mockDefaultUser.id, idFactory: () => `walkthrough-${++n}` },
    'mock',
  );
  if (prepared.kind !== 'change') throw new Error('expected a change');
  const ctx = { organizationId: ORG, actorIdentityId: mockDefaultUser.id, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-walkthrough' };
  await recordOrderOperationJournal(ctx, {
    operationId: prepared.newOrder.id,
    caseId: caseId(),
    status: 'prepared',
    details: {
      kind: 'edit', previousOrderId: v1.id, previousVersion: v1.version, plannedOrderId: prepared.newOrder.id, plannedVersion: v1.version + 1, plannedTotal: prepared.newOrder.total,
      serviceDelta: prepared.serviceDelta, merchandiseDelta: prepared.merchandiseDelta, revenueReference: `case-order-revenue:${prepared.newOrder.id}`, auditEntries: prepared.auditEntries,
    },
  }, 'mock');
  caseOrderLineItemFixtures.push(...prepared.newLineItems);
  caseOrderFixtures.push({ ...prepared.newOrder, status: 'pending', supersedesOrderId: v1.id });
  const index = caseOrderFixtures.findIndex((o) => o.id === v1.id);
  caseOrderFixtures[index] = { ...caseOrderFixtures[index], status: 'superseded', supersededByOrderId: prepared.newOrder.id };
  vi.setSystemTime(new Date(Date.now() + 6 * 60_000));
  return prepared.newOrder;
}

describe('Manors order walkthrough', () => {
  it('1–2. a normal edit makes a new version; an edit without its version is refused (428); a stale or concurrent one is refused (409) — never two active orders', async () => {
    expect((await createRequest(BASE)).status).toBe(201);
    const v1 = active()[0];
    expect((await editRequest({ ...BASE, mailCremated: true })).status).toBe(428);
    expect((await editRequest({ ...BASE, mailCremated: true }, v1.id)).status).toBe(200);
    expect(rows().map((o) => [o.version, o.status])).toEqual([[1, 'superseded'], [2, 'active']]);
    const v2 = active()[0];
    expect((await listOrderOperations(ORG, 'mock')).find((o) => o.operationId === v2.id)?.history.map((h) => h.status)).toEqual(['prepared', 'activated', 'completed']);

    // Someone still looking at version 1 saves: refused, nothing written.
    const stale = await editRequest({ ...BASE, urnTransfer: true }, v1.id);
    expect(stale.status).toBe(409);
    expect(rows()).toHaveLength(2);

    // Two people save version 2 at the same moment: exactly one wins.
    const both = await Promise.all([editRequest({ ...BASE, urnTransfer: true }, v2.id), editRequest({ ...BASE, shipping: true }, v2.id)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(active()).toHaveLength(1);
    expect(active()[0].version).toBe(3);
  });

  it("3. Manors' existing pricing is unchanged: an edit re-prices every line at the current catalog price", async () => {
    expect((await createRequest(BASE)).status).toBe(201);
    const v1 = active()[0];
    const line = caseOrderLineItemFixtures.find((l) => l.caseOrderId === v1.id && l.unitPrice > 0)!;
    const item = serviceCatalogFixtures.find((s) => s.organizationId === ORG && s.serviceCode === line.serviceCode)!;
    item.defaultPrice = (item.defaultPrice ?? 0) + 12_345;

    expect((await editRequest({ ...BASE, mailCremated: true }, v1.id)).status).toBe(200);
    const v2 = active()[0];
    const repriced = caseOrderLineItemFixtures.find((l) => l.caseOrderId === v2.id && l.serviceCode === line.serviceCode)!;
    expect(repriced.unitPrice).toBe(item.defaultPrice);
    expect(caseOrderLineItemFixtures.find((l) => l.id === line.id)!.unitPrice).toBe(line.unitPrice); // version 1 keeps its price
  });

  it('4–5. an interrupted save locks the order; only an administrator of Manors recovers it, once, with the repair journaled and payments untouched', async () => {
    expect((await createRequest(BASE)).status).toBe(201);
    const v1 = active()[0];
    const pending = await interruptedSave(v1);
    const paymentsBefore = structuredClone(paymentRecordFixtures);

    // 4. Locked: billing stays on version 1; edits are refused.
    const locked = await getOrder();
    expect(locked.order).toMatchObject({ id: v1.id });
    expect(locked.interruption).toMatchObject({ pendingOrderId: pending.id, stale: true });
    const refused = await editRequest({ ...BASE, shipping: true }, v1.id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ reason: 'order_needs_repair' });

    // 5a. Not an administrator: refused, nothing changes.
    for (const user of [mockManagerUser, mockFuneralDirectorUser]) {
      as(user);
      expect((await getReport()).status).toBe(403);
      expect((await postRepair(pending.id, 'complete')).status).toBe(403);
    }
    as(mockDefaultUser);
    expect(rows().find((o) => o.id === pending.id)!.status).toBe('pending');

    // 5b. Another organization (or another case) never sees it.
    expect((await getReport(GUS_ORGANIZATION_ID)).status).toBe(403);
    expect((await postRepair(pending.id, 'complete', null, GUS_ORGANIZATION_ID)).status).toBe(403);
    const otherCase = caseFixtures.find((c) => c.organizationId === ORG && c.id !== caseId())!.id;
    expect(((await (await getReport(ORG, otherCase)).json()) as { operations: unknown[] }).operations).toEqual([]);

    // 5c. The administrator's report: which change, how things stand, why.
    const listed = (await (await getReport()).json()) as { operations: Array<{ operationId: string; caseId: string; inspection: { allowedActions: string[]; summary: string } }> };
    expect(listed.operations).toHaveLength(1);
    expect(listed.operations[0]).toMatchObject({ operationId: pending.id, caseId: caseId(), inspection: { allowedActions: ['complete', 'roll_back'] } });
    expect(listed.operations[0].inspection.summary).toMatch(/locked/);

    // 5d. Two administrators confirm at the same moment: one repair runs.
    const results = await Promise.all([postRepair(pending.id, 'complete'), postRepair(pending.id, 'complete')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(active().map((o) => o.id)).toEqual([pending.id]);
    expect(rows()).toHaveLength(2);
    expect(journalEntryFixtures.filter((e) => e.sourceReferenceId === `case-order-revenue:${pending.id}`)).toHaveLength(1);
    expect((await postRepair(pending.id, 'complete')).status).toBe(409); // resolved: never repaired twice

    // Journaled with the administrator and the note.
    const op = (await listOrderOperations(ORG, 'mock')).find((o) => o.operationId === pending.id)!;
    expect(op.status).toBe('resolved');
    expect(op.details).toMatchObject({ resolution: 'completed', note: 'Fictional walkthrough' });
    expect(op.history.at(-1)).toMatchObject({ status: 'resolved', actorIdentityId: mockDefaultUser.id });

    // Payments and refunds untouched; editing works again.
    expect(paymentRecordFixtures).toEqual(paymentsBefore);
    expect((await getOrder()).interruption).toBeNull();
    expect((await editRequest({ ...BASE, shipping: true }, pending.id)).status).toBe(200);
  });

  it('5e. roll back instead: the previous version is back in effect, the interrupted one withdrawn and kept, no revenue posted', async () => {
    expect((await createRequest(BASE)).status).toBe(201);
    const v1 = active()[0];
    const pending = await interruptedSave(v1);
    expect((await postRepair(pending.id, 'roll_back')).status).toBe(200);
    expect(rows().map((o) => [o.id, o.status])).toEqual([[v1.id, 'active'], [pending.id, 'withdrawn']]);
    expect(journalEntryFixtures.filter((e) => e.sourceReferenceId === `case-order-revenue:${pending.id}`)).toHaveLength(0);
    expect((await postRepair(pending.id, 'close')).status).toBe(409);
  });
});
