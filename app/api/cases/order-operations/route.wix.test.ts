import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { buildWixServiceCatalogData } from '@/lib/wixServiceCatalogMapper';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { mapWixCaseOrderItem } from '@/lib/wixCaseOrderMapper';
import type { Case } from '@/types/case';
import type { CaseOrder } from '@/types/caseOrder';

/**
 * Interrupted order edits (2026-10, Phase 5A.2) — end to end in
 * DATA_ADAPTER=wix against the in-memory Wix stand-in (fictional rows, no
 * network): the real order route, pricing engine, ledger, payments and
 * activity log, plus the order-operation report and repair routes.
 *
 * A "process crash" is modelled exactly like the service-change journal
 * tests: from the chosen Wix write on, EVERY Wix call fails (nothing the
 * dying process tries afterwards lands — not its own compensation, not its
 * journal) until the test "restarts" the process. The crash is injected
 * before EACH write of a real order edit in turn, so every window between
 * two writes is covered.
 */

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
vi.mock('@/lib/wixDataApi', () => wix.api);

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';
const USER = 'identity-gus-test-admin';

const auth = vi.hoisted(() => ({ organizationId: 'gus-camacho-jr', admin: true }));
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: async (requested: string) =>
    requested === auth.organizationId
      ? { authorized: true, context: { organizationId: auth.organizationId, userId: 'identity-gus-test-admin', role: 'administrator' } }
      : { authorized: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) },
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canEditCase: async () => true,
  canEditCaseOrder: async () => true,
  canReadCaseOrder: async () => true,
  canCollectPayment: async () => true,
  isAdminTier: async () => auth.admin,
}));

const orderRoute = await import('../[caseId]/order/route');
const manualPayment = await import('../[caseId]/payments/manual/route');
const report = await import('./route');
const repair = await import('./[operationId]/route');
const pricing = await import('@/services/pricingService');
const { getAccountByNumber } = await import('@/services/chartOfAccountsService');
const { getAccountBalance } = await import('@/services/generalLedgerService');
const { markCasePaidIfVerified } = await import('@/services/paymentWorkflow');
const { initiateFamilyCheckout } = await import('@/services/portal/portalPaymentService');

const target = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 4)!;
const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
const PRICES: Record<string, number> = { DIRECT_CREMATION: 150_000, CREMATION_WITH_VIEWING: 250_000 };

let v1: CaseOrder;

function wixCaseRow(c: Case): WixCaseItem {
  return {
    beaconCaseId: c.id,
    organizationId: c.organizationId,
    caseNumber: c.caseNumber,
    caseType: c.caseType,
    workflowTemplateId: c.workflowTemplateId,
    workflowTemplateVersion: c.workflowTemplateVersion,
    workflowSnapshot: c.workflowSnapshot,
    currentStage: c.rawStage,
    checklistState: c.checklistState,
    fieldValues: c.fieldValues,
    decedentName: c.decedentName,
    dateOfBirth: c.dateOfBirth ?? '',
    dateOfDeath: c.dateOfDeath ?? '',
    timeOfDeath: c.timeOfDeath ?? '',
    placeOfDeath: c.placeOfDeath ?? '',
    weight: String(c.weight ?? ''),
    nextOfKinName: c.nextOfKinName ?? '',
    nextOfKinPhone: c.nextOfKinPhone ?? '',
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    isArchived: false,
    createdAt: c.createdAt,
  };
}
const storedCase = (): Case => mapWixCaseItem(wix.get('cases', target.id) as WixCaseItem)!;
function orderRows(caseId = target.id): CaseOrder[] {
  return wix.rows('caseOrders', { caseId }).map((r) => mapWixCaseOrderItem(r.data)!).sort((a, b) => a.version - b.version || a.createdAt.localeCompare(b.createdAt));
}
const activeRows = () => orderRows().filter((o) => o.status === 'active');
const lineIds = (orderId: string) => wix.rows('caseOrderLineItems', { caseOrderId: orderId }).map((r) => r.id).sort();
const revenueEntries = (reference?: string) =>
  wix.rows('journalEntries', { caseId: target.id }).filter((r) => r.data.sourceType === 'revenue_recognition' && (reference === undefined || r.data.sourceReferenceId === reference));
