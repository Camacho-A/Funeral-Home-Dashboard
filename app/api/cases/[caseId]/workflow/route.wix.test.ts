import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { buildWixServiceCatalogData } from '@/lib/wixServiceCatalogMapper';
import { buildWixWorkflowTemplateData, buildWixWorkflowTemplateVersionData } from '@/lib/wixWorkflowTemplateMapper';
import type { WixCaseItem } from '@/lib/wixCaseMapper';
import { findStageByRawStage } from '@/domain/workflow/resolveStages';
import type { Case } from '@/types/case';

/**
 * Case concurrency (2026-10) — Wix-adapter contract tests for the older
 * workflow remap route (POST /api/cases/[caseId]/workflow): it now writes
 * through the case write service (field-scoped, revision-conditioned)
 * instead of a full replace, so a checklist tick landing between the plan
 * and the write is never silently discarded. In-memory Wix, fictional
 * rows, no network.
 */

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
vi.mock('@/lib/wixDataApi', () => wix.api);

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';
const auth = vi.hoisted(() => ({ organizationId: 'gus-camacho-jr' }));
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: async (requested: string) =>
    requested === auth.organizationId
      ? { authorized: true, context: { organizationId: auth.organizationId, userId: 'identity-gus-test-admin', role: 'administrator' } }
      : { authorized: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) },
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canEditCase: async () => true,
}));

const { POST } = await import('./route');

const target = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 4)!;
const manorsCase = caseFixtures.find((c) => c.organizationId === MANORS)!;
const stage = findStageByRawStage(target.workflowSnapshot!, target.rawStage)!;
const KEY = `${stage.displayStage}:${stage.checklist.items[0].index}`;

function wixCaseRow(c: Case): Record<string, unknown> {
  return {
    beaconCaseId: c.id, organizationId: c.organizationId, caseNumber: c.caseNumber, caseType: c.caseType,
    workflowTemplateId: c.workflowTemplateId, workflowTemplateVersion: c.workflowTemplateVersion, workflowSnapshot: c.workflowSnapshot,
    currentStage: c.rawStage, checklistState: c.checklistState, fieldValues: c.fieldValues, decedentName: c.decedentName,
    dateOfBirth: c.dateOfBirth ?? '', dateOfDeath: c.dateOfDeath ?? '', timeOfDeath: c.timeOfDeath ?? '', placeOfDeath: c.placeOfDeath ?? '',
    weight: String(c.weight ?? ''), nextOfKinName: c.nextOfKinName ?? '', nextOfKinPhone: c.nextOfKinPhone ?? '',
    paymentStatus: 'awaiting_payment', isVeteran: false, isArchived: false, createdAt: c.createdAt,
  };
}
const row = (id = target.id) => wix.get('cases', id) as WixCaseItem;

function remap(extra: Record<string, unknown> = {}, caseId = target.id) {
  return POST(
    new Request(`http://localhost/api/cases/${caseId}/workflow`, {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ organizationId: GUS, serviceTypeCode: 'CREMATION_WITH_VIEWING', expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, confirm: true, expectedRevision: ((wix.get('cases', caseId) as { revision?: unknown } | undefined)?.revision as number | undefined ?? 0), ...extra }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
}
/** Another staff member ticks KEY between the plan's read and its write. */
function tickBeforeFirstCasePatch() {
  let done = false;
  wix.onBeforeOp((op) => {
    if (!done && op.op === 'patch' && op.collection === 'cases') {
      done = true;
      const current = row();
      wix.seed('cases', target.id, { ...current, checklistState: { ...(current.checklistState as object), [KEY]: true }, revision: 1 });
    }
  });
}

let originalAdapter: string | undefined;
beforeEach(() => {
  originalAdapter = process.env.DATA_ADAPTER;
  process.env.DATA_ADAPTER = 'wix';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  auth.organizationId = GUS;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  wix.reset();
  for (const template of workflowTemplateFixtures.filter((t) => t.organizationId === GUS)) {
    wix.seed('workflowTemplates', template.id, buildWixWorkflowTemplateData(template) as Record<string, unknown>);
    for (const version of template.versions) {
      const approved = template.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING') ? 'approved' : version.status;
      wix.seed('workflowTemplateVersions', `${template.id}-v${version.version}`, buildWixWorkflowTemplateVersionData({ beaconTemplateId: template.id, ...version, status: approved }) as Record<string, unknown>);
    }
  }
  for (const item of serviceCatalogFixtures.filter((i) => i.organizationId === GUS)) {
    wix.seed('serviceCatalog', item.id, buildWixServiceCatalogData(item) as Record<string, unknown>);
  }
  wix.seed('cases', target.id, { ...wixCaseRow(target), checklistState: { ...target.checklistState, [KEY]: false } });
  wix.seed('cases', manorsCase.id, wixCaseRow(manorsCase));
});

afterEach(() => {
  if (originalAdapter === undefined) delete process.env.DATA_ADAPTER;
  else process.env.DATA_ADAPTER = originalAdapter;
  vi.restoreAllMocks();
});

describe('workflow remap (Wix) — conditional, field-scoped', () => {
  it('writes only the workflow fields it changes, plus the revision, conditioned on organization/case/revision', async () => {
    const before = row();
    const response = await remap();
    expect(response.status).toBe(200);
    const [write] = wix.writes().filter((op) => op.collection === 'cases');
    expect(write.op).toBe('patch');
    expect(write.fields).toContain('workflowSnapshot');
    expect(write.fields).toContain('revision');
    expect(write.fields).not.toContain('decedentName');
    expect(wix.conditions[0].filter).toEqual({ organizationId: { $eq: GUS }, beaconCaseId: { $eq: target.id }, revision: { $eq: null } });
    expect(row().decedentName).toBe(before.decedentName);
    expect(row().revision).toBe(1);
  });

  it('a checklist tick landing between plan and write is NOT lost: the confirm is refused (409), never re-planned behind staff\'s back (Phase 5A.1)', async () => {
    tickBeforeFirstCasePatch();
    const response = await remap();
    expect(response.status).toBe(409);
    expect((row().checklistState as Record<string, boolean>)[KEY]).toBe(true);
    expect(row().workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    expect(row().revision).toBe(1);
    expect(wix.writes().filter((op) => op.collection === 'cases')).toHaveLength(1);
  });

  it('a confirm without expectedRevision is refused 428 (nothing written); a preview needs none and returns caseRevision', async () => {
    const before = wix.snapshot();
    const refused = await remap({ expectedRevision: undefined });
    expect(refused.status).toBe(428);
    expect((await refused.json()).reason).toBe('revision_required');
    expect(wix.snapshot()).toEqual(before);
    const preview = await remap({ confirm: false, expectedRevision: undefined });
    expect(preview.status).toBe(200);
    expect((await preview.json()).caseRevision).toBe(0);
  });

  it('with expectedRevision, the same race is a 409 and nothing of the remap is written', async () => {
    tickBeforeFirstCasePatch();
    const response = await remap({ expectedRevision: 0 });
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe('revision_conflict');
    expect(row().workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    expect((row().checklistState as Record<string, boolean>)[KEY]).toBe(true);
  });

  it("another organization's case is 404; a Wix 5xx on the write is 503 with nothing written", async () => {
    expect((await remap({}, manorsCase.id)).status).toBe(404);
    wix.failNext('patch', 'cases', 500);
    expect((await remap()).status).toBe(503);
    expect(row().workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
  });
});
