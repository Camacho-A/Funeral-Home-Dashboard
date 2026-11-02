import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { casesService } from './casesService';
import { reconcileCaseWorkflow } from './workflowReconciliationService';
import { caseFixtures } from './__mocks__/fixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID, STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID } from './__mocks__/workflowTemplates';
import { GUS_ADMIN_STAFF_ID } from './__mocks__/gusFixtures';
import { buildCaseViewModel } from '../domain/cases/viewModel';
import { advanceToNextSnapshotStage, advanceToNextStage } from '../domain/cases/transitions';
import { computeKpis } from '../domain/reports/calculations';
import { GUS_SERVICE_CATALOG } from '../domain/onboarding/gusServiceCatalog';
import type { Case, NewCaseInput } from '../types/case';
import type { Session } from '../types/session';
import type { OrganizationContext } from '../types/organization';
import type { WorkflowTemplate } from '../types/workflowTemplate';

/**
 * Service-specific workflows (2026-10) — the mock (local) case paths for
 * Gus Camacho Jr.: creation per service type, stage progression with
 * automatic advancement, progress %, the local counts/list, and a
 * confirmed service change. Fictional data only.
 */

const GUS = 'gus-camacho-jr';
const gus: OrganizationContext = { organizationId: GUS };
const session: Session = { staffId: GUS_ADMIN_STAFF_ID, displayName: 'Fictional Admin' };
const gusTemplates = () => workflowTemplateFixtures.filter((t) => t.organizationId === GUS);
const directCremation = () => gusTemplates().find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;

const INPUT: NewCaseInput = {
  decedentName: 'Fictional Decedent',
  nextOfKinName: 'Fictional Contact',
  nextOfKinPhone: '(555) 010-0000',
  dateOfBirth: '01/02/1940',
  dateOfDeath: '10/01/2026',
  timeOfDeath: '08:30',
  placeOfDeath: 'Sample Hospital',
  weight: '160 lb',
  certifierName: 'Dr. Fictional',
  certifierPhone: '(555) 010-0001',
  // Gus's Certifier Information needs the fax (2026-11).
  certifierFax: '(555) 010-0002',
};

let casesBefore: Case[];
let templatesBefore: WorkflowTemplate[];

beforeEach(() => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  casesBefore = structuredClone(caseFixtures);
  templatesBefore = structuredClone(workflowTemplateFixtures);
});

afterEach(() => {
  caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
  workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
});

describe('mock create — the selected service decides the workflow', () => {
  it('Direct Cremation creates a case on its approved workflow, service recorded', async () => {
    const created = await casesService.create(gus, { ...INPUT, serviceTypeCode: 'DIRECT_CREMATION' }, session, directCremation());
    expect(created.workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
    expect(created.workflowSnapshot?.serviceTypeCode).toBe('DIRECT_CREMATION');
    expect(created.rawStage).toBe(0);
  });

  it.each(['CREMATION_WITH_VIEWING', 'CREMATION_WITH_FINAL_GOODBYE'])('%s creates a case on the shared cremation process', async (code) => {
    const created = await casesService.create(gus, { ...INPUT, serviceTypeCode: code }, session, directCremation());
    expect(created.workflowSnapshot?.serviceTypeCode).toBe(code);
    expect(created.workflowSnapshot?.composition?.base.key).toBe('cremation.base');
  });

  it.each(GUS_SERVICE_CATALOG.slice(3).map((entry) => [entry.serviceCode, entry.displayName]))(
    '%s is refused while its workflow is a draft — no case is created',
    async (code, name) => {
      const before = caseFixtures.length;
      await expect(casesService.create(gus, { ...INPUT, serviceTypeCode: code }, session, directCremation())).rejects.toThrow(
        `The workflow for ${name} has not been approved yet.`,
      );
      expect(caseFixtures.length).toBe(before);
    },
  );

  it('cannot be steered by passing another template — the selection is re-run for the service', async () => {
    const entombment = gusTemplates().find((t) => t.serviceTypeCodes?.includes('DIRECT_ENTOMBMENT'))!;
    const created = await casesService.create(gus, { ...INPUT, serviceTypeCode: 'DIRECT_CREMATION' }, session, entombment);
    expect(created.workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
  });

  it('Manors keeps "the template it is given, latest version" with no service on the snapshot', async () => {
    const manorsTemplate = workflowTemplateFixtures.find((t) => t.id === STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID)!;
    const created = await casesService.create(
      { organizationId: 'managed-cremations' },
      { ...INPUT, serviceTypeCode: 'DIRECT_ENTOMBMENT' },
      { staffId: 'staff-1', displayName: 'Dana' },
      manorsTemplate,
    );
    expect(created.workflowTemplateId).toBe(STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID);
    expect(created.workflowTemplateVersion).toBe(manorsTemplate.versions[manorsTemplate.versions.length - 1].version);
    expect(created.workflowSnapshot && 'serviceTypeCode' in created.workflowSnapshot).toBe(false);
  });
});

describe('Direct Cremation — stage progression, automatic advancement and progress', () => {
  it('advances stage by stage as the checklist is completed, and progress % follows', async () => {
    const created = await casesService.create(gus, { ...INPUT, serviceTypeCode: 'DIRECT_CREMATION' }, session, directCremation());
    const progress = () => buildCaseViewModel(caseFixtures.find((c) => c.id === created.id)!, { staffList: [] });
    const set = (patch: Partial<Case>) => {
      const index = caseFixtures.findIndex((c) => c.id === created.id);
      caseFixtures[index] = { ...caseFixtures[index], ...patch };
    };
    const startPercent = progress().progressPercent;
    expect(progress().stageLabel).toBe('First Call & Payment');

    // First Call & Payment: intake data is on the case; the three payment
    // confirmations are manual.
    set({ checklistState: { '0:8': true, '0:9': true, '0:10': true } });
    expect((await reconcileCaseWorkflow(GUS, created.id, 'mock')).rawStage).toBe(2);
    expect(progress().stageLabel).toBe('JotForm Application');
    const afterFirstCall = progress().progressPercent;
    expect(afterFirstCall).toBeGreaterThan(startPercent);

    set({ checklistState: { ...caseFixtures.find((c) => c.id === created.id)!.checklistState, '1:0': true } });
    expect((await reconcileCaseWorkflow(GUS, created.id, 'mock')).rawStage).toBe(3);
    expect(progress().stageLabel).toBe('EDRS & Doctor / Cause of Death');
    expect(progress().progressPercent).toBeGreaterThan(afterFirstCall);
    // Separate stepper positions, never combined.
    expect(progress().stageLabels.slice(0, 2)).toEqual(['First Call & Payment', 'JotForm Application']);
  });

  it('the bulk advance is bounded by the case’s own workflow for Gus; Manors keeps +1', () => {
    const last = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 7)!;
    expect(advanceToNextSnapshotStage(last).rawStage).toBe(7);
    const mid = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 4)!;
    expect(advanceToNextSnapshotStage(mid)).toEqual({ rawStage: 5, daysWaitingInStage: 0 });
    expect(advanceToNextStage(last).rawStage).toBe(8);
  });

  it('KPIs count a Gus case as completed on its own workflow’s terminal stage', () => {
    const views = caseFixtures.filter((c) => c.organizationId === GUS && !c.isDeleted).map((c) => buildCaseViewModel(c, { staffList: [] }));
    const kpis = computeKpis(views, GUS);
    expect(kpis.activeCases + kpis.completedCases).toBe(views.length);
    expect(computeKpis(views)).toEqual(computeKpis(views, 'managed-cremations'));
  });
});