function orderJournal() {
  return wix
    .rows('activityEvents', { eventType: 'case.order.operation.journal' })
    .map((r) => JSON.parse(r.data.metadata as string) as { status: string; operationId: string; resolution?: string });
}
/** A fictional payment that settled out of band (e.g. a webhook). */
function seedPayment(id: string, amount: number) {
  wix.seed('paymentRecords', id, {
    beaconPaymentId: id, organizationId: GUS, caseId: target.id, caseOrderId: v1.id, provider: 'manual', providerCheckoutId: id, idempotencyKey: id,
    amount, currency: 'usd', purpose: 'Fictional payment', status: 'succeeded', createdAt: '2026-10-16T15:01:00.000Z', updatedAt: '2026-10-16T15:01:00.000Z',
  });
}
/** The store without collections that only exist because something was
    looked up (an empty collection is no write). */
function nonEmpty(snapshot: Record<string, Record<string, unknown>>) {
  return Object.fromEntries(Object.entries(snapshot).filter(([, rows]) => Object.keys(rows).length > 0));
}
async function receivable(): Promise<number> {
  const account = await getAccountByNumber(GUS, '1200', 'wix');
  return account ? getAccountBalance(GUS, account.id, 'wix') : 0;
}

function request(url: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { origin: 'http://localhost', host: 'localhost', ...(init.headers ?? {}) } });
}
const params = { params: Promise.resolve({ caseId: target.id }) };
async function json(response: Response) {
  return { status: response.status, body: await response.json() };
}
function editOrder(expectedOrderId: string = v1.id, serviceTypeCode = 'CREMATION_WITH_VIEWING') {
  return orderRoute.PATCH(
    request(`http://localhost/api/cases/${target.id}/order`, { method: 'PATCH', body: JSON.stringify({ organizationId: GUS, selections: { serviceTypeCode }, expectedOrderId }) }),
    params,
  );
}
async function getOrder() {
  return json(await orderRoute.GET(request(`http://localhost/api/cases/${target.id}/order?organizationId=${GUS}`), params));
}
async function createOrder() {
  return json(await orderRoute.POST(request(`http://localhost/api/cases/${target.id}/order`, { method: 'POST', body: JSON.stringify({ organizationId: GUS, selections: { serviceTypeCode: 'DIRECT_CREMATION' } }) }), params));
}
async function recordPayment(amountCents = 1_000) {
  return json(
    await manualPayment.POST(
      request(`http://localhost/api/cases/${target.id}/payments/manual`, { method: 'POST', body: JSON.stringify({ organizationId: GUS, method: 'cash', amountCents, idempotencyKey: `pay-${Math.random()}` }) }),
      params,
    ),
  );
}
async function getReport(organizationId = GUS, all = false) {
  return json(await report.GET(request(`http://localhost/api/cases/order-operations?organizationId=${organizationId}${all ? '&all=1' : ''}`)));
}
async function act(operationId: string, action: string, organizationId = GUS) {
  return json(
    await repair.POST(
      request(`http://localhost/api/cases/order-operations/${operationId}`, { method: 'POST', body: JSON.stringify({ organizationId, action, note: 'Fictional repair note' }) }),
      { params: Promise.resolve({ operationId }) },
    ),
  );
}

/** Simulated crash — see the file comment. `crashBeforeWrite(k)`: the
    k-th Wix write (0-based, counted from the call) and everything after it
    fails until restartAfter(). */
let dead = false;
let armed = false;
let writesSeen = 0;
function crashBeforeWrite(k: number) {
  armed = true;
  writesSeen = 0;
  wix.onBeforeOp((op) => {
    if (armed && op.op !== 'query' && op.op !== 'count') {
      if (writesSeen === k) dead = true;
      writesSeen += 1;
    }
    if (dead) throw new Error('process crashed (simulated)');
  });
}
function restartAfter(minutes: number) {
  dead = false;
  armed = false;
  vi.setSystemTime(new Date(Date.now() + minutes * 60_000));
}

async function setup() {
  wix.reset();
  dead = false;
  armed = false;
  for (const item of serviceCatalogFixtures.filter((i) => i.organizationId === GUS)) {
    wix.seed('serviceCatalog', item.id, buildWixServiceCatalogData({ ...item, defaultPrice: PRICES[item.serviceCode] ?? item.defaultPrice }) as Record<string, unknown>);
  }
  wix.seed('cases', target.id, wixCaseRow(target) as Record<string, unknown>);
  wix.seed('cases', manorsCase.id, wixCaseRow(manorsCase) as Record<string, unknown>);
  let n = 0;
  ({ order: v1 } = await pricing.createCaseOrder(
    { organizationId: GUS, caseId: target.id, selections: { serviceTypeCode: 'DIRECT_CREMATION' }, performedBy: USER, idFactory: () => `seed-${++n}` },
    'wix',
  ));
  wix.ops.length = 0;
}

