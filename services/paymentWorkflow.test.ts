import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markCasePaidIfVerified } from './paymentWorkflow';
import { caseFixtures, DEFAULT_ORGANIZATION_ID } from './__mocks__/fixtures';
import { findPaymentConfirmationChecklistIndex } from '../domain/cases/paymentChecklist';
import { createCaseOrder } from './pricingService';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { seedChartOfAccounts } from './chartOfAccountsService';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import type { ActivityContext } from './activityService';
import type { PaymentRecord } from '../types/payment';

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

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine) correction: a
 * case with an itemized CaseOrder supports multiple payments against one
 * balance — a single verified success no longer automatically means
 * "fully paid" once a real balance exists to check against.
 */
describe('markCasePaidIfVerified — with an active CaseOrder (Phase 19C)', () => {
  let idCounter = 0;
  function idFactory(): string {
    idCounter += 1;
    return `wf-id-${idCounter}`;
  }

  let restoreIndex = -1;
  let restoreValue: (typeof caseFixtures)[number] | null = null;

  beforeEach(() => {
    caseOrderFixtures.length = 0;
    caseOrderLineItemFixtures.length = 0;
    caseOrderAuditFixtures.length = 0;
    paymentRecordFixtures.length = 0;
  });

  afterEach(() => {
    if (restoreIndex !== -1 && restoreValue) caseFixtures[restoreIndex] = restoreValue;
    restoreIndex = -1;
    restoreValue = null;
    caseOrderFixtures.length = 0;
    caseOrderLineItemFixtures.length = 0;
    caseOrderAuditFixtures.length = 0;
    paymentRecordFixtures.length = 0;
  });

  // Deliberately a case that starts 'awaiting_payment' — some seed cases
  // are already 'paid_in_full', which would make the "stays awaiting"
  // assertions below meaningless (already true beforehand).
  function withKnownCase() {
    const index = caseFixtures.findIndex(
      (c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted && c.paymentStatus === 'awaiting_payment',
    );
    restoreIndex = index;
    restoreValue = caseFixtures[index];
    return caseFixtures[index];
  }

  function succeededPayment(caseId: string, caseOrderId: string, amount: number): PaymentRecord {
    return {
      id: idFactory(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId,
      caseOrderId,
      provider: 'clover',
      providerCheckoutId: idFactory(),
      providerPaymentId: idFactory(),
      idempotencyKey: idFactory(),
      checkoutUrl: null,
      status: 'succeeded',
      amount,
      currency: 'usd',
      purpose: 'Balance due',
      cardBrand: null,
      cardLast4: null,
      receiptReference: null,
      failureCode: null,
      failureMessage: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      paidAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      initiatedByStaffProfileId: null, depositedInBankDepositId: null,
    };
  }

  it('does not mark the case paid_in_full when a partial payment leaves a remaining balance', async () => {
    const case_ = withKnownCase();
    const { order } = await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: case_.id,
        selections: { weightTier: '201_250', extraDeathCertificateQuantity: 0, mailCremated: false }, // $1,180 total
        performedBy: 'Test',
        idFactory,
      },
      'mock',
    );
    paymentRecordFixtures.push(succeededPayment(case_.id, order.id, 50_000)); // partial

    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');

    const updatedCase = caseFixtures.find((c) => c.id === case_.id);
    expect(updatedCase?.paymentStatus).toBe('awaiting_payment');
    const updatedOrder = caseOrderFixtures.find((o) => o.id === order.id);
    expect(updatedOrder?.balanceDue).toBe(order.total - 50_000);
  });

  it('marks the case paid_in_full once multiple successive payments sum to the full balance', async () => {
    const case_ = withKnownCase();
    const { order } = await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: case_.id,
        selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false }, // $890 total
        performedBy: 'Test',
        idFactory,
      },
      'mock',
    );

    paymentRecordFixtures.push(succeededPayment(case_.id, order.id, 40_000));
    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    expect(caseFixtures.find((c) => c.id === case_.id)?.paymentStatus).toBe('awaiting_payment');

    paymentRecordFixtures.push(succeededPayment(case_.id, order.id, 49_000)); // 40k + 49k = 89k = $890
    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    expect(caseFixtures.find((c) => c.id === case_.id)?.paymentStatus).toBe('paid_in_full');
    expect(caseOrderFixtures.find((o) => o.id === order.id)?.balanceDue).toBe(0);
  });
});

describe('markCasePaidIfVerified — financial posting (Phase 31)', () => {
  let idCounter = 0;
  function idFactory(): string {
    idCounter += 1;
    return `wf-fin-id-${idCounter}`;
  }

  function ctx(): ActivityContext {
    return { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1', isSystemGenerated: true };
  }

  let restoreIndex = -1;
  let restoreValue: (typeof caseFixtures)[number] | null = null;

  beforeEach(async () => {
    await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
  });

  afterEach(() => {
    if (restoreIndex !== -1 && restoreValue) caseFixtures[restoreIndex] = restoreValue;
    restoreIndex = -1;
    restoreValue = null;
    ledgerAccountFixtures.length = 0;
    journalEntryFixtures.length = 0;
    journalEntryLineFixtures.length = 0;
  });

  function withKnownCase() {
    const index = caseFixtures.findIndex((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted);
    restoreIndex = index;
    restoreValue = caseFixtures[index];
    return caseFixtures[index];
  }

  it('posts a journal entry for the payment when financialPosting is provided', async () => {
    const case_ = withKnownCase();
    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, case_.id, 'mock', {
      paymentId: 'payment-fin-1',
      amountCents: 5_000,
      ctx: ctx(),
      idFactory,
    });

    const entry = journalEntryFixtures.find((e) => e.sourceReferenceId === 'payment-fin-1');
    expect(entry).toBeDefined();
    expect(entry?.sourceType).toBe('payment');
    const lines = journalEntryLineFixtures.filter((l) => l.journalEntryId === entry!.id);
    expect(lines).toHaveLength(2);
  });

  it('never posts a journal entry when financialPosting is omitted (backward compatible)', async () => {
    const case_ = withKnownCase();
    await markCasePaidIfVerified(DEFAULT_ORGANIZATION_ID, case_.id, 'mock');
    expect(journalEntryFixtures).toHaveLength(0);
  });
});
