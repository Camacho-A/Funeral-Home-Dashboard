import { describe, expect, it } from 'vitest';
import { computeStageBreakdown, groupCasesByPresentedStage } from './calculations';
import { STAGES } from '../cases/stages';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';
import type { CaseViewModel } from '../../types/caseViewModel';

/**
 * Manors intake-stage combination (2026-10). The stage-breakdown report
 * buckets by USER-FACING stage, so Manors reports six rows instead of
 * seven. These guard the two things merging rows could plausibly break:
 * a case being double-counted or dropped, and a merged row inventing an
 * SLA target that produces a false bottleneck.
 */

/** Only the fields computeStageBreakdown actually reads. */
function caseAt(displayStage: number, daysWaitingInStage: number): CaseViewModel {
  return { displayStage, daysWaitingInStage } as unknown as CaseViewModel;
}

describe('groupCasesByPresentedStage', () => {
  it('buckets Manors cases into six user-facing stages', () => {
    const grouped = groupCasesByPresentedStage([], DEFAULT_ORGANIZATION_ID);
    expect(grouped).toHaveLength(6);
  });

  it('puts cases from BOTH canonical intake stages in the first bucket', () => {
    const grouped = groupCasesByPresentedStage(
      [caseAt(0, 1), caseAt(1, 1), caseAt(2, 1)],
      DEFAULT_ORGANIZATION_ID,
    );
    expect(grouped[0]).toHaveLength(2); // canonical display 0 and 1
    expect(grouped[1]).toHaveLength(1); // EDRS
  });

  it('counts every case exactly once across all buckets', () => {
    const cases = [0, 1, 2, 3, 4, 5, 6].map((ds) => caseAt(ds, 1));
    const grouped = groupCasesByPresentedStage(cases, DEFAULT_ORGANIZATION_ID);
    expect(grouped.reduce((sum, bucket) => sum + bucket.length, 0)).toBe(cases.length);
  });

  it('leaves another organization with one bucket per canonical stage', () => {
    const grouped = groupCasesByPresentedStage([], SECOND_MOCK_ORGANIZATION_ID);
    expect(grouped).toHaveLength(STAGES.length);
  });
});

describe('computeStageBreakdown — Manors', () => {
  it('reports six rows, the first being the combined intake stage', () => {
    const rows = computeStageBreakdown([], DEFAULT_ORGANIZATION_ID);
    expect(rows).toHaveLength(6);
    expect(rows[0].label).toBe('Intake & JotForm');
    expect(rows.map((r) => r.label)).not.toContain('First Call & Payment');
    expect(rows.map((r) => r.label)).not.toContain('Jotform Application');
  });

  it('sums the counts of both intake stages into the one row, dropping nothing', () => {
    const rows = computeStageBreakdown(
      [caseAt(0, 1), caseAt(0, 1), caseAt(1, 1), caseAt(2, 1)],
      DEFAULT_ORGANIZATION_ID,
    );
    expect(rows[0].count).toBe(3);
    expect(rows[1].count).toBe(1);
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(4);
  });

  it('uses the LONGEST covered SLA target for the merged stage, never the shortest', () => {
    // First Call targets 0.25d, JotForm Application 1d. A 0.5-day average
    // is over the shorter budget but inside the longer one — taking the
    // max is what stops that reading as a bottleneck.
    const rows = computeStageBreakdown([caseAt(0, 0.5)], DEFAULT_ORGANIZATION_ID);
    expect(rows[0].targetLabel).toBe('1d');
    expect(rows[0].isBottleneck).toBe(false);
    expect(rows[0].avgColor).toBe('neutral');
  });

  it('never sums the covered targets — 1.25d would hide a real bottleneck', () => {
    // A 1.1-day average exceeds the longest budget (1d) and must flag,
    // which it would not if the targets had been added together.
    const rows = computeStageBreakdown([caseAt(1, 1.1)], DEFAULT_ORGANIZATION_ID);
    expect(rows[0].isBottleneck).toBe(true);
    expect(rows[0].avgColor).toBe('danger');
  });

  it('averages days-in-stage across both intake stages', () => {
    const rows = computeStageBreakdown([caseAt(0, 1), caseAt(1, 3)], DEFAULT_ORGANIZATION_ID);
    expect(rows[0].count).toBe(2);
    expect(rows[0].avgDays).toBe(2);
  });

  it('leaves every later stage keyed to its own unchanged target', () => {
    const rows = computeStageBreakdown([], DEFAULT_ORGANIZATION_ID);
    expect(rows[1].label).toBe('EDRS & Doctor / Cause of Death');
    expect(rows[1].targetLabel).toBe('3d');
    expect(rows[5].label).toBe('Completed');
    expect(rows[5].targetLabel).toBe('—'); // terminal, no target
  });
});

describe('computeStageBreakdown — other organizations are unchanged', () => {
  it('still reports one row per canonical stage, with the original labels and targets', () => {
    const rows = computeStageBreakdown([], SECOND_MOCK_ORGANIZATION_ID);
    expect(rows).toHaveLength(STAGES.length);
    expect(rows.map((r) => r.label)).toEqual([...STAGES]);
    expect(rows[0].targetLabel).toBe('same day'); // First Call's own 0.25d
    expect(rows[1].targetLabel).toBe('1d'); // Jotform Application's own
  });
});
