import { afterEach, describe, expect, it } from 'vitest';
import { caseRevision } from '../lib/wixCaseMapper';
import { casesService } from './casesService';
import { caseFixtures, DEFAULT_ORGANIZATION_ID } from './__mocks__/fixtures';
import { buildCaseViewModel } from '../domain/cases/viewModel';
import type { Case } from '../types/case';

/**
 * Earlier workflow stages (2026-10): a stage the case has moved beyond
 * shows its TRUE checklist status, and staff can complete or correct it
 * there — without the case ever moving. Fictional mock cases only.
 */
const originals = new Map<string, Case>();
const index = (id: string) => caseFixtures.findIndex((c) => c.id === id && c.organizationId === DEFAULT_ORGANIZATION_ID);
afterEach(() => {
  for (const [id, original] of originals) caseFixtures[index(id)] = original;
  originals.clear();
});

/** A fictional Manors case moved to its last stage with nothing checked on the way. */
function lateCase(id: string, overrides: Partial<Case> = {}): Case {
  originals.set(id, caseFixtures[index(id)]);
  const base = caseFixtures[index(id)];
  const lastRaw = Math.max(...base.workflowSnapshot!.stages.map((s) => s.rawStage));
  caseFixtures[index(id)] = { ...base, rawStage: lastRaw, checklistState: {}, isDeleted: false, ...overrides };
  return caseFixtures[index(id)];
}
const save = (id: string, checklistState: Record<string, boolean>) =>
  casesService.update({ organizationId: DEFAULT_ORGANIZATION_ID } as Parameters<typeof casesService.update>[0], id, { checklistState }, 'mock', {
    expectedRevision: caseRevision(caseFixtures[index(id)]),
  });
const workflow2 = (case_: Case) => buildCaseViewModel(case_, { staffList: [], viewingDisplayStage: 2 }).checklist;

describe('earlier workflow stages', () => {
  it('show what was really done — nothing, for a case moved forward without its steps — and are editable in any order', () => {
    const case_ = lateCase('1045');
    const items = workflow2(case_);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => !i.done && !i.locked)).toBe(true);
  });

  it('completing, then correcting, an earlier step records it on that step and never moves the case — backward or forward', async () => {
    const case_ = lateCase('1045');
    const stageBefore = case_.rawStage;
    let saved = await save('1045', { '2:1': true });
    expect(saved.rawStage).toBe(stageBefore);
    expect(saved.checklistState).toEqual({ '2:1': true });
    expect(workflow2(saved).map((i) => i.done)).toEqual([false, true, false]);
    // Nothing else was completed alongside it.
    expect(Object.keys(saved.checklistState ?? {})).toEqual(['2:1']);
    // Recorded as a historical correction, with the staff member's attribution.
    expect(saved.checklistCompletions?.['2:1']).toMatchObject({ done: true, method: 'manual', historical: true });

    saved = await save('1045', { '2:1': false });
    expect(saved.rawStage).toBe(stageBefore);
    expect(workflow2(saved).every((i) => !i.done)).toBe(true);
  });

  it('a Medical Examiner case past Workflow 2 shows — and can complete — the three ME verification steps; the doctor steps checked before it became ME are kept, not counted', async () => {
    lateCase('1042', { isMedicalExaminerCase: true, checklistState: { '2:0': true, '2:1': true } });
    let items = workflow2(caseFixtures[index('1042')]);
    expect(items.map((i) => [i.index, i.label, i.done])).toEqual([
      [3, 'Medical Examiner EDRS entry verified', false],
      [4, 'Medical Examiner cause of death verified', false],
      [5, 'Required ME information confirmed', false],
    ]);
    const stageBefore = caseFixtures[index('1042')].rawStage;
    const saved = await save('1042', { '2:3': true, '2:4': true, '2:5': true });
    expect(saved.rawStage).toBe(stageBefore);
    items = workflow2(saved);
    expect(items.every((i) => i.done)).toBe(true);
    expect(saved.checklistState).toMatchObject({ '2:0': true, '2:1': true, '2:3': true, '2:4': true, '2:5': true });
    expect(saved.checklistCompletions?.['2:5']).toMatchObject({ historical: true });
  });

  it('a case whose earlier steps are complete reads complete — nothing changes for it', () => {
    const case_ = lateCase('1045');
    const stage2 = case_.workflowSnapshot!.stages.find((s) => s.displayStage === 2)!;
    const all = Object.fromEntries(stage2.checklist.items.map((item) => [`2:${item.index}`, true]));
    caseFixtures[index('1045')] = { ...case_, checklistState: all };
    expect(workflow2(caseFixtures[index('1045')]).every((i) => i.done)).toBe(true);
  });
});
