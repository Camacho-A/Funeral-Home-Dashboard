import { describe, expect, it } from 'vitest';
import { isCaseWorkflowComplete, becameComplete } from './workflowCompletion';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../workflow/snapshot';
import {
  standardCremationWorkflowTemplateFixture,
  secondOrgWorkflowTemplateFixture,
} from '../../services/__mocks__/workflowTemplates';
import type { Case } from '../../types/case';

type CompletionCase = Parameters<typeof isCaseWorkflowComplete>[0];

function caseAt(overrides: Partial<Case>): CompletionCase {
  const template = standardCremationWorkflowTemplateFixture;
  return {
    rawStage: 7,
    workflowSnapshot: buildCaseWorkflowSnapshot(template, latestTemplateVersion(template)),
    returnMethod: 'pickup',
    pickupStatus: 'awaiting_pickup',
    shippingDeliveryStatus: null,
    ...overrides,
  } as CompletionCase;
}

describe('isCaseWorkflowComplete', () => {
  it('a released pickup at the terminal stage is complete', () => {
    expect(isCaseWorkflowComplete(caseAt({ pickupStatus: 'released' }))).toBe(true);
  });

  it('a confirmed shipping delivery at the terminal stage is complete', () => {
    expect(
      isCaseWorkflowComplete(caseAt({ returnMethod: 'shipping', shippingDeliveryStatus: 'delivered' })),
    ).toBe(true);
  });

  it('awaiting family pickup is NOT complete', () => {
    expect(isCaseWorkflowComplete(caseAt({}))).toBe(false);
  });

  it('shipping DISPATCH is not confirmed delivery', () => {
    // A tracking number and a "shipped" status are not the family having
    // received anything.
    expect(
      isCaseWorkflowComplete(caseAt({ returnMethod: 'shipping', shippingDeliveryStatus: 'shipped' })),
    ).toBe(false);
  });

  it('an undecided return method can never be complete', () => {
    expect(isCaseWorkflowComplete(caseAt({ returnMethod: 'undecided' }))).toBe(false);
  });

  it('a released pickup EARLIER in the workflow is not complete', () => {
    // The crematory releasing ashes to the funeral home happens stages
    // before the family receives them. Being released is not enough on
    // its own — the case must also have reached its last stage.
    for (const rawStage of [0, 3, 5, 6]) {
      expect(isCaseWorkflowComplete(caseAt({ rawStage, pickupStatus: 'released' })), `rawStage ${rawStage}`).toBe(false);
    }
  });

  it('judges another organization against ITS OWN template, with no hardcoded stage number', () => {
    const other = secondOrgWorkflowTemplateFixture;
    const snapshot = buildCaseWorkflowSnapshot(other, latestTemplateVersion(other));
    const stages = [...snapshot.stages].sort((a, b) => a.displayStage - b.displayStage);
    const terminal = stages[stages.length - 1];
    const earlier = stages[0];

    expect(
      isCaseWorkflowComplete({
        rawStage: terminal.rawStage,
        workflowSnapshot: snapshot,
        returnMethod: 'pickup',
        pickupStatus: 'released',
        shippingDeliveryStatus: null,
      }),
    ).toBe(true);

    expect(
      isCaseWorkflowComplete({
        rawStage: earlier.rawStage,
        workflowSnapshot: snapshot,
        returnMethod: 'pickup',
        pickupStatus: 'released',
        shippingDeliveryStatus: null,
      }),
    ).toBe(false);
  });

  it('a case with no workflow snapshot is never complete', () => {
    expect(isCaseWorkflowComplete(caseAt({ workflowSnapshot: null, pickupStatus: 'released' }))).toBe(false);
  });
});

describe('becameComplete — archiving keys off the transition, never the state', () => {
  const incomplete = caseAt({});
  const complete = caseAt({ pickupStatus: 'released' });

  it('is true only for an incomplete -> complete transition', () => {
    expect(becameComplete(incomplete, complete)).toBe(true);
    expect(becameComplete(incomplete, incomplete)).toBe(false);
    expect(becameComplete(complete, complete)).toBe(false);
  });

  it('never fires for an already-complete case, so deploying backfills nothing', () => {
    // Every historical completed case — B2026-035 included — was complete
    // before any later edit, so no edit can retroactively archive it.
    expect(becameComplete(complete, complete)).toBe(false);
  });

  it('a restored case is not re-archived by a later unrelated edit', () => {
    // Restore leaves the case complete. The next edit therefore sees
    // complete -> complete, which is not a transition. Only a genuinely
    // NEW completion can archive again.
    const restoredStillComplete = complete;
    expect(becameComplete(restoredStillComplete, restoredStillComplete)).toBe(false);
  });

  it('a case that becomes incomplete again can later re-complete', () => {
    // Staff correct a mistaken release, then record the real one.
    expect(becameComplete(complete, incomplete)).toBe(false);
    expect(becameComplete(incomplete, complete)).toBe(true);
  });
});
