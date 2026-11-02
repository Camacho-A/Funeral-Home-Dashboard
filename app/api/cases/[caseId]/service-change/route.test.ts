import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityFixtures, MANORS_ADMIN_IDENTITY_ID } from '@/services/__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID, GUS_VIEWER_IDENTITY_ID } from '@/services/__mocks__/gusFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import {
  serviceCatalogFixtures,
  caseOrderFixtures,
  caseOrderLineItemFixtures,
  caseOrderAuditFixtures,
} from '@/services/__mocks__/pricingFixtures';
import { journalEntryFixtures, journalEntryLineFixtures, ledgerAccountFixtures } from '@/services/__mocks__/ledgerFixtures';
import type { Case } from '@/types/case';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Consistent service changes (2026-10). POST
 * /api/cases/[caseId]/service-change in mock data mode — fictional cases,
 * no Wix/network. The Wix-backed path (including the failure, race and
 * compensation cases, which need an injectable backend) is covered by
 * ./route.wix.test.ts.
 */

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';

let mockSession: unknown = null;
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: vi.fn(async () => undefined),
  clearSession: vi.fn(),
}));

const { createIdentitySession } = await import('@/services/sessionService');
const { createCaseOrder } = await import('@/services/pricingService');
const { POST } = await import('./route');

let n = 0;
async function signInAs(identityId: string) {
  const identity = identityFixtures.find((i) => i.id === identityId)!;
  const session = await createIdentitySession(
    { identityId, deviceId: 'service-change-test', passwordVersionAtIssue: identity.passwordVersion, idFactory: () => `sc-${++n}` },
    'mock',
  );
  mockSession = { user: { id: identity.id, email: identity.email, displayName: identity.displayName, source: 'identity' }, sessionId: session.id };
}

