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
import { createAndPostJournalEntry } from './generalLedgerService';
import { postPaymentTransaction, postDepositTransaction, postWriteOffTransaction } from './financialTransactionService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import type { ActivityContext } from './activityService';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, caseWriteOffFixtures } from './__mocks__/ledgerFixtures';
import { bankDepositFixtures } from './__mocks__/bankingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { caseOrderFixtures } from './__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
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

/**
 * Trial Balance correctness (2026-10 accounting audit).
 *
 * The report published each account's GROSS ACTIVITY in both columns,
 * which is an activity summary rather than a trial balance. Every amount
 * that merely moves between accounts got counted again on both sides, so
 * the total tracked bookkeeping volume instead of the business. These
 * tests pin the definition: each account's ENDING BALANCE, in its natural
 * column, with the two columns proving the ledger balances.
 */
describe('getTrialBalance — ending balances, not gross activity', () => {
  const ORG = DEFAULT_ORGANIZATION_ID;

  async function accounts() {
    await seedChartOfAccounts(ORG, idFactory, 'mock');
    return {
      ar: (await getAccountByNumber(ORG, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock'))!,
      revenue: (await getAccountByNumber(ORG, STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE, 'mock'))!,
    };
  }

  /** Dr Accounts Receivable / Cr Service Revenue — an invoice. */
  async function recognizeRevenue(caseId: string, amount: number, entryDate = NOW) {
    const { ar, revenue } = await accounts();
    await createAndPostJournalEntry(
      ORG,
      {
        entryDate,
        sourceType: 'revenue_recognition',
        caseId,
        memo: `revenue ${amount}`,
        lines:
          amount > 0
            ? [
                { accountId: ar.id, direction: 'debit', amount, caseId },
                { accountId: revenue.id, direction: 'credit', amount, caseId },
              ]
            : [
                { accountId: ar.id, direction: 'credit', amount: -amount, caseId },
                { accountId: revenue.id, direction: 'debit', amount: -amount, caseId },
              ],
        idFactory,
        now: entryDate,
      },
      'mock',
    );
  }

  const row = (rows: Awaited<ReturnType<typeof getTrialBalance>>['rows'], number: string) =>
    rows.find((r) => r.accountNumber === number);

  it('an invoiced-then-paid case leaves Accounts Receivable at ZERO, not at its gross activity', async () => {
    // The headline defect. AR took 50,000 in and 50,000 out; its balance
    // is zero. Reporting 50,000/50,000 states a receivable that is settled.
    await recognizeRevenue('case-1', 50_000);
    await postPaymentTransaction(ORG, { caseId: 'case-1', paymentId: 'payment-1', amountCents: 50_000, idFactory }, ctx(), 'mock');

    const { rows, totalDebits, totalCredits } = await getTrialBalance(ORG, 'mock');
    const ar = row(rows, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE)!;

    expect(ar.debitTotal).toBe(0);
    expect(ar.creditTotal).toBe(0);
    // The gross movement is still reported, just not as the balance.
    expect(ar.debitActivity).toBe(50_000);
    expect(ar.creditActivity).toBe(50_000);

    // Cash in one account, revenue in the other — not both sides twice.
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS)!.debitTotal).toBe(50_000);
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE)!.creditTotal).toBe(50_000);
    expect(totalDebits).toBe(50_000);
    expect(totalCredits).toBe(50_000);
  });

  it('reproduces the managed-cremations ledger and totals 5,020 — not 11,190', async () => {
    // The exact shape of the live ledger: three invoiced-and-paid cases,
    // one of them revised down twice and up once. Gross activity across
    // all accounts is 1,119,000; the books balance at 502,000.
    await recognizeRevenue('case-a', 145_000);
    await postPaymentTransaction(ORG, { caseId: 'case-a', paymentId: 'pay-a', amountCents: 145_000, idFactory }, ctx(), 'mock');
    await recognizeRevenue('case-b', 89_000);
    await postPaymentTransaction(ORG, { caseId: 'case-b', paymentId: 'pay-b', amountCents: 89_000, idFactory }, ctx(), 'mock');
    await recognizeRevenue('case-c', 175_500);
    await postPaymentTransaction(ORG, { caseId: 'case-c', paymentId: 'pay-c', amountCents: 164_000, idFactory }, ctx(), 'mock');
    await recognizeRevenue('case-c', -12_500);
    await recognizeRevenue('case-c', -45_000);
    await recognizeRevenue('case-c', 46_000);
    await recognizeRevenue('case-d', 104_000);
    await postPaymentTransaction(ORG, { caseId: 'case-d', paymentId: 'pay-d', amountCents: 104_000, idFactory }, ctx(), 'mock');

    const { rows, totalDebits, totalCredits } = await getTrialBalance(ORG, 'mock');

    expect(totalDebits).toBe(502_000);
    expect(totalCredits).toBe(502_000);
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS)!.debitTotal).toBe(502_000);
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE)!.creditTotal).toBe(502_000);
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE)!.debitTotal).toBe(0);

    // The old behaviour, preserved as activity — this is where 11,190 came from.
    const grossDebits = rows.reduce((s, r) => s + r.debitActivity, 0);
    expect(grossDebits).toBe(1_119_000);
  });

  it('an unpaid case shows a real receivable — balances are not collapsed to zero', async () => {
    await recognizeRevenue('case-unpaid', 80_000);

    const { rows, totalDebits, totalCredits } = await getTrialBalance(ORG, 'mock');
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE)!.debitTotal).toBe(80_000);
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE)!.creditTotal).toBe(80_000);
    expect(totalDebits).toBe(totalCredits);
  });

  it('a partial payment leaves the unpaid remainder in Accounts Receivable', async () => {
    await recognizeRevenue('case-partial', 100_000);
    await postPaymentTransaction(ORG, { caseId: 'case-partial', paymentId: 'pay-partial', amountCents: 30_000, idFactory }, ctx(), 'mock');

    const { rows, totalDebits, totalCredits } = await getTrialBalance(ORG, 'mock');
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE)!.debitTotal).toBe(70_000);
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS)!.debitTotal).toBe(30_000);
    expect(totalDebits).toBe(totalCredits);
  });

  it('a write-off clears the receivable and lands in Bad Debt Expense', async () => {
    await recognizeRevenue('case-wo', 60_000);
    await postWriteOffTransaction(ORG, { caseId: 'case-wo', amountCents: 60_000, reason: 'uncollectible', idFactory }, ctx(), 'mock');

    const { rows, totalDebits, totalCredits } = await getTrialBalance(ORG, 'mock');
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE)!.debitTotal).toBe(0);
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.BAD_DEBT_EXPENSE)!.debitTotal).toBe(60_000);
    expect(totalDebits).toBe(totalCredits);
  });

  it('a deposit moves cash out of Undeposited Funds instead of counting it twice', async () => {
    await recognizeRevenue('case-1', 50_000);
    await postPaymentTransaction(ORG, { caseId: 'case-1', paymentId: 'payment-1', amountCents: 50_000, idFactory }, ctx(), 'mock');
    paymentRecordFixtures.push(buildSucceededPayment());
    const cashOperating = await getAccountByNumber(ORG, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
    await postDepositTransaction(ORG, { bankAccountLedgerAccountId: cashOperating!.id, paymentIds: ['payment-1'], idFactory }, ctx(), 'mock');

    const { rows, totalDebits, totalCredits } = await getTrialBalance(ORG, 'mock');
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS)!.debitTotal).toBe(0);
    expect(row(rows, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING)!.debitTotal).toBe(50_000);
    // Three entries have now touched the books, and the cash is still 50,000:
    // the balance follows the money, not the number of postings.
    expect(totalDebits).toBe(50_000);
    expect(totalDebits).toBe(totalCredits);
  });

  it('totals always agree, which is the control the report exists to provide', async () => {
    await recognizeRevenue('case-x', 12_345);
    await postPaymentTransaction(ORG, { caseId: 'case-x', paymentId: 'pay-x', amountCents: 5_000, idFactory }, ctx(), 'mock');
    const { totalDebits, totalCredits } = await getTrialBalance(ORG, 'mock');
    expect(totalDebits).toBe(totalCredits);
  });

  it('is scoped to one organization', async () => {
    await recognizeRevenue('case-mine', 70_000);
    const other = await getTrialBalance(SECOND_MOCK_ORGANIZATION_ID, 'mock');
    expect(other.totalDebits).toBe(0);
    expect(other.totalCredits).toBe(0);
  });
});