let originalAdapter: string | undefined;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T15:00:00.000Z'));
  originalAdapter = process.env.DATA_ADAPTER;
  process.env.DATA_ADAPTER = 'wix';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  Object.assign(auth, { organizationId: GUS, admin: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await setup();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalAdapter === undefined) delete process.env.DATA_ADAPTER;
  else process.env.DATA_ADAPTER = originalAdapter;
  vi.restoreAllMocks();
});

describe('a successful order edit', () => {
  it('writes the new version pending first, journals every step, and posts its revenue once under its reference', async () => {
    const edited = await json(await editOrder());
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const v2 = edited.body.order as CaseOrder;
    const writes = wix.writes().filter((op) => op.collection === 'caseOrders').map((op) => op.op);
    expect(writes).toEqual(['insert', 'patch', 'patch']); // pending insert, v1 superseded, v2 activated
    expect(orderRows().map((o) => [o.version, o.status, o.total])).toEqual([
      [1, 'superseded', 150_000],
      [2, 'active', 250_000],
    ]);
    expect(orderJournal().filter((e) => e.operationId === v2.id).map((e) => e.status)).toEqual(['prepared', 'activated', 'completed']);
    expect(revenueEntries(`case-order-revenue:${v2.id}`)).toHaveLength(1);
    expect(await receivable()).toBe(250_000);
    expect((await getReport()).body.operations).toEqual([]);
  });

  it('is refused (503, nothing written) when its journal entry cannot be recorded', async () => {
    const before = wix.snapshot();
    wix.failNext('insert', 'activityEvents', 503);
    const response = await json(await editOrder());
    expect(response.status).toBe(503);
    expect(response.body.reason).toBe('journal_unavailable');
    expect(nonEmpty(wix.snapshot())).toEqual(nonEmpty(before));
  });
});

