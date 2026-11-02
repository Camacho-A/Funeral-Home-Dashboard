import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  caseIsInOrganizationStage,
  findOrganizationStage,
  organizationStageLabels,
  resolveOrganizationStages,
  wixFilterForOrganizationStage,
} from './organizationStages';
import { displayStagesInOrder } from './resolveStages';
import {
  BURIAL_ID,
  EXPECTED_LABELS,
  GUS,
  burial,
  burialStages,
  burialTemplate,
  burialV,
  burialVersion,
  caseOn,
  crossServiceCases,
  direct,
  directV,
  everyBurialItemChecked,
  gusTemplatesWithBurial,
  item,
  templates,
} from './crossServiceRegression.fixtures';
import { buildCaseViewModel } from '../cases/viewModel';
import { advanceToNextSnapshotStage, advanceToNextStage } from '../cases/transitions';
import { STAGES, rawStagesForDisplayStage } from '../cases/stages';
import { presentedStages } from '../organization/workflowStagePresentation';
import { computeKpis, computeStageBreakdownByOrganizationStage, reportStageRef } from '../reports/calculations';
import { computeFirstIncompleteRawStage, reconcileCaseWorkflow } from '../../services/workflowReconciliationService';
import { averageDaysInStageSnapshot, caseCountsByStage, countActiveCases, countOverdueCases } from '../../services/reportingService';
import { buildAllCaseDataRows } from '../../services/allCaseDataReportService';
import * as casesService from '../../services/casesService';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import {
  workflowTemplateFixtures,
  buildGusServiceWorkflowTemplateFixtures,
  standardCremationWorkflowTemplateFixture,
  GUS_WORKFLOW_TEMPLATE_ID,
} from '../../services/__mocks__/workflowTemplates';
import type { Case } from '../../types/case';
import type { CaseViewModel } from '../../types/caseViewModel';
import type { StageTemplate, WorkflowTemplate } from '../../types/workflowTemplate';

/**
 * Service-specific workflows — cross-service regression (2026-10).
 *
 * Gus Camacho Jr. runs one workflow per service, and those workflows have
 * DIFFERENT numbers of stages. Only Direct Cremation (7 display / 8 raw
 * stages) is approved today, so this suite uses a FICTIONAL second approved
 * workflow built for the test (crossServiceRegression.fixtures.ts — a
 * burial-shaped one with 5 display / 6 raw stages, sharing "First Call &
 * Payment", "Death Certificate Application Sent" and "Completed" with
 * Direct Cremation and adding two labels of its own) and fictional cases
 * spread across both. It pins every shared surface (stage list, counts,
 * filters, progress, SLA, reports, auto-advance, case detail) to "each
 * case is read against its OWN workflow", and pins Managed Cremations to
 * the global STAGES behaviour. Route-level (mock + Wix) coverage lives in
 * app/api/cases/crossServiceStages.test.ts. Fictional data only.
 */

const MANORS = 'managed-cremations';

const view = (c: Case): CaseViewModel => buildCaseViewModel(c, { staffList: [] });

function countByLabel(model: ReturnType<typeof resolveOrganizationStages>, cases: Case[]): Record<string, number> {
  return Object.fromEntries(model.stages.map((stage) => [stage.label, cases.filter((c) => caseIsInOrganizationStage(stage, c)).length]));
}

