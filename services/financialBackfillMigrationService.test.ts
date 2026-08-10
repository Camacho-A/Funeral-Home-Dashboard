import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { backfillOpeningJournalEntries } from './financialBackfillMigrationService';
import { seedChartOfAccounts, getAccountByNumber } from './chartOfAccountsService';
import { getAccountBalance } from './generalLedgerService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import type { ActivityContext } from './activityService';
import type { PaymentRecord } from '../types/payment';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

const NOW = '2026-08-07T00:00:00.000Z';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `financial-backfill-test-${idCounter}`;
}

function ctx(): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'accounting',
    correlationId: 'corr-1',
  };
}

function buildSucceededPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'legacy-payment-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: '1042',
    caseOrderId: null,
    provider: 'clover',
    providerCheckoutId: 'checkout-legacy-1',
    providerPaymentId: 'provider-payment-legacy-1',
    idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:legacy-key-1`,
    checkoutUrl: null,
    status: 'succeeded',
    amount: 75_000,
    currency: 'usd',
    purpose: 'Cremation service fee',
    cardBrand: null,
    cardLast4: null,
    receiptReference: null,
    failureCode: null,
    failureMessage: null,
    createdAt: NOW,
    paidAt: NOW,
    updatedAt: NOW,
    initiatedByStaffProfileId: null,
    depositedInBankDepositId: null,
    ...overrides,
  };
}

let lengths: { accounts: number; entries: number; lines: number; activity: number };
beforeEach(async () => {
  lengths = {
    accounts: ledgerAccountFixtures.length,
    entries: journalEntryFixtures.length,
    lines: journalEntryLineFixtures.length,
    activity: activityEventFixtures.length,
  };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});
afterEach(() => {
  ledgerAccountFixtures.length = lengths.accounts;
  journalEntryFixtures.length = lengths.entries;
  journalEntryLineFixtures.length = lengths.lines;
  activityEventFixtures.length = lengths.activity;
});

describe('backfillOpeningJournalEntries', () => {
  it('dry run (apply: false) reports "posted" for a resolvable case but writes no journal entry', async () => {
    const payment = buildSucceededPayment();

    const report = await backfillOpeningJournalEntries(DEFAULT_ORGANIZATION_ID, [payment], { apply: false, idFactory, now: NOW }, ctx(), 'mock');

    expect(report.apply).toBe(false);
    expect(report.posted).toBe(1);
    expect(report.rows[0]).toMatchObject({ status: 'posted', journalEntryId: null });
    expect(journalEntryFixtures.some((e) => e.sourceReferenceId === payment.id)).toBe(false);
  });

  it('apply posts a balanced Dr Undeposited Funds / Cr Accounts Receivable opening entry for a resolvable case', async () => {
    const payment = buildSucceededPayment();

    const report = await backfillOpeningJournalEntries(DEFAULT_ORGANIZATION_ID, [payment], { apply: true, idFactory, now: NOW }, ctx(), 'mock');

    expect(report.posted).toBe(1);
    const entry = journalEntryFixtures.find((e) => e.sourceReferenceId === payment.id);
    expect(entry).toMatchObject({ sourceType: 'opening_balance', caseId: payment.caseId, status: 'posted' });

    const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
    const accountsReceivable = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock');
    expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, undepositedFunds!.id, 'mock')).toBe(payment.amount);
    expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, accountsReceivable!.id, 'mock')).toBe(-payment.amount);

    expect(activityEventFixtures.some((e) => e.category === 'financial' && e.resourceId === entry!.id)).toBe(true);
  });

  it('falls back to the Legacy Opening Balance account when the payment\'s case no longer resolves', async () => {
    const payment = buildSucceededPayment({ id: 'legacy-payment-orphaned', caseId: 'case-does-not-exist' });

    const report = await backfillOpeningJournalEntries(DEFAULT_ORGANIZATION_ID, [payment], { apply: true, idFactory, now: NOW }, ctx(), 'mock');

    expect(report.legacyFallbackPosted).toBe(1);
    const entry = journalEntryFixtures.find((e) => e.sourceReferenceId === payment.id);
    expect(entry).toMatchObject({ sourceType: 'opening_balance', caseId: null, status: 'posted' });
    expect(entry!.memo).toContain('case-does-not-exist');

    const legacyOpeningBalance = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.LEGACY_OPENING_BALANCE, 'mock');
    expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, legacyOpeningBalance!.id, 'mock')).toBe(-payment.amount);
  });

  it('skips a non-succeeded payment, reporting "not-succeeded"', async () => {
    const payment = buildSucceededPayment({ id: 'legacy-payment-pending', status: 'pending' });

    const report = await backfillOpeningJournalEntries(DEFAULT_ORGANIZATION_ID, [payment], { apply: true, idFactory, now: NOW }, ctx(), 'mock');

    expect(report.notSucceeded).toBe(1);
    expect(journalEntryFixtures.some((e) => e.sourceReferenceId === payment.id)).toBe(false);
  });

  it('is idempotent — a payment already journaled (e.g. by the real-time posting path) is reported "already-posted" and not double-booked', async () => {
    const payment = buildSucceededPayment();

    const first = await backfillOpeningJournalEntries(DEFAULT_ORGANIZATION_ID, [payment], { apply: true, idFactory, now: NOW }, ctx(), 'mock');
    const second = await backfillOpeningJournalEntries(DEFAULT_ORGANIZATION_ID, [payment], { apply: true, idFactory, now: NOW }, ctx(), 'mock');

    expect(first.posted).toBe(1);
    expect(second.posted).toBe(0);
    expect(second.alreadyPosted).toBe(1);
    expect(journalEntryFixtures.filter((e) => e.sourceReferenceId === payment.id)).toHaveLength(1);
  });
});