describe('a crash before EACH write of an order edit (simulated)', () => {
  it('never leaves two active versions, never loses billing, locks the case, and is always repairable to one consistent order', async () => {
    // The writes of one successful edit, in order — the crash points.
    await editOrder();
    const writes = wix.writes().map((op) => `${op.op} ${op.collection}`);
    expect(writes.length).toBeGreaterThan(8);

    for (let k = 0; k < writes.length; k++) {
      const at = `crash before write ${k} (${writes[k]})`;
      await setup();
      const v1Before = { ...wix.get('caseOrders', v1.id) };
      const v1Lines = lineIds(v1.id);
      crashBeforeWrite(k);
      await editOrder().catch(() => null);
      restartAfter(6);

      // --- after the crash, before any repair ---
      const rows = orderRows();
      expect(rows.filter((o) => o.status === 'active').length, at).toBeLessThanOrEqual(1);
      // v1's billing is untouched: totals and lines exactly as written.
      for (const key of ['total', 'subtotal', 'balanceDue', 'version', 'organizationId', 'caseId']) {
        expect((wix.get('caseOrders', v1.id) as Record<string, unknown>)[key], `${at}: v1.${key}`).toEqual(v1Before[key]);
      }
      expect(lineIds(v1.id), at).toEqual(v1Lines);
      // The case is never shown as having no order (never $0 owed).
      const shown = await getOrder();
      expect(shown.body.order, at).not.toBeNull();
      expect([150_000, 250_000], at).toContain(shown.body.order.total);

      const pending = rows.find((o) => o.status === 'pending');
      if (pending) {
        // Locked: no edit, no fresh order, no payment.
        expect(shown.body.interruption, at).toMatchObject({ pendingOrderId: pending.id, stale: true });
        const refusedEdit = await json(await editOrder(shown.body.order.id));
        expect(refusedEdit.status, at).toBe(409);
        expect(refusedEdit.body.reason, at).toBe('order_needs_repair');
        expect((await createOrder()).status, at).toBe(409);
        const payment = await recordPayment();
        expect(payment.status, at).toBe(409);
        expect(payment.body.reason, at).toBe('order_needs_repair');
        // AR / reports still count the case, at its effective version, flagged.
        const listed = (await pricing.listActiveCaseOrdersForOrganization(GUS, 'wix')).filter((o) => o.caseId === target.id);
        expect(listed, at).toHaveLength(1);
        expect(listed[0].operationInterrupted, at).toBe(true);
        expect(listed[0].total, at).toBe(shown.body.order.total);
      }

      // --- the report and the repair ---
      const listedOps = (await getReport()).body.operations as Array<{ operationId: string; inspection: { allowedActions: string[]; summary: string } }>;
      // (The seeded first order was journaled too — skip its entries.)
      const prepared = orderJournal().find((e) => e.status === 'prepared' && e.operationId !== v1.id);
      if (!prepared) {
        // Crashed on the journal entry itself: nothing was written at all.
        expect(rows.map((o) => [o.id, o.status]), at).toEqual([[v1.id, 'active']]);
        expect(listedOps, at).toEqual([]);
        continue;
      }
      const opId = prepared.operationId;
      const op = listedOps.find((o) => o.operationId === opId);
      const finishedBeforeCrash = orderJournal().some((e) => e.operationId === opId && e.status === 'completed');
      if (finishedBeforeCrash) {
        expect(op, at).toBeUndefined();
      } else {
        expect(op, at).toBeDefined();
        const actions = op!.inspection.allowedActions;
        expect(actions.length, `${at}: ${op!.inspection.summary}`).toBeGreaterThan(0);
        const action = actions.includes('complete') ? 'complete' : 'close';
        const repaired = await act(opId, action);
        expect(repaired.status, `${at}: ${action} → ${JSON.stringify(repaired.body)}`).toBe(200);
        // Idempotent: the same repair again is refused, writing nothing.
        const snapshot = wix.snapshot();
        expect((await act(opId, action)).status, at).toBe(409);
        expect(wix.snapshot(), at).toEqual(snapshot);
      }

      // --- after repair: one consistent order ---
      const final = orderRows();
      expect(final.filter((o) => o.status === 'active'), at).toHaveLength(1);
      expect(final.filter((o) => o.status === 'pending'), at).toEqual([]);
      const active = final.find((o) => o.status === 'active')!;
      // The ledger matches the order in effect — revenue for each version
      // that took effect, exactly once; none for one that never did.
      expect(await receivable(), at).toBe(active.total);
      // (A crash between a ledger entry and its lines leaves an EMPTY header —
      // no financial effect; the repair posts the revenue once more, so
      // exactly one entry under the reference has lines.)
      if (active.id !== v1.id) expect(revenueEntries(`case-order-revenue:${active.id}`).filter((e) => wix.rows('journalEntryLines', { journalEntryId: e.id }).length > 0), at).toHaveLength(1);
      expect((await getReport()).body.operations, at).toEqual([]);
      // And the case can be edited again normally.
      expect((await json(await editOrder(active.id, active.total === 250_000 ? 'DIRECT_CREMATION' : 'CREMATION_WITH_VIEWING'))).status, at).toBe(200);
    }
  });
});

