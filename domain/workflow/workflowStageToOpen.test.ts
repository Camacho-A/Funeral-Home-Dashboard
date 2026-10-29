import { describe, expect, it } from 'vitest';
import { workflowStageToOpen } from './workflowStageToOpen';

describe('workflowStageToOpen (Resolve Workflow 2, 2026-10)', () => {
  it('opens a stage the case has passed — e.g. Workflow 2 on a case at the last stage', () => {
    expect(workflowStageToOpen(2, 7)).toBe(2);
    expect(workflowStageToOpen('2', 7)).toBe(2);
  });
  it('the current stage, a later stage, or anything invalid opens the current step', () => {
    expect(workflowStageToOpen(2, 2)).toBeNull();
    expect(workflowStageToOpen(2, 0)).toBeNull();
    for (const bad of ['', 'abc', '-1', '2.5', null, undefined, -1]) expect(workflowStageToOpen(bad, 7)).toBeNull();
  });
});