describe('Gus organization stage list across workflows with different stage counts', () => {
  const model = resolveOrganizationStages(GUS, templates);

  it('is the ordered union by label: shared labels once, each template’s own labels in position, Completed last', () => {
    expect(model.kind).toBe('per_template');
    expect(organizationStageLabels(model)).toEqual(EXPECTED_LABELS);
  });

  it('a shared label covers both templates at their OWN raw stages; a one-template label covers only that template', () => {
    expect(findOrganizationStage(model, 'First Call & Payment')!.members).toEqual([
      { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, rawStages: [0, 1] },
      { workflowTemplateId: BURIAL_ID, rawStages: [0, 1] },
    ]);
    expect(findOrganizationStage(model, 'Death Certificate Application Sent')!.members).toEqual([
      { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, rawStages: [5] },
      { workflowTemplateId: BURIAL_ID, rawStages: [3] },
    ]);
    expect(findOrganizationStage(model, 'Completed')!.members).toEqual([
      { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, rawStages: [7] },
      { workflowTemplateId: BURIAL_ID, rawStages: [5] },
    ]);
    expect(findOrganizationStage(model, 'Cemetery Arrangements')!.members).toEqual([{ workflowTemplateId: BURIAL_ID, rawStages: [2] }]);
    expect(findOrganizationStage(model, 'EDRS & Doctor / Cause of Death')!.members).toEqual([{ workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, rawStages: [3] }]);
  });

  it('attention, terminal and SLA come from the templates (a shared row takes the longest target, never a sum)', () => {
    expect(findOrganizationStage(model, 'Cemetery Arrangements')!.isAttentionStage).toBe(true);
    expect(findOrganizationStage(model, 'EDRS & Doctor / Cause of Death')!.isAttentionStage).toBe(true);
    expect(findOrganizationStage(model, 'Graveside Service Held')!.isAttentionStage).toBe(false);
    expect(model.stages.filter((s) => s.isTerminal).map((s) => s.label)).toEqual(['Completed']);
    expect(findOrganizationStage(model, 'Death Certificate Application Sent')!.slaTargetDays).toBe(3);
    expect(findOrganizationStage(model, 'Graveside Service Held')!.slaTargetDays).toBe(1);
    expect(findOrganizationStage(model, 'Completed')!.slaTargetDays).toBeNull();
  });

  it('every case lands in exactly one stage, so the per-stage counts sum to the total', () => {
    const cases = crossServiceCases();
    for (const c of cases) expect(model.stages.filter((s) => caseIsInOrganizationStage(s, c))).toHaveLength(1);
    const counts = countByLabel(model, cases);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(cases.length);
    expect(counts).toEqual({
      'First Call & Payment': 3,
      'JotForm Application': 0,
      'Cemetery Arrangements': 1,
      'EDRS & Doctor / Cause of Death': 1,
      'Permit & Authorization Sent to Crematory': 0,
      'Graveside Service Held': 1,
      'Death Certificate Application Sent': 2,
      'Ready for Pickup / Contact Family': 0,
      'Completed': 4,
    });
  });

  it('the Wix filter for a shared label is an $or of each template’s own (template, raw stages)', () => {
    expect(wixFilterForOrganizationStage(findOrganizationStage(model, 'Death Certificate Application Sent')!)).toEqual({
      $or: [
        { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, currentStage: { $in: [5] } },
        { workflowTemplateId: BURIAL_ID, currentStage: { $in: [3] } },
      ],
    });
    expect(wixFilterForOrganizationStage(findOrganizationStage(model, 'Graveside Service Held')!)).toEqual({
      $or: [{ workflowTemplateId: BURIAL_ID, currentStage: { $in: [4] } }],
    });
  });
});

