import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { buildWixServiceCatalogData } from '@/lib/wixServiceCatalogMapper';
import { buildWixWorkflowTemplateData, buildWixWorkflowTemplateVersionData } from '@/lib/wixWorkflowTemplateMapper';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { mapWixCaseOrderItem } from '@/lib/wixCaseOrderMapper';
import { findStageByRawStage } from '@/domain/workflow/resolveStages';
import type { Case } from '@/types/case';
import type { CaseOrder } from '@/types/caseOrder';

/**
 * Case concurrency (2026-10) — the service change OPERATION JOURNAL, the
 * read-only interrupted-operations report and the administrator's explicit
 * repairs, end to end in DATA_ADAPTER=wix against the in-memory Wix
 * stand-in (fictional rows, no network): the real service-change route,
 * service, pricing engine, ledger and activity log. A "process crash" is
 * modelled by making every Wix call fail from the moment the case patch
 * is attempted until the test "restarts" the process.
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
  isAdminTier: async () => auth.admin,
}));

const serviceChange = await import('../[caseId]/service-change/route');
const report = await import('./route');
const repair = await import('./[serviceChangeId]/route');
const { createCaseOrder } = await import('@/services/pricingService');

const target = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 4)!;
const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
const KEY = 'svc-change-journal-1';

let initialOrder: CaseOrder;

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
const caseRow = (id = target.id) => wix.get('cases', id) as WixCaseItem;
const storedCase = (id = target.id): Case => mapWixCaseItem(caseRow(id))!;
function caseOrders(): CaseOrder[] {
  return wix.rows('caseOrders', { caseId: target.id }).map((r) => mapWixCaseOrderItem(r.data)!).sort((a, b) => a.version - b.version);
}
function journal() {
  return wix
    .rows('activityEvents', { eventType: 'case.service_change.journal' })
    .map((r) => JSON.parse(r.data.metadata as string) as { status: string; serviceChangeId: string });
}

function request(url: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { origin: 'http://localhost', host: 'localhost', ...(init.headers ?? {}) } });
}
function change(extra: Record<string, unknown> = {}) {
  return serviceChange.POST(
    request(`http://localhost/api/cases/${target.id}/service-change`, {
      method: 'POST',
      body: JSON.stringify({
        organizationId: GUS,
        serviceTypeCode: 'CREMATION_WITH_VIEWING',
        expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
        expectedOrderId: initialOrder.id,
        selections: { serviceTypeCode: 'CREMATION_WITH_VIEWING' },
        confirm: true,
        idempotencyKey: KEY,
        expectedRevision: ((wix.get('cases', target.id) as { revision?: unknown } | undefined)?.revision as number | undefined ?? 0),
        ...extra,
      }),
    }),
    { params: Promise.resolve({ caseId: target.id }) },
  );
}
async function getReport(organizationId = GUS, all = false) {
  const response = await report.GET(request(`http://localhost/api/cases/service-change-operations?organizationId=${organizationId}${all ? '&all=1' : ''}`));
  return { status: response.status, body: await response.json() };
}
async function act(action: string, organizationId = GUS, id = KEY) {
  const response = await repair.POST(
    request(`http://localhost/api/cases/service-change-operations/${id}`, { method: 'POST', body: JSON.stringify({ organizationId, action, note: 'Fictional repair note' }) }),
    { params: Promise.resolve({ serviceChangeId: id }) },
  );
  return { status: response.status, body: await response.json() };
}

/** A simulated process crash: once `crashWhen` matches an operation,
    every Wix call fails until `restartAfter()` — which also disarms it, so
    the restarted process runs normally. */
let dead = false;
let armed = false;
function crashWhen(predicate: (op: { op: string; collection: string }) => boolean) {
  armed = true;
  wix.onBeforeOp((op) => {
    if (armed && predicate(op)) dead = true;
    if (dead) throw new Error('process crashed (simulated)');
  });
}
function crashAtCasePatch() {
  crashWhen((op) => op.op === 'patch' && op.collection === 'cases');
}
function restartAfter(minutes: number) {
  dead = false;
  armed = false;
  vi.setSystemTime(new Date(Date.now() + minutes * 60_000));
}

