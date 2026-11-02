import { describe, expect, it } from 'vitest';
import {
  addChecklistItem,
  addStage,
  groupStagesByDisplayStage,
  intakeFieldsLinkedToFirstStageItem,
  isFirstStageLinkedToIntake,
  itemOrderAfterMove,
  itemOrderAfterRemoval,
  moveChecklistItem,
  moveDisplayStage,
  remapIntakeAfterFirstStageChange,
  removeChecklistItem,
  removeStage,
  renumberWorkflowStages,
  updateChecklistItem,
  updateStage,
} from './templateEditing';
import { validateWorkflowStages } from './templateValidation';
import {
  buildGusWorkflowTemplateFixture,
  secondOrgWorkflowTemplateFixture,
  standardCremationWorkflowTemplateFixture,
} from '../../services/__mocks__/workflowTemplates';
import type { IntakeTemplate, StageTemplate } from '../../types/workflowTemplate';

/** Workflow template editor (2026-10) — structural operations. */

const gusStages = () => structuredClone(buildGusWorkflowTemplateFixture().versions[0].stages);
const numbering = (stages: StageTemplate[]) => stages.map((s) => [s.rawStage, s.displayStage]);
const labels = (stages: StageTemplate[]) => groupStagesByDisplayStage(stages).map((g) => g[0].label);

function simple(...names: string[]): StageTemplate[] {
  return names.map((label, i) => ({
    rawStage: i,
    displayStage: i,
    label,
    isAttentionStage: false,
    slaTargetDays: 1,
    checklist: { items: [{ index: 0, label: `${label} item`, hasField: false }] },
  }));
}

describe('renumbering', () => {
  it('leaves every existing template exactly as it is (combined First Call & Payment preserved)', () => {
    for (const version of [
      ...standardCremationWorkflowTemplateFixture.versions,
      ...secondOrgWorkflowTemplateFixture.versions,
      ...buildGusWorkflowTemplateFixture().versions,
    ]) {
      expect(renumberWorkflowStages(version.stages)).toEqual(version.stages);
    }
  });

  it('closes raw/display/index gaps, keeping raw stages that shared a display stage together', () => {
    const messy: StageTemplate[] = [
      { ...simple('A')[0], rawStage: 4, displayStage: 9 },
      { ...simple('A')[0], rawStage: 7, displayStage: 9 },
      { ...simple('B')[0], rawStage: 2, displayStage: 3, checklist: { items: [{ index: 5, label: 'x', hasField: false }] } },
    ];
    const result = renumberWorkflowStages(messy);
    expect(numbering(result)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
    ]);
    expect(result[2].checklist.items[0].index).toBe(0);
  });
});

describe('stage operations (by display stage)', () => {
  it('adds a new single-raw-stage display stage just before Completed, with a unique name', () => {
    const once = addStage(gusStages());
    const twice = addStage(once);
    expect(labels(twice).slice(-3)).toEqual(['New stage', 'New stage 2', 'Completed']);
    expect(numbering(twice).slice(-3)).toEqual([
      [7, 6],
      [8, 7],
      [9, 8],
    ]);
    expect(numbering(twice).slice(0, 2)).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(validateWorkflowStages(twice, 'draft')).toEqual([]);
  });

  it('appends at the end when the workflow has no terminal Completed stage', () => {
    expect(labels(addStage(simple('Intake', 'Service')))).toEqual(['Intake', 'Service', 'New stage']);
  });

  it('removes a whole display stage and renumbers', () => {
    const result = removeStage(gusStages(), 3); // Permit & Authorization
    expect(labels(result)).not.toContain('Permit & Authorization Sent to Crematory');
    expect(numbering(result)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
    ]);
    // Removing the combined stage removes both raw stages.
    expect(removeStage(gusStages(), 0)).toHaveLength(6);
  });

  it('moves a combined stage as one unit and it stays combined', () => {
    const result = moveDisplayStage(gusStages(), 0, 'down');
    expect(labels(result).slice(0, 2)).toEqual(['JotForm Application', 'First Call & Payment']);
    expect(numbering(result).slice(0, 3)).toEqual([
      [0, 0],
      [1, 1],
      [2, 1],
    ]);
    expect(moveDisplayStage(gusStages(), 0, 'up')).toEqual(gusStages());
  });

  it('renames / sets SLA and attention on every raw stage of a combined stage', () => {
    const result = updateStage(gusStages(), 0, { label: 'Intake & Payment', slaTargetDays: 1, isAttentionStage: true });
    expect(result.slice(0, 2).map((s) => [s.label, s.slaTargetDays, s.isAttentionStage])).toEqual([
      ['Intake & Payment', 1, true],
      ['Intake & Payment', 1, true],
    ]);
    expect(result.slice(2)).toEqual(gusStages().slice(2));
  });
});

