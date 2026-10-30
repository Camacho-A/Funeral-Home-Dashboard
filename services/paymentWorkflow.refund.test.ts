import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markCaseUnpaidAfterRefund } from './paymentWorkflow';
import { caseFixtures, DEFAULT_ORGANIZATION_ID } from './__mocks__/fixtures';
import { caseOrderFixtures } from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { caseWriteOffFixtures } from './__mocks__/ledgerFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import type { ActivityContext } from './activityService';
import type { Case } from '../types/case';
import type { PaymentRecord, PaymentRecordStatus } from '../types/payment';

/**
 * Payment status after a refund (2026-10): a completed refund that leaves
 * a verified balance on the Case Order returns the case to "Awaiting
 * payment" — and nothing else about the case changes.
 */

const NOW = '2026-10-30T12:00:00.000Z';
const ctx: ActivityContext = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  actorIdentityId: 'identity-dana',
  actorMembershipId: null,
  actorRoleKey: 'owner',
  correlationId: 'refund-test',
};

let index = -1;
let original: Case;
let lengths: { orders: number; payments: number; writeOffs: number; activity: number };
let savedOrders: typeof caseOrderFixtures;

beforeEach(() => {
  index = caseFixtures.findIndex((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted && c.workflowSnapshot);
  original = caseFixtures[index];
  lengths = {
    orders: caseOrderFixtures.length,
    payments: paymentRecordFixtures.length,
    writeOffs: caseWriteOffFixtures.length,
    activity: activityEventFixtures.length,
  };
  // Any order the fixture case already has would compete with the test's own.
  savedOrders = caseOrderFixtures.map((o) => ({ ...o }));
  caseOrderFixtures.forEach((o, i) => {
    if (o.caseId === original.id && o.organizationId === DEFAULT_ORGANIZATION_ID) caseOrderFixtures[i] = { ...o, status: 'superseded' };
  });
});

afterEach(() => {
  caseFixtures[index] = original;
  caseOrderFixtures.splice(0, caseOrderFixtures.length, ...savedOrders);
  paymentRecordFixtures.length = lengths.payments;
  caseWriteOffFixtures.length = lengths.writeOffs;
  activityEventFixtures.length = lengths.activity;
});

function givenCase(patch: Partial<Case>) {
  caseFixtures[index] = { ...original, ...patch };
}

function givenOrder(total: number) {
  caseOrderFixtures.push({
    id: 'refund-order', organizationId: DEFAULT_ORGANIZATION_ID, caseId: original.id, status: 'active',
    subtotal: total, discountTotal: 0, taxTotal: 0, total, balanceDue: 0, version: 1, createdAt: NOW, updatedAt: NOW,
  });
}

function givenPayment(id: string, status: PaymentRecordStatus, amount: number) {
  const payment: PaymentRecord = {
    id, organizationId: DEFAULT_ORGANIZATION_ID, caseId: original.id, caseOrderId: 'refund-order',
    provider: 'clover', providerCheckoutId: `checkout-${id}`, providerPaymentId: `provider-${id}`, idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:${id}`,
    checkoutUrl: null, status, amount, currency: 'usd', purpose: 'Cremation service fee',
    cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
    createdAt: NOW, paidAt: NOW, updatedAt: NOW, initiatedByStaffProfileId: null, depositedInBankDepositId: null,
  };
  paymentRecordFixtures.push(payment);
}

function givenWriteOff(amount: number) {
  caseWriteOffFixtures.push({
    id: 'refund-write-off', organizationId: DEFAULT_ORGANIZATION_ID, caseId: original.id, amount,
    journalEntryId: 'je-write-off', reason: 'Hardship', performedByStaffProfileId: null, createdAt: NOW,
  });
}

const paymentStatusEvents = () =>
  activityEventFixtures.slice(lengths.activity).filter((e) => e.caseId === original.id && e.eventType === 'case.updated');

describe('a refund that leaves a verified balance returns the case to Awaiting payment', () => {
  it('a full refund of the only payment reopens the payment status and records it', async () => {
    givenCase({ paymentStatus: 'paid_in_full' });
    givenOrder(89_000);
    givenPayment('p1', 'refunded', 89_000);

    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('reopened');
    expect(caseFixtures[index].paymentStatus).toBe('awaiting_payment');
    expect(caseOrderFixtures.find((o) => o.id === 'refund-order')?.balanceDue).toBe(89_000);

    const events = paymentStatusEvents();
    expect(events).toHaveLength(1);
    expect(events[0].actorIdentityId).toBe('identity-dana');
    expect(JSON.parse(events[0].previousValue!)).toEqual({ paymentStatus: 'paid_in_full' });
    expect(JSON.parse(events[0].newValue!)).toEqual({ paymentStatus: 'awaiting_payment' });
  });

  it('a partial refund that leaves part of the order unpaid reopens it too', async () => {
    givenCase({ paymentStatus: 'paid_in_full' });
    givenOrder(89_000);
    givenPayment('p1', 'succeeded', 50_000);
    givenPayment('p2', 'refunded', 39_000);

    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('reopened');
    expect(caseFixtures[index].paymentStatus).toBe('awaiting_payment');
  });

  it('a pending replacement payment does not count — the balance is still owed', async () => {
    givenCase({ paymentStatus: 'paid_in_full' });
    givenOrder(89_000);
    givenPayment('p1', 'refunded', 89_000);
    givenPayment('p2', 'pending', 89_000);
    givenPayment('p3', 'failed', 89_000);
    givenPayment('p4', 'cancelled', 89_000);

    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('reopened');
  });

  it('only the payment status changes: checklist ticks, completion records, stage and payment history are kept', async () => {
    givenCase({ paymentStatus: 'paid_in_full' });
    const before = caseFixtures[index];
    givenOrder(89_000);
    givenPayment('p1', 'refunded', 89_000);

    await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx);

    const after = caseFixtures[index];
    expect(after.checklistState).toEqual(before.checklistState);
    expect(after.checklistCompletions).toEqual(before.checklistCompletions);
    expect(after.rawStage).toBe(before.rawStage);
    expect(after.isDeleted).toBe(before.isDeleted);
    expect(paymentRecordFixtures.find((p) => p.id === 'p1')?.status).toBe('refunded');
  });
});

describe('a settled case is never reopened', () => {
  it('a refund still covered by a write-off leaves the case paid', async () => {
    givenCase({ paymentStatus: 'paid_in_full' });
    givenOrder(89_000);
    givenPayment('p1', 'succeeded', 50_000);
    givenPayment('p2', 'refunded', 39_000);
    givenWriteOff(39_000);

    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('unchanged');
    expect(caseFixtures[index].paymentStatus).toBe('paid_in_full');
    expect(paymentStatusEvents()).toHaveLength(0);
  });

  it('a refund still covered by other succeeded payments leaves the case paid', async () => {
    givenCase({ paymentStatus: 'paid_in_full' });
    givenOrder(50_000);
    givenPayment('p1', 'succeeded', 50_000);
    givenPayment('p2', 'refunded', 10_000);

    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('unchanged');
    expect(caseFixtures[index].paymentStatus).toBe('paid_in_full');
  });

  it('a case without a Case Order has no authoritative balance and is left alone', async () => {
    givenCase({ paymentStatus: 'paid_in_full' });
    givenPayment('p1', 'refunded', 89_000);

    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('unchanged');
    expect(caseFixtures[index].paymentStatus).toBe('paid_in_full');
  });

  it('an archived case is left alone', async () => {
    givenCase({ paymentStatus: 'paid_in_full', isDeleted: true });
    givenOrder(89_000);
    givenPayment('p1', 'refunded', 89_000);

    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('unchanged');
    expect(caseFixtures[index].paymentStatus).toBe('paid_in_full');
  });

  it('a case already awaiting payment is not written or recorded again', async () => {
    givenCase({ paymentStatus: 'awaiting_payment' });
    const revision = caseFixtures[index].revision;
    givenOrder(89_000);
    givenPayment('p1', 'refunded', 89_000);

    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('unchanged');
    expect(caseFixtures[index].revision).toBe(revision);
    expect(paymentStatusEvents()).toHaveLength(0);
  });

  it('running it twice reopens once and records once', async () => {
    givenCase({ paymentStatus: 'paid_in_full' });
    givenOrder(89_000);
    givenPayment('p1', 'refunded', 89_000);

    await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx);
    expect(await markCaseUnpaidAfterRefund(DEFAULT_ORGANIZATION_ID, original.id, 'mock', ctx)).toBe('unchanged');
    expect(paymentStatusEvents()).toHaveLength(1);
  });
});