describe('repair actions', () => {
  /** Crash right after v1 was superseded — the window with NO active row. */
  async function crashBetweenSupersedeAndActivate() {
    await editOrder();
    const writes = wix.writes().map((op) => `${op.op} ${op.collection}`);
    const activateIndex = writes.findIndex((w, i) => w === 'patch caseOrders' && writes.slice(0, i).includes('patch caseOrders'));
    await setup();
    crashBeforeWrite(activateIndex);
    await editOrder().catch(() => null);
    restartAfter(6);
    const pending = orderRows().find((o) => o.status === 'pending')!;
    expect(pending).toBeDefined();
    expect(activeRows()).toEqual([]);
    return pending;
  }

  it('the no-active window: billing resolves to the superseded version, payments are recorded but the case is not marked paid, checkout is refused', async () => {
    const pending = await crashBetweenSupersedeAndActivate();
    const shown = await getOrder();
    expect(shown.body.order).toMatchObject({ id: v1.id, total: 150_000, operationInterrupted: true });

    // A payment that was already under way settles meanwhile: recorded,
    // but the case is not marked paid on a balance that isn't settled.
    seedPayment('pay-fictional-1', 150_000);
    await markCasePaidIfVerified(GUS, target.id, 'wix');
    expect(storedCase().paymentStatus).not.toBe('paid_in_full');
    await expect(
      initiateFamilyCheckout({ organizationId: GUS, caseId: target.id, idempotencyKey: 'k', returnUrl: 'https://example.test/r', cancelUrl: 'https://example.test/c' }, 'wix'),
    ).rejects.toThrow(/temporarily unavailable/);

    const [op] = (await getReport()).body.operations;
    expect(op.operationId).toBe(pending.id);
    expect(op.inspection).toMatchObject({ plannedStatus: 'pending', previousStatus: 'superseded', previousSupersededByPlanned: true, revenue: 'not_posted', allowedActions: ['complete', 'roll_back'] });
  });

  it('complete: the planned version takes effect, its revenue is posted once, the balance reflects payments taken meanwhile', async () => {
    const pending = await crashBetweenSupersedeAndActivate();
    seedPayment('pay-fictional-2', 50_000);
    const done = await act(pending.id, 'complete');
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ resolution: 'completed', revenuePosted: true });
    expect(activeRows().map((o) => o.id)).toEqual([pending.id]);
    expect(revenueEntries(`case-order-revenue:${pending.id}`)).toHaveLength(1);
    expect(await receivable()).toBe(250_000);
    expect(wix.get('caseOrders', pending.id)).toMatchObject({ balanceDue: 250_000 - 50_000 });
    // The audit trail of the change was written by the repair, once.
    expect(wix.rows('caseOrderAuditEntries', { caseOrderId: pending.id }).length).toBeGreaterThan(0);
    const resolved = orderJournal().filter((e) => e.operationId === pending.id && e.status === 'resolved');
    expect(resolved).toEqual([expect.objectContaining({ resolution: 'completed' })]);
    expect(wix.rows('activityEvents', { eventType: 'case.order.operation.journal' }).at(-1)!.data).toMatchObject({ actorIdentityId: USER, organizationId: GUS });
  });

  it('roll_back: the previous version is back in effect, the pending one withdrawn (kept), no revenue', async () => {
    const pending = await crashBetweenSupersedeAndActivate();
    const done = await act(pending.id, 'roll_back');
    expect(done.status).toBe(200);
    expect(orderRows().map((o) => [o.id, o.status])).toEqual([
      [v1.id, 'active'],
      [pending.id, 'withdrawn'],
    ]);
    expect(wix.get('caseOrders', v1.id)).toMatchObject({ total: 150_000, supersededByOrderId: null });
    expect(revenueEntries()).toHaveLength(1); // v1's only
    expect(await receivable()).toBe(150_000);
    expect((await pricing.listCaseOrderVersions(GUS, target.id, 'wix')).map((o) => o.version)).toEqual([1]);
  });

  it('two administrators completing at once: one repair runs, revenue is posted exactly once', async () => {
    const pending = await crashBetweenSupersedeAndActivate();
    const results = await Promise.all([act(pending.id, 'complete'), act(pending.id, 'complete')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(revenueEntries(`case-order-revenue:${pending.id}`)).toHaveLength(1);
    expect(await receivable()).toBe(250_000);
  });

  it('a change that was in effect before the crash but never posted its revenue: complete posts it once; roll_back is not offered', async () => {
    await editOrder();
    const writes = wix.writes().map((op) => `${op.op} ${op.collection}`);
    await setup();
    crashBeforeWrite(writes.indexOf('insert caseOrderAuditEntries'));
    await editOrder().catch(() => null);
    restartAfter(6);
    const v2 = activeRows()[0];
    expect(v2.version).toBe(2);
    expect(await receivable()).toBe(150_000); // v2's delta never posted
    const [op] = (await getReport()).body.operations;
    expect(op.inspection).toMatchObject({ plannedStatus: 'active', revenue: 'not_posted', allowedActions: ['complete'] });
    expect((await act(v2.id, 'roll_back')).status).toBe(409);
    expect((await act(v2.id, 'close')).status).toBe(409);
    expect((await act(v2.id, 'complete')).status).toBe(200);
    expect(await receivable()).toBe(250_000);
  });

  it('an in-flight operation is never offered for repair; a resolved one is never repaired twice', async () => {
    const pending = await crashBetweenSupersedeAndActivate();
    vi.setSystemTime(new Date(Date.now() - 5 * 60_000)); // back to "just now"
    expect((await getReport()).body.operations).toEqual([]);
    expect((await act(pending.id, 'complete')).status).toBe(409);
    // While fresh, an edit is told to retry shortly, not to call an admin.
    const busy = await json(await editOrder(v1.id));
    expect(busy).toMatchObject({ status: 409, body: { reason: 'order_busy' } });
  });
});

