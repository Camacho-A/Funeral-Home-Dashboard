import { describe, expect, it } from 'vitest';
import { findPaymentConfirmationChecklistIndex } from './paymentChecklist';
import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';

function snapshotWithItem(label: string, index: number): CaseWorkflowSnapshot {
  return {
    workflowTemplateId: 'x',
    workflowTemplateVersion: 1,
    intake: { sections: [] },
    stages: [
      {
        rawStage: 0,
        displayStage: 0,
        label: 'First Call & Payment',
        isAttentionStage: false,
        slaTargetDays: 1,
        checklist: {
          items: [
            { index: 0, label: 'Name of deceased', hasField: true },
            { index, label, hasField: false },
          ],
        },
      },
    ],
  };
}

describe('findPaymentConfirmationChecklistIndex', () => {
  it('finds the "Payment collected" item in whichever stage/index it appears', () => {
    expect(findPaymentConfirmationChecklistIndex(snapshotWithItem('Payment collected', 8))).toBe(8);
  });

  it('searches across every stage, not just the first', () => {
    const snapshot: CaseWorkflowSnapshot = {
      workflowTemplateId: 'x',
      workflowTemplateVersion: 1,
      intake: { sections: [] },
      stages: [
        { rawStage: 0, displayStage: 0, label: 'A', isAttentionStage: false, slaTargetDays: 1, checklist: { items: [{ index: 0, label: 'Something', hasField: false }] } },
        { rawStage: 1, displayStage: 1, label: 'B', isAttentionStage: false, slaTargetDays: 1, checklist: { items: [{ index: 0, label: 'Payment collected', hasField: false }] } },
      ],
    };
    expect(findPaymentConfirmationChecklistIndex(snapshot)).toBe(0);
  });

  it('returns null when no item has this exact label', () => {
    expect(findPaymentConfirmationChecklistIndex(snapshotWithItem('Something else entirely', 8))).toBeNull();
  });

  it('returns null for a null snapshot', () => {
    expect(findPaymentConfirmationChecklistIndex(null)).toBeNull();
  });

  it('does not match a label that merely contains "Payment collected" as a substring', () => {
    expect(findPaymentConfirmationChecklistIndex(snapshotWithItem('Payment collected in full', 8))).toBeNull();
  });
});
