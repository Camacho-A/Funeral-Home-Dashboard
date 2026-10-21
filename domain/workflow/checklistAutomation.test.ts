import { describe, expect, it } from 'vitest';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import {
  automatableChecklistItems,
  automaticChecklistCompletion,
  checklistCompletionInfo,
  describeCompletionEvent,
  findArrangementFormChecklistItem,
  isChecklistAutomationEnabled,
  staffChecklistCompletionUpdate,
} from './checklistAutomation';
import { resolveChecklist } from './resolveChecklist';
import type { Case, ChecklistCompletionRecord } from '../../types/case';

const NOW = '2026-10-20T15:00:00.000Z';
const manors = (overrides: Partial<Case> = {}): Case => ({ ...caseFixtures.find((c) => c.id === '1044')!, checklistState: {}, checklistCompletions: undefined, ...overrides });
const PAYMENT = { displayStage: 0, index: 8 };
const PAYMENT_TRIGGER = { source: 'payment_confirmed' as const, eventType: 'payment.paid_in_full', eventId: 'pay-1' };
const automatic: ChecklistCompletionRecord = { done: true, method: 'automatic', source: 'payment_confirmed', eventType: 'payment.paid_in_full', eventId: 'pay-1', at: NOW, actorId: 'solis-automation' };
const manual = (done: boolean): ChecklistCompletionRecord => ({ done, method: 'manual', source: 'staff_confirmation', eventType: 'staff.checklist_toggle', eventId: null, at: NOW, actorId: 'staff-7' });

describe('checklist automation — which items, for whom', () => {
  it('is on for Manors only; Gus SOLIS keeps its existing behaviour', () => {
    expect(isChecklistAutomationEnabled('managed-cremations')).toBe(true);
    expect(isChecklistAutomationEnabled('gus-camacho-jr')).toBe(false);
    expect(isChecklistAutomationEnabled(null)).toBe(false);
  });

  it('finds "Payment collected" and "Jotform application completed" by stable key in the case\'s own snapshot', () => {
    expect([...automatableChecklistItems(manors())]).toEqual([
      ['0:8', 'payment'],
      ['1:0', 'arrangement_form'],
    ]);
    expect(findArrangementFormChecklistItem(null)).toBeNull();
  });
});

describe('automaticChecklistCompletion — the rules', () => {
  it('completes an open item and records the source, event, related record, time and SOLIS Automation', () => {
    expect(automaticChecklistCompletion(manors(), PAYMENT, PAYMENT_TRIGGER, NOW)).toEqual({
      checklistState: { '0:8': true },
      checklistCompletions: { '0:8': automatic },
    });
  });

  it('changes nothing for an item already done — so a retried event never duplicates or rewrites the original source', () => {
    expect(automaticChecklistCompletion(manors({ checklistState: { '0:8': true }, checklistCompletions: { '0:8': automatic } }), PAYMENT, PAYMENT_TRIGGER, '2026-10-21T00:00:00.000Z')).toBeNull();
  });

  it('never overrides a staff decision, including a reopened item', () => {
    const reopened = manors({ checklistState: { '0:8': false }, checklistCompletions: { '0:8': manual(false) } });
    expect(automaticChecklistCompletion(reopened, PAYMENT, PAYMENT_TRIGGER, NOW)).toBeNull();
  });

  it('never touches an archived case', () => {
    expect(automaticChecklistCompletion(manors({ isDeleted: true }), PAYMENT, PAYMENT_TRIGGER, NOW)).toBeNull();
  });
});

describe('staffChecklistCompletionUpdate — manual control', () => {
  it('records every item a staff edit completes or reopens, with the staff member and time', () => {
    const current = manors({ checklistState: { '0:8': true, '2:0': false } });
    expect(staffChecklistCompletionUpdate(current, { '0:8': false, '2:0': true, '2:1': true }, 'staff-7', NOW)).toEqual({
      '0:8': manual(false),
      '2:0': manual(true),
      '2:1': manual(true),
    });
  });

  it('records nothing for an edit that changes nothing', () => {
    expect(staffChecklistCompletionUpdate(manors({ checklistState: { '0:8': true } }), { '0:8': true }, 'staff-7', NOW)).toBeNull();
    expect(staffChecklistCompletionUpdate(manors(), { '2:0': false }, 'staff-7', NOW)).toBeNull();
  });
});

describe('Why an item is complete', () => {
  const stage0 = (case_: Case) => resolveChecklist(case_.workflowSnapshot!.stages[0].checklist.items, 0, case_, { isPastStage: false });
  const stage2 = (case_: Case, past = false) => resolveChecklist(case_.workflowSnapshot!.stages.find((s) => s.displayStage === 2)!.checklist.items, 2, case_, { isPastStage: past });

  it('automatic, manual, derived from case information, or unavailable — never guessed', () => {
    const case_ = manors({ checklistState: { '0:8': true, '2:0': true, '2:1': true }, checklistCompletions: { '0:8': automatic, '2:0': manual(true) } });
    expect(stage0(case_).find((item) => item.index === 8)?.completion).toEqual({ kind: 'automatic', record: automatic });
    expect(stage2(case_).find((item) => item.index === 0)?.completion).toEqual({ kind: 'manual', record: manual(true) });
    expect(stage2(case_).find((item) => item.index === 1)?.completion).toEqual({ kind: 'unavailable' });
    expect(checklistCompletionInfo(case_, 0, 0, true)).toEqual({ kind: 'derived' });
  });

  it('a past stage with no records says "unavailable", and open items carry nothing', () => {
    expect(stage2(manors(), true).every((item) => item.completion?.kind === 'unavailable')).toBe(true);
    expect(stage2(manors()).every((item) => item.completion === undefined)).toBe(true);
  });

  it('Gus SOLIS shows no attribution at all', () => {
    const gus = { ...caseFixtures.find((c) => c.organizationId === 'gus-camacho-jr')!, checklistState: { '0:8': true } };
    const items = resolveChecklist(gus.workflowSnapshot!.stages[0].checklist.items, 0, gus, { isPastStage: false });
    expect(items.every((item) => item.completion === undefined)).toBe(true);
  });

  it('explains each event in plain language', () => {
    expect(describeCompletionEvent(automatic)).toBe('A verified payment brought the balance to $0.');
    expect(describeCompletionEvent(manual(true))).toBe('A staff member checked this item.');
    expect(describeCompletionEvent({ ...automatic, source: 'workflow_event', eventType: 'sla.event_recorded', eventId: 'hard_saved' })).toMatch(/workflow event/);
  });
});
