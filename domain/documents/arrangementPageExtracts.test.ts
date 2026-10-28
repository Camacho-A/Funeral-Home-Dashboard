import { describe, expect, it } from 'vitest';
import { ARRANGEMENT_EXTRACTS, crematoryFormIsDue, crematoryFormWorkflowState, crematoryPermitStatus } from './arrangementPageExtracts';
import { checklistItemsForEvent } from '@/domain/sla/slaMilestones';
import { checklistItemKey } from '@/domain/workflow/checklistItemKey';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import type { Case } from '@/types/case';

describe('ARRANGEMENT_EXTRACTS', () => {
  it('Release Form (formerly ME Form) is page 2, Crematory Form is page 3', () => {
    expect(ARRANGEMENT_EXTRACTS.me_form).toMatchObject({ page: 2, fileName: 'Release Form.pdf', displayName: 'Release Form' });
    expect(ARRANGEMENT_EXTRACTS.crematory_form).toMatchObject({ page: 3, fileName: 'Crematory Form.pdf', displayName: 'Crematory Form' });
  });
});

describe('crematoryPermitStatus', () => {
  const base: Case = { ...caseFixtures[0], slaEvents: {}, checklistState: {} };
  const record = { at: '2026-10-26T15:00:00.000Z', recordedAt: '2026-10-26T15:00:00.000Z', recordedBy: 'staff-dana', source: 'staff' as const };

  it('is not confirmed from nothing — not from the stage, not from unrelated items', () => {
    const lateStage: Case = { ...base, rawStage: 6 };
    expect(crematoryPermitStatus(lateStage)).toEqual({ confirmed: false, basis: null });
  });

  it('is confirmed by a recorded state approval or a recorded permit sent', () => {
    expect(crematoryPermitStatus({ ...base, slaEvents: { approval_received: record } })).toEqual({ confirmed: true, basis: 'State approval recorded' });
    expect(crematoryPermitStatus({ ...base, slaEvents: { permit_sent: record } })).toEqual({ confirmed: true, basis: 'Permit sent to crematory recorded' });
  });

  it('is confirmed by the "Permit sent to crematory" checklist item, when the case\'s workflow has it', () => {
    const items = checklistItemsForEvent(base, 'permit_sent');
    if (items.length === 0) return; // the fixture workflow does not carry that item
    const checked = Object.fromEntries(items.map((item) => [checklistItemKey(item.displayStage, item.index), true]));
    expect(crematoryPermitStatus({ ...base, checklistState: checked })).toEqual({ confirmed: true, basis: '"Permit sent to crematory" checked' });
  });
});

describe('Crematory Form workflow trigger (2026-10)', () => {
  // A Manors-shaped workflow: stage 2 ends with the Hardsave step, stage 3
  // starts with "Permit sent to crematory" — the live labels.
  const fixture = caseFixtures.find((c) => c.organizationId === 'managed-cremations' && c.workflowSnapshot)!;
  const template = fixture.workflowSnapshot!.stages[0].checklist.items[0];
  const item = (index: number, label: string) => ({ ...template, index, label, hasField: false, requiredCaseFields: undefined });
  const snapshot = {
    ...fixture.workflowSnapshot!,
    stages: [
      ...fixture.workflowSnapshot!.stages.filter((s) => s.displayStage !== 2 && s.displayStage !== 3),
      { ...fixture.workflowSnapshot!.stages[0], displayStage: 2, checklist: { ...fixture.workflowSnapshot!.stages[0].checklist, items: [item(0, 'EDRS submitted & sent to doctor'), item(1, 'Cause of death entered'), item(2, 'Hardsave for state approval if not an online doctor')] } },
      { ...fixture.workflowSnapshot!.stages[0], displayStage: 3, checklist: { ...fixture.workflowSnapshot!.stages[0].checklist, items: [item(0, 'Permit sent to crematory'), item(1, 'Authorization of release sent to crematory')] } },
    ],
  };
  const manors = (checklistState: Record<string, boolean>, isMedicalExaminerCase = false): Case => ({
    ...fixture,
    organizationId: 'managed-cremations',
    workflowSnapshot: snapshot,
    checklistState,
    isMedicalExaminerCase,
    isDeleted: false,
    slaEvents: {},
  });

  it('is ready when the last step of workflow 2 is checked and "Permit sent to crematory" is pending', () => {
    expect(crematoryFormWorkflowState(manors({}))).toMatchObject({ ready: false, nextStepLabel: 'Permit sent to crematory' });
    expect(crematoryFormWorkflowState(manors({ '2:0': true, '2:1': true }))?.ready).toBe(false);
    expect(crematoryFormWorkflowState(manors({ '2:2': true }))).toEqual({ ready: true, lastStepLabel: 'Attestation Received / Hard Saved', nextStepLabel: 'Permit sent to crematory' });
    expect(crematoryFormWorkflowState(manors({ '2:2': true, '3:0': true }))?.ready).toBe(false);
  });

  it('on a Medical Examiner case, the last step is the last ME verification step', () => {
    expect(crematoryFormWorkflowState(manors({ '2:2': true }, true))?.ready).toBe(false);
    expect(crematoryFormWorkflowState(manors({ '2:5': true }, true))).toMatchObject({ ready: true, lastStepLabel: 'Required ME information confirmed' });
  });

  it('is due only on the save that reaches that moment — never again while it holds, never for an archived case', () => {
    expect(crematoryFormIsDue(manors({ '2:1': true }), manors({ '2:1': true, '2:2': true }))).toBe(true);
    expect(crematoryFormIsDue(null, manors({ '2:2': true }))).toBe(true);
    expect(crematoryFormIsDue(manors({ '2:2': true }), manors({ '2:2': true, '0:1': true }))).toBe(false);
    expect(crematoryFormIsDue(manors({ '2:2': true }), manors({ '2:2': true, '3:0': true }))).toBe(false);
    expect(crematoryFormIsDue(manors({}), { ...manors({ '2:2': true }), isDeleted: true })).toBe(false);
  });

  it('checking that step counts as the permit confirmation for the button too', () => {
    expect(crematoryPermitStatus(manors({ '2:2': true }))).toEqual({ confirmed: true, basis: '"Attestation Received / Hard Saved" checked' });
  });
});