describe('draft and superseded versions', () => {
  it('Gus as shipped: the burial/entombment drafts add no stage — only the seven cremation stages its three cremation services share', () => {
    const shipped = buildGusServiceWorkflowTemplateFixtures();
    const model = resolveOrganizationStages(GUS, shipped);
    expect(organizationStageLabels(model)).toEqual(displayStagesInOrder({ ...directV, workflowTemplateId: direct.id, workflowTemplateVersion: 1 }).map((s) => s.label));
    const cremationIds = shipped.filter((t) => t.caseTypes.includes('cremation')).map((t) => t.id);
    expect(cremationIds).toHaveLength(3);
    for (const stage of model.stages) expect(stage.members.map((m) => m.workflowTemplateId)).toEqual(cremationIds);
  });

  it('a draft version adds nothing until it is approved, then its stages appear', () => {
    const draftOnly = burialTemplate([burialVersion(1, burialStages(), 'draft')]);
    const asDraft = resolveOrganizationStages(GUS, gusTemplatesWithBurial(draftOnly));
    expect(organizationStageLabels(asDraft)).not.toContain('Cemetery Arrangements');
    expect(findOrganizationStage(asDraft, 'Completed')!.members).toEqual([{ workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, rawStages: [7] }]);

    // A newer DRAFT on top of an approved version changes nothing either.
    const renamed = burialStages().map((s) => (s.label === 'Graveside Service Held' ? { ...s, label: 'Draft-only Stage Name' } : s));
    const pendingEdit = resolveOrganizationStages(GUS, gusTemplatesWithBurial(burialTemplate([burialVersion(1, burialStages()), burialVersion(2, renamed, 'draft')])));
    expect(organizationStageLabels(pendingEdit)).toEqual(EXPECTED_LABELS);

    const approved = burialTemplate([burialVersion(1, burialStages(), 'approved')]);
    expect(organizationStageLabels(resolveOrganizationStages(GUS, gusTemplatesWithBurial(approved)))).toEqual(EXPECTED_LABELS);
  });

  describe('a case created under a version later superseded keeps counting under its own snapshot’s labels', () => {
    // v1 (approved, older): 3 display / 4 raw stages, a stage later renamed.
    const v1Stages = (): StageTemplate[] => [
      ...burialStages().slice(0, 2),
      { rawStage: 2, displayStage: 1, label: 'Cemetery Selection', isAttentionStage: false, slaTargetDays: 4, checklist: { items: [item(0, 'Fictional plot chosen')] } },
      { rawStage: 3, displayStage: 2, label: 'Completed', isAttentionStage: false, slaTargetDays: null, checklist: { items: [item(0, 'Fictional committal confirmed')] } },
    ];
    const twoVersions = burialTemplate([burialVersion(1, v1Stages()), burialVersion(2, burialStages())]);
    const model = resolveOrganizationStages(GUS, gusTemplatesWithBurial(twoVersions));
    const [v1, v2] = twoVersions.versions;
    const cases = [
      caseOn(twoVersions, v1, 'old-01', 0),
      caseOn(twoVersions, v1, 'old-02', 2),
      caseOn(twoVersions, v1, 'old-03', 3, { released: true }),
      caseOn(twoVersions, v2, 'new-01', 2),
      caseOn(twoVersions, v2, 'new-02', 3),
      caseOn(twoVersions, v2, 'new-03', 5, { released: true }),
    ];

    it('the latest version still defines the order; the superseded name is listed for its cases', () => {
      const labels = organizationStageLabels(model);
      expect(labels.slice(0, 3)).toEqual(['First Call & Payment', 'JotForm Application', 'Cemetery Arrangements']);
      expect(labels).toContain('Cemetery Selection');
      expect(labels[labels.length - 1]).toBe('Completed');
      expect(new Set(labels).size).toBe(labels.length);
    });

    it('each case is counted once, under the label its own snapshot gives its raw stage', () => {
      for (const c of cases) {
        const matching = model.stages.filter((s) => caseIsInOrganizationStage(s, c)).map((s) => s.label);
        expect(matching).toEqual([c.workflowSnapshot!.stages.find((s) => s.rawStage === c.rawStage)!.label]);
      }
      const counts = countByLabel(model, cases);
      expect(counts['Cemetery Selection']).toBe(1); // old-02 (v1 raw 2)
      expect(counts['Cemetery Arrangements']).toBe(1); // new-01 (v2 raw 2)
      // Raw stage 3 is "Completed" on v1 but "Death Certificate Application Sent" on v2.
      expect(counts['Completed']).toBe(2); // old-03, new-03
      expect(counts['Death Certificate Application Sent']).toBe(1); // new-02
      expect(counts['First Call & Payment']).toBe(1); // unambiguous across versions
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(cases.length);
    });

    it('only the stages whose names differ between versions are pinned to a version (Wix: workflowTemplateVersion $in)', () => {
      expect(findOrganizationStage(model, 'First Call & Payment')!.members).toContainEqual({ workflowTemplateId: BURIAL_ID, rawStages: [0, 1] });
      expect(wixFilterForOrganizationStage(findOrganizationStage(model, 'Completed')!)).toEqual({
        $or: [
          { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, currentStage: { $in: [7] } },
          { workflowTemplateId: BURIAL_ID, currentStage: { $in: [5] } },
          { workflowTemplateId: BURIAL_ID, workflowTemplateVersion: { $in: [1] }, currentStage: { $in: [3] } },
        ],
      });
      expect(wixFilterForOrganizationStage(findOrganizationStage(model, 'Death Certificate Application Sent')!)).toEqual({
        $or: [
          { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, currentStage: { $in: [5] } },
          { workflowTemplateId: BURIAL_ID, workflowTemplateVersion: { $in: [2] }, currentStage: { $in: [3] } },
        ],
      });
    });

    it('the superseded case reads its own labels, stage count and progress on Case Detail', () => {
      const oldCase = view(cases[1]);
      expect(oldCase.stageLabels).toEqual(['First Call & Payment', 'Cemetery Selection', 'Completed']);
      expect(oldCase.stageLabel).toBe('Cemetery Selection');
      expect(view(cases[2]).progressPercent).toBe(100);
      expect(view(cases[5]).progressPercent).toBe(100);
    });
  });
});