describe('checklist item operations', () => {
  it('adds an item to every raw stage of a combined stage, at the same index', () => {
    const result = addChecklistItem(gusStages(), 0);
    expect(result[0].checklist.items[11]).toEqual({ index: 11, label: 'New checklist item', hasField: false, isPasswordField: false, externalFormIntegrationId: null });
    expect(result[1].checklist.items[11]).toEqual(result[0].checklist.items[11]);
    expect(validateWorkflowStages(result, 'draft')).toEqual([]);
  });

  it('removes and reorders items in every raw stage, reindexing from 0', () => {
    const removed = removeChecklistItem(gusStages(), 0, 3); // Weight
    for (const raw of removed.slice(0, 2)) {
      expect(raw.checklist.items.map((i) => i.label)).not.toContain('Weight');
      expect(raw.checklist.items.map((i) => i.index)).toEqual([...Array(10).keys()]);
    }
    const moved = moveChecklistItem(gusStages(), 2, 0, 'down'); // EDRS stage
    expect(moved[3].checklist.items.map((i) => [i.index, i.label])).toEqual([
      [0, 'Cause of death entered'],
      [1, 'EDRS submitted & sent to doctor'],
      [2, 'Hardsave for state approval if not an online doctor'],
    ]);
    expect(moveChecklistItem(gusStages(), 2, 0, 'up')).toEqual(gusStages());
  });

  it('keeps data entry on the first raw stage only; other requirements mirror across the combined stage', () => {
    const result = updateChecklistItem(gusStages(), 0, 3, { hasField: false });
    expect(result[0].checklist.items[3].hasField).toBe(false);
    const back = updateChecklistItem(result, 0, 3, { hasField: true, isPasswordField: true });
    expect(back[0].checklist.items[3]).toMatchObject({ hasField: true, isPasswordField: true });
    expect(back[1].checklist.items[3]).toMatchObject({ hasField: false, isPasswordField: true });
  });

  it('removes a cleared optional requirement instead of storing undefined', () => {
    const result = updateChecklistItem(gusStages(), 0, 5, { valueKind: undefined });
    expect('valueKind' in result[0].checklist.items[5]).toBe(false);
    expect('valueKind' in result[1].checklist.items[5]).toBe(false);
    const certifier = updateChecklistItem(gusStages(), 0, 6, { requiredCaseFields: ['certifierName'] });
    expect(certifier[0].checklist.items[6].requiredCaseFields).toEqual(['certifierName']);
    expect(certifier[1].checklist.items[6].requiredCaseFields).toEqual(['certifierName']);
  });

  it('carries externalFormIntegrationId and valueKind through every structural operation', () => {
    const manors = structuredClone(standardCremationWorkflowTemplateFixture.versions[1].stages);
    // Remove an EDRS item, add a stage, move the JotForm stage down.
    const edited = moveDisplayStage(addStage(removeChecklistItem(manors, 2, 0)), 1, 'down');
    const jotform = manors[2].checklist.items[0];
    expect(jotform.externalFormIntegrationId).toBeTruthy();
    expect(edited.flatMap((s) => s.checklist.items).find((i) => i.label === jotform.label)).toEqual(jotform);
    for (const raw of edited.slice(0, 2)) {
      expect(raw.checklist.items.find((i) => i.label === 'Time of death')!.valueKind).toBe('time');
    }
  });
});

describe('intake coupling with the first stage', () => {
  const intake: IntakeTemplate = {
    sections: [
      {
        key: 's',
        label: 'S',
        fields: [
          { key: 'a', label: 'A', checklistItemIndex: 0 },
          { key: 'b', label: 'B', checklistItemIndex: 2 },
          { key: 'slot', label: 'Slot', checklistItemIndex: 40 },
          { key: 'none', label: 'None' },
        ],
      },
    ],
  };
  const stages = () => gusStages();

  it('knows which intake fields feed a first-stage item and whether the stage is pinned', () => {
    expect(intakeFieldsLinkedToFirstStageItem(stages(), intake, 2)).toEqual(['B']);
    expect(intakeFieldsLinkedToFirstStageItem(stages(), intake, 40)).toEqual([]);
    expect(isFirstStageLinkedToIntake(stages(), intake)).toBe(true);
    expect(isFirstStageLinkedToIntake(stages(), { sections: [] })).toBe(false);
  });

  it('re-points checklistItemIndex after a move or a removal so each field keeps its item', () => {
    const moved = remapIntakeAfterFirstStageChange(intake, itemOrderAfterMove(11, 0, 'down'));
    expect(moved.sections[0].fields.map((f) => f.checklistItemIndex)).toEqual([1, 2, 40, undefined]);
    const removed = remapIntakeAfterFirstStageChange(intake, itemOrderAfterRemoval(11, 1));
    expect(removed.sections[0].fields.map((f) => f.checklistItemIndex)).toEqual([0, 1, 40, undefined]);
    // Nothing to re-point returns the same object.
    expect(remapIntakeAfterFirstStageChange(intake, itemOrderAfterMove(11, 5, 'down'))).toBe(intake);
  });
});
