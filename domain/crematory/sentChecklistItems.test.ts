import { describe, expect, it } from 'vitest';
import { adminOnlyChecklistChanges, crematorySentChecklistKeys } from './sentChecklistItems';
import { standardCremationWorkflowTemplateFixture } from '../../services/__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot } from '../workflow/snapshot';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';

/** Send to Crematory (2026-10): which checklist items only administrators change by hand. */
const snapshot = buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, standardCremationWorkflowTemplateFixture.versions[0]);
const manors = (checklistState: Record<string, boolean> = {}) => ({ organizationId: MANORS_ORGANIZATION_ID, workflowSnapshot: snapshot, checklistState });

describe('the two "sent to crematory" items', () => {
  it('are Workflow 3 items 0 and 1, by their keys and the labels in the case\'s own snapshot — Manors only', () => {
    expect(crematorySentChecklistKeys(manors())).toEqual(['3:0', '3:1']);
    expect(crematorySentChecklistKeys({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, workflowSnapshot: snapshot })).toEqual([]);
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
