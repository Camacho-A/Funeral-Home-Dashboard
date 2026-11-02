import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { buildWixServiceCatalogData } from '@/lib/wixServiceCatalogMapper';
import { buildWixWorkflowTemplateData, buildWixWorkflowTemplateVersionData } from '@/lib/wixWorkflowTemplateMapper';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { mapWixCaseOrderItem } from '@/lib/wixCaseOrderMapper';
import type { Case } from '@/types/case';
import type { CaseOrder } from '@/types/caseOrder';

/**
 * Consistent service changes (2026-10) — Wix-adapter contract tests for
 * POST /api/cases/[caseId]/service-change. The REAL route, service, pricing
 * engine, case/order/template mappers and activity recording run in
 * DATA_ADAPTER=wix mode against an in-memory stand-in for lib/wixDataApi.ts
 * (lib/testing/inMemoryWixData.ts) holding fictional rows — never the
 * network. Only the session/RBAC lookups are replaced (their own Wix
 * collections are out of scope here). Covers: what is persisted through
 * the case mapper (snapshot, workflowHistory, checklistState), org
 * scoping, compare-and-swap concurrency, Wix 4xx/5xx handling,
 * compensation and its failure marker, idempotent retries, and that
 * other cases are never touched.
 */

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
vi.mock('@/lib/wixDataApi', () => wix.api);

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';
const USER = 'identity-gus-test-admin';

const auth = vi.hoisted(() => ({ organizationId: 'gus-camacho-jr', canEditCase: true, canEditCaseOrder: true }));
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: async (requested: string) =>
    requested === auth.organizationId
      ? { authorized: true, context: { organizationId: auth.organizationId, userId: 'identity-gus-test-admin', role: 'administrator' } }
      : { authorized: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) },
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canEditCase: async () => auth.canEditCase,
  canEditCaseOrder: async () => auth.canEditCaseOrder,
}));

const { POST } = await import('./route');
const { createCaseOrder } = await import('@/services/pricingService');

