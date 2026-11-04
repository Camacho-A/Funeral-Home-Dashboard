import { describe, expect, it } from 'vitest';
import type { StarterWorkflowContent } from './starterWorkflow';
import { workflowStructureForClone } from './workflowCloneSources';

const source = (): StarterWorkflowContent => ({
  caseTypes: ['cremation'],
  stages: [{
    rawStage: 0, displayStage: 0, label: 'Intake', slaTargetDays: 2, stageKey: 'cremation.intake',
    checklist: { items: [{ index: 0, label: 'Authorization form', hasField: false, stepId: 'cremation.intake.authorization', externalFormIntegrationId: 'jotform-binding-fictional-123' }] },
  }],
  intake: { sections: [{ key: 'main', label: 'Main', fields: [
    { key: 'deposit', label: 'Deposit', fieldType: 'payment', paymentPurpose: 'deposit', paymentAmount: '$999.00', paymentDescription: 'Fictional private pricing note' },
    { key: 'county', label: 'County', defaultValue: 'Fictional County of the source home' },
  ] }] },
});

describe('workflowStructureForClone', () => {
  it('copies the structure and never integration ids, default values or payment amounts', () => {
    const cloned = workflowStructureForClone(source());
    expect(cloned.stages[0]).toMatchObject({ label: 'Intake', slaTargetDays: 2, stageKey: 'cremation.intake' });
    expect(cloned.stages[0].checklist.items[0]).toEqual({ index: 0, label: 'Authorization form', hasField: false, stepId: 'cremation.intake.authorization' });
    expect(cloned.intake.sections[0].fields).toEqual([
      { key: 'deposit', label: 'Deposit', fieldType: 'payment', paymentPurpose: 'deposit' },
      { key: 'county', label: 'County' },
    ]);
    expect(JSON.stringify(cloned)).not.toMatch(/jotform-binding|\$999|private pricing|Fictional County/);
  });

  it('shares no object with the source', () => {
    const original = source();
    const cloned = workflowStructureForClone(original);
    cloned.stages[0].checklist.items[0].label = 'Changed';
    cloned.caseTypes.push('burial');
    expect(original.stages[0].checklist.items[0].label).toBe('Authorization form');
    expect(original.caseTypes).toEqual(['cremation']);
  });

  it('drops a field nobody listed yet', () => {
    const withUnknown = source();
    (withUnknown.stages[0] as unknown as Record<string, unknown>).assignedStaffId = 'identity-fictional-director';
    expect(JSON.stringify(workflowStructureForClone(withUnknown))).not.toContain('identity-fictional-director');
  });
});
