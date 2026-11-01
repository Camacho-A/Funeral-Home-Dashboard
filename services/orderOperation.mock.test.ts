import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { CaseOrder } from '../types/caseOrder';

/**
 * Interrupted order edits (2026-10, Phase 5A.2) — DATA_ADAPTER=mock. The
 * same write order, lock and repair semantics as the Wix path, against the
 * in-memory fixtures (fictional data). The interrupted state is built the
 * way a crash leaves it: the operation journaled `prepared`, its version
 * written `pending`, the version it replaces superseded — and nothing more.
 */

vi.mock('./merchandiseService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./merchandiseService')>()),
  listActiveProductsForOrganization: async () => [],
  getVariantById: async () => null,
}));

const pricing = await import('./pricingService');
const { recordOrderOperationJournal, listOrderOperations } = await import('./orderOperationJournal');
const { inspectOrderOperation, completeOrderOperation, rollBackOrderOperation } = await import('./orderOperationRepair');

const ORG = DEFAULT_ORGANIZATION_ID;
const CASE_ID = 'case-order-operation-mock-1';
const BASE = { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false, keepsakeTransferQuantity: 0, urnTransfer: false, shipping: false };
let n = 0;
const idFactory = () => `mock-op-${++n}`;
const ctx = { organizationId: ORG, actorIdentityId: 'identity-fictional-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' };