function post(caseId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/cases/${caseId}/service-change`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify('expectedRevision' in body ? body : { ...body, expectedRevision: ((wix.get('cases', caseId) as { revision?: unknown } | undefined)?.revision as number | undefined ?? 0) }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

/** A fictional fixture case as its live-shaped `cases` row. */
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

const target = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 4)!;
const otherGus = caseFixtures.find((c) => c.organizationId === GUS && c.id !== target.id)!;
const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
const OTHER_TEMPLATE_ID = 'gus-camacho-jr-other-template-fictional';

let initialOrder: CaseOrder;
let viewingTemplateId: string;
let catalogPrices: Record<string, number | null>;

function caseRow(id: string): WixCaseItem {
  return wix.rows('cases', { beaconCaseId: id })[0]?.data as WixCaseItem;
}
function storedCase(id: string): Case {
  return mapWixCaseItem(caseRow(id))!;
}
function caseOrders(caseId: string): CaseOrder[] {
  return wix
    .rows('caseOrders', { caseId })
    .map((row) => mapWixCaseOrderItem(row.data)!)
    .sort((a, b) => a.version - b.version);
}
function lineCodes(orderId: string): string[] {
  return wix.rows('caseOrderLineItems', { caseOrderId: orderId }).map((row) => row.data.serviceCode as string).sort();
}
function activity(eventType?: string) {
  return wix.rows('activityEvents', eventType ? { eventType } : undefined).map((row) => row.data);
}

function seedTemplates() {
  for (const template of workflowTemplateFixtures.filter((t) => t.organizationId === GUS)) {
    wix.seed('workflowTemplates', template.id, buildWixWorkflowTemplateData(template) as Record<string, unknown>);
    for (const version of template.versions) {
      const approved = template.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING') ? 'approved' : version.status;
      wix.seed(
        'workflowTemplateVersions',
        `${template.id}-v${version.version}`,
        buildWixWorkflowTemplateVersionData({ beaconTemplateId: template.id, ...version, status: approved }) as Record<string, unknown>,
      );
    }
  }
  viewingTemplateId = workflowTemplateFixtures.find((t) => t.organizationId === GUS && t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!.id;
}

function seedCatalog() {
  for (const item of serviceCatalogFixtures.filter((i) => i.organizationId === GUS)) {
    const price = item.serviceCode in catalogPrices ? catalogPrices[item.serviceCode] : item.defaultPrice;
    wix.seed('serviceCatalog', item.id, buildWixServiceCatalogData({ ...item, defaultPrice: price }) as Record<string, unknown>);
  }
}

function body(extra: Record<string, unknown> = {}) {
  return {
    organizationId: GUS,
    serviceTypeCode: 'CREMATION_WITH_VIEWING',
    expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
    expectedOrderId: initialOrder.id,
    selections: { serviceTypeCode: 'CREMATION_WITH_VIEWING' },
    confirm: true,
    idempotencyKey: 'svc-change-1',
    ...extra,
  };
}

let originalAdapter: string | undefined;
beforeEach(async () => {
  originalAdapter = process.env.DATA_ADAPTER;
  process.env.DATA_ADAPTER = 'wix';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  Object.assign(auth, { organizationId: GUS, canEditCase: true, canEditCaseOrder: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  wix.reset();

  catalogPrices = { DIRECT_CREMATION: 150_000, CREMATION_WITH_VIEWING: 250_000 };
  seedTemplates();
  seedCatalog();
  wix.seed('cases', target.id, wixCaseRow(target) as Record<string, unknown>);
  wix.seed('cases', otherGus.id, { ...wixCaseRow(otherGus), workflowTemplateId: OTHER_TEMPLATE_ID } as Record<string, unknown>);
  wix.seed('cases', manorsCase.id, wixCaseRow(manorsCase) as Record<string, unknown>);

  let n = 0;
  ({ order: initialOrder } = await createCaseOrder(
    { organizationId: GUS, caseId: target.id, selections: { serviceTypeCode: 'DIRECT_CREMATION' }, performedBy: USER, idFactory: () => `seed-${++n}` },
    'wix',
  ));
  wix.ops.length = 0;
});

afterEach(() => {
  if (originalAdapter === undefined) delete process.env.DATA_ADAPTER;
  else process.env.DATA_ADAPTER = originalAdapter;
  vi.restoreAllMocks();
});

describe('service change (Wix) — success', () => {
  it('persists snapshot, history and checklistState through ONE conditional case patch, plus a new order version', async () => {
    const othersBefore = { other: caseRow(otherGus.id), manors: caseRow(manorsCase.id) };
    const response = await post(target.id, body());
    expect(response.status).toBe(200);
    const result = await response.json();

    // The case: one conditional PATCH, never a full PUT.
    const caseWrites = wix.writes().filter((op) => op.collection === 'cases');
    expect(caseWrites).toEqual([
      {
        op: 'patch',
        collection: 'cases',
        id: target.id,
        // Case concurrency (2026-10): plus the revision increment that
        // every case write carries.
        fields: ['workflowTemplateId', 'workflowTemplateVersion', 'workflowSnapshot', 'caseType', 'currentStage', 'checklistState', 'fieldValues', 'daysWaitingInStage', 'workflowHistory', 'lastServiceChangeId', 'revision'],
      },
    ]);
    expect(caseRow(target.id).revision).toBe(1);
    const stored = storedCase(target.id);
    expect(stored.workflowTemplateId).toBe(viewingTemplateId);
    expect(stored.workflowSnapshot?.serviceTypeCode).toBe('CREMATION_WITH_VIEWING');
    expect(stored.lastServiceChangeId).toBe('svc-change-1');
    expect(stored.workflowHistory).toEqual([
      expect.objectContaining({
        workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
        serviceTypeCode: 'DIRECT_CREMATION',
        rawStage: target.rawStage,
        checklistState: target.checklistState,
        fieldValues: target.fieldValues,
        changedByUserId: USER,
        serviceChangeId: 'svc-change-1',
      }),
    ]);
    expect(result.case).toEqual(stored);
    // Every field the change doesn't own is exactly as before.
    const row = caseRow(target.id);
    expect({ ...row, workflowTemplateId: undefined, workflowTemplateVersion: undefined, workflowSnapshot: undefined, caseType: undefined, currentStage: undefined, checklistState: undefined, fieldValues: undefined, daysWaitingInStage: undefined, workflowHistory: undefined, lastServiceChangeId: undefined, revision: undefined }).toEqual({
      ...wixCaseRow(target),
      workflowTemplateId: undefined,
      workflowTemplateVersion: undefined,
      workflowSnapshot: undefined,
      caseType: undefined,
      currentStage: undefined,
      checklistState: undefined,
      fieldValues: undefined,
    });

    // The order: v1 superseded by compare-and-swap (kept), v2 active.
    const orders = caseOrders(target.id);
    expect(orders.map((o) => [o.version, o.status, o.total])).toEqual([
      [1, 'superseded', 150_000],
      [2, 'active', 250_000],
    ]);
    // Phase 5A.2: the new version is inserted PENDING, then v1 is superseded,
    // then v2 is activated — never zero or two active versions visible.
    expect(wix.writes().filter((op) => op.collection === 'caseOrders').map((op) => op.op)).toEqual(['insert', 'patch', 'patch']);
    expect(lineCodes(orders[0].id)).toContain('DIRECT_CREMATION');
    expect(lineCodes(orders[1].id)).toContain('CREMATION_WITH_VIEWING');

    // Linked audit history.
    const events = activity().filter((e) => e.correlationId === result.correlationId);
    expect(events.filter((e) => e.category === 'cases').map((e) => e.eventType).sort()).toEqual(['case.order.changed', 'case.workflow.changed']);
    // Case concurrency (2026-10): plus the operation journal, under the
    // same correlation id but in `system`, off the case's own timeline.
    const journal = events.filter((e) => e.eventType === 'case.service_change.journal');
    expect(journal.map((e) => JSON.parse(e.metadata as string).status)).toEqual(['prepared', 'order_committed', 'case_committed']);
    expect(journal.every((e) => e.category === 'system' && e.caseId === null)).toBe(true);

    // Nobody else's case was touched.
    expect(caseRow(otherGus.id)).toEqual(othersBefore.other);
    expect(caseRow(manorsCase.id)).toEqual(othersBefore.manors);
  });

  it('an idempotent retry finds the applied change and writes nothing', async () => {
    expect((await post(target.id, body())).status).toBe(200);
    const before = wix.snapshot();
    wix.ops.length = 0;
    const retry = await post(target.id, body());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ applied: true, replayed: true });
    expect(wix.writes()).toEqual([]);
    expect(wix.snapshot()).toEqual(before);
  });

  it('a case patch that applied but whose response was lost is recognised as applied (no compensation)', async () => {
    wix.failNext('patch', 'cases', 504, { afterWrite: true });
    const response = await post(target.id, body());
    expect(response.status).toBe(200);
    expect(storedCase(target.id).workflowHistory).toHaveLength(1);
    expect(caseOrders(target.id).map((o) => o.status)).toEqual(['superseded', 'active']);
    expect(activity('case.service_change.compensated')).toEqual([]);
  });
});

describe('service change (Wix) — refused before any write', () => {
  it('order recalculation failure (catalog read 500) → 503, nothing written', async () => {
    const before = wix.snapshot();
    wix.failNext('query', 'serviceCatalog', 500);
    const response = await post(target.id, body());
    expect(response.status).toBe(503);
    expect(wix.writes()).toEqual([]);
    expect(wix.snapshot()).toEqual(before);
  });

  it('a Wix 4xx reading the case → 503, nothing written', async () => {
    wix.failNext('query', 'cases', 403);
    const response = await post(target.id, body());
    expect(response.status).toBe(503);
    expect(wix.writes()).toEqual([]);
  });

  it('unpriced service → 422, nothing written', async () => {
    catalogPrices.CREMATION_WITH_VIEWING = null;
    seedCatalog();
    const response = await post(target.id, body());
    expect(response.status).toBe(422);
    expect(wix.writes()).toEqual([]);
  });

  it('stale preview (workflow or order) → 409, nothing written', async () => {
    expect((await post(target.id, body({ expectedWorkflowTemplateId: 'stale' }))).status).toBe(409);
    expect((await post(target.id, body({ expectedOrderId: 'stale' }))).status).toBe(409);
    expect(wix.writes()).toEqual([]);
  });

  it('Phase 5A.1: a confirm without expectedRevision → 428; a stale one → 409 revision_conflict; nothing written either way', async () => {
    const missing = await post(target.id, body({ expectedRevision: undefined }));
    expect(missing.status).toBe(428);
    expect((await missing.json()).reason).toBe('revision_required');
    // Someone ticks an item after the preview was shown.
    wix.seed('cases', target.id, { ...caseRow(target.id), revision: 3 } as Record<string, unknown>);
    wix.ops.length = 0;
    const stale = await post(target.id, body({ expectedRevision: 2 }));
    expect(stale.status).toBe(409);
    const json = await stale.json();
    expect(json.reason).toBe('revision_conflict');
    expect(json.currentRevision).toBe(3);
    expect(wix.writes()).toEqual([]);
  });

  it('Phase 5A.1: a preview needs no revision and returns the caseRevision a confirm must send', async () => {
    const response = await post(target.id, body({ confirm: false, expectedRevision: undefined }));
    expect(response.status).toBe(200);
    expect((await response.json()).caseRevision).toBe(0);
    expect(wix.writes()).toEqual([]);
  });

  it('another organization’s case is not found (404) and is never written', async () => {
    const before = caseRow(manorsCase.id);
    const response = await post(manorsCase.id, body());
    expect(response.status).toBe(404);
    expect(wix.writes()).toEqual([]);
    expect(caseRow(manorsCase.id)).toEqual(before);
  });

  it('Manors (flag off) is refused (403) before any Wix access', async () => {
    auth.organizationId = MANORS;
    const response = await post(manorsCase.id, body({ organizationId: MANORS }));
    expect(response.status).toBe(403);
    expect(wix.writes()).toEqual([]);
  });

  it('missing caseOrder.update permission is refused (403)', async () => {
    auth.canEditCaseOrder = false;
    expect((await post(target.id, body())).status).toBe(403);
    expect(wix.writes()).toEqual([]);
  });
});

describe('service change (Wix) — concurrency and compensation', () => {
  it('a concurrent order edit (previous version no longer active) → 409; no order version, no case write', async () => {
    wix.onBeforeOp((op) => {
      if (op.op === 'patch' && op.collection === 'caseOrders' && caseRow(target.id).lastServiceChangeId === undefined) {
        // Another request superseded v1 between our read and our swap.
        const [v1] = wix.rows('caseOrders', { beaconCaseOrderId: initialOrder.id });
        wix.seed('caseOrders', v1.id, { ...v1.data, status: 'superseded' });
      }
    });
    const response = await post(target.id, body());
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe('stale_order');
    // No order VERSION: the change's own row (written pending) was withdrawn.
    expect(caseOrders(target.id).filter((o) => o.status !== 'withdrawn')).toHaveLength(1);
    expect(caseOrders(target.id).filter((o) => o.status === 'pending')).toEqual([]);
    expect(wix.writes().filter((op) => op.collection === 'cases')).toEqual([]);
    expect(storedCase(target.id).workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
  });

  it('a concurrent case change between read and patch → 409, and the order change is undone by a restoring version', async () => {
    let raced = false;
    wix.onBeforeOp((op) => {
      if (!raced && op.op === 'patch' && op.collection === 'cases') {
        raced = true;
        wix.seed('cases', target.id, { ...caseRow(target.id), currentStage: target.rawStage + 1 });
      }
    });
    const response = await post(target.id, body());
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe('stale_case');

    // The case keeps the OTHER request's write; none of ours applied.
    const stored = storedCase(target.id);
    expect(stored.rawStage).toBe(target.rawStage + 1);
    expect(stored.workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    expect(stored.workflowHistory).toBeUndefined();

    // Billing history: v1, v2 (the undone change) and v3 restoring v1 — nothing deleted.
    const orders = caseOrders(target.id);
    expect(orders.map((o) => [o.version, o.status, o.total])).toEqual([
      [1, 'superseded', 150_000],
      [2, 'superseded', 250_000],
      [3, 'active', 150_000],
    ]);
    expect(lineCodes(orders[2].id)).toEqual(lineCodes(orders[0].id));
    expect(wix.writes().filter((op) => op.op === 'delete')).toEqual([]);
    const reverted = wix.rows('caseOrderAuditEntries', { action: 'service_change_reverted' });
    expect(reverted).toHaveLength(1);
    expect(reverted[0].data).toMatchObject({ caseOrderId: orders[2].id, amountDeltaCents: -100_000 });
    // Ledger: the change's +$1,000 recognition is reversed by a new entry, never removed.
    const receivable = wix.rows('chartOfAccounts', { organizationId: GUS, accountNumber: '1200' })[0].data.beaconLedgerAccountId;
    const receivableNet = wix
      .rows('journalEntryLines', { caseId: target.id, accountId: receivable })
      .reduce((sum, row) => sum + (row.data.direction === 'debit' ? 1 : -1) * (row.data.amount as number), 0);
    expect(wix.rows('journalEntries', { caseId: target.id })).toHaveLength(3);
    expect(receivableNet).toBe(initialOrder.total);

    const [marker] = activity('case.service_change.compensated');
    expect(marker).toMatchObject({ caseId: target.id, severity: 'warning' });
    expect(JSON.parse(marker.metadata as string)).toMatchObject({ failedStep: 'case', committedOrderId: orders[1].id, restoredOrderId: orders[2].id, needsRepair: false });
    expect(activity('case.workflow.changed')).toEqual([]);
  });

  it('a Wix 5xx on the case patch → 503 and the order change is compensated', async () => {
    wix.failNext('patch', 'cases', 500);
    const response = await post(target.id, body());
    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe('case_write_failed');
    expect(storedCase(target.id).workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    expect(caseOrders(target.id).map((o) => o.status)).toEqual(['superseded', 'superseded', 'active']);
    expect(caseOrders(target.id)[2].total).toBe(initialOrder.total);
    expect(activity('case.service_change.compensated')).toHaveLength(1);
  });

  it('compensation failure → 500 with an explicit needs-repair marker in Activity', async () => {
    wix.failNext('patch', 'cases', 500);
    let caseOrderPatches = 0;
    // The change's own patches (superseding v1, activating v2) succeed; the
    // compensation's (superseding v2 for the restoring version) fails.
    wix.failNext('patch', 'caseOrders', 503, { when: () => ++caseOrderPatches === 3 });
    const response = await post(target.id, body());
    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result).toMatchObject({ needsRepair: true, reason: 'needs_repair' });
    expect(result.error).toMatch(/need repair/);

    const [marker] = activity('case.service_change.failed');
    expect(marker).toMatchObject({ caseId: target.id, severity: 'critical', correlationId: result.correlationId });
    expect(JSON.parse(marker.metadata as string)).toMatchObject({ needsRepair: true, failedStep: 'case', serviceChangeId: 'svc-change-1' });
    expect(marker.description).toMatch(/NEEDS REPAIR/);
  });

  it('a failure inserting the new order version → the previous version is reactivated, no case write', async () => {
    wix.failNext('insert', 'caseOrders', 500);
    const response = await post(target.id, body());
    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe('order_write_failed');
    expect(caseOrders(target.id)).toEqual([expect.objectContaining({ id: initialOrder.id, status: 'active' })]);
    expect(wix.writes().filter((op) => op.collection === 'cases')).toEqual([]);
    expect(activity('case.service_change.compensated')).toHaveLength(1);
  });
});
