import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import { buildWixWorkflowTemplateData, buildWixWorkflowTemplateVersionData } from '@/lib/wixWorkflowTemplateMapper';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { STAGES, rawStagesForDisplayStage } from '@/domain/cases/stages';
import {
  BURIAL_ID,
  EXPECTED_LABELS,
  GUS,
  burialStages,
  burialTemplate,
  burialVersion,
  caseOn,
  crossServiceCases,
  gusTemplatesWithBurial,
  item,
  templates,
} from '@/domain/workflow/crossServiceRegression.fixtures';
import type { Case } from '@/types/case';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Service-specific workflows — cross-service regression, route level
 * (2026-10). GET /api/cases/counts (Dashboard "Cases by stage" + tab
 * counts) and GET /api/cases?stage= (Cases list stage filter) for Gus with
 * TWO approved workflows of different lengths (a fictional burial-shaped
 * one — see domain/workflow/crossServiceRegression.fixtures.ts — next to
 * Direct Cremation), on both adapters:
 *   - mock: the routes' own caseFixtures/workflowTemplateFixtures branch;
 *   - wix: the REAL routes, template fetch and case mapper against the
 *     in-memory stand-in for lib/wixDataApi.ts (lib/testing/inMemoryWixData.ts),
 *     with every count filter recorded so the exact `$or` sent is asserted.
 * Plus Managed Cremations on both adapters, unchanged. Fictional rows
 * only; no network.
 */

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
const countFilters = vi.hoisted(() => [] as Array<Record<string, unknown> | undefined>);
vi.mock('@/lib/wixDataApi', () => ({
  ...wix.api,
  countWixDataItems: async (collection: string, filter?: Record<string, unknown>) => {
    countFilters.push(filter);
    return wix.api.countWixDataItems(collection, filter);
  },
}));

const MANORS = 'managed-cremations';
const auth = vi.hoisted(() => ({ organizationId: 'gus-camacho-jr' }));
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: async () => ({
    authorized: true,
    context: { organizationId: auth.organizationId, userId: 'identity-test-admin', role: 'administrator' },
  }),
}));
vi.mock('@/services/authorizationPolicyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/authorizationPolicyService')>()),
  canReadCases: async () => true,
  canReadPickup: async () => true,
}));

const casesRoute = await import('./route');
const countsRoute = await import('./counts/route');

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

function useAdapter(mode: 'mock' | 'wix') {
  process.env.DATA_ADAPTER = mode;
  // Never a real credential; every Wix call is answered in memory.
  process.env.WIX_API_KEY = mode === 'wix' ? 'test-key-not-real' : '';
  process.env.WIX_SITE_ID = mode === 'wix' ? 'test-site-not-real' : '';
}

/** A fictional case as its live-shaped `cases` row. */
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
    isArchived: c.isDeleted,
    createdAt: c.createdAt,
  };
}

function seedWix(cases: Case[], gusTemplates: WorkflowTemplate[]) {
  for (const template of gusTemplates) {
    wix.seed('workflowTemplates', template.id, buildWixWorkflowTemplateData(template) as Record<string, unknown>);
    for (const version of template.versions) {
      wix.seed(
        'workflowTemplateVersions',
        `${template.id}-v${version.version}`,
        buildWixWorkflowTemplateVersionData({ beaconTemplateId: template.id, ...version }) as Record<string, unknown>,
      );
    }
  }
  for (const c of cases) {
    const row = wixCaseRow(c);
    expect(mapWixCaseItem(row)).not.toBeNull();
    wix.seed('cases', `row-${c.id}`, row as unknown as Record<string, unknown>);
  }
}

async function getCounts(organizationId: string) {
  const response = await countsRoute.GET(new Request(`http://localhost/api/cases/counts?organizationId=${organizationId}`));
  expect(response.status).toBe(200);
  return (await response.json()) as { total: number; byStage: Record<string, number> };
}

async function listStage(organizationId: string, stage: string, paged: boolean): Promise<string[]> {
  const response = await casesRoute.GET(
    new Request(`http://localhost/api/cases?organizationId=${organizationId}&stage=${encodeURIComponent(stage)}${paged ? '&limit=100' : ''}`),
  );
  expect(response.status).toBe(200);
  return ((await response.json()).cases as Case[]).map((c) => c.id).sort();
}

const sum = (byStage: Record<string, number>) => Object.values(byStage).reduce((a, b) => a + b, 0);

/** Raw-stage (Dashboard) counts the fictional cases must produce. */
const EXPECTED_COUNTS: Record<string, number> = {
  'First Call & Payment': 3,
  'JotForm Application': 0,
  'Cemetery Arrangements': 1,
  'EDRS & Doctor / Cause of Death': 1,
  'Permit & Authorization Sent to Crematory': 0,
  'Graveside Service Held': 1,
  'Death Certificate Application Sent': 2,
  'Ready for Pickup / Contact Family': 0,
  'Completed': 4,
};

let casesBefore: Case[];
let templatesBefore: WorkflowTemplate[];

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  casesBefore = structuredClone(caseFixtures);
  templatesBefore = structuredClone(workflowTemplateFixtures);
  auth.organizationId = GUS;
  wix.reset();
  countFilters.length = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
});

