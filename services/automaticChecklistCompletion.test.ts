import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { createCaseOrder } from './pricingService';
import { markCasePaidIfVerified } from './paymentWorkflow';
import * as casesService from './casesService';
import { caseRevision } from '../lib/wixCaseMapper';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import type { Case } from '../types/case';
import type { PaymentRecord } from '../types/payment';

const { formLinked } = vi.hoisted(() => ({ formLinked: { value: true } }));
vi.mock('./workflowReconciliationService', async () => {
  const actual = await vi.importActual<typeof import('./workflowReconciliationService')>('./workflowReconciliationService');
  return { ...actual, isArrangementFormLinked: vi.fn(async () => formLinked.value) };
});

const { completeArrangementFormChecklistItem } = await import('./automaticChecklistCompletion');

/**
 * Automatic checklist completion (2026-10), end to end in mock mode: the
 * real payment workflow and form-receipt path, against the Manors and Gus
 * fixture cases. Every case touched is restored afterwards.
 */
const MANORS = 'managed-cremations';
const GUS = 'gus-camacho-jr';

const saved = new Map<number, Case>();
function useCase(id: string, overrides: Partial<Case> = {}): Case {
  const index = caseFixtures.findIndex((c) => c.id === id);
  if (!saved.has(index)) saved.set(index, caseFixtures[index]);
  caseFixtures[index] = { ...caseFixtures[index], checklistState: {}, checklistAutomation: undefined, ...overrides };
  return caseFixtures[index];
}
const current = (id: string) => caseFixtures.find((c) => c.id === id)!;
const autoEvents = (caseId: string) =>
  activityEventFixtures.filter((e) => e.caseId === caseId && e.eventType === ACTIVITY_EVENT_TYPES.CASE_CHECKLIST_COMPLETED_AUTOMATICALLY);

let ids = 0;
const idFactory = () => `auto-${++ids}`;
function payment(caseId: string, caseOrderId: string, amount: number, status: PaymentRecord['status'] = 'succeeded'): PaymentRecord {
  return {
    id: idFactory(),
    organizationId: MANORS,
    caseId,
    caseOrderId,
    provider: 'clover',
    providerCheckoutId: idFactory(),
    providerPaymentId: idFactory(),
    idempotencyKey: idFactory(),
    checkoutUrl: null,
    status,
    amount,
    currency: 'usd',
    purpose: 'Balance due',
    cardBrand: null,
    cardLast4: null,
    receiptReference: null,
    failureCode: null,
    failureMessage: null,
    createdAt: '2026-10-20T12:00:00.000Z',
    paidAt: status === 'succeeded' ? '2026-10-20T12:00:00.000Z' : null,
    updatedAt: '2026-10-20T12:00:00.000Z',
    initiatedByStaffProfileId: null,
    depositedInBankDepositId: null,
  };
}
async function orderFor(caseId: string) {
  const { order } = await createCaseOrder(
    { organizationId: MANORS, caseId, selections: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false }, performedBy: 'Test', idFactory },
    'mock',
  );
  return order; // $890
}

beforeEach(() => {
  formLinked.value = true;
  activityEventFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
  paymentRecordFixtures.length = 0;
});
afterEach(() => {
  for (const [index, value] of saved) caseFixtures[index] = value;
  saved.clear();
});