describe('case progress, stage labels and SLA — each case against its own workflow', () => {
  const cases = Object.fromEntries(crossServiceCases().map((c) => [c.id, c]));

  it('the last stage is 100% on both workflows once the return of remains is recorded', () => {
    expect(view(cases['dc-05']).progressPercent).toBe(100);
    expect(view(cases['bu-05']).progressPercent).toBe(100);
    expect(view(cases['dc-05']).stageLabel).toBe('Completed');
    expect(view(cases['bu-05']).stageLabel).toBe('Completed');
  });

  it('a mid stage is the fraction of that template’s OWN items (past stages done, nothing checked yet here)', () => {
    // Burial: 7 items in all; display 0 (2) and 1 (2) are past -> 4/7.
    const bu03 = view(cases['bu-03']);
    expect([bu03.progressCompletedItems, bu03.progressTotalItems, bu03.progressPercent]).toEqual([4, 7, Math.round((4 / 7) * 100)]);
    // Direct Cremation at its own display 4 ("Death Certificate Application Sent").
    const dcItems = displayStagesInOrder(cases['dc-04'].workflowSnapshot!).map((s) => s.checklist.items.length);
    const dc04 = view(cases['dc-04']);
    expect(dc04.progressTotalItems).toBe(dcItems.reduce((a, b) => a + b, 0));
    expect(dc04.progressCompletedItems).toBe(dcItems.slice(0, 4).reduce((a, b) => a + b, 0));
    // Same stage NAME, different workflows -> different fractions.
    expect(dc04.stageLabel).toBe(bu03.stageLabel);
    expect(dc04.progressPercent).not.toBe(bu03.progressPercent);
  });

  it('the stepper shows the case’s own stages at its own position', () => {
    const bu = view(cases['bu-04']);
    expect(bu.stageLabels).toEqual(['First Call & Payment', 'Cemetery Arrangements', 'Death Certificate Application Sent', 'Graveside Service Held', 'Completed']);
    expect([bu.presentedDisplayStage, bu.stageLabel]).toEqual([3, 'Graveside Service Held']);
    const dc = view(cases['dc-04']);
    expect(dc.stageLabels).toHaveLength(7);
    expect([dc.presentedDisplayStage, dc.stageLabel]).toEqual([4, 'Death Certificate Application Sent']);
    expect(view(cases['bu-02']).stageBadgeVariant).toBe('danger');
  });

  it('overdue uses each case’s own snapshot SLA, not the global sla.ts target for the label', () => {
    // Same label and wait (3 days): Direct Cremation's target is 2, the burial's 3.
    expect(view(cases['dc-04']).slaTargetDays).toBe(2);
    expect(view(cases['dc-04']).isOverdue).toBe(true);
    expect(view(cases['bu-03']).slaTargetDays).toBe(3);
    expect(view(cases['bu-03']).isOverdue).toBe(false);
    // A burial-only stage has its own target.
    expect(view(cases['bu-02']).slaTargetDays).toBe(2);
    expect(view(cases['bu-02']).isOverdue).toBe(true);
    // Terminal stages are never overdue.
    expect(view(cases['dc-05']).isOverdue).toBe(false);
    expect(view(cases['bu-05']).isOverdue).toBe(false);
  });

  it('Needs Attention (stalled) picks up stalled cases from both workflows', () => {
    const urgent = Object.values(cases).map(view).filter((c) => c.needsAttention).map((c) => c.id);
    expect(urgent.sort()).toEqual(['bu-02', 'dc-03']);
  });

  it('a terminal-stage case without the return recorded shows its real stage, not yet done (Beacon, 2026-10)', () => {
    for (const id of ['dc-06', 'bu-06']) {
      expect(view(cases[id]).stageLabel).toBe('Completed');
      expect(view(cases[id]).rowSummaryVariant).not.toBe('success');
    }
  });
});