function useMockGusData(cases: Case[], gusTemplates: WorkflowTemplate[] = templates) {
  caseFixtures.splice(0, caseFixtures.length, ...caseFixtures.filter((c) => c.organizationId !== GUS), ...structuredClone(cases));
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...workflowTemplateFixtures.filter((t) => t.organizationId !== GUS), ...structuredClone(gusTemplates));
}

describe('Gus, two approved workflows of different lengths — mock adapter', () => {
  it('counts: one key per organization stage, exact per-label counts, summing to the total', async () => {
    useAdapter('mock');
    const cases = crossServiceCases();
    useMockGusData(cases);
    const counts = await getCounts(GUS);
    expect(Object.keys(counts.byStage)).toEqual(EXPECTED_LABELS);
    expect(counts.byStage).toEqual(EXPECTED_COUNTS);
    expect(counts.total).toBe(cases.length);
    expect(sum(counts.byStage)).toBe(counts.total);
  });

  it('stage filter: a shared label returns cases from both workflows and nothing else; a one-workflow label only its own', async () => {
    useAdapter('mock');
    useMockGusData(crossServiceCases());
    for (const paged of [false, true]) {
      expect(await listStage(GUS, 'Death Certificate Application Sent', paged)).toEqual(['bu-03', 'dc-04']);
      expect(await listStage(GUS, 'Completed', paged)).toEqual(['bu-05', 'bu-06', 'dc-05', 'dc-06']);
      expect(await listStage(GUS, 'First Call & Payment', paged)).toEqual(['bu-01', 'dc-01', 'dc-02']);
      expect(await listStage(GUS, 'Cemetery Arrangements', paged)).toEqual(['bu-02']);
      expect(await listStage(GUS, 'EDRS & Doctor / Cause of Death', paged)).toEqual(['dc-03']);
    }
  });

  it('every stage filter together partitions the cases (no case in two stages, none missing)', async () => {
    useAdapter('mock');
    const cases = crossServiceCases();
    useMockGusData(cases);
    const seen: string[] = [];
    for (const label of EXPECTED_LABELS) seen.push(...(await listStage(GUS, label, true)));
    expect(seen.sort()).toEqual(cases.map((c) => c.id).sort());
  });

  it('a stage that exists only in a DRAFT is not a valid filter, and the draft adds no count key', async () => {
    useAdapter('mock');
    const draftOnly = burialTemplate([burialVersion(1, burialStages(), 'draft')]);
    useMockGusData(crossServiceCases().filter((c) => c.workflowTemplateId === GUS_WORKFLOW_TEMPLATE_ID), gusTemplatesWithBurial(draftOnly));
    const counts = await getCounts(GUS);
    expect(Object.keys(counts.byStage)).not.toContain('Cemetery Arrangements');
    expect(Object.keys(counts.byStage)).toHaveLength(7);
    expect(sum(counts.byStage)).toBe(counts.total);
    const response = await casesRoute.GET(new Request(`http://localhost/api/cases?organizationId=${GUS}&stage=${encodeURIComponent('Cemetery Arrangements')}`));
    expect(response.status).toBe(400);
  });
});

