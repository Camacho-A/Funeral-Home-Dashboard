import { describe, expect, it } from 'vitest';
import { validateWorkflowStages, problemMessages } from './templateValidation';
import { updateChecklistItem, updateStage } from './templateEditing';
import {
  buildGusServiceWorkflowTemplateFixtures,
  buildGusWorkflowTemplateFixture,
  secondOrgWorkflowTemplateFixture,
  standardCremationWorkflowTemplateFixture,
} from '../../services/__mocks__/workflowTemplates';
import type { StageTemplate } from '../../types/workflowTemplate';

/** Workflow template editor (2026-10) — the shared draft/approval rules. */

function stage(rawStage: number, displayStage: number, label: string, items: string[] = [`${label} item`], sla: number | null = 1): StageTemplate {
  return {
    rawStage,
    displayStage,
    label,
    isAttentionStage: false,
    slaTargetDays: sla,
    checklist: { items: items.map((item, index) => ({ index, label: item, hasField: false })) },
  };
}

const valid = (): StageTemplate[] => [stage(0, 0, 'Intake'), stage(1, 1, 'Work'), stage(2, 2, 'Completed', [], null)];
const codes = (stages: StageTemplate[], level: 'draft' | 'approval', ctx = {}) => validateWorkflowStages(stages, level, ctx).map((p) => p.code);

describe('existing workflows', () => {
  it('every Manors and approved Gus version passes both levels; evergreen passes draft (it has no approval step)', () => {
    for (const version of standardCremationWorkflowTemplateFixture.versions) {
      expect(validateWorkflowStages(version.stages, 'approval')).toEqual([]);
    }
    expect(validateWorkflowStages(buildGusWorkflowTemplateFixture().versions[0].stages, 'approval')).toEqual([]);
    expect(validateWorkflowStages(secondOrgWorkflowTemplateFixture.versions[0].stages, 'draft')).toEqual([]);
  });

  it('every Gus draft is savable', () => {
    for (const template of buildGusServiceWorkflowTemplateFixtures()) {
      expect(validateWorkflowStages(template.versions[0].stages, 'draft')).toEqual([]);
    }
  });
});

describe("'draft' level — structural", () => {
  it('accepts a minimal well-formed workflow', () => {
    expect(codes(valid(), 'draft')).toEqual([]);
    expect(codes(valid(), 'approval')).toEqual([]);
  });

  it('requires at least one stage', () => {
    expect(codes([], 'draft')).toEqual(['no_stages']);
  });

  it('requires sequential rawStage and coherent displayStage numbering', () => {
    const gap = valid();
    gap[1] = { ...gap[1], rawStage: 5 };
    expect(codes(gap, 'draft')).toContain('raw_stage_sequence');
    const jump = valid();
    jump[2] = { ...jump[2], displayStage: 4 };
    expect(codes(jump, 'draft')).toContain('display_stage_sequence');
    const notFromZero = valid().map((s) => ({ ...s, displayStage: s.displayStage + 1 }));
    expect(codes(notFromZero, 'draft')).toContain('display_stage_sequence');
  });

  it('requires a combined stage to share one label and one checklist', () => {
    const combined = [stage(0, 0, 'First Call', ['a', 'b']), stage(1, 0, 'Payment', ['a', 'b']), stage(2, 1, 'Completed', [], null)];
    expect(codes(combined, 'draft')).toEqual(['combined_stage_label']);
    const diverged = [stage(0, 0, 'First Call', ['a', 'b']), stage(1, 0, 'First Call', ['a', 'c']), stage(2, 1, 'Completed', [], null)];
    expect(codes(diverged, 'draft')).toEqual(['combined_stage_checklist']);
  });

  it('requires item index = position and non-empty stage/item labels', () => {
    const stages = valid();
    stages[0].checklist.items = [{ index: 3, label: ' ', hasField: false }];
    stages[1] = { ...stages[1], label: '   ' };
    expect(codes(stages, 'draft').sort()).toEqual(['item_index_sequence', 'item_label_empty', 'stage_label_empty']);
    expect(problemMessages(validateWorkflowStages(stages, 'draft')).join(' ')).toMatch(/non-empty label/);
  });

  it('rejects a negative or non-finite SLA, accepts null', () => {
    expect(codes([stage(0, 0, 'A', ['x'], -1)], 'draft')).toEqual(['sla_invalid']);
    expect(codes([stage(0, 0, 'A', ['x'], Number.NaN)], 'draft')).toEqual(['sla_invalid']);
    expect(codes([stage(0, 0, 'A', ['x'], null)], 'draft')).toEqual([]);
  });

  it('checks a proposed service assignment against the active catalog, once each', () => {
    const ctx = { serviceTypeCodes: ['A', 'A', 'Z'], activeServiceTypeCodes: ['A', 'B'] };
    expect(codes(valid(), 'draft', ctx).sort()).toEqual(['service_duplicate', 'service_unknown']);
  });

  it('allows work in progress: an empty stage, a duplicate name, no Completed stage', () => {
    const wip = [stage(0, 0, 'Intake'), stage(1, 1, 'Intake', []), stage(2, 2, 'Later', [])];
    expect(codes(wip, 'draft')).toEqual([]);
    expect(codes(wip, 'approval').sort()).toEqual(['final_stage_not_terminal', 'stage_label_duplicate', 'stage_without_items']);
  });
});

