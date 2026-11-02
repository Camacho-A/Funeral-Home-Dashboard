import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import {
  workflowTemplateFixtures,
  standardCremationWorkflowTemplateFixture,
  GUS_WORKFLOW_TEMPLATE_ID,
} from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { buildCaseWorkflowSnapshot } from '@/domain/workflow/snapshot';
import type { Case } from '@/types/case';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Service-specific workflows (2026-10). POST /api/cases (workflow
 * selection), GET /api/cases (stage filter) and GET /api/cases/counts for
 * Gus Camacho Jr., whose cases run on several workflow templates — plus
 * the Manors behavior those paths must keep. Fictional data only; every
 * Wix call is a mock (no network).
 */

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';

let currentOrg = GUS;
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: async () => ({
    authorized: true,
    context: { organizationId: currentOrg, userId: 'identity-test-admin', role: 'administrator' },
  }),
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canCreateCase: async () => true,
  canReadCases: async () => true,
  canReadPickup: async () => true,
}));

const mockQuery = vi.fn();
const mockInsert = vi.fn();
const mockCount = vi.fn();
vi.mock('@/lib/wixDataApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wixDataApi')>();
  return {
    WixDataApiError: actual.WixDataApiError,
    queryWixDataItems: (...args: unknown[]) => mockQuery(...args),
    queryAllWixDataItems: async (collectionId: string, filter?: Record<string, unknown>) =>
      (await mockQuery(collectionId, { filter })).dataItems,
    insertWixDataItem: (...args: unknown[]) => mockInsert(...args),
    countWixDataItems: (...args: unknown[]) => mockCount(...args),
    updateWixDataItem: vi.fn(),
  };
});

let wixTemplates: WorkflowTemplate[] = [];
vi.mock('@/lib/wixWorkflowTemplateMapper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wixWorkflowTemplateMapper')>()),
  fetchWixWorkflowTemplates: async (organizationId: string) => wixTemplates.filter((t) => t.organizationId === organizationId),
}));
const mockGetServiceCatalog = vi.fn(async (organizationId: string) =>
  serviceCatalogFixtures.filter((item) => item.organizationId === organizationId && item.isActive),
);
vi.mock('@/services/pricingService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/pricingService')>()),
  getServiceCatalog: (organizationId: string) => mockGetServiceCatalog(organizationId),
}));
vi.mock('@/services/staffProfileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/staffProfileService')>()),
  resolveStaffProfileForCaller: async () => ({ id: 'staff-test-admin' }),
}));
vi.mock('@/lib/wixCaseNumberSequence', () => ({
  reserveNextCaseNumber: async () => 'M2026-901',
  advanceCaseSequencePast: async () => undefined,
}));
vi.mock('@/services/organizationProvisioningService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/organizationProvisioningService')>()),
  getOrganization: async (id: string) => ({ id, name: 'Test', timezone: 'America/New_York', caseNumberPrefix: id === GUS ? 'M' : 'B' }),
}));
vi.mock('@/services/caseNotifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/caseNotifications')>()),
  notifyCaseCreated: async () => undefined,
}));
vi.mock('@/services/activityService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/activityService')>()),
  recordCaseCreated: async () => undefined,
}));

const casesRoute = await import('./route');
const countsRoute = await import('./counts/route');

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

function useAdapter(mode: 'mock' | 'wix') {
  process.env.DATA_ADAPTER = mode;
  // Never a real credential; every Wix call below is mocked.
  process.env.WIX_API_KEY = mode === 'wix' ? 'test-key-not-real' : '';
  process.env.WIX_SITE_ID = mode === 'wix' ? 'test-site-not-real' : '';
}

function postCase(body: Record<string, unknown>) {
  return casesRoute.POST(
    new Request('http://localhost/api/cases', {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ decedentName: 'FICTIONAL DECEDENT', nextOfKinName: 'FICTIONAL CONTACT', nextOfKinPhone: '(555) 010-0000', ...body }),
    }),
  );
}