describe('ledger entries and compensations cut off part way', () => {
  async function crashAt(predicate: (writes: string[]) => number) {
    await editOrder();
    const writes = wix.writes().map((op) => `${op.op} ${op.collection}`);
    await setup();
    crashBeforeWrite(predicate(writes));
    await editOrder().catch(() => null);
    restartAfter(6);
  }

  it('a revenue entry cut off between its lines whose stored lines no longer match the plan: complete refuses, nothing is written', async () => {
    // Crash before the entry's SECOND line — the AR line is stored alone.
    await crashAt((writes) => writes.lastIndexOf('insert journalEntryLines'));
    const v2 = activeRows()[0];
    const [op] = (await getReport()).body.operations;
    expect(op.inspection).toMatchObject({ plannedStatus: 'active', revenue: 'partial', allowedActions: ['complete'] });
    // Someone altered the stored line since: it is no longer what the
    // entry was meant to post.
    const [line] = wix.rows('journalEntryLines').filter((r) => String(r.data.journalEntryId).length > 0 && revenueEntries(`case-order-revenue:${v2.id}`).some((e) => e.id === r.data.journalEntryId));
    wix.seed('journalEntryLines', line.id, { ...line.data, amount: 1 });
    const before = wix.snapshot();
    const refused = await act(v2.id, 'complete');
    expect(refused.status).toBe(503);
    expect(wix.rows('journalEntryLines')).toEqual(Object.entries(before.journalEntryLines).map(([id, data]) => expect.objectContaining({ id, data })));
    expect((await getReport()).body.operations).toHaveLength(1);
  });

  it('a compensation interrupted while putting its restoring version in effect: the restore is journaled, locked, and completes to the original order (revenue reversed once)', async () => {
    let n = 0;
    const idFactory = () => `restore-test-${++n}`;
    const prepared = await pricing.prepareCaseOrderChange({ organizationId: GUS, caseId: target.id, selections: { serviceTypeCode: 'CREMATION_WITH_VIEWING' }, performedBy: USER, idFactory }, 'wix');
    if (prepared.kind !== 'change') throw new Error('expected a change');
    const committed = await pricing.commitPreparedCaseOrderChange(prepared, { idFactory }, 'wix');
    expect(await receivable()).toBe(250_000);

    // The compensation dies right before activating its restoring version.
    wix.ops.length = 0;
    let caseOrderPatches = 0;
    armed = true;
    wix.onBeforeOp((op) => {
      if (armed && op.op === 'patch' && op.collection === 'caseOrders' && ++caseOrderPatches === 2) dead = true;
      if (dead) throw new Error('process crashed (simulated)');
    });
    await pricing.revertCommittedCaseOrderChange(committed, { idFactory, reason: 'fictional case write failure' }, 'wix').catch(() => null);
    restartAfter(6);

    const restore = orderRows().find((o) => o.status === 'pending')!;
    expect(restore).toMatchObject({ total: 150_000, supersedesOrderId: committed.order.id });
    expect(activeRows()).toEqual([]);
    expect((await getOrder()).body.order).toMatchObject({ id: committed.order.id, operationInterrupted: true });
    const ops = (await getReport()).body.operations as Array<{ operationId: string; details: { kind: string } }>;
    expect(ops.map((o) => [o.operationId, o.details.kind])).toEqual([[restore.id, 'restore']]);
    expect((await act(restore.id, 'complete')).status).toBe(200);
    expect(activeRows().map((o) => [o.id, o.total])).toEqual([[restore.id, 150_000]]);
    expect(await receivable()).toBe(150_000);
    expect(revenueEntries(`case-order-revenue:${restore.id}`)).toHaveLength(1);
    expect((await act(restore.id, 'complete')).status).toBe(409);
  });
});

describe('access', () => {
  it('administrators only; organization-scoped — another organization can neither list nor repair', async () => {
    await editOrder();
    const writes = wix.writes().map((op) => `${op.op} ${op.collection}`);
    await setup();
    crashBeforeWrite(writes.indexOf('insert caseOrders'));
    await editOrder().catch(() => null);
    restartAfter(6);
    const [op] = (await getReport()).body.operations;
    expect(op).toBeDefined();

    auth.admin = false;
    expect((await getReport()).status).toBe(403);
    expect((await act(op.operationId, 'close')).status).toBe(403);

    Object.assign(auth, { organizationId: MANORS, admin: true });
    expect((await getReport(MANORS)).body.operations).toEqual([]);
    expect((await act(op.operationId, 'close', MANORS)).status).toBe(404);
    expect((await getReport(GUS)).status).toBe(403);
  });
});
