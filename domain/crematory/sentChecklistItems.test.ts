import { describe, expect, it } from 'vitest';
import { adminOnlyChecklistChanges, crematorySentChecklistKeys } from './sentChecklistItems';
import { standardCremationWorkflowTemplateFixture } from '../../services/__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot } from '../workflow/snapshot';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { buildCremationFoundationStages } from '../workflow/cremationFoundation';
import { composeWorkflowStages } from '../workflow/workflowComposition';

/** Send to Crematory (2026-10): which checklist items only administrators change by hand. */
const snapshot = buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, standardCremationWorkflowTemplateFixture.versions[0]);
const manors = (checklistState: Record<string, boolean> = {}) => ({ organizationId: MANORS_ORGANIZATION_ID, workflowSnapshot: snapshot, checklistState });

describe('the two "sent to crematory" items', () => {
  it('are Workflow 3 items 0 and 1, by their keys and the labels in the case\'s own snapshot — organizations offering Send to Crematory only', () => {
    expect(crematorySentChecklistKeys(manors())).toEqual(['3:0', '3:1']);
    // Gus offers the process on the shared platform (2026-11), sending off.
    expect(crematorySentChecklistKeys({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, workflowSnapshot: snapshot })).toEqual(['3:0', '3:1']);
    expect(crematorySentChecklistKeys({ organizationId: 'some-other-organization', workflowSnapshot: snapshot })).toEqual([]);
    expect(crematorySentChecklistKeys({ organizationId: MANORS_ORGANIZATION_ID, workflowSnapshot: null })).toEqual([]);
  });

  it('a template whose items carry other labels has none — nothing is restricted by position alone', () => {
    const relabelled = structuredClone(snapshot);
    relabelled.stages.find((s) => s.displayStage === 3)!.checklist.items[0].label = 'Something else';
    expect(crematorySentChecklistKeys({ organizationId: MANORS_ORGANIZATION_ID, workflowSnapshot: relabelled })).toEqual([]);
  });

  it('only a real change to one of them counts', () => {
    expect(adminOnlyChecklistChanges(manors(), { '3:0': true })).toEqual(['3:0']);
    expect(adminOnlyChecklistChanges(manors({ '3:1': true }), { '3:1': false, '2:0': true })).toEqual(['3:1']);
    expect(adminOnlyChecklistChanges(manors({ '3:0': true }), { '3:0': true, '2:0': true })).toEqual([]);
    expect(adminOnlyChecklistChanges(manors(), { '3:0': false })).toEqual([]);
    expect(adminOnlyChecklistChanges(manors(), { '4:0': true })).toEqual([]);
    expect(adminOnlyChecklistChanges(manors(), undefined)).toEqual([]);
  });
});

describe('shared cremation foundation (2026-11): found by step id, wherever a service puts them', () => {
  const base = buildCremationFoundationStages({ arrangementFormIntegrationId: null });
  const withInsertedStage = composeWorkflowStages(base, [
    {
      key: 'test.extra',
      version: 1,
      label: 'Extra',
      stepsToBeDefined: false,
      additions: [{ kind: 'stage', beforeStageKey: 'cremation.edrs', stage: { stageKey: 'test.extra', label: 'Extra stage', slaTargetDays: null, items: [{ stepId: 'test.extra.one', label: 'Extra step' }] } }],
    },
  ]);
  const gusCase = (stages: typeof base) => ({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, workflowSnapshot: { workflowTemplateId: 't', workflowTemplateVersion: 1, stages, intake: { sections: [] } as never } });

  it('on the foundation itself they are Workflow 3 items 0 and 1, as for Manors', () => {
    expect(crematorySentChecklistKeys(gusCase(base))).toEqual(['3:0', '3:1']);
  });

  it('a stage inserted before them moves them, and they are still the ones restricted', () => {
    expect(crematorySentChecklistKeys(gusCase(withInsertedStage))).toEqual(['4:0', '4:1']);
    expect(withInsertedStage.find((s) => s.displayStage === 4)?.checklist.items.map((i) => i.label)).toEqual([
      'Permit sent to crematory',
      'Authorization of release sent to crematory',
    ]);
  });
});
