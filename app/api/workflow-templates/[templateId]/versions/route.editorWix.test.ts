import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureIdentitySession } from '@/lib/auth/testing/fixtureIdentityAuth';
import { buildGusServiceWorkflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { buildWixWorkflowTemplateData, buildWixWorkflowTemplateVersionData } from '@/lib/wixWorkflowTemplateMapper';
import { addChecklistItem, updateStage } from '@/domain/workflow/templateEditing';
import { completionItemOptions, finalItemsCompletionPolicy } from '@/domain/workflow/completionPolicy';
import type { Membership } from '@/types/membership';
import type { StageTemplate } from '@/types/workflowTemplate';

/** Unfinished-workflow protection (2026-10): every approval now carries the
    approver's review attestation (see approve/route.ts). */
const REVIEW_ATTESTATION = { stagesReviewed: true, checklistReviewed: true, completionReviewed: true };

/**
 * Workflow template editor (2026-10), DATA_ADAPTER=wix. The versions and
 * approve routes against an in-memory stand-in for the Wix Data API (never
 * the network): the inserted version row carries the editor's content
 * field for field (Time of death's valueKind included) plus authorship and
 * the proposed service; approval refuses an incomplete version without any
 * write, and otherwise updates only the version row's approval fields and
 * the template row's service assignment. Fictional data only.
 */

const GUS = 'gus-camacho-jr';
const ADMIN = { id: 'identity-wix-editor-admin', email: 'admin@example.test', displayName: 'Example Admin', source: 'identity' as const };

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
vi.mock('@/lib/wixDataApi', () => wix.api);
const writesTo = (collection: string) => wix.writes().filter((op) => op.collection === collection);

const mockSession = { current: fixtureIdentitySession(ADMIN) };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession.current,
  createSession: async () => undefined,
  clearSession: async () => undefined,
}));
vi.mock('@/lib/auth/resolveIdentitySession', async () => (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureResolveIdentitySessionModule);
vi.mock('@/services/membershipService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/membershipService')>()),
  listMembershipsForIdentity: async (identityId: string): Promise<Membership[]> =>
    identityId === ADMIN.id
      ? [{ id: 'm-1', identityId, organizationId: GUS, role: 'administrator', status: 'active', invitedBy: null, joinedAt: 'x', createdAt: 'x', updatedAt: 'x' }]
      : [],
}));
// RBAC resolution against Wix is not this file's concern (the versions
// route's own tests cover canPublishWorkflow); the catalog read is the
// pricing service's (fixture rows, mock data).
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canPublishWorkflow: async () => true,
}));
vi.mock('@/services/pricingService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/pricingService')>()),
  getServiceCatalog: async (organizationId: string) => serviceCatalogFixtures.filter((item) => item.organizationId === organizationId && item.isActive),
}));

const versions = await import('./route');
const approve = await import('./[version]/approve/route');

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID', 'AUTH_ADAPTER'] as const;
let originalEnv: Record<string, string | undefined>;

const templates = buildGusServiceWorkflowTemplateFixtures();
const graveside = templates.find((t) => t.serviceTypeCodes?.includes('GRAVESIDE_BURIAL_SERVICE_ONLY'))!;
const direct = templates.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;

function seed() {
  wix.reset();
  for (const t of templates) {
    wix.seed('workflowTemplates', `wix-${t.id}`, buildWixWorkflowTemplateData(t) as Record<string, unknown>);
    wix.seed('workflowTemplateVersions', `${t.id}-v1`, buildWixWorkflowTemplateVersionData({ beaconTemplateId: t.id, ...t.versions[0] }) as Record<string, unknown>);
  }
}

