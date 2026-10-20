import { describe, expect, it } from 'vitest';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import {
  automatableChecklistItems,
  automaticChecklistCompletion,
  findArrangementFormChecklistItem,
  isChecklistAutomationEnabled,
  isCompletedAutomatically,
  staffChecklistAutomationUpdate,
} from './checklistAutomation';
import { resolveChecklist } from './resolveChecklist';
import type { Case } from '../../types/case';

const NOW = '2026-10-20T15:00:00.000Z';
const manors = (overrides: Partial<Case> = {}): Case => ({ ...caseFixtures.find((c) => c.id === '1044')!, checklistState: {}, ...overrides });
const PAYMENT = { displayStage: 0, index: 8 };

describe('checklist automation — which items, for whom', () => {
  it('is on for Manors only; Gus SOLIS keeps its existing behaviour', () => {
    expect(isChecklistAutomationEnabled('managed-cremations')).toBe(true);
    expect(isChecklistAutomationEnabled('gus-camacho-jr')).toBe(false);
    expect(isChecklistAutomationEnabled(null)).toBe(false);
  });

  it('finds "Payment collected" and "Jotform application completed" in the case\'s own snapshot', () => {
    expect([...automatableChecklistItems(manors())]).toEqual([
      ['0:8', 'payment_received_in_full'],
      ['1:0', 'arrangement_form_received'],
    ]);
    expect(findArrangementFormChecklistItem(null)).toBeNull();
  });
});

describe('automaticChecklistCompletion — the rules', () => {
  it('completes an open item and records that SOLIS did it, and why', () => {
    expect(automaticChecklistCompletion(manors(), PAYMENT, 'payment_received_in_full', NOW)).toEqual({
      checklistState: { '0:8': true },
      checklistAutomation: { '0:8': { by: 'automatic', source: 'payment_received_in_full', at: NOW } },
    });
  });

  it('changes nothing for an item already done — so a retried event never duplicates anything', () => {
    expect(automaticChecklistCompletion(manors({ checklistState: { '0:8': true } }), PAYMENT, 'payment_received_in_full', NOW)).toBeNull();
  });

  it('never overrides a staff correction', () => {
    const corrected = manors({ checklistState: { '0:8': false }, checklistAutomation: { '0:8': { by: 'staff', at: NOW } } });
    expect(automaticChecklistCompletion(corrected, PAYMENT, 'payment_received_in_full', NOW)).toBeNull();
  });

  it('never touches an archived case', () => {
    expect(automaticChecklistCompletion(manors({ isDeleted: true }), PAYMENT, 'payment_received_in_full', NOW)).toBeNull();
  });
});

describe('staffChecklistAutomationUpdate — manual control', () => {
  it('records a staff decision when staff change an automatable item', () => {
    const auto = manors({ checklistState: { '0:8': true }, checklistAutomation: { '0:8': { by: 'automatic', source: 'payment_received_in_full', at: NOW } } });
    expect(staffChecklistAutomationUpdate(auto, { '0:8': false }, NOW)).toEqual({ '0:8': { by: 'staff', at: NOW } });
  });

  it('ignores items SOLIS never completes, and edits that change nothing', () => {
    expect(staffChecklistAutomationUpdate(manors(), { '0:3': true, '2:0': true }, NOW)).toBeNull();
    expect(staffChecklistAutomationUpdate(manors({ checklistState: { '0:8': true } }), { '0:8': true }, NOW)).toBeNull();
  });
});

describe('"Completed automatically" in the checklist', () => {
  const stage0 = (case_: Case) => resolveChecklist(case_.workflowSnapshot!.stages[0].checklist.items, 0, case_, { isPastStage: false });

  it('marks only items SOLIS completed, and only while they are done', () => {
    const auto = manors({ checklistState: { '0:8': true }, checklistAutomation: { '0:8': { by: 'automatic', source: 'payment_received_in_full', at: NOW } } });
    expect(stage0(auto).find((item) => item.index === 8)?.completedAutomatically).toBe(true);
    expect(stage0(auto).filter((item) => item.completedAutomatically)).toHaveLength(1);

    const ticked = manors({ checklistState: { '0:8': true } });
    expect(stage0(ticked).find((item) => item.index === 8)?.completedAutomatically).toBe(false);

    const corrected = manors({ checklistState: { '0:8': false }, checklistAutomation: { '0:8': { by: 'staff', at: NOW } } });
    expect(stage0(corrected).find((item) => item.index === 8)?.completedAutomatically).toBe(false);
    expect(isCompletedAutomatically(corrected, 0, 8)).toBe(false);
  });
});