let originalAdapter: string | undefined;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T15:00:00.000Z'));
  originalAdapter = process.env.DATA_ADAPTER;
  process.env.DATA_ADAPTER = 'wix';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  Object.assign(auth, { organizationId: GUS, admin: true });
  dead = false;
  armed = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  wix.reset();

  for (const template of workflowTemplateFixtures.filter((t) => t.organizationId === GUS)) {
    wix.seed('workflowTemplates', template.id, buildWixWorkflowTemplateData(template) as Record<string, unknown>);
    for (const version of template.versions) {
      const approved = template.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING') ? 'approved' : version.status;
      wix.seed('workflowTemplateVersions', `${template.id}-v${version.version}`, buildWixWorkflowTemplateVersionData({ beaconTemplateId: template.id, ...version, status: approved }) as Record<string, unknown>);
    }
  }
  const prices: Record<string, number> = { DIRECT_CREMATION: 150_000, CREMATION_WITH_VIEWING: 250_000 };
  for (const item of serviceCatalogFixtures.filter((i) => i.organizationId === GUS)) {
    wix.seed('serviceCatalog', item.id, buildWixServiceCatalogData({ ...item, defaultPrice: prices[item.serviceCode] ?? item.defaultPrice }) as Record<string, unknown>);
  }
  wix.seed('cases', target.id, wixCaseRow(target) as Record<string, unknown>);
  wix.seed('cases', manorsCase.id, wixCaseRow(manorsCase) as Record<string, unknown>);
  let n = 0;
  ({ order: initialOrder } = await createCaseOrder(
    { organizationId: GUS, caseId: target.id, selections: { serviceTypeCode: 'DIRECT_CREMATION' }, performedBy: USER, idFactory: () => `seed-${++n}` },
    'wix',
  ));
  wix.ops.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  if (originalAdapter === undefined) delete process.env.DATA_ADAPTER;
  else process.env.DATA_ADAPTER = originalAdapter;
  vi.restoreAllMocks();
});