describe("'approval' level — complete", () => {
  it('needs at least 2 stages and a terminal "Completed" final stage (trimmed, case-insensitive)', () => {
    expect(codes([stage(0, 0, 'Completed', [], null)], 'approval')).toEqual(['too_few_stages']);
    const renamed = updateStage(valid(), 2, { label: '  completed ' });
    expect(codes(renamed, 'approval')).toEqual([]);
    expect(codes(updateStage(valid(), 2, { label: 'Done' }), 'approval')).toEqual(['final_stage_not_terminal']);
  });

  it('needs ≥1 item on every non-final stage; the final stage may have none', () => {
    const stages = valid();
    stages[1].checklist.items = [];
    expect(codes(stages, 'approval')).toEqual(['stage_without_items']);
  });

  it('rejects duplicate stage labels and duplicate item labels within a stage (case-insensitive)', () => {
    expect(codes(updateStage(valid(), 1, { label: 'INTAKE' }), 'approval')).toEqual(['stage_label_duplicate']);
    const dupItems = [stage(0, 0, 'Intake', ['Call family', 'call family ']), stage(1, 1, 'Completed', [], null)];
    expect(codes(dupItems, 'approval')).toEqual(['item_label_duplicate']);
    // The same item label in two different stages is fine.
    expect(codes([stage(0, 0, 'A', ['Same']), stage(1, 1, 'B', ['Same']), stage(2, 2, 'Completed', [], null)], 'approval')).toEqual([]);
  });

  it('accepts whole days or a same-day fraction below 1 (the existing 0.25 target); refuses e.g. 1.5', () => {
    expect(codes([stage(0, 0, 'A', ['x'], 0.25), stage(1, 1, 'Completed', [], null)], 'approval')).toEqual([]);
    expect(codes([stage(0, 0, 'A', ['x'], 0), stage(1, 1, 'Completed', [], null)], 'approval')).toEqual([]);
    expect(codes([stage(0, 0, 'A', ['x'], 1.5), stage(1, 1, 'Completed', [], null)], 'approval')).toEqual(['sla_not_whole_days']);
  });

  it('keeps data entry in the first stage and requiredCaseFields valid', () => {
    const outside = updateChecklistItem(valid(), 1, 0, { hasField: true });
    expect(codes(outside, 'approval')).toEqual(['data_entry_outside_intake']);
    const both = updateChecklistItem(updateChecklistItem(valid(), 0, 0, { hasField: true }), 0, 0, { requiredCaseFields: ['certifierName'] });
    expect(codes(both, 'approval')).toEqual(['required_fields_with_data_entry']);
    expect(codes(updateChecklistItem(valid(), 0, 0, { requiredCaseFields: [] }), 'approval')).toEqual(['required_fields_invalid']);
    expect(codes(updateChecklistItem(valid(), 0, 0, { requiredCaseFields: ['ssn'] }), 'approval')).toEqual(['required_fields_invalid']);
    expect(codes(updateChecklistItem(valid(), 0, 0, { requiredCaseFields: ['certifierName', 'nextOfKinEmail'] }), 'approval')).toEqual([]);
  });

  it('requires a service and refuses one another ENABLED template of the organization already serves', () => {
    const templates = buildGusServiceWorkflowTemplateFixtures();
    const viewing = templates.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
    const base = { organizationTemplates: templates, templateId: viewing.id, templateIsEnabled: true, requireServiceAssignment: true };
    expect(codes(valid(), 'approval', { ...base, serviceTypeCodes: [] })).toEqual(['service_missing']);
    expect(codes(valid(), 'approval', { ...base, serviceTypeCodes: ['CREMATION_WITH_VIEWING'] })).toEqual([]);
    const taken = validateWorkflowStages(valid(), 'approval', {
      ...base,
      serviceTypeCodes: ['DIRECT_CREMATION'],
      serviceDisplayName: (code) => (code === 'DIRECT_CREMATION' ? 'Direct Cremation' : null),
    });
    expect(taken.map((p) => p.code)).toEqual(['service_taken']);
    expect(taken[0].message).toMatch(/Direct Cremation is already served by the enabled workflow "Direct Cremation"/);
    // A disabled holder claims nothing; a disabled template under review claims nothing either.
    const disabled = templates.map((t) => (t.serviceTypeCodes?.includes('DIRECT_CREMATION') ? { ...t, isEnabled: false } : t));
    expect(codes(valid(), 'approval', { ...base, organizationTemplates: disabled, serviceTypeCodes: ['DIRECT_CREMATION'] })).toEqual([]);
    expect(codes(valid(), 'approval', { ...base, templateIsEnabled: false, serviceTypeCodes: ['DIRECT_CREMATION'] })).toEqual([]);
  });

  it('reports positions for the UI and tags each problem with its level', () => {
    const stages = valid();
    stages[1].checklist.items = [];
    const [problem] = validateWorkflowStages(stages, 'approval');
    expect(problem).toMatchObject({ code: 'stage_without_items', stagePosition: 1, level: 'approval' });
  });
});
