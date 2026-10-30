import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMockStore } from './mockStore';
import { summarizeCasePayment } from '../../domain/cases/casePaymentSummary';

/**
 * SOLIS sandbox examples (2026-10): present only with the sandbox switch
 * on, and each one's stored Payment value agrees with its records.
 */

async function loadFixtures(sandbox: boolean) {
  vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', sandbox ? 'true' : '');
  resetMockStore();
  vi.resetModules();
  const [fixtures, pricing, payments, identity] = await Promise.all([import('./fixtures'), import('./pricingFixtures'), import('./paymentFixtures'), import('./identityFixtures')]);
  return {
    cases: fixtures.caseFixtures, tasks: fixtures.taskFixtures, orders: pricing.caseOrderFixtures, lines: pricing.caseOrderLineItemFixtures, payments: payments.paymentRecordFixtures,
    identities: identity.identityFixtures, memberships: identity.membershipFixtures,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetMockStore();
  vi.resetModules();
});

describe('sandbox examples', () => {
  it('without the sandbox switch the fixtures are exactly the ordinary ones', async () => {
    const f = await loadFixtures(false);
    expect(f.orders).toEqual([]);
    expect((await import('./ledgerFixtures')).ledgerAccountFixtures.some((a) => a.organizationId === 'managed-cremations')).toBe(false);
    expect(f.lines).toEqual([]);
    expect(f.payments).toEqual([]);
    expect(f.tasks.some((t) => t.id.startsWith('sandbox-'))).toBe(false);
    expect(f.cases.find((c) => c.id === '1043')?.paymentStatus).toBe('paid_in_full');
    expect(f.identities.some((i) => i.email === 'readonly@managedcremations.test')).toBe(false);
    expect(f.memberships.some((m) => m.identityId === 'identity-manors-sandbox-readonly')).toBe(false);
  });

  it('with it, a read-only demo account exists so assignment permissions can be tried', async () => {
    const f = await loadFixtures(true);
    const riley = f.identities.find((i) => i.email === 'readonly@managedcremations.test')!;
    expect(riley.status).toBe('active');
    expect(f.memberships.find((m) => m.identityId === riley.id)).toMatchObject({ organizationId: 'managed-cremations', role: 'readOnly', status: 'active' });
  });

  it('with it, every payment state has one example and the stored Payment value matches the records', async () => {
    const f = await loadFixtures(true);
    const summary = (caseId: string) => {
      const order = f.orders.find((o) => o.caseId === caseId)!;
      const case_ = f.cases.find((c) => c.id === caseId)!;
      return summarizeCasePayment({ order, payments: f.payments.filter((p) => p.caseId === caseId), recordedStatus: case_.paymentStatus })!;
    };
    expect(summary('1042')).toMatchObject({ state: 'paid_in_full', mismatch: null, detail: '$890.00 paid' });
    expect(summary('1043')).toMatchObject({ state: 'partial_payment', mismatch: null, detail: '$445.00 of $890.00 paid · $445.00 due' });
    expect(summary('1044')).toMatchObject({ state: 'awaiting_payment', mismatch: null, detail: '$890.00 due' });
    expect(summary('1045')).toMatchObject({ state: 'paid_in_full', mismatch: null });
    expect(summary('1046')).toMatchObject({ state: 'awaiting_payment', mismatch: null, detail: '$890.00 due · $890.00 pending' });
    expect(summary('1047')).toMatchObject({ state: 'awaiting_payment', mismatch: null, detail: '$890.00 due · $890.00 refunded' });
    expect(f.orders.every((o) => f.lines.some((l) => l.caseOrderId === o.id))).toBe(true);
    const ledger = (await import('./ledgerFixtures')).ledgerAccountFixtures;
    expect(ledger.some((a) => a.organizationId === 'managed-cremations' && a.accountNumber === '1100')).toBe(true);
  });

  it('with it, tasks cover mine, other staff, unassigned, open and done', async () => {
    const f = await loadFixtures(true);
    const sandbox = f.tasks.filter((t) => t.id.startsWith('sandbox-'));
    expect(sandbox.some((t) => t.assigneeStaffId === 'staff-dana' && !t.isDone)).toBe(true);
    expect(sandbox.some((t) => t.assigneeStaffId === 'staff-chris' || t.assigneeStaffId === 'staff-priya')).toBe(true);
    expect(sandbox.some((t) => t.assigneeStaffId === null)).toBe(true);
    expect(sandbox.some((t) => t.isDone)).toBe(true);
    expect(sandbox.every((t) => t.organizationId === 'managed-cremations')).toBe(true);
  });
});
