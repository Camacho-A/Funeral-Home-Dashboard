import { describe, expect, it } from 'vitest';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { describeChecklistCorrection, historicalChecklistKeys, isHistoricalChecklistCorrection, isTrueEarlierStageStatusEnabled } from './earlierStages';
import { staffChecklistCompletionUpdate } from './checklistAutomation';
import { findStageByRawStage } from './resolveStages';
import type { Case } from '../../types/case';

/**
 * Earlier workflow stages (2026-10): the Manors-only setting and the
 * server's own decision that a checklist change is a historical correction.
 */

const at = (displayStage: number): Case => {
  const base = caseFixtures.find((c) => c.organizationId === MANORS_ORGANIZATION_ID && c.workflowSnapshot)!;
  const stage = base.workflowSnapshot!.stages.find((s) => s.displayStage === displayStage)!;
  return { ...base, rawStage: stage.rawStage, checklistState: {} };
};

describe('true earlier-stage status — Manors only', () => {
  it('is enabled for Manors and nowhere else', () => {
    expect(isTrueEarlierStageStatusEnabled(MANORS_ORGANIZATION_ID)).toBe(true);
    expect(isTrueEarlierStageStatusEnabled(GUS_CAMACHO_ORGANIZATION_ID)).toBe(false);
    expect(isTrueEarlierStageStatusEnabled('evergreen-memorial-group')).toBe(false);
    expect(isTrueEarlierStageStatusEnabled('some-new-organization')).toBe(false);
    expect(isTrueEarlierStageStatusEnabled(null)).toBe(false);
  });
});

describe('historical correction — decided from the case as stored', () => {
  it('a key on a stage before the current one is historical; the current and later stages are not', () => {
    const case_ = at(3);
    expect(findStageByRawStage(case_.workflowSnapshot!, case_.rawStage)?.displayStage).toBe(3);
    expect(historicalChecklistKeys(case_, { '2:1': true })).toEqual(['2:1']);
    expect(historicalChecklistKeys(case_, { '0:0': false })).toEqual(['0:0']);
    expect(historicalChecklistKeys(case_, { '3:0': true })).toEqual([]);
    expect(historicalChecklistKeys(case_, { '4:0': true })).toEqual([]);
    expect(isHistoricalChecklistCorrection(case_, { '2:1': true })).toBe(true);
    expect(isHistoricalChecklistCorrection(case_, { '3:0': true })).toBe(false);
  });

  it('a mixed change flags only its earlier-stage keys', () => {
    expect(historicalChecklistKeys(at(3), { '2:1': true, '3:0': true })).toEqual(['2:1']);
  });

  it('nothing to decide — no patch, no snapshot, malformed keys — is never historical', () => {
    expect(historicalChecklistKeys(at(3), undefined)).toEqual([]);
    expect(historicalChecklistKeys(at(3), {})).toEqual([]);
    expect(historicalChecklistKeys({ ...at(3), workflowSnapshot: null }, { '0:0': true })).toEqual([]);
    expect(historicalChecklistKeys(at(3), { '1': true, 'x:0': true })).toEqual([]);
  });

  it('the correction is described with the presented stage and item labels', () => {
    const case_ = at(3);
    const stage = case_.workflowSnapshot!.stages.find((s) => s.displayStage === 2)!;
    const { description, changes } = describeChecklistCorrection(case_, { '2:0': true });
    expect(changes).toEqual([{ key: '2:0', stage: stage.label, label: expect.any(String), done: true }]);
    expect(description).toContain(`(${stage.label})`);
    expect(description).toMatch(/^Earlier step corrected: checked "/);
    expect(description).toContain('the case stays at its current stage');
  });
});

describe('attribution — a correction keeps staff, time and says what it is', () => {
  it('records the staff member and the time, flagged historical only for the earlier-stage keys', () => {
    const records = staffChecklistCompletionUpdate({ checklistState: {} }, { '2:1': true, '3:0': true }, 'identity-dana', '2026-10-29T15:00:00.000Z', {
      historicalKeys: ['2:1'],
    })!;
    expect(records['2:1']).toEqual({
      done: true,
      method: 'manual',
      source: 'staff_confirmation',
      eventType: 'staff.checklist_toggle',
      eventId: null,
      at: '2026-10-29T15:00:00.000Z',
      actorId: 'identity-dana',
      historical: true,
    });
    expect(records['3:0']).not.toHaveProperty('historical');
  });

  it('an ordinary current-stage update is recorded exactly as before', () => {
    const records = staffChecklistCompletionUpdate({ checklistState: {} }, { '3:0': true }, 'identity-dana', '2026-10-29T15:00:00.000Z')!;
    expect(records['3:0']).not.toHaveProperty('historical');
  });
});
