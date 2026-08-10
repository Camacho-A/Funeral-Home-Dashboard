import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  getTrialBalance,
  getGeneralLedgerDetail,
  getBalanceSheet,
  getProfitAndLoss,
  getArAgingReport,
  getTransactionRegister,
} from './financialReportsService';
import { seedChartOfAccounts, getAccountByNumber } from './chartOfAccountsService';
import { postPaymentTransaction, postDepositTransaction, postWriteOffTransaction } from './financialTransactionService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import type { ActivityContext } from './activityService';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, caseWriteOffFixtures } from './__mocks__/ledgerFixtures';
import { bankDepositFixtures } from './__mocks__/bankingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { caseOrderFixtures } from './__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { PaymentRecord } from '../types/payment';

const NOW = '2026-08-01T00:00:00.000Z';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `fin-report-test-${idCounter}`;
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
    id: 'payment-1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', caseOrderId: 'order-1', provider: 'clover',
    providerCheckoutId: 'checkout-1', providerPaymentId: 'provider-payment-1', idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
    checkoutUrl: null, status: 'succeeded', amount: 50_000, currency: 'usd', purpose: 'Cremation service fee',
    cardBrand: null, cardLast4: null, receiptReference: null, failureCode: null, failureMessage: null,
    createdAt: NOW, paidAt: NOW, updatedAt: NOW, initiatedByStaffProfileId: null, depositedInBankDepositId: null,
    ...overrides,
  };
}

let lengths: {
  ledgerAccounts: number;
  journalEntries: number;
  journalEntryLines: number;
  caseWriteOffs: number;
  bankDeposits: number;
  activityEvents: number;
  paymentRecords: number;
  caseOrders: number;
};

beforeEach(async () => {
  idCounter = 0;
  lengths = {
    ledgerAccounts: ledgerAccountFixtures.length,
    journalEntries: journalEntryFixtures.length,
    journalEntryLines: journalEntryLineFixtures.length,
    caseWriteOffs: caseWriteOffFixtures.length,
    bankDeposits: bankDepositFixtures.length,
    activityEvents: activityEventFixtures.length,
    paymentRecords: paymentRecordFixtures.length,
    caseOrders: caseOrderFixtures.length,
  };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});

afterEach(() => {
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
  caseWriteOffFixtures.length = lengths.caseWriteOffs;
  bankDepositFixtures.length = lengths.bankDeposits;
  activityEventFixtures.length = lengths.activityEvents;
  paymentRecordFixtures.length = lengths.paymentRecords;
  caseOrderFixtures.length = lengths.caseOrders;
});