describe('mock counts and stage filter for Gus', () => {
  it('counts are keyed by the organization stage list (no "Intake & JotForm")', async () => {
    const counts = await casesService.counts(gus);
    expect(Object.keys(counts.byStage)).toEqual([
      'First Call & Payment',
      'JotForm Application',
      'EDRS & Doctor / Cause of Death',
      'Permit & Authorization Sent to Crematory',
      'Death Certificate Application Sent',
      'Ready for Pickup / Contact Family',
      'Completed',
    ]);
    expect(Object.values(counts.byStage).reduce((a, b) => a + b, 0)).toBe(counts.total);
  });

  it('a stage page lists only that stage’s cases', async () => {
    const page = await casesService.listPage(gus, { stage: 'Death Certificate Application Sent' });
    expect(page.cases.length).toBeGreaterThan(0);
    for (const c of page.cases) expect(c.rawStage).toBe(5);
    expect((await casesService.listPage(gus, { stage: 'Intake & JotForm' })).cases).toEqual([]);
  });

  it('Manors local counts are unchanged (STAGES keys)', async () => {
    const counts = await casesService.counts({ organizationId: 'managed-cremations' });
    expect(Object.keys(counts.byStage)[1]).toBe('Jotform Application');
    expect(Object.keys(counts.byStage)).toHaveLength(7);
  });
});

describe('mock service change (casesService.changeWorkflow)', () => {
  function approveViewing() {
    const viewing = gusTemplates().find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
    viewing.versions[0].status = 'approved';
    return viewing;
  }

  it('previews without writing, then applies only on confirm — history appended', async () => {
    const viewing = approveViewing();
    const target = caseFixtures.find((c) => c.organizationId === GUS && c.workflowTemplateId === GUS_WORKFLOW_TEMPLATE_ID && c.rawStage > 0)!;
    const before = structuredClone(target);
    const input = { serviceTypeCode: 'CREMATION_WITH_VIEWING', expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID };

    const preview = await casesService.changeWorkflow(gus, target.id, { ...input, confirm: false }, session);
    expect(preview.applied).toBe(false);
    expect(caseFixtures.find((c) => c.id === target.id)).toEqual(before);

    // The confirm is pinned to the revision its preview was made on.
    const applied = await casesService.changeWorkflow(gus, target.id, { ...input, confirm: true, expectedRevision: preview.caseRevision }, session);
    expect(applied.applied).toBe(true);
    const stored = caseFixtures.find((c) => c.id === target.id)!;
    expect(stored.workflowTemplateId).toBe(viewing.id);
    expect(stored.workflowHistory?.[0]).toMatchObject({ workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, rawStage: target.rawStage, changedByUserId: GUS_ADMIN_STAFF_ID });
  });

  it('refuses a draft target and a non-Gus organization', async () => {
    const target = caseFixtures.find((c) => c.organizationId === GUS)!;
    await expect(
      casesService.changeWorkflow(gus, target.id, { serviceTypeCode: 'DIRECT_ENTOMBMENT', expectedWorkflowTemplateId: target.workflowTemplateId, confirm: true }, session),
    ).rejects.toThrow(/has not been approved yet/);
    const manorsCase = caseFixtures.find((c) => c.organizationId === 'managed-cremations')!;
    await expect(
      casesService.changeWorkflow({ organizationId: 'managed-cremations' }, manorsCase.id, { serviceTypeCode: 'X', expectedWorkflowTemplateId: manorsCase.workflowTemplateId, confirm: true }, session),
    ).rejects.toThrow(/does not select workflows by service type/);
  });
});