describe('Dashboard KPIs and report calculations', () => {
  const cases = crossServiceCases();
  const views = cases.map(view);
  const model = resolveOrganizationStages(GUS, templates);

  it('active / completed use each case’s own terminal stage (different stage counts)', () => {
    const kpis = computeKpis(views, GUS);
    // On their own terminal stage (the real stage, like Manors' dashboard): dc-05, dc-06, bu-05, bu-06.
    expect(kpis.completedCases).toBe(4);
    expect(kpis.activeCases).toBe(8);
    expect(kpis.activeCases + kpis.completedCases).toBe(kpis.totalCases);
    expect(kpis.overdueCases).toBe(views.filter((v) => v.isOverdue).length);
  });

  it('stage breakdown: non-terminal rows sum to the active count and the Completed row to the completed count', () => {
    const refs = new Map(cases.map((c, i) => [c.id, reportStageRef(c, views[i])]));
    const rows = computeStageBreakdownByOrganizationStage(views, model, refs);
    expect(rows.map((r) => r.label)).toEqual(EXPECTED_LABELS);
    const kpis = computeKpis(views, GUS);
    const completedRow = rows.find((r) => r.label === 'Completed')!;
    expect(completedRow.count).toBe(kpis.completedCases);
    expect(rows.filter((r) => r !== completedRow).reduce((sum, r) => sum + r.count, 0)).toBe(kpis.activeCases);
    // Terminal cases sit in the Completed row (their real stage).
    expect(rows.find((r) => r.label === 'Ready for Pickup / Contact Family')!.count).toBe(0);
    expect(rows.find((r) => r.label === 'Graveside Service Held')!.count).toBe(1);
    // Each row's target is the template's own (longest across templates sharing it).
    expect(rows.find((r) => r.label === 'Death Certificate Application Sent')!.targetLabel).toBe('3d');
    expect(rows.find((r) => r.label === 'Cemetery Arrangements')).toMatchObject({ count: 1, avgDays: 3, isBottleneck: true });
  });
});

