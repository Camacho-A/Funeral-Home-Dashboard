import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { buildWixWorkflowTemplateData, buildWixWorkflowTemplateVersionData } from '@/lib/wixWorkflowTemplateMapper';
import { buildWixServiceCatalogData } from '@/lib/wixServiceCatalogMapper';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import type { WorkflowTemplate, WorkflowTemplateVersion } from '@/types/workflowTemplate';

/** Unfinished-workflow protection (2026-10): every approval now carries the
    approver's review attestation (see approve/route.ts). */
const REVIEW_ATTESTATION = { stagesReviewed: true, checklistReviewed: true, completionReviewed: true };

/**
 * Consistent service changes / Wix adapter verification (2026-10).
 * Contract tests for the Wix-backed paths of workflow version persistence
 * (POST /api/workflow-templates/[templateId]/versions) and template
 * approval (POST .../versions/[version]/approve): the REAL routes and
 * mappers run in DATA_ADAPTER=wix mode against an in-memory stand-in for
 * lib/wixDataApi.ts (lib/testing/inMemoryWixData.ts) holding fictional
 * rows — no network, no live Wix. Only the session and RBAC lookups are
 * replaced. Asserts the exact rows written, organization scoping and
 * error handling for Wix 4xx/5xx. (These routes are being extended in
 * parallel by the workflow-editor work; this file pins the persistence
 * contract, not the editor's validation rules.)
 */

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
vi.mock('@/lib/wixDataApi', () => wix.api);

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';

const auth = vi.hoisted(() => ({ organizationId: 'gus-camacho-jr', canPublish: true }));
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: async (requested: string) =>
    requested === auth.organizationId
      ? { authorized: true, context: { organizationId: auth.organizationId, userId: 'identity-test-approver', role: 'administrator' } }
      : { authorized: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) },
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canPublishWorkflow: async () => auth.canPublish,
}));

const approve = await import('./[templateId]/versions/[version]/approve/route');
const versions = await import('./[templateId]/versions/route');

function request(url: string, body: Record<string, unknown>) {
  return new Request(url, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: JSON.stringify(body) });
}
function postApprove(templateId: string, version: number, organizationId = GUS) {
  return approve.POST(request(`http://localhost/api/workflow-templates/${templateId}/versions/${version}/approve`, { organizationId, attestation: REVIEW_ATTESTATION }), {
    params: Promise.resolve({ templateId, version: String(version) }),
  });
}
function postVersion(template: WorkflowTemplate, organizationId = template.organizationId) {
  const source = template.versions[0];
  return versions.POST(
    request(`http://localhost/api/workflow-templates/${template.id}/versions`, { organizationId, stages: source.stages, intake: source.intake }),
    { params: Promise.resolve({ templateId: template.id }) },
  );
}

const gusTemplates = workflowTemplateFixtures.filter((t) => t.organizationId === GUS);
const approved = gusTemplates.find((t) => t.versions.every((v) => v.status !== 'draft'))!;
const manorsTemplate = workflowTemplateFixtures.find((t) => t.organizationId === MANORS)!;
const nextVersion = (t: WorkflowTemplate) => Math.max(...t.versions.map((v) => v.version)) + 1;

/** A complete draft: the approved template's content as version N+1. */
const DRAFT_VERSION = nextVersion(approved);
const completeDraft: WorkflowTemplateVersion = { ...structuredClone(approved.versions[approved.versions.length - 1]), version: DRAFT_VERSION, status: 'draft' };
/** An incomplete draft (a stage without a label) as version N+2. */
const INCOMPLETE_VERSION = DRAFT_VERSION + 1;
const incompleteDraft: WorkflowTemplateVersion = {
  ...structuredClone(completeDraft),
  version: INCOMPLETE_VERSION,
  stages: completeDraft.stages.map((stage, i) => (i === 0 ? { ...stage, label: '' } : stage)),
};
const draft: WorkflowTemplate = { ...approved, versions: [...approved.versions, completeDraft, incompleteDraft] };

