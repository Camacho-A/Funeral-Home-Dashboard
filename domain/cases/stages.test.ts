import { describe, expect, it } from 'vitest';
import { STAGES, rawStagesForDisplayStage, rawStagesForStageLabel } from './stages';

describe('rawStagesForDisplayStage (Case list scalability, Phase 2)', () => {
  it('display stage 0 ("First Call & Payment") combines raw stages 0 and 1', () => {
    expect(rawStagesForDisplayStage(0)).toEqual([0, 1]);
  });

  it('every other display stage maps from exactly one raw stage (displayStage + 1)', () => {
    expect(rawStagesForDisplayStage(1)).toEqual([2]);
    expect(rawStagesForDisplayStage(2)).toEqual([3]);
    expect(rawStagesForDisplayStage(3)).toEqual([4]);
    expect(rawStagesForDisplayStage(4)).toEqual([5]);
    expect(rawStagesForDisplayStage(5)).toEqual([6]);
    expect(rawStagesForDisplayStage(6)).toEqual([7]);
  });
});

describe('rawStagesForStageLabel (Case list scalability, Phase 2)', () => {
  it('resolves every canonical STAGES label to its raw stage(s)', () => {
    expect(rawStagesForStageLabel('First Call & Payment')).toEqual([0, 1]);
    expect(rawStagesForStageLabel('Jotform Application')).toEqual([2]);
    expect(rawStagesForStageLabel('EDRS & Doctor / Cause of Death')).toEqual([3]);
    expect(rawStagesForStageLabel('Permit & Authorization Sent to Crematory')).toEqual([4]);
    expect(rawStagesForStageLabel('DC Application Sent')).toEqual([5]);
    expect(rawStagesForStageLabel('Ready for Pickup / Contact Family')).toEqual([6]);
    expect(rawStagesForStageLabel('Completed')).toEqual([7]);
  });

  it('returns null for an unrecognized label — never a silent "All Cases" fallback', () => {
    expect(rawStagesForStageLabel('Pending Approval')).toBeNull();
    expect(rawStagesForStageLabel('In-House')).toBeNull();
    expect(rawStagesForStageLabel('')).toBeNull();
    expect(rawStagesForStageLabel('completed')).toBeNull(); // case-sensitive exact match
  });

  it('every STAGES entry round-trips through rawStagesForStageLabel with no gaps', () => {
    STAGES.forEach((label) => {
      expect(rawStagesForStageLabel(label)).not.toBeNull();
    });
  });
});