function post(handler: typeof versions.POST, url: string, params: Record<string, string>, body: Record<string, unknown>) {
  return handler(
    new Request(url, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: JSON.stringify({ organizationId: GUS, ...body }) }),
    { params: Promise.resolve(params) } as never,
  );
}
const save = (templateId: string, body: Record<string, unknown>) => post(versions.POST, `http://localhost/api/workflow-templates/${templateId}/versions`, { templateId }, body);
const approveVersion = (templateId: string, version: number) =>
  post(approve.POST as typeof versions.POST, `http://localhost/api/workflow-templates/${templateId}/versions/${version}/approve`, { templateId, version: String(version) }, { attestation: REVIEW_ATTESTATION });

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.DATA_ADAPTER = 'wix';
  process.env.WIX_API_KEY = 'test-key-not-real';
  process.env.WIX_SITE_ID = 'test-site-not-real';
  process.env.AUTH_ADAPTER = 'identity';
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  seed();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('wix mode — save draft', () => {
  it('inserts the version row with the exact stages (valueKind kept), status draft, author and proposed service, plus an activity event', async () => {
    const response = await save(direct.id, { stages: direct.versions[0].stages, intake: direct.versions[0].intake, serviceTypeCodes: ['DIRECT_CREMATION'] });
    expect(response.status).toBe(200);
    expect(writesTo('workflowTemplateVersions')).toEqual([expect.objectContaining({ op: 'insert', id: `${direct.id}-v2` })]);
    const row = wix.get('workflowTemplateVersions', `${direct.id}-v2`)!;
    expect(row).toMatchObject({ version: 2, status: 'draft', createdBy: ADMIN.id, createdByName: 'Example Admin', serviceTypeCodes: ['DIRECT_CREMATION'] });
    expect(row.stages).toEqual(direct.versions[0].stages);
    const stages = row.stages as StageTemplate[];
    expect(stages[0].checklist.items[5]).toMatchObject({ label: 'Time of death', valueKind: 'time' });
    expect(wix.rows('activityEvents').map((r) => r.data)).toEqual([expect.objectContaining({ eventType: 'workflow.template.updated', organizationId: GUS })]);
    // A save never touches the template row: the assignment waits for approval.
    expect(writesTo('workflowTemplates')).toEqual([]);
  });
});

describe('wix mode — approve', () => {
  it('refuses an incomplete version with 422 and writes nothing', async () => {
    const response = await approveVersion(graveside.id, 1);
    expect(response.status).toBe(422);
    expect((await response.json()).problems.map((p: { code: string }) => p.code)).toEqual([
      'stage_without_items',
      'placeholder_stage',
      'completion_items_undefined',
    ]);
    // No workflow write — only the audited refusal (2026-10).
    expect(wix.writes().filter((op) => op.collection !== 'activityEvents')).toEqual([]);
    expect(wix.rows('activityEvents').map((r) => r.data.eventType)).toEqual(['workflow.template.approval_refused']);
  });

  it('approves a completed draft: only the version row’s approval fields and the template row’s service change', async () => {
    const placeholder = graveside.versions[0].stages.find((s) => s.label.endsWith('steps to be defined'))!;
    // Defined (fictional) steps, and the completion item chosen from them.
    const stages = addChecklistItem(updateStage(graveside.versions[0].stages, placeholder.displayStage, { label: 'Example graveside stage' }), placeholder.displayStage, 'Example step');
    const completionPolicy = finalItemsCompletionPolicy({ requiredFinalItems: [completionItemOptions(stages).find((o) => o.ref.label === 'Example step')!.ref] });
    expect((await save(graveside.id, { stages, intake: graveside.versions[0].intake, serviceTypeCodes: ['GRAVESIDE_BURIAL_SERVICE_ONLY'], completionPolicy })).status).toBe(200);
    const before = wix.snapshot();

    const response = await approveVersion(graveside.id, 2);
    expect(response.status).toBe(200);
    const versionRow = `${graveside.id}-v2`;
    expect(wix.get('workflowTemplateVersions', versionRow)).toEqual({
      ...before.workflowTemplateVersions[versionRow],
      status: 'approved',
      approvedBy: ADMIN.id,
      approvedAt: expect.any(String),
      approvedByName: 'Example Admin',
    });
    expect(wix.get('workflowTemplates', `wix-${graveside.id}`)).toEqual({
      ...before.workflowTemplates[`wix-${graveside.id}`],
      serviceTypeCodes: ['GRAVESIDE_BURIAL_SERVICE_ONLY'],
    });
    expect(wix.rows('activityEvents').map((r) => r.data.eventType)).toEqual(['workflow.template.updated', 'workflow.template.published']);

    const again = await approveVersion(graveside.id, 2);
    expect(again.status).toBe(409);
  });
});