describe('financialReportsService', () => {
  describe('getTrialBalance', () => {
    it('reflects a posted payment transaction, balanced across accounts', async () => {
      await postPaymentTransaction(DEFAULT_ORGANIZATION_ID, { caseId: 'case-1', paymentId: 'payment-1', amountCents: 50_000, idFactory }, ctx(), 'mock');

      const { rows, totalDebits, totalCredits } = await getTrialBalance(DEFAULT_ORGANIZATION_ID, 'mock');
      expect(totalDebits).toBe(totalCredits);

      const undeposited = rows.find((r) => r.accountNumber === STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS);
      const ar = rows.find((r) => r.accountNumber === STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE);
      expect(undeposited?.debitTotal).toBe(50_000);
      expect(ar?.creditTotal).toBe(50_000);
    });
  });

  describe('getGeneralLedgerDetail', () => {
    it('lists every posted line against one account with a correct ending balance', async () => {
      await postPaymentTransaction(DEFAULT_ORGANIZATION_ID, { caseId: 'case-1', paymentId: 'payment-1', amountCents: 50_000, idFactory }, ctx(), 'mock');
      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');

      const { account, rows, endingBalance } = await getGeneralLedgerDetail(DEFAULT_ORGANIZATION_ID, undepositedFunds!.id, 'mock');
      expect(account.accountNumber).toBe(STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS);
      expect(rows).toHaveLength(1);
      expect(rows[0].direction).toBe('debit');
      expect(rows[0].amount).toBe(50_000);
      expect(endingBalance).toBe(50_000);
    });

    it('throws for an unknown account', async () => {
      await expect(getGeneralLedgerDetail(DEFAULT_ORGANIZATION_ID, 'no-such-account', 'mock')).rejects.toThrow();
    });
  });

  describe('getBalanceSheet', () => {
    it('folds net income into equity and balances assets against liabilities+equity', async () => {
      await postWriteOffTransaction(DEFAULT_ORGANIZATION_ID, { caseId: 'case-1', amountCents: 5_000, reason: 'Uncollectible', idFactory }, ctx(), 'mock');

      const report = await getBalanceSheet(DEFAULT_ORGANIZATION_ID, 'mock');
      // write-off: Dr Bad Debt Expense 5000, Cr Accounts Receivable 5000 —
      // an expense with no offsetting revenue means net income is -5000,
      // AR (an asset) drops by 5000 — both sides of the equation move by
      // the same amount, so the sheet still balances.
      expect(report.netIncome).toBe(-5_000);
      expect(report.totalAssets).toBe(report.totalLiabilitiesAndEquity);
    });
  });

  describe('getProfitAndLoss', () => {
    it('sums revenue and expense activity within the given date range', async () => {
      await postWriteOffTransaction(
        DEFAULT_ORGANIZATION_ID,
        { caseId: 'case-1', amountCents: 5_000, reason: 'Uncollectible', entryDate: '2026-08-15T00:00:00.000Z', idFactory },
        ctx(),
        'mock',
      );

      const inRange = await getProfitAndLoss(DEFAULT_ORGANIZATION_ID, 'mock', { fromDate: '2026-08-01T00:00:00.000Z', toDate: '2026-08-31T00:00:00.000Z' });
      expect(inRange.totalExpenses).toBe(5_000);
      expect(inRange.netIncome).toBe(-5_000);

      const outOfRange = await getProfitAndLoss(DEFAULT_ORGANIZATION_ID, 'mock', { fromDate: '2026-09-01T00:00:00.000Z', toDate: '2026-09-30T00:00:00.000Z' });
      expect(outOfRange.totalExpenses).toBe(0);
    });
  });

  describe('getArAgingReport', () => {
    it('buckets an open case order by age from its v1 anchor and reconciles against the GL AR balance', async () => {
      caseOrderFixtures.push(
        {
          id: 'order-v1', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-aging-1', status: 'superseded',
          subtotal: 10_000, discountTotal: 0, taxTotal: 0, total: 10_000, balanceDue: 10_000, version: 1,
          createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'order-v2', organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-aging-1', status: 'active',
          subtotal: 10_000, discountTotal: 0, taxTotal: 0, total: 10_000, balanceDue: 10_000, version: 2,
          createdAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z',
        },
      );
      await postPaymentTransaction(DEFAULT_ORGANIZATION_ID, { caseId: 'case-aging-1', paymentId: 'gl-offset-1', amountCents: 10_000, entryDate: '2026-06-01T00:00:00.000Z', idFactory }, ctx(), 'mock');
      // Reverse the credit so the GL's AR balance matches the one open
      // order's balanceDue exactly (10,000), isolating this test from
      // needing a second real payment against the case.
      const accountsReceivable = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock');

      const report = await getArAgingReport(DEFAULT_ORGANIZATION_ID, accountsReceivable!.id, 'mock', '2026-08-01T00:00:00.000Z');
      expect(report.rows).toHaveLength(1);
      // Anchor is 2026-06-01 (v1), asOf 2026-08-01 -> 61 days -> '61-90' bucket.
      expect(report.rows[0].bucket).toBe('61-90');
      expect(report.totalOutstanding).toBe(10_000);
    });
  });

  describe('getTransactionRegister', () => {
    it('lists posted entries enriched with the originating payment purpose', async () => {
      paymentRecordFixtures.push(buildSucceededPayment());
      await postPaymentTransaction(DEFAULT_ORGANIZATION_ID, { caseId: 'case-1', paymentId: 'payment-1', amountCents: 50_000, idFactory }, ctx(), 'mock');

      const rows = await getTransactionRegister(DEFAULT_ORGANIZATION_ID, 'mock');
      expect(rows).toHaveLength(1);
      expect(rows[0].sourceType).toBe('payment');
      expect(rows[0].totalAmount).toBe(50_000);
      expect(rows[0].relatedDescription).toBe('Cremation service fee');
    });

    it('enriches a deposit entry with the number of included payments', async () => {
      paymentRecordFixtures.push(buildSucceededPayment());
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
      await postDepositTransaction(DEFAULT_ORGANIZATION_ID, { bankAccountLedgerAccountId: cashOperating!.id, paymentIds: ['payment-1'], idFactory }, ctx(), 'mock');

      const rows = await getTransactionRegister(DEFAULT_ORGANIZATION_ID, 'mock');
      expect(rows[0].sourceType).toBe('deposit');
      expect(rows[0].relatedDescription).toBe('Deposit of 1 payment(s)');
    });
  });
});