function seed(template: WorkflowTemplate) {
  wix.seed('workflowTemplates', `wix-${template.id}`, buildWixWorkflowTemplateData(template) as Record<string, unknown>);
  for (const version of template.versions) {
    wix.seed(
      'workflowTemplateVersions',
      `${template.id}-v${version.version}`,
      buildWixWorkflowTemplateVersionData({ beaconTemplateId: template.id, ...version }) as Record<string, unknown>,
    );
  }
}

let originalAdapter: string | undefined;
beforeEach(() => {
  originalAdapter = process.env.DATA_ADAPTER;
  process.env.DATA_ADAPTER = 'wix';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  Object.assign(auth, { organizationId: GUS, canPublish: true });
  wix.reset();
  for (const template of [...gusTemplates.filter((t) => t.id !== approved.id), draft, manorsTemplate]) seed(template);
  for (const item of serviceCatalogFixtures.filter((i) => i.organizationId === GUS)) {
    wix.seed('serviceCatalog', item.id, buildWixServiceCatalogData(item) as Record<string, unknown>);
  }
});

afterEach(() => {
  if (originalAdapter === undefined) delete process.env.DATA_ADAPTER;
  else process.env.DATA_ADAPTER = originalAdapter;
});

describe('version persistence (Wix)', () => {
  it('a Gus edit inserts ONE new row "{templateId}-v{n}" carrying status: "draft", and never updates an existing version', async () => {
    const before = wix.snapshot();
    const response = await postVersion(draft);
    expect(response.status).toBe(200);
    const next = nextVersion(draft);
    const versionWrites = wix.writes().filter((op) => op.collection !== 'activityEvents');
    expect(versionWrites).toEqual([{ op: 'insert', collection: 'workflowTemplateVersions', id: `${draft.id}-v${next}` }]);
    const row = wix.get('workflowTemplateVersions', `${draft.id}-v${next}`)!;
    expect(row).toMatchObject({ beaconTemplateId: draft.id, version: next, status: 'draft', createdBy: 'identity-test-approver' });
    expect(row).not.toHaveProperty('approvedBy');
    expect(row).not.toHaveProperty('approvedAt');
    // Every pre-existing row is byte-identical.
    for (const [collection, rows] of Object.entries(before)) {
      for (const [id, data] of Object.entries(rows)) expect(wix.get(collection, id)).toEqual(data);
    }
  });

  it('a Manors edit inserts a row with NO status field (unchanged row shape)', async () => {
    auth.organizationId = MANORS;
    const response = await postVersion(manorsTemplate);
    expect(response.status).toBe(200);
    const row = wix.get('workflowTemplateVersions', `${manorsTemplate.id}-v${nextVersion(manorsTemplate)}`)!;
    expect(row).toMatchObject({ beaconTemplateId: manorsTemplate.id, version: nextVersion(manorsTemplate) });
    expect(Object.keys(row)).not.toContain('status');
    expect(Object.keys(row)).not.toContain('serviceTypeCodes');
  });

  it('another organization’s template is 404 and nothing is inserted', async () => {
    const response = await versions.POST(
      request(`http://localhost/api/workflow-templates/${manorsTemplate.id}/versions`, {
        organizationId: GUS,
        stages: manorsTemplate.versions[0].stages,
        intake: manorsTemplate.versions[0].intake,
      }),
      { params: Promise.resolve({ templateId: manorsTemplate.id }) },
    );
    expect(response.status).toBe(404);
    expect(wix.writes()).toEqual([]);
  });

  it('Wix 409 on the insert (same version saved concurrently) → 409; Wix 500 → 503', async () => {
    wix.failNext('insert', 'workflowTemplateVersions', 409);
    expect((await postVersion(draft)).status).toBe(409);
    wix.failNext('insert', 'workflowTemplateVersions', 500);
    expect((await postVersion(draft)).status).toBe(503);
    expect(wix.rows('workflowTemplateVersions', { beaconTemplateId: draft.id })).toHaveLength(draft.versions.length);
    expect(wix.rows('activityEvents')).toEqual([]);
  });
});