/** Gus' templates with Cremation with Viewing approved under a different,
    fictional stage list (test data only), so cases on two templates share
    some stage names and not others. */
/** Gus's templates with Cremation with Viewing replaced by a fictional,
    shorter approved version — two workflows of different lengths. Final
    Goodbye (the same stages as Direct Cremation, 2026-11) is left out. */
function gusTemplatesWithApprovedViewing(): WorkflowTemplate[] {
  const templates = structuredClone(
    workflowTemplateFixtures.filter((t) => t.organizationId === GUS && !t.serviceTypeCodes?.includes('CREMATION_WITH_FINAL_GOODBYE')),
  );
  const viewing = templates.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
  viewing.versions = [
    {
      ...viewing.versions[0],
      status: 'approved',
      stages: [
        viewing.versions[0].stages[0],
        viewing.versions[0].stages[1],
        { rawStage: 2, displayStage: 1, label: 'JotForm Application', isAttentionStage: false, slaTargetDays: 1, checklist: { items: [{ index: 0, label: 'Jotform application completed', hasField: false }] } },
        { rawStage: 3, displayStage: 2, label: 'Viewing Scheduled', isAttentionStage: false, slaTargetDays: 2, checklist: { items: [{ index: 0, label: 'Viewing date confirmed', hasField: false }] } },
        { rawStage: 4, displayStage: 3, label: 'Completed', isAttentionStage: false, slaTargetDays: null, checklist: { items: [{ index: 0, label: 'Service held', hasField: false }] } },
      ],
    },
  ];
  return templates;
}

let casesBefore: Case[];
let templatesBefore: WorkflowTemplate[];

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  casesBefore = structuredClone(caseFixtures);
  templatesBefore = structuredClone(workflowTemplateFixtures);
  currentOrg = GUS;
  wixTemplates = structuredClone(workflowTemplateFixtures);
  mockQuery.mockReset();
  mockInsert.mockReset();
  mockCount.mockReset();
  mockGetServiceCatalog.mockClear();
  mockInsert.mockImplementation(async (_collection: string, data: unknown) => ({ id: 'x', dataCollectionId: 'cases', data }));
  mockQuery.mockResolvedValue({ dataItems: [] });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
});