describe('"Payment collected" — completed by a verified payment in full', () => {
  it('a full payment completes it automatically, with one audit event naming the evidence', async () => {
    useCase('1044', { paymentStatus: 'awaiting_payment' });
    await markCasePaidIfVerified(MANORS, '1044', 'mock');

    expect(current('1044').checklistState['0:8']).toBe(true);
    expect(current('1044').checklistAutomation?.['0:8']).toMatchObject({ by: 'automatic', source: 'payment_received_in_full' });
    const events = autoEvents('1044');
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe('Checklist: "Payment collected" completed automatically (payment received in full).');
    expect(events[0].isSystemGenerated).toBe(true);
    expect(events[0].actorIdentityId).toBeNull();
  });

  it('a duplicate or retried event changes nothing and records nothing more', async () => {
    useCase('1044', { paymentStatus: 'awaiting_payment' });
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    const after = current('1044').checklistAutomation;
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    expect(autoEvents('1044')).toHaveLength(1);
    expect(current('1044').checklistAutomation).toEqual(after);
  });

  it('a deposit leaves it open; the payment that clears the balance completes it', async () => {
    useCase('1044', { paymentStatus: 'awaiting_payment' });
    const order = await orderFor('1044');

    paymentRecordFixtures.push(payment('1044', order.id, 40_000));
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    expect(current('1044').checklistState['0:8']).toBeUndefined();
    expect(current('1044').paymentStatus).toBe('awaiting_payment');
    expect(autoEvents('1044')).toHaveLength(0);

    paymentRecordFixtures.push(payment('1044', order.id, 49_000));
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    expect(current('1044').checklistState['0:8']).toBe(true);
    expect(autoEvents('1044')).toHaveLength(1);
  });

  it('a failed or pending payment never completes it', async () => {
    useCase('1044', { paymentStatus: 'awaiting_payment' });
    const order = await orderFor('1044');
    paymentRecordFixtures.push(payment('1044', order.id, 89_000, 'failed'), payment('1044', order.id, 89_000, 'pending'));
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    expect(current('1044').checklistState['0:8']).toBeUndefined();
    expect(autoEvents('1044')).toHaveLength(0);
  });

  it('a staff correction stands: unticked after automation, it stays unticked when another payment arrives', async () => {
    useCase('1044', { paymentStatus: 'awaiting_payment' });
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    await casesService.update({ organizationId: MANORS }, '1044', { checklistState: { '0:8': false } }, 'mock', {
      expectedRevision: caseRevision(current('1044')),
    });
    expect(current('1044').checklistAutomation?.['0:8']).toMatchObject({ by: 'staff' });

    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    expect(current('1044').checklistState['0:8']).toBe(false);
    expect(autoEvents('1044')).toHaveLength(1);
  });

  it('an item staff already ticked is left as theirs — not relabelled automatic, no event', async () => {
    useCase('1044', { paymentStatus: 'awaiting_payment', checklistState: { '0:8': true } });
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    expect(current('1044').checklistAutomation).toBeUndefined();
    expect(autoEvents('1044')).toHaveLength(0);
  });

  it('never touches an archived case', async () => {
    useCase('1044', { paymentStatus: 'awaiting_payment', isDeleted: true });
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    expect(current('1044').checklistState).toEqual({});
    expect(current('1044').paymentStatus).toBe('awaiting_payment');
    expect(autoEvents('1044')).toHaveLength(0);
  });

  it('does not advance the stage on its own: the case stays put while other First Call items are open', async () => {
    const before = useCase('1044', { paymentStatus: 'awaiting_payment' }).rawStage;
    await markCasePaidIfVerified(MANORS, '1044', 'mock');
    expect(current('1044').rawStage).toBe(before);
  });

  it('Gus SOLIS keeps its existing behaviour exactly: ticked, no provenance, no new event', async () => {
    useCase('gus-case-001', { paymentStatus: 'awaiting_payment' });
    await markCasePaidIfVerified(GUS, 'gus-case-001', 'mock');
    expect(current('gus-case-001').checklistState['0:8']).toBe(true);
    expect(current('gus-case-001').checklistAutomation).toBeUndefined();
    expect(autoEvents('gus-case-001')).toHaveLength(0);
  });
});

describe('"Jotform application completed" — completed by the received Arrangement Form', () => {
  it('completes it once, with an audit event; a repeat changes nothing', async () => {
    useCase('1047');
    expect(await completeArrangementFormChecklistItem(MANORS, '1047', 'mock')).toBe('completed');
    expect(current('1047').checklistState['1:0']).toBe(true);
    expect(current('1047').checklistAutomation?.['1:0']).toMatchObject({ by: 'automatic', source: 'arrangement_form_received' });
    expect(autoEvents('1047')[0].description).toBe('Checklist: "Jotform application completed" completed automatically (Arrangement Form received).');

    expect(await completeArrangementFormChecklistItem(MANORS, '1047', 'mock')).toBe('unchanged');
    expect(autoEvents('1047')).toHaveLength(1);
  });

  it('a link that is not received (only sent) completes nothing', async () => {
    useCase('1047');
    formLinked.value = false;
    expect(await completeArrangementFormChecklistItem(MANORS, '1047', 'mock')).toBe('not_applicable');
    expect(current('1047').checklistState['1:0']).toBeUndefined();
    expect(autoEvents('1047')).toHaveLength(0);
  });

  it('never for an archived case, and never for Gus SOLIS', async () => {
    useCase('1047', { isDeleted: true });
    expect(await completeArrangementFormChecklistItem(MANORS, '1047', 'mock')).toBe('unchanged');
    expect(current('1047').checklistState).toEqual({});
    expect(await completeArrangementFormChecklistItem(GUS, 'gus-case-001', 'mock')).toBe('not_applicable');
  });
});