describe('template approval (Wix)', () => {
  const draftVersion = () => completeDraft;

  it('changes ONLY status/approvedBy/approvedAt on exactly one version row (a conditional patch of just those fields)', async () => {
    const before = wix.snapshot();
    const rowId = `${draft.id}-v${draftVersion().version}`;
    const response = await postApprove(draft.id, draftVersion().version);
    expect(response.status).toBe(200);
    expect(wix.writes().filter((op) => op.collection !== 'activityEvents')).toEqual([
      { op: 'patch', collection: 'workflowTemplateVersions', id: rowId, fields: ['status', 'approvedBy', 'approvedAt'] },
    ]);
    const after = wix.get('workflowTemplateVersions', rowId)!;
    expect(after).toEqual({ ...before.workflowTemplateVersions[rowId], status: 'approved', approvedBy: 'identity-test-approver', approvedAt: expect.any(String) });
    for (const [collection, rows] of Object.entries(before)) {
      for (const [id, data] of Object.entries(rows)) if (id !== rowId) expect(wix.get(collection, id)).toEqual(data);
    }
    const body = await response.json();
    expect(body.workflowTemplate.versions.find((v: { version: number }) => v.version === draftVersion().version)).toMatchObject({ status: 'approved' });
    // Audit: one append-only activity row for the approval, in this organization.
    const events = wix.rows('activityEvents').map((row) => row.data);
    expect(events).toEqual([expect.objectContaining({ organizationId: GUS, actorIdentityId: 'identity-test-approver', eventType: expect.stringMatching(/^workflow\.template\./) })]);
  });

  it('an already-approved version is refused (409) with NO write — approvedBy/approvedAt are never re-stamped', async () => {
    const version = approved.versions[approved.versions.length - 1].version;
    const before = wix.snapshot();
    const response = await postApprove(draft.id, version);
    expect(response.status).toBe(409);
    expect(wix.writes()).toEqual([]);
    expect(wix.snapshot()).toEqual(before);
  });

  it('a draft carrying a service assignment also sets ONLY serviceTypeCodes on its template row (applied at approval, not at save)', async () => {
    const withAssignment = { ...structuredClone(completeDraft), serviceTypeCodes: ['DIRECT_CREMATION'] };
    wix.seed('workflowTemplateVersions', `${draft.id}-v${DRAFT_VERSION}`, buildWixWorkflowTemplateVersionData({ beaconTemplateId: draft.id, ...withAssignment }) as Record<string, unknown>);
    // The template does not serve it yet, so approval has an assignment to apply.
    wix.seed('workflowTemplates', `wix-${draft.id}`, { ...wix.get('workflowTemplates', `wix-${draft.id}`)!, serviceTypeCodes: [] });
    const before = wix.snapshot();
    const response = await postApprove(draft.id, DRAFT_VERSION);
    expect(response.status).toBe(200);
    const templateRowId = `wix-${draft.id}`;
    expect(wix.get('workflowTemplates', templateRowId)).toEqual({ ...before.workflowTemplates[templateRowId], serviceTypeCodes: ['DIRECT_CREMATION'] });
    expect(wix.writes().filter((op) => op.collection !== 'activityEvents').map((op) => [op.op, op.collection, op.fields])).toEqual([
      ['patch', 'workflowTemplateVersions', ['status', 'approvedBy', 'approvedAt']],
      ['patch', 'workflowTemplates', ['serviceTypeCodes']],
    ]);
  });

  // Fixed (workflow-editor work, 2026-10): approval writes the version row,
  // THEN the template row's service assignment. If that second write fails
  // the answer is 503 with the version approved; a retry finds the
  // assignment still pending and completes it (idempotent completion)
  // instead of refusing the version as already approved.
  it('a template-row failure after the version row was approved can be retried to completion', async () => {
    const withAssignment = { ...structuredClone(completeDraft), serviceTypeCodes: ['DIRECT_CREMATION'] };
    wix.seed('workflowTemplateVersions', `${draft.id}-v${DRAFT_VERSION}`, buildWixWorkflowTemplateVersionData({ beaconTemplateId: draft.id, ...withAssignment }) as Record<string, unknown>);
    wix.seed('workflowTemplates', `wix-${draft.id}`, { ...wix.get('workflowTemplates', `wix-${draft.id}`)!, serviceTypeCodes: [] });
    wix.failNext('patch', 'workflowTemplates', 500);
    expect((await postApprove(draft.id, DRAFT_VERSION)).status).toBe(503);
    expect(wix.get('workflowTemplateVersions', `${draft.id}-v${DRAFT_VERSION}`)).toMatchObject({ status: 'approved' });
    const retry = await postApprove(draft.id, DRAFT_VERSION);
    expect(retry.status).toBe(200);
    expect(wix.get('workflowTemplates', `wix-${draft.id}`)!.serviceTypeCodes).toEqual(['DIRECT_CREMATION']);
    // The approval was recorded once (when the version was approved); the
    // completion re-stamps nothing and is then refused as done.
    expect(wix.rows('activityEvents').map((row) => row.data.eventType)).toEqual(['workflow.template.published']);
    expect((await postApprove(draft.id, DRAFT_VERSION)).status).toBe(409);
  });

  it('two concurrent approvals of one draft: exactly one applies (one approvedBy, one activity event); the other is 409', async () => {
    const rowId = `${draft.id}-v${DRAFT_VERSION}`;
    // Interleave: both requests read the row as a draft before either writes.
    let reads = 0;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => (releaseReads = resolve));
    const originalQuery = wix.api.queryWixDataItems;
    wix.api.queryWixDataItems = (async (...args: Parameters<typeof originalQuery>) => {
      const result = await originalQuery(...args);
      if (args[0] === 'workflowTemplateVersions' && (args[1]?.filter as Record<string, unknown>)?.version === DRAFT_VERSION) {
        reads += 1;
        if (reads === 2) releaseReads();
        await bothRead;
      }
      return result;
    }) as typeof originalQuery;
    try {
      const [a, b] = await Promise.all([postApprove(draft.id, DRAFT_VERSION), postApprove(draft.id, DRAFT_VERSION)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    } finally {
      wix.api.queryWixDataItems = originalQuery;
    }
    const versionPatches = wix.writes().filter((op) => op.collection === 'workflowTemplateVersions');
    expect(versionPatches).toHaveLength(2); // both tried; the condition let only one apply
    expect(wix.get('workflowTemplateVersions', rowId)).toMatchObject({ status: 'approved', approvedBy: 'identity-test-approver' });
    expect(wix.rows('activityEvents')).toHaveLength(1);
  });

  it('an incomplete draft is refused (422) with NO write', async () => {
    const response = await postApprove(draft.id, INCOMPLETE_VERSION);
    expect(response.status).toBe(422);
    // No workflow write — only the audited refusal (2026-10).
    expect(wix.writes().filter((op) => op.collection !== 'activityEvents')).toEqual([]);
    expect(wix.rows('activityEvents').map((r) => r.data.eventType)).toEqual(['workflow.template.approval_refused']);
    expect(wix.get('workflowTemplateVersions', `${draft.id}-v${INCOMPLETE_VERSION}`)).toMatchObject({ status: 'draft' });
  });

  it('another organization’s template is refused as not found (404) and its rows are untouched', async () => {
    const before = wix.snapshot();
    const response = await postApprove(manorsTemplate.id, manorsTemplate.versions[0].version);
    expect(response.status).toBe(404);
    expect(wix.writes()).toEqual([]);
    expect(wix.snapshot()).toEqual(before);
  });

  it('authorization: no workflow.publish → 403; another organization → 403; Manors (no approval step) → 403 — no Wix writes', async () => {
    auth.canPublish = false;
    expect((await postApprove(draft.id, draftVersion().version)).status).toBe(403);
    auth.canPublish = true;
    expect((await postApprove(draft.id, draftVersion().version, MANORS)).status).toBe(403);
    auth.organizationId = MANORS;
    expect((await postApprove(manorsTemplate.id, 1, MANORS)).status).toBe(403);
    expect(wix.writes()).toEqual([]);
  });

  it('unknown version → 404; Wix 4xx/5xx → 503 with nothing half-written', async () => {
    expect((await postApprove(draft.id, 99)).status).toBe(404);
    wix.failNext('query', 'workflowTemplates', 403);
    expect((await postApprove(draft.id, draftVersion().version)).status).toBe(503);
    const before = wix.snapshot();
    wix.failNext('patch', 'workflowTemplateVersions', 500);
    expect((await postApprove(draft.id, draftVersion().version)).status).toBe(503);
    expect(wix.snapshot()).toEqual(before);
  });
});