function post(caseId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/cases/${caseId}/service-change`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify('expectedRevision' in body ? body : { ...body, expectedRevision: (caseFixtures.find((c) => c.id === caseId)?.revision ?? 0) }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}

/** Every mock collection a service change may write. */
function snapshotWrites() {
  return structuredClone({
    cases: caseFixtures,
    orders: caseOrderFixtures,
    lines: caseOrderLineItemFixtures,
    audit: caseOrderAuditFixtures,
    activity: activityEventFixtures,
    journal: journalEntryFixtures,
    journalLines: journalEntryLineFixtures,
  });
}

let restore: () => void;
let target: Case;
let initialOrderId: string;

function setPrice(serviceCode: string, cents: number | null) {
  const row = serviceCatalogFixtures.find((item) => item.organizationId === GUS && item.serviceCode === serviceCode)!;
  row.defaultPrice = cents;
}

function approveViewing(): WorkflowTemplate {
  const viewing = workflowTemplateFixtures.find((t) => t.organizationId === GUS && t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
  viewing.versions[0].status = 'approved';
  return viewing;
}

function viewingBody(extra: Record<string, unknown> = {}) {
  return {
    organizationId: GUS,
    serviceTypeCode: 'CREMATION_WITH_VIEWING',
    expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
    expectedOrderId: initialOrderId,
    selections: { serviceTypeCode: 'CREMATION_WITH_VIEWING' },
    ...extra,
  };
}

beforeEach(async () => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  const before = {
    cases: structuredClone(caseFixtures),
    templates: structuredClone(workflowTemplateFixtures),
    catalog: structuredClone(serviceCatalogFixtures),
    orders: structuredClone(caseOrderFixtures),
    lines: structuredClone(caseOrderLineItemFixtures),
    audit: structuredClone(caseOrderAuditFixtures),
    activity: activityEventFixtures.length,
    journal: structuredClone(journalEntryFixtures),
    journalLines: structuredClone(journalEntryLineFixtures),
    ledger: structuredClone(ledgerAccountFixtures),
  };
  restore = () => {
    caseFixtures.splice(0, caseFixtures.length, ...before.cases);
    workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...before.templates);
    serviceCatalogFixtures.splice(0, serviceCatalogFixtures.length, ...before.catalog);
    caseOrderFixtures.splice(0, caseOrderFixtures.length, ...before.orders);
    caseOrderLineItemFixtures.splice(0, caseOrderLineItemFixtures.length, ...before.lines);
    caseOrderAuditFixtures.splice(0, caseOrderAuditFixtures.length, ...before.audit);
    activityEventFixtures.splice(before.activity);
    journalEntryFixtures.splice(0, journalEntryFixtures.length, ...before.journal);
    journalEntryLineFixtures.splice(0, journalEntryLineFixtures.length, ...before.journalLines);
    ledgerAccountFixtures.splice(0, ledgerAccountFixtures.length, ...before.ledger);
  };

  // Fictional prices for the test only.
  setPrice('DIRECT_CREMATION', 150_000);
  setPrice('CREMATION_WITH_VIEWING', 250_000);
  target = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 4)!;
  const { order } = await createCaseOrder(
    { organizationId: GUS, caseId: target.id, selections: { serviceTypeCode: 'DIRECT_CREMATION' }, performedBy: GUS_ADMIN_IDENTITY_ID, idFactory: () => `seed-${++n}` },
    'mock',
  );
  initialOrderId = order.id;
  await signInAs(GUS_ADMIN_IDENTITY_ID);
});

afterEach(() => restore());

describe('POST /api/cases/[caseId]/service-change — preview', () => {
  it('returns the workflow preview and what the order becomes, and writes nothing', async () => {
    approveViewing();
    const before = snapshotWrites();
    const response = await post(target.id, viewingBody());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toBe(false);
    expect(body.preview).toMatchObject({ unchanged: false, to: { serviceTypeCode: 'CREMATION_WITH_VIEWING' } });
    expect(body.order).toMatchObject({ unchanged: false, currentOrderId: initialOrderId, currentTotal: 150_000, newTotal: 250_000 });
    expect(body.order.changes.length).toBeGreaterThan(0);
    expect(snapshotWrites()).toEqual(before);
  });

  it('refuses an unpriced service already at preview (422, nothing written)', async () => {
    approveViewing();
    setPrice('CREMATION_WITH_VIEWING', null);
    const before = snapshotWrites();
    const response = await post(target.id, viewingBody());
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ reason: 'unpriced', unpricedItems: [{ serviceCode: 'CREMATION_WITH_VIEWING' }] });
    expect(body.error).toMatch(/Settings › Services & Pricing/);
    expect(snapshotWrites()).toEqual(before);
  });
});

describe('POST /api/cases/[caseId]/service-change — confirm', () => {
  it('changes the workflow and the order together, keeping all history, with linked activity', async () => {
    const viewing = approveViewing();
    const response = await post(target.id, viewingBody({ confirm: true, idempotencyKey: 'key-1' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ applied: true, serviceChangeId: 'key-1' });

    const stored = caseFixtures.find((c) => c.id === target.id)!;
    expect(stored.workflowTemplateId).toBe(viewing.id);
    expect(stored.workflowSnapshot?.serviceTypeCode).toBe('CREMATION_WITH_VIEWING');
    expect(stored.lastServiceChangeId).toBe('key-1');
    expect(stored.workflowHistory).toEqual([
      expect.objectContaining({ workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, serviceTypeCode: 'DIRECT_CREMATION', checklistState: target.checklistState, serviceChangeId: 'key-1' }),
    ]);

    // Billing history: v1 kept (superseded), v2 active with the new service.
    const orders = caseOrderFixtures.filter((o) => o.caseId === target.id).sort((a, b) => a.version - b.version);
    expect(orders.map((o) => [o.version, o.status, o.total])).toEqual([
      [1, 'superseded', 150_000],
      [2, 'active', 250_000],
    ]);
    const v2Lines = caseOrderLineItemFixtures.filter((li) => li.caseOrderId === orders[1].id);
    expect(v2Lines.map((li) => li.serviceCode)).toContain('CREMATION_WITH_VIEWING');
    expect(caseOrderLineItemFixtures.filter((li) => li.caseOrderId === initialOrderId).map((li) => li.serviceCode)).toContain('DIRECT_CREMATION');
    expect(caseOrderAuditFixtures.filter((e) => e.caseOrderId === orders[1].id).length).toBeGreaterThan(0);

    const events = activityEventFixtures.filter((e) => e.caseId === target.id && e.correlationId === body.correlationId);
    expect(events.map((e) => e.eventType).sort()).toEqual(['case.order.changed', 'case.workflow.changed']);
  });

  it('an idempotent retry with the same key returns the applied change and writes nothing more', async () => {
    approveViewing();
    const first = await post(target.id, viewingBody({ confirm: true, idempotencyKey: 'key-retry' }));
    expect(first.status).toBe(200);
    const before = snapshotWrites();
    const retry = await post(target.id, viewingBody({ confirm: true, idempotencyKey: 'key-retry' }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ applied: true, replayed: true, serviceChangeId: 'key-retry', order: { version: 2, status: 'active' } });
    expect(snapshotWrites()).toEqual(before);
  });

  it('creates the first order together with the workflow when the case had none', async () => {
    approveViewing();
    caseOrderFixtures.splice(0, caseOrderFixtures.length, ...caseOrderFixtures.filter((o) => o.caseId !== target.id));
    const response = await post(target.id, viewingBody({ expectedOrderId: null, confirm: true, idempotencyKey: 'key-new' }));
    expect(response.status).toBe(200);
    const orders = caseOrderFixtures.filter((o) => o.caseId === target.id);
    expect(orders).toEqual([expect.objectContaining({ version: 1, status: 'active', total: 250_000 })]);
    expect(caseFixtures.find((c) => c.id === target.id)!.workflowSnapshot?.serviceTypeCode).toBe('CREMATION_WITH_VIEWING');
  });

  it('refuses an unpriced service on confirm (422) — no workflow or order write', async () => {
    approveViewing();
    setPrice('CREMATION_WITH_VIEWING', null);
    const before = snapshotWrites();
    const response = await post(target.id, viewingBody({ confirm: true, idempotencyKey: 'key-unpriced' }));
    expect(response.status).toBe(422);
    expect(snapshotWrites()).toEqual(before);
  });

  it('refuses a draft target workflow (422) — nothing written', async () => {
    const before = snapshotWrites();
    // Cremation with Viewing is approved (2026-11); Direct Entombment is a draft.
    const response = await post(
      target.id,
      viewingBody({ serviceTypeCode: 'DIRECT_ENTOMBMENT', selections: { serviceTypeCode: 'DIRECT_ENTOMBMENT' }, confirm: true, idempotencyKey: 'key-draft' }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/has not been approved yet/);
    expect(snapshotWrites()).toEqual(before);
  });

  it('refuses a stale workflow or a stale order (409) — nothing written', async () => {
    approveViewing();
    const before = snapshotWrites();
    const staleWorkflow = await post(target.id, viewingBody({ expectedWorkflowTemplateId: 'not-the-current-template', confirm: true, idempotencyKey: 'k1' }));
    expect(staleWorkflow.status).toBe(409);
    const staleOrder = await post(target.id, viewingBody({ expectedOrderId: 'some-older-order', confirm: true, idempotencyKey: 'k2' }));
    expect(staleOrder.status).toBe(409);
    expect((await staleOrder.json()).reason).toBe('stale_order');
    expect(snapshotWrites()).toEqual(before);
  });

  it('validates the request: matching selections, idempotency key and expected order on confirm (400)', async () => {
    approveViewing();
    const before = snapshotWrites();
    expect((await post(target.id, viewingBody({ selections: { serviceTypeCode: 'DIRECT_CREMATION' } }))).status).toBe(400);
    expect((await post(target.id, viewingBody({ confirm: true }))).status).toBe(400);
    const noExpectedOrder = viewingBody({ confirm: true, idempotencyKey: 'k' }) as Record<string, unknown>;
    delete noExpectedOrder.expectedOrderId;
    expect((await post(target.id, noExpectedOrder)).status).toBe(400);
    expect(snapshotWrites()).toEqual(before);
  });
});

describe('POST /api/cases/[caseId]/service-change — scope and permissions', () => {
  it('Manors is refused (403) and nothing changes, even for its own administrator', async () => {
    await signInAs(MANORS_ADMIN_IDENTITY_ID);
    const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
    const before = snapshotWrites();
    const response = await post(manorsCase.id, {
      organizationId: MANORS,
      serviceTypeCode: 'DIRECT_CREMATION',
      expectedWorkflowTemplateId: manorsCase.workflowTemplateId,
      expectedOrderId: null,
      selections: { serviceTypeCode: 'DIRECT_CREMATION' },
      confirm: true,
      idempotencyKey: 'k',
    });
    expect(response.status).toBe(403);
    expect(snapshotWrites()).toEqual(before);
  });

  it('another organization’s case is not found (404); another organization id is refused (403)', async () => {
    approveViewing();
    const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
    const before = snapshotWrites();
    const notFound = await post(manorsCase.id, viewingBody({ confirm: true, idempotencyKey: 'k' }));
    expect(notFound.status).toBe(404);
    const crossOrg = await post(manorsCase.id, viewingBody({ organizationId: MANORS }));
    expect(crossOrg.status).toBe(403);
    expect(snapshotWrites()).toEqual(before);
  });

  it('requires case.update and caseOrder.update — a read-only member is refused (403)', async () => {
    approveViewing();
    await signInAs(GUS_VIEWER_IDENTITY_ID);
    const before = snapshotWrites();
    const response = await post(target.id, viewingBody({ confirm: true, idempotencyKey: 'k' }));
    expect(response.status).toBe(403);
    expect(snapshotWrites()).toEqual(before);
  });
});
