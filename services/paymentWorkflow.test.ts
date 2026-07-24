import { afterEach, describe, expect, it } from 'vitest';
import { markCasePaidIfVerified } from './paymentWorkflow';
import { caseFixtures, DEFAULT_ORGANIZATION_ID } from './__mocks__/fixtures';
import { findPaymentConfirmationChecklistIndex } from '../domain/cases/paymentChecklist';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Mock-mode coverage for
 * the one shared "apply a verified paid outcome to a case" function,
 * called from both the webhook route and the status-polling GET route's
 * reconciliation fallback. Wix-mode is exercised indirectly through the
 * webhook route's own tests (app/api/webhooks/clover/route.test.ts),
 * which mock lib/wixDataApi.ts the same way every other Wix-mode route
 * test does.
 */
describe('markCasePaidIfVerified — mock mode', () => {
  let restoreIndex = -1;
  let restoreValue: (typeof caseFixtures)[number] | null = null;

  afterEach(() => {
    if (restoreIndex !== -1 && restoreValue) {
      caseFixtures[restoreIndex] = restoreValue;
    }
    restoreIndex = -1;
    restoreValue = null;
  });

  function withKnownCase() {
    const index = caseFixtures.findIndex((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted);
    restoreIndex = index;
    restoreValue = caseFixtures[index];
    return { index, original: caseFixtures[index] };
  }

  it('marks Case.paymentStatus paid_in_full', async () => {
    const { index, original } = withKnownCase();
    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, original.id, 'mock');
    expect(caseFixtures[index].paymentStatus).toBe('paid_in_full');
  });

  it("marks the case's own 'Payment collected' checklist item done, found via its workflowSnapshot", async () => {
    const { index, original } = withKnownCase();
    const checklistIndex = findPaymentConfirmationChecklistIndex(original.workflowSnapshot);
    expect(checklistIndex).not.toBeNull();

    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, original.id, 'mock');

    expect(caseFixtures[index].checklistState[checklistIndex as number]).toBe(true);
  });

  it('never touches rawStage — a payment event never auto-advances the workflow stage', async () => {
    const { index, original } = withKnownCase();
    const stageBefore = original.rawStage;

    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, original.id, 'mock');

    expect(caseFixtures[index].rawStage).toBe(stageBefore);
  });

  it('preserves every other checklistState entry untouched', async () => {
    const { index, original } = withKnownCase();
    const checklistIndex = findPaymentConfirmationChecklistIndex(original.workflowSnapshot) as number;
    const otherEntries = Object.entries(original.checklistState).filter(([key]) => Number(key) !== checklistIndex);

    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, original.id, 'mock');

    for (const [key, value] of otherEntries) {
      expect(caseFixtures[index].checklistState[Number(key)]).toBe(value);
    }
  });

  it('is idempotent — applying it twice leaves the same paid state, no error', async () => {
    const { index, original } = withKnownCase();
    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, original.id, 'mock');
    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, original.id, 'mock');
    expect(caseFixtures[index].paymentStatus).toBe('paid_in_full');
  });

  it('is a no-op for a nonexistent case id — does not throw', async () => {
    await expect(markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, 'no-such-case', 'mock')).resolves.toBeUndefined();
  });

  it('is a no-op when the case belongs to a different organization', async () => {
    const { original } = withKnownCase();
    await markCasePaidIfVerified('some-other-org', original.id, 'mock');
    // restoreIndex/original still point at the real record — confirm it
    // was never touched despite a matching caseId.
    expect(caseFixtures.find((c) => c.id === original.id)?.paymentStatus).toBe(original.paymentStatus);
  });
});