describe('auto-advance stops at each workflow’s own last stage', () => {
  it('bulk advance (snapshot-bounded) never passes a case’s own last raw stage', () => {
    expect(advanceToNextSnapshotStage(caseOn(burial, burialV, 'adv-1', 4)).rawStage).toBe(5);
    expect(advanceToNextSnapshotStage(caseOn(burial, burialV, 'adv-2', 5, { daysWaitingInStage: 4 }))).toEqual({ rawStage: 5, daysWaitingInStage: 4 });
    expect(advanceToNextSnapshotStage(caseOn(direct, directV, 'adv-3', 5)).rawStage).toBe(6);
    expect(advanceToNextSnapshotStage(caseOn(direct, directV, 'adv-4', 7)).rawStage).toBe(7);
    // The unbounded +1 (still Manors' action) would have walked off the burial workflow.
    expect(advanceToNextStage(caseOn(burial, burialV, 'adv-5', 5)).rawStage).toBe(6);
  });

  it('checklist reconciliation lands on the burial’s last raw stage (5), never Direct Cremation’s (7)', () => {
    const allDone = everyBurialItemChecked();
    expect(computeFirstIncompleteRawStage(caseOn(burial, burialV, 'rec-1', 2, { checklistState: allDone }), false)).toBe(5);
    // Nothing checked at Cemetery Arrangements -> stays there.
    expect(computeFirstIncompleteRawStage(caseOn(burial, burialV, 'rec-2', 2), false)).toBe(2);
  });
});

/** Swaps Gus' mock templates and cases for the fictional set, restoring
    the shared fixtures afterwards. */
function useFictionalGusData(cases: Case[], gusTemplates: WorkflowTemplate[] = templates) {
  let casesBefore: Case[];
  let templatesBefore: WorkflowTemplate[];
  beforeEach(() => {
    casesBefore = structuredClone(caseFixtures);
    templatesBefore = structuredClone(workflowTemplateFixtures);
    caseFixtures.splice(0, caseFixtures.length, ...caseFixtures.filter((c) => c.organizationId !== GUS), ...structuredClone(cases));
    workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...workflowTemplateFixtures.filter((t) => t.organizationId !== GUS), ...structuredClone(gusTemplates));
  });
  afterEach(() => {
    caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
    workflowTemplateFixtures.splice(0, workflowTemplateFixtures.length, ...templatesBefore);
  });
}

describe('operational reports (mock adapter) over both workflows', () => {
  const cases = crossServiceCases();
  useFictionalGusData(cases);

  it('active cases, stage counts and the stage-aging breakdown agree with each other', async () => {
    const active = await countActiveCases(GUS, {}, 'mock');
    expect(active).toBe(8);
    const rows = await caseCountsByStage(GUS, 'mock');
    expect(rows.map((r) => r.stage)).toEqual(EXPECTED_LABELS);
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(cases.length);
    expect(rows.filter((r) => r.stage !== 'Completed').reduce((sum, r) => sum + r.count, 0)).toBe(active);
    expect(rows.find((r) => r.stage === 'Completed')!.count).toBe(4);
    const aging = await averageDaysInStageSnapshot(GUS, 'mock');
    expect(aging.map((r) => [r.label, r.count])).toEqual(rows.map((r) => [r.stage, r.count]));
  });

  it('SLA exceptions count each case against its own workflow’s target, filterable by a shared label', async () => {
    expect(await countOverdueCases(GUS, {}, 'mock')).toBe(cases.map(view).filter((v) => v.isOverdue).length);
    // dc-04 is overdue at "Death Certificate Application Sent"; bu-03 (same label, same wait) is not.
    expect(await countOverdueCases(GUS, { stage: 'Death Certificate Application Sent' }, 'mock')).toBe(1);
    expect(await countOverdueCases(GUS, { stage: 'Cemetery Arrangements' }, 'mock')).toBe(1);
  });

  it('the All Case Data report names each case’s stage from its own snapshot', async () => {
    const rows = await buildAllCaseDataRows(GUS, {}, false, 'mock');
    const byNumber = new Map(rows.map((r) => [r.caseNumber, r.stage]));
    for (const c of cases) expect(byNumber.get(c.caseNumber)).toBe(c.workflowSnapshot!.stages.find((s) => s.rawStage === c.rawStage)!.label);
    expect(byNumber.get(cases.find((c) => c.id === 'bu-04')!.caseNumber)).toBe('Graveside Service Held');
  });

  it('local counts + stage filter: a shared label returns cases from both workflows and nothing else', async () => {
    const context = { organizationId: GUS } as Parameters<typeof casesService.listPage>[0];
    const counts = await casesService.counts(context, '', 'mock');
    expect(counts.total).toBe(cases.length);
    expect(Object.values(counts.byStage).reduce((a, b) => a + b, 0)).toBe(counts.total);
    expect(counts.byStage['Completed']).toBe(4); // raw-stage counts, like Manors' dashboard
    const page = await casesService.listPage(context, { stage: 'Death Certificate Application Sent', limit: 100 }, 'mock');
    expect(page.cases.map((c) => c.id).sort()).toEqual(['bu-03', 'dc-04']);
    const completed = await casesService.listPage(context, { stage: 'Completed', limit: 100 }, 'mock');
    expect(completed.cases.map((c) => c.id).sort()).toEqual(['bu-05', 'bu-06', 'dc-05', 'dc-06']);
    const burialOnly = await casesService.listPage(context, { stage: 'Graveside Service Held', limit: 100 }, 'mock');
    expect(burialOnly.cases.map((c) => c.id)).toEqual(['bu-04']);
  });

  it('mock reconciliation advances a fully-checked burial case to its own last stage and stops', async () => {
    const allDone = everyBurialItemChecked();
    const index = caseFixtures.findIndex((c) => c.id === 'bu-02');
    caseFixtures[index] = { ...caseFixtures[index], checklistState: allDone };
    expect(await reconcileCaseWorkflow(GUS, 'bu-02', 'mock')).toMatchObject({ rawStage: 5, changed: true });
    expect(await reconcileCaseWorkflow(GUS, 'bu-02', 'mock')).toMatchObject({ rawStage: 5, changed: false });
  });
});