describe('journal — every step of a service change', () => {
  it('a successful change journals prepared → order_committed → case_committed (system category, off the case timeline)', async () => {
    expect((await change()).status).toBe(200);
    expect(journal().map((e) => e.status)).toEqual(['prepared', 'order_committed', 'case_committed']);
    const prepared = wix.rows('activityEvents', { eventType: 'case.service_change.journal' })[0].data;
    expect(prepared).toMatchObject({ category: 'system', caseId: null, organizationId: GUS, resourceId: KEY });
    expect(JSON.parse(prepared.metadata as string)).toMatchObject({
      caseId: target.id,
      previousOrderId: initialOrder.id,
      expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
      toServiceTypeCode: 'CREMATION_WITH_VIEWING',
      serviceDelta: 100_000,
    });
    expect((await getReport()).body.operations).toEqual([]);
  });

  it('if the journal cannot be written, the change is refused (503) and NOTHING is written', async () => {
    wix.failNext('insert', 'activityEvents', 503);
    const nonEmpty = (snapshot: Record<string, Record<string, unknown>>) => Object.fromEntries(Object.entries(snapshot).filter(([, rows]) => Object.keys(rows).length > 0));
    const before = nonEmpty(wix.snapshot());
    const response = await change();
    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe('journal_unavailable');
    expect(nonEmpty(wix.snapshot())).toEqual(before);
    expect(wix.writes().filter((op) => op.op !== 'insert' || op.collection !== 'activityEvents')).toEqual([]);
  });

  it('a concurrent checklist tick between plan and case write is detected by the revision (409), the order is compensated and the tick is kept', async () => {
    const stage = findStageByRawStage(target.workflowSnapshot!, target.rawStage)!;
    const key = `${stage.displayStage}:${stage.checklist.items[0].index}`;
    let raced = false;
    wix.onBeforeOp((op) => {
      if (!raced && op.op === 'patch' && op.collection === 'cases') {
        raced = true;
        const current = caseRow();
        wix.seed('cases', target.id, { ...current, checklistState: { ...(current.checklistState as object), [key]: !(current.checklistState as Record<string, boolean>)[key] }, revision: 1 });
      }
    });
    const tickedTo = !(caseRow().checklistState as Record<string, boolean>)[key];
    const response = await change();
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe('stale_case');
    expect((caseRow().checklistState as Record<string, boolean>)[key]).toBe(tickedTo);
    expect(storedCase().workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    expect(caseOrders().map((o) => o.status)).toEqual(['superseded', 'superseded', 'active']);
    expect(journal().map((e) => e.status)).toEqual(['prepared', 'order_committed', 'compensated']);
  });
});

describe('interrupted operations — report and explicit repair', () => {
  async function interruptAfterOrderCommit() {
    crashAtCasePatch();
    await change();
    restartAfter(10);
    wix.ops.length = 0;
  }

  it('a crash between the order and the case write is FOUND after a restart, with what is safe to do', async () => {
    await interruptAfterOrderCommit();
    expect(journal().map((e) => e.status)).toEqual(['prepared', 'order_committed']);

    const { status, body } = await getReport();
    expect(status).toBe(200);
    expect(body.operations).toHaveLength(1);
    const [op] = body.operations;
    expect(op).toMatchObject({ serviceChangeId: KEY, caseId: target.id, status: 'order_committed', interrupted: true });
    expect(op.inspection).toMatchObject({ caseCommitted: false, activeOrderIs: 'planned', allowedActions: ['complete', 'compensate'] });
    // Read-only.
    expect(wix.writes()).toEqual([]);
  });

  it('an operation still in flight (under the grace period) is neither listed nor repairable', async () => {
    crashAtCasePatch();
    await change();
    dead = false;
    expect((await getReport()).body.operations).toEqual([]);
    expect((await act('complete')).status).toBe(409);
  });

  it('complete: finishes the change with NO second order version and NO second revenue entry', async () => {
    await interruptAfterOrderCommit();
    const ordersBefore = caseOrders();
    const journalEntriesBefore = wix.rows('journalEntries', { caseId: target.id }).length;
    const { status, body } = await act('complete');
    expect(status).toBe(200);
    expect(body).toMatchObject({ applied: true, serviceChangeId: KEY });
    expect(storedCase().workflowHistory?.some((entry) => entry.serviceChangeId === KEY)).toBe(true);
    expect(storedCase().workflowSnapshot?.serviceTypeCode).toBe('CREMATION_WITH_VIEWING');
    expect(caseOrders()).toEqual(ordersBefore);
    expect(wix.rows('journalEntries', { caseId: target.id }).length).toBe(journalEntriesBefore);
    expect(journal().at(-1)?.status).toBe('resolved');
    expect((await getReport()).body.operations).toEqual([]);
    // Retrying the repair is harmless: it is no longer interrupted.
    expect((await act('complete')).status).toBe(409);
  });

  it('compensate: appends a restoring order version and reverses the revenue; the case keeps its workflow and checklist', async () => {
    await interruptAfterOrderCommit();
    const checklistBefore = caseRow().checklistState;
    const { status, body } = await act('compensate');
    expect(status).toBe(200);
    expect(body.compensated).toBe(true);
    const orders = caseOrders();
    expect(orders.map((o) => [o.version, o.status, o.total])).toEqual([
      [1, 'superseded', 150_000],
      [2, 'superseded', 250_000],
      [3, 'active', 150_000],
    ]);
    expect(storedCase().workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    expect(caseRow().checklistState).toEqual(checklistBefore);
    expect(wix.rows('journalEntries', { caseId: target.id })).toHaveLength(3);
    expect(journal().slice(-2).map((e) => e.status)).toEqual(['compensated', 'resolved']);
    expect(wix.rows('activityEvents', { eventType: 'case.service_change.compensated', caseId: target.id })).toHaveLength(1);
    // A second compensate is refused — nothing to undo twice.
    expect((await act('compensate')).status).toBe(409);
    expect(caseOrders()).toHaveLength(3);
  });

  it('journal cut off before order_committed: the ledger (Phase 5A.2 revenue reference) says revenue was NOT posted, so compensate reverses nothing', async () => {
    // Crash right after the order's new version is put in effect — before
    // its revenue was posted and before order_committed could be journaled.
    crashWhen((op) => op.op === 'insert' && op.collection === 'activityEvents' && journal().length === 1 && wix.rows('caseOrders', { caseId: target.id }).length === 2);
    await change();
    restartAfter(10);
    expect(journal().map((e) => e.status)).toEqual(['prepared']);
    const ledgerBefore = wix.rows('journalEntries', { caseId: target.id }).length;
    const [op] = (await getReport()).body.operations;
    expect(op.inspection.activeOrderIs).toBe('planned');
    // Before 5A.2 this was refused as `revenue_unknown`: the revenue entry
    // carried no reference. Now the order operation's own reference proves
    // it was never posted — so nothing is reversed.
    const compensated = await act('compensate');
    expect(compensated.status).toBe(200);
    expect(wix.rows('journalEntries', { caseId: target.id })).toHaveLength(ledgerBefore);
    expect(caseOrders().filter((o) => o.status === 'active')).toHaveLength(1);
  });

  it('Phase 5A.2: a change whose ORDER half was cut off (new version pending) offers no service-change repair until the order operation is repaired', async () => {
    let caseOrderPatches = 0;
    // Crash right before the new order version is activated (v1 already superseded).
    crashWhen((op) => op.op === 'patch' && op.collection === 'caseOrders' && ++caseOrderPatches === 2);
    await change();
    restartAfter(10);
    expect(caseOrders().map((o) => o.status)).toEqual(['superseded', 'pending']);
    const [op] = (await getReport()).body.operations;
    expect(op.inspection.allowedActions).toEqual([]);
    expect(op.inspection.summary).toMatch(/order-operations/);
    expect((await act('complete')).status).toBe(409);
    expect((await act('compensate')).status).toBe(409);
    expect(caseOrders().map((o) => o.status)).toEqual(['superseded', 'pending']);
  });

  it('a change that crashed before ANY write: nothing to undo — complete or close only', async () => {
    crashWhen((op) => op.op === 'insert' && op.collection === 'caseOrderLineItems');
    await change();
    restartAfter(10);
    const [op] = (await getReport()).body.operations;
    expect(op.inspection).toMatchObject({ activeOrderIs: 'previous', allowedActions: ['complete', 'close'] });
    expect((await act('compensate')).status).toBe(409);
    const closed = await act('close');
    expect(closed.status).toBe(200);
    expect(journal().at(-1)).toMatchObject({ status: 'resolved', resolution: 'closed', note: 'Fictional repair note' });
  });

  it("if the order was edited by someone else since, no automatic repair is offered", async () => {
    await interruptAfterOrderCommit();
    const [active] = wix.rows('caseOrders', { caseId: target.id, status: 'active' });
    wix.seed('caseOrders', active.id, { ...active.data, beaconCaseOrderId: 'someone-elses-order' });
    const [op] = (await getReport()).body.operations;
    expect(op.inspection.allowedActions).toEqual(['close']);
    expect((await act('complete')).status).toBe(409);
    expect((await act('compensate')).status).toBe(409);
  });
});

describe('interrupted operations — authorization and organization isolation', () => {
  it('non-administrators are refused (403), reading and repairing alike', async () => {
    auth.admin = false;
    expect((await getReport()).status).toBe(403);
    expect((await act('close')).status).toBe(403);
  });

  it("another organization's caller sees and repairs nothing of this organization's", async () => {
    crashAtCasePatch();
    await change();
    restartAfter(10);
    auth.organizationId = MANORS;
    expect((await getReport(MANORS)).status).toBe(403); // not a service-change organization
    expect((await act('compensate', MANORS)).status).toBe(403);
    // A forged organizationId never reaches the journal.
    expect((await getReport(GUS)).status).toBe(403);
    expect(caseOrders().filter((o) => o.status === 'active')).toHaveLength(1);
  });

  it("a journal entry of ANOTHER organization with the same operation id is never listed or acted on", async () => {
    wix.seed('activityEvents', 'foreign-journal', {
      beaconActivityEventId: 'foreign-journal', eventVersion: 1, organizationId: MANORS, caseId: null, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null,
      category: 'system', eventType: 'case.service_change.journal', resourceType: 'case_service_change', resourceId: KEY, previousValue: null,
      newValue: null, description: 'fictional', severity: 'info', correlationId: null, isSystemGenerated: true, createdAt: '2026-10-01T00:00:00.000Z',
      metadata: JSON.stringify({ serviceChangeId: KEY, caseId: manorsCase.id, status: 'failed' }),
    });
    expect((await getReport(GUS, true)).body.operations).toEqual([]);
    expect((await act('close')).status).toBe(404);
  });
});