describe('POST /api/cases — workflow follows the selected service (Gus)', () => {
  beforeEach(() => useAdapter('wix'));

  it('Direct Cremation loads its approved workflow and records the service on the snapshot', async () => {
    const response = await postCase({ organizationId: GUS, serviceTypeCode: 'DIRECT_CREMATION' });
    expect(response.status).toBe(201);
    const inserted = mockInsert.mock.calls[0][1] as Record<string, unknown> & { workflowSnapshot: { serviceTypeCode: string; stages: { label: string }[] } };
    expect(inserted.workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    expect(inserted.workflowSnapshot.serviceTypeCode).toBe('DIRECT_CREMATION');
    expect(inserted.workflowSnapshot.stages.map((s) => s.label)).toContain('JotForm Application');
    expect(inserted.workflowSnapshot.stages.map((s) => s.label)).not.toContain('Intake & JotForm');
  });

  it.each(['CREMATION_WITH_FINAL_GOODBYE', 'CREMATION_WITH_VIEWING'])('%s creates a case on the shared cremation process (201)', async (code) => {
    const response = await postCase({ organizationId: GUS, serviceTypeCode: code });
    expect(response.status).toBe(201);
    const inserted = mockInsert.mock.calls[0][1] as { workflowSnapshot: { serviceTypeCode: string; composition?: { base: { key: string } } } };
    expect(inserted.workflowSnapshot.serviceTypeCode).toBe(code);
    expect(inserted.workflowSnapshot.composition?.base.key).toBe('cremation.base');
  });

  it.each([
    ['GRAVESIDE_BURIAL_SERVICE_ONLY', 'Graveside Burial Service Only (No Viewing)'],
    ['VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY', 'U.S. Veterans, Graveside Burial Service Only (No Viewing)'],
    ['DIRECT_ENTOMBMENT', 'Direct Entombment (Embalming Required)'],
  ])('%s is refused (422) while its workflow is a draft — nothing is created', async (code, name) => {
    const response = await postCase({ organizationId: GUS, serviceTypeCode: code });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe(
      `The workflow for ${name} has not been approved yet. An administrator must review and approve it in Settings › Workflow Templates before cases can use it.`,
    );
    expect(body.workflowSelectionRefused).toBe('not_approved');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('a missing or unknown service type is refused — never guessed', async () => {
    const missing = await postCase({ organizationId: GUS });
    expect(missing.status).toBe(422);
    expect((await missing.json()).workflowSelectionRefused).toBe('service_type_required');
    const unknown = await postCase({ organizationId: GUS, serviceTypeCode: 'NOT_A_GUS_SERVICE' });
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).workflowSelectionRefused).toBe('unknown_service_type');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('Manors: first enabled template exactly as before — serviceTypeCode ignored, catalog never read, no service on the snapshot', async () => {
    currentOrg = MANORS;
    const response = await postCase({ organizationId: MANORS, serviceTypeCode: 'CREMATION_WITH_VIEWING' });
    expect(response.status).toBe(201);
    const inserted = mockInsert.mock.calls[0][1] as Record<string, unknown> & { workflowSnapshot: Record<string, unknown> };
    const latest = standardCremationWorkflowTemplateFixture.versions[standardCremationWorkflowTemplateFixture.versions.length - 1];
    expect(inserted.workflowSnapshot).toEqual(buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, latest));
    expect('serviceTypeCode' in inserted.workflowSnapshot).toBe(false);
    expect(mockGetServiceCatalog).not.toHaveBeenCalled();
  });
});

describe('Gus stage surfaces across several workflow templates', () => {
  it('mock counts group by organization stage, each case counted by its own (template, raw stage)', async () => {
    useAdapter('mock');
    const templates = gusTemplatesWithApprovedViewing();
    const viewing = templates.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
    workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...workflowTemplateFixtures.filter((t) => t.organizationId !== GUS), ...templates);
    // One fictional case on the Viewing workflow at its raw stage 3
    // ("Viewing Scheduled") — on Direct Cremation, raw stage 3 is EDRS.
    // Only Direct Cremation demo cases stay, so every count below is exact.
    caseFixtures.splice(0, caseFixtures.length, ...caseFixtures.filter((c) => c.organizationId !== GUS || c.workflowTemplateId === GUS_WORKFLOW_TEMPLATE_ID));
    const base = caseFixtures.find((c) => c.organizationId === GUS)!;
    caseFixtures.push({ ...structuredClone(base), id: 'gus-viewing-case', caseNumber: 'M2026-990', workflowTemplateId: viewing.id, rawStage: 3 });

    const response = await countsRoute.GET(new Request(`http://localhost/api/cases/counts?organizationId=${GUS}`));
    const body = await response.json();
    expect(Object.keys(body.byStage)).toEqual([
      'First Call & Payment',
      'JotForm Application',
      'EDRS & Doctor / Cause of Death',
      'Viewing Scheduled',
      'Permit & Authorization Sent to Crematory',
      'Death Certificate Application Sent',
      'Ready for Pickup / Contact Family',
      'Completed',
    ]);
    const gusCases = caseFixtures.filter((c) => c.organizationId === GUS && !c.isDeleted);
    const directAt = (raw: number) => gusCases.filter((c) => c.workflowTemplateId === GUS_WORKFLOW_TEMPLATE_ID && c.rawStage === raw).length;
    expect(body.byStage['Viewing Scheduled']).toBe(1);
    expect(body.byStage['EDRS & Doctor / Cause of Death']).toBe(directAt(3));
    expect(body.byStage['Completed']).toBe(directAt(7));
    expect(body.total).toBe(gusCases.length);
  });

  it('mock list filter by stage returns only cases on that (template, raw stage); unknown labels are 400', async () => {
    useAdapter('mock');
    const edrs = await casesRoute.GET(new Request(`http://localhost/api/cases?organizationId=${GUS}&stage=${encodeURIComponent('EDRS & Doctor / Cause of Death')}`));
    expect(edrs.status).toBe(200);
    const { cases } = await edrs.json();
    expect(cases.length).toBeGreaterThan(0);
    // Gus's three cremation services share the stage (2026-11).
    const cremationIds = workflowTemplateFixtures.filter((t) => t.organizationId === GUS && t.caseTypes.includes('cremation')).map((t) => t.id);
    for (const c of cases) {
      expect(cremationIds).toContain(c.workflowTemplateId);
      expect(c.rawStage).toBe(3);
    }

    const combined = await casesRoute.GET(new Request(`http://localhost/api/cases?organizationId=${GUS}&stage=${encodeURIComponent('Intake & JotForm')}`));
    expect(combined.status).toBe(400);
    expect((await combined.json()).error).toContain('JotForm Application');
  });

  it('wix counts send one $or-of-(template, raw stages) count per organization stage', async () => {
    useAdapter('wix');
    wixTemplates = gusTemplatesWithApprovedViewing();
    const viewing = wixTemplates.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
    mockCount.mockResolvedValue(0);
    const response = await countsRoute.GET(new Request(`http://localhost/api/cases/counts?organizationId=${GUS}`));
    expect(response.status).toBe(200);
    const filters = mockCount.mock.calls.map((call) => call[1]);
    expect(filters[0]).toEqual({ organizationId: GUS, isArchived: false });
    expect(filters).toContainEqual({
      $and: [
        { organizationId: GUS, isArchived: false },
        {
          $or: [
            { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, currentStage: { $in: [7] } },
            { workflowTemplateId: viewing.id, currentStage: { $in: [4] } },
          ],
        },
      ],
    });
    expect(Object.keys((await response.json()).byStage)).toHaveLength(8);
  });

  it('wix list with a stage filters on the case workflow template id, never a bare raw stage', async () => {
    useAdapter('wix');
    await casesRoute.GET(new Request(`http://localhost/api/cases?organizationId=${GUS}&stage=${encodeURIComponent('JotForm Application')}&limit=25`));
    const casesCall = mockQuery.mock.calls.find((call) => call[0] === 'cases')!;
    // One clause per cremation workflow (Gus's three share the stage).
    const cremationIds = workflowTemplateFixtures.filter((t) => t.organizationId === GUS && t.caseTypes.includes('cremation')).map((t) => t.id);
    expect(casesCall[1].filter).toEqual({
      $and: [{ organizationId: GUS, isArchived: false }, { $or: cremationIds.map((workflowTemplateId) => ({ workflowTemplateId, currentStage: { $in: [2] } })) }],
    });
  });

  it('Manors wix counts keep the raw-stage filters, with no template clause', async () => {
    useAdapter('wix');
    currentOrg = MANORS;
    mockCount.mockResolvedValue(0);
    const response = await countsRoute.GET(new Request(`http://localhost/api/cases/counts?organizationId=${MANORS}`));
    expect(Object.keys((await response.json()).byStage)).toEqual([
      'First Call & Payment',
      'Jotform Application',
      'EDRS & Doctor / Cause of Death',
      'Permit & Authorization Sent to Crematory',
      'DC Application Sent',
      'Ready for Pickup / Contact Family',
      'Completed',
    ]);
    for (const [, filter] of mockCount.mock.calls) expect(JSON.stringify(filter)).not.toContain('workflowTemplateId');
    expect(mockCount.mock.calls[1][1]).toEqual({ organizationId: MANORS, isArchived: false, currentStage: { $in: [0, 1] } });
  });
});