describe('Managed Cremations is unchanged (global STAGES)', () => {
  const manorsCases = () => caseFixtures.filter((c) => c.organizationId === MANORS && !c.isDeleted);

  it('the stage model is the global one whatever templates are passed', () => {
    for (const passed of [[], [standardCremationWorkflowTemplateFixture], templates]) {
      const model = resolveOrganizationStages(MANORS, passed);
      expect(model.kind).toBe('global');
      expect(organizationStageLabels(model)).toEqual(presentedStages(MANORS, STAGES).map((s) => s.label));
    }
  });

  it('stage membership is exactly the raw-stage sets of STAGES (no template or version clause)', () => {
    const model = resolveOrganizationStages(MANORS, []);
    for (const stage of model.stages) {
      expect(stage.members).toEqual([]);
      const canonical = presentedStages(MANORS, STAGES).find((s) => s.label === stage.label)!.canonicalDisplayStages;
      const raw = canonical.flatMap((ds) => rawStagesForDisplayStage(ds));
      for (const c of manorsCases()) expect(caseIsInOrganizationStage(stage, c)).toBe(raw.includes(c.rawStage));
    }
  });

  it('local counts keep the seven STAGES keys and raw-stage membership', async () => {
    const counts = await casesService.counts({ organizationId: MANORS } as Parameters<typeof casesService.counts>[0], '', 'mock');
    expect(Object.keys(counts.byStage)).toEqual([...STAGES]);
    STAGES.forEach((label, ds) => {
      expect(counts.byStage[label]).toBe(manorsCases().filter((c) => rawStagesForDisplayStage(ds).includes(c.rawStage)).length);
    });
  });

  it('KPIs and report rows are computed exactly as the global-constant path', async () => {
    const views = manorsCases().map(view);
    expect(computeKpis(views, MANORS)).toEqual(computeKpis(views));
    const rows = await caseCountsByStage(MANORS, 'mock');
    expect(rows.map((r) => r.stage)).toEqual(presentedStages(MANORS, STAGES).map((s) => s.label));
    expect(rows.map((r) => r.count)).toEqual(presentedStages(MANORS, STAGES).map((s) => views.filter((v) => s.canonicalDisplayStages.includes(v.displayStage)).length));
    const kpis = computeKpis(views);
    expect(rows.slice(0, -1).reduce((sum, r) => sum + r.count, 0)).toBe(kpis.activeCases);
  });
});