const lengths = {
  orders: 0,
  lines: 0,
  audit: 0,
  activity: 0,
  journal: 0,
  journalLines: 0,
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T15:00:00.000Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(lengths, {
    orders: caseOrderFixtures.length,
    lines: caseOrderLineItemFixtures.length,
    audit: caseOrderAuditFixtures.length,
    activity: activityEventFixtures.length,
    journal: journalEntryFixtures.length,
    journalLines: journalEntryLineFixtures.length,
  });
});
afterEach(() => {
  caseOrderFixtures.length = lengths.orders;
  caseOrderLineItemFixtures.length = lengths.lines;
  caseOrderAuditFixtures.length = lengths.audit;
  activityEventFixtures.length = lengths.activity;
  journalEntryFixtures.length = lengths.journal;
  journalEntryLineFixtures.length = lengths.journalLines;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const rows = (): CaseOrder[] => caseOrderFixtures.filter((o) => o.organizationId === ORG && o.caseId === CASE_ID);

/** What a crash right after "previous version superseded" leaves behind. */
async function interruptedEdit(v1: CaseOrder) {
  const prepared = await pricing.prepareCaseOrderChange({ organizationId: ORG, caseId: CASE_ID, selections: { ...BASE, extraDeathCertificateQuantity: 2 }, performedBy: 'identity-fictional-admin', idFactory }, 'mock');
  if (prepared.kind !== 'change') throw new Error('expected a change');
  await recordOrderOperationJournal(
    ctx,
    {
      operationId: prepared.newOrder.id,
      caseId: CASE_ID,
      status: 'prepared',
      details: {
        kind: 'edit',
        previousOrderId: v1.id,
        previousVersion: 1,
        plannedOrderId: prepared.newOrder.id,
        plannedVersion: 2,
        plannedTotal: prepared.newOrder.total,
        serviceDelta: prepared.serviceDelta,
        merchandiseDelta: prepared.merchandiseDelta,
        revenueReference: `case-order-revenue:${prepared.newOrder.id}`,
        auditEntries: prepared.auditEntries,
      },
    },
    'mock',
  );
  caseOrderLineItemFixtures.push(...prepared.newLineItems);
  caseOrderFixtures.push({ ...prepared.newOrder, status: 'pending', supersedesOrderId: v1.id });
  const index = caseOrderFixtures.findIndex((o) => o.id === v1.id);
  caseOrderFixtures[index] = { ...caseOrderFixtures[index], status: 'superseded', supersededByOrderId: prepared.newOrder.id };
  vi.setSystemTime(new Date(Date.now() + 6 * 60_000));
  return prepared;
}

describe('order operations in mock mode', () => {
  it('a normal edit journals prepared → activated → completed and leaves no pending row', async () => {
    const created = await pricing.createCaseOrder({ organizationId: ORG, caseId: CASE_ID, selections: BASE, performedBy: 'identity-fictional-admin', idFactory }, 'mock');
    const edited = await pricing.recalculateOrder({ organizationId: ORG, caseId: CASE_ID, selections: { ...BASE, mailCremated: true }, performedBy: 'identity-fictional-admin', idFactory, expectedOrderId: created.order.id }, 'mock');
    expect(rows().map((o) => [o.version, o.status])).toEqual([
      [1, 'superseded'],
      [2, 'active'],
    ]);
    const ops = await listOrderOperations(ORG, 'mock');
    expect(ops.find((o) => o.operationId === edited!.order.id)?.history.map((h) => h.status)).toEqual(['prepared', 'activated', 'completed']);
  });

  it('an interrupted edit locks the order, keeps billing on the superseded version, and is never visible to another organization', async () => {
    const { order: v1 } = await pricing.createCaseOrder({ organizationId: ORG, caseId: CASE_ID, selections: BASE, performedBy: 'identity-fictional-admin', idFactory }, 'mock');
    const prepared = await interruptedEdit(v1);

    const state = await pricing.getCaseOrderState(ORG, CASE_ID, 'mock');
    expect(state.active).toBeNull();
    expect(state.effective).toMatchObject({ id: v1.id, operationInterrupted: true });
    expect(state.interruption).toMatchObject({ pendingOrderId: prepared.newOrder.id, previousOrderId: v1.id, stale: true });
    await expect(pricing.recalculateOrder({ organizationId: ORG, caseId: CASE_ID, selections: BASE, performedBy: 'x', idFactory, expectedOrderId: v1.id }, 'mock')).rejects.toBeInstanceOf(pricing.CaseOrderInterruptedError);
    await expect(pricing.createCaseOrder({ organizationId: ORG, caseId: CASE_ID, selections: BASE, performedBy: 'x', idFactory }, 'mock')).rejects.toBeInstanceOf(pricing.CaseOrderInterruptedError);
    expect((await pricing.listActiveCaseOrdersForOrganization(ORG, 'mock')).find((o) => o.caseId === CASE_ID)).toMatchObject({ id: v1.id, operationInterrupted: true });
    expect((await pricing.listCaseOrderVersions(ORG, CASE_ID, 'mock')).map((o) => o.id)).toEqual([v1.id]);

    expect((await listOrderOperations(SECOND_MOCK_ORGANIZATION_ID, 'mock')).find((o) => o.caseId === CASE_ID)).toBeUndefined();
    expect(await pricing.getCaseOrderState(SECOND_MOCK_ORGANIZATION_ID, CASE_ID, 'mock')).toEqual({ active: null, effective: null, interruption: null });
  });

  it('complete and roll_back repair it in mock mode exactly like Wix', async () => {
    const { order: v1 } = await pricing.createCaseOrder({ organizationId: ORG, caseId: CASE_ID, selections: BASE, performedBy: 'identity-fictional-admin', idFactory }, 'mock');
    const prepared = await interruptedEdit(v1);
    const op = (await listOrderOperations(ORG, 'mock')).find((o) => o.operationId === prepared.newOrder.id)!;
    expect((await inspectOrderOperation(op, 'mock')).allowedActions).toEqual(['complete', 'roll_back']);

    const rolledBack = await rollBackOrderOperation(op, ctx, null, 'mock');
    expect(rolledBack.status).toBe(200);
    expect(rows().map((o) => [o.id, o.status])).toEqual([
      [v1.id, 'active'],
      [prepared.newOrder.id, 'withdrawn'],
    ]);

    const second = await interruptedEdit({ ...v1, status: 'active' });
    const op2 = (await listOrderOperations(ORG, 'mock')).find((o) => o.operationId === second.newOrder.id)!;
    const completed = await completeOrderOperation(op2, ctx, 'fictional', 'mock');
    expect(completed.status).toBe(200);
    expect(rows().filter((o) => o.status === 'active').map((o) => o.id)).toEqual([second.newOrder.id]);
    expect(journalEntryFixtures.filter((e) => e.sourceReferenceId === `case-order-revenue:${second.newOrder.id}`)).toHaveLength(1);
  });
});