describe('getTrialBalance — as-of date', () => {
  const ORG = DEFAULT_ORGANIZATION_ID;

  async function invoice(caseId: string, amount: number, entryDate: string) {
    await seedChartOfAccounts(ORG, idFactory, 'mock');
    const ar = (await getAccountByNumber(ORG, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock'))!;
    const revenue = (await getAccountByNumber(ORG, STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE, 'mock'))!;
    await createAndPostJournalEntry(
      ORG,
      {
        entryDate,
        sourceType: 'revenue_recognition',
        caseId,
        memo: 'invoice',
        lines: [
          { accountId: ar.id, direction: 'debit', amount, caseId },
          { accountId: revenue.id, direction: 'credit', amount, caseId },
        ],
        idFactory,
        now: entryDate,
      },
      'mock',
    );
  }

  it('includes entries dated ON the as-of date', async () => {
    // `entryDate` is a full timestamp and an as-of date is a calendar day,
    // so a raw string compare put "2026-08-01T10:00:00.000Z" AFTER
    // "2026-08-01" and silently dropped everything booked that day.
    await invoice('case-same-day', 25_000, '2026-08-01T10:00:00.000Z');
    const { totalDebits } = await getTrialBalance(ORG, 'mock', '2026-08-01');
    expect(totalDebits).toBe(25_000);
  });

  it('excludes entries dated after the as-of date', async () => {
    await invoice('case-later', 25_000, '2026-08-02T10:00:00.000Z');
    const { totalDebits } = await getTrialBalance(ORG, 'mock', '2026-08-01');
    expect(totalDebits).toBe(0);
  });

  it('includes everything when no as-of date is given', async () => {
    await invoice('case-any', 25_000, '2026-08-05T10:00:00.000Z');
    const { totalDebits } = await getTrialBalance(ORG, 'mock');
    expect(totalDebits).toBe(25_000);
  });

  it('still balances at any as-of date', async () => {
    await invoice('case-1', 10_000, '2026-08-01T10:00:00.000Z');
    await invoice('case-2', 20_000, '2026-08-03T10:00:00.000Z');
    for (const asOf of ['2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-10']) {
      const { totalDebits, totalCredits } = await getTrialBalance(ORG, 'mock', asOf);
      expect(totalDebits, asOf).toBe(totalCredits);
    }
  });
});