describe('Gus, two approved workflows of different lengths — Wix adapter (in-memory)', () => {
  it('counts: one $or-of-(template, raw stages) count per organization stage, exact values, summing to the total', async () => {
    useAdapter('wix');
    const cases = crossServiceCases();
    seedWix(cases, templates);
    const counts = await getCounts(GUS);
    expect(Object.keys(counts.byStage)).toEqual(EXPECTED_LABELS);
    expect(counts.byStage).toEqual(EXPECTED_COUNTS);
    expect(counts.total).toBe(cases.length);
    expect(sum(counts.byStage)).toBe(counts.total);

    const base = { organizationId: GUS, isArchived: false };
    expect(countFilters[0]).toEqual(base);
    expect(countFilters).toHaveLength(1 + EXPECTED_LABELS.length);
    expect(countFilters).toContainEqual({
      $and: [
        base,
        { $or: [{ workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, currentStage: { $in: [5] } }, { workflowTemplateId: BURIAL_ID, currentStage: { $in: [3] } }] },
      ],
    });
    expect(countFilters).toContainEqual({
      $and: [
        base,
        { $or: [{ workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, currentStage: { $in: [0, 1] } }, { workflowTemplateId: BURIAL_ID, currentStage: { $in: [0, 1] } }] },
      ],
    });
    expect(countFilters).toContainEqual({ $and: [base, { $or: [{ workflowTemplateId: BURIAL_ID, currentStage: { $in: [4] } }] }] });
    expect(countFilters).toContainEqual({ $and: [base, { $or: [{ workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, currentStage: { $in: [3] } }] }] });
    // Never a bare raw-stage filter: raw stage 3 means different things on the two workflows.
    for (const filter of countFilters) expect(JSON.stringify(filter)).not.toMatch(/"isArchived":false,"currentStage"/);
  });

  it('archived cases are excluded from every count, as on the list', async () => {
    useAdapter('wix');
    const cases = crossServiceCases();
    cases.find((c) => c.id === 'bu-04')!.isDeleted = true;
    seedWix(cases, templates);
    const counts = await getCounts(GUS);
    expect(counts.total).toBe(cases.length - 1);
    expect(counts.byStage['Graveside Service Held']).toBe(0);
    expect(sum(counts.byStage)).toBe(counts.total);
  });

  it('stage filter (paged and unpaged): a shared label returns cases from both workflows and nothing else', async () => {
    useAdapter('wix');
    seedWix(crossServiceCases(), templates);
    for (const paged of [false, true]) {
      expect(await listStage(GUS, 'Death Certificate Application Sent', paged)).toEqual(['bu-03', 'dc-04']);
      expect(await listStage(GUS, 'Completed', paged)).toEqual(['bu-05', 'bu-06', 'dc-05', 'dc-06']);
      expect(await listStage(GUS, 'Graveside Service Held', paged)).toEqual(['bu-04']);
    }
  });

  it('a case created under a superseded version still counts under its own snapshot’s label (version-pinned filter)', async () => {
    useAdapter('wix');
    const v1Stages = [
      ...burialStages().slice(0, 2),
      { rawStage: 2, displayStage: 1, label: 'Cemetery Selection', isAttentionStage: false, slaTargetDays: 4, checklist: { items: [item(0, 'Fictional plot chosen')] } },
      { rawStage: 3, displayStage: 2, label: 'Completed', isAttentionStage: false, slaTargetDays: null, checklist: { items: [item(0, 'Fictional committal confirmed')] } },
    ];
    const twoVersions = burialTemplate([burialVersion(1, v1Stages), burialVersion(2, burialStages())]);
    const gusTemplates = gusTemplatesWithBurial(twoVersions);
    const [v1, v2] = twoVersions.versions;
    const cases = [
      caseOn(twoVersions, v1, 'old-02', 2),
      caseOn(twoVersions, v1, 'old-03', 3, { released: true }),
      caseOn(twoVersions, v2, 'new-02', 3),
      caseOn(twoVersions, v2, 'new-03', 5, { released: true }),
    ];
    seedWix(cases, gusTemplates);
    const counts = await getCounts(GUS);
    expect(counts.byStage['Cemetery Selection']).toBe(1);
    expect(counts.byStage['Completed']).toBe(2);
    expect(counts.byStage['Death Certificate Application Sent']).toBe(1);
    expect(sum(counts.byStage)).toBe(counts.total);
    expect(countFilters).toContainEqual({
      $and: [
        { organizationId: GUS, isArchived: false },
        {
          $or: [
            { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, currentStage: { $in: [5] } },
            { workflowTemplateId: BURIAL_ID, workflowTemplateVersion: { $in: [2] }, currentStage: { $in: [3] } },
          ],
        },
      ],
    });
    expect(await listStage(GUS, 'Completed', true)).toEqual(['new-03', 'old-03']);

    // Mock adapter, same data: same answer.
    useAdapter('mock');
    useMockGusData(cases, gusTemplates);
    expect(await getCounts(GUS)).toEqual(counts);
  });
});

describe('Managed Cremations is unchanged on both adapters', () => {
  const manorsCases = () => casesBefore.filter((c) => c.organizationId === MANORS && !c.isDeleted);
  const expectedByStage = () =>
    Object.fromEntries(STAGES.map((label, ds) => [label, manorsCases().filter((c) => rawStagesForDisplayStage(ds).includes(c.rawStage)).length]));

  it('counts keep the seven STAGES keys, raw-stage membership, and no template/version clause', async () => {
    auth.organizationId = MANORS;
    useAdapter('mock');
    const mockCounts = await getCounts(MANORS);
    expect(mockCounts.byStage).toEqual(expectedByStage());

    useAdapter('wix');
    seedWix(manorsCases(), []);
    const wixCounts = await getCounts(MANORS);
    expect(wixCounts).toEqual(mockCounts);
    for (const filter of countFilters) expect(JSON.stringify(filter)).not.toMatch(/workflowTemplate/);
    expect(countFilters[1]).toEqual({ organizationId: MANORS, isArchived: false, currentStage: { $in: [0, 1] } });
  });

  it('the stage filter still accepts the presented and historical labels with raw-stage semantics', async () => {
    auth.organizationId = MANORS;
    useAdapter('mock');
    const intake = manorsCases().filter((c) => [0, 1, 2].includes(c.rawStage)).map((c) => c.id).sort();
    expect(await listStage(MANORS, 'Intake & JotForm', true)).toEqual(intake);
    const edrs = manorsCases().filter((c) => c.rawStage === 3).map((c) => c.id).sort();
    expect(await listStage(MANORS, 'EDRS & Doctor / Cause of Death', true)).toEqual(edrs);

    useAdapter('wix');
    seedWix(manorsCases(), []);
    expect(await listStage(MANORS, 'Intake & JotForm', true)).toEqual(intake);
    expect(await listStage(MANORS, 'EDRS & Doctor / Cause of Death', true)).toEqual(edrs);
  });
});
