import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  postPaymentTransaction,
  postWriteOffTransaction,
  postAdjustmentTransaction,
  postDepositTransaction,
  postTransferTransaction,
  postRefundTransaction,
  FinancialTransactionServiceError,
} from './financialTransactionService';
import { seedChartOfAccounts, getAccountByNumber } from './chartOfAccountsService';
import { getAccountBalance } from './generalLedgerService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import type { ActivityContext } from './activityService';
import type { PaymentRecord } from '../types/payment';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, caseWriteOffFixtures } from './__mocks__/ledgerFixtures';
import { bankDepositFixtures, bankAccountFixtures } from './__mocks__/bankingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { caseOrderFixtures } from './__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

const NOW = '2026-08-01T00:00:00.000Z';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `fin-txn-test-${idCounter}`;
}

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'accounting',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function buildSucceededPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'payment-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    caseOrderId: 'order-1',
    provider: 'clover',
    providerCheckoutId: 'checkout-1',
    providerPaymentId: 'provider-payment-1',
    idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
    checkoutUrl: null,
    status: 'succeeded',
    amount: 50_000,
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

let lengths: {
  ledgerAccounts: number;
  journalEntries: number;
  journalEntryLines: number;
  caseWriteOffs: number;
  bankDeposits: number;
  bankAccounts: number;
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
    bankAccounts: bankAccountFixtures.length,
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
  bankAccountFixtures.length = lengths.bankAccounts;
  caseOrderFixtures.length = lengths.caseOrders;
  bankDepositFixtures.length = lengths.bankDeposits;
  activityEventFixtures.length = lengths.activityEvents;
  paymentRecordFixtures.length = lengths.paymentRecords;
});

describe('financialTransactionService', () => {
  describe('postPaymentTransaction', () => {
    it('debits Undeposited Funds and credits Accounts Receivable', async () => {
      const entry = await postPaymentTransaction(
        DEFAULT_ORGANIZATION_ID,
        { caseId: 'case-1', paymentId: 'payment-1', amountCents: 50_000, idFactory },
        ctx(),
        'mock',
      );
      expect(entry.sourceType).toBe('payment');
      expect(entry.status).toBe('posted');

      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      const accountsReceivable = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, undepositedFunds!.id, 'mock')).toBe(50_000);
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, accountsReceivable!.id, 'mock')).toBe(-50_000);
      expect(activityEventFixtures.some((e) => e.category === 'financial' && e.resourceId === entry.id)).toBe(true);
    });

    it('throws if the chart of accounts has not been seeded for this organization', async () => {
      ledgerAccountFixtures.length = lengths.ledgerAccounts;
      await expect(
        postPaymentTransaction(DEFAULT_ORGANIZATION_ID, { caseId: 'case-1', paymentId: 'payment-1', amountCents: 1000, idFactory }, ctx(), 'mock'),
      ).rejects.toThrow(FinancialTransactionServiceError);
    });
  });

  describe('postWriteOffTransaction', () => {
    it('debits Bad Debt Expense, credits Accounts Receivable, and creates a CaseWriteOff row', async () => {
      const { writeOff } = await postWriteOffTransaction(
        DEFAULT_ORGANIZATION_ID,
        { caseId: 'case-1', amountCents: 5_000, reason: 'Uncollectible balance', idFactory },
        ctx(),
        'mock',
      );
      expect(writeOff.caseId).toBe('case-1');
      expect(writeOff.amount).toBe(5_000);
      expect(caseWriteOffFixtures.some((w) => w.id === writeOff.id)).toBe(true);

      const badDebtExpense = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.BAD_DEBT_EXPENSE, 'mock');
      const accountsReceivable = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, badDebtExpense!.id, 'mock')).toBe(5_000);
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, accountsReceivable!.id, 'mock')).toBe(-5_000);
      expect(activityEventFixtures.some((e) => e.category === 'financial' && e.resourceId === writeOff.id)).toBe(true);
    });
  });

  describe('postAdjustmentTransaction', () => {
    it('posts a balanced entry between two staff-selected accounts', async () => {
      const bankFees = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.BANK_FEES_EXPENSE, 'mock');
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');

      const entry = await postAdjustmentTransaction(
        DEFAULT_ORGANIZATION_ID,
        { debitAccountId: bankFees!.id, creditAccountId: cashOperating!.id, amountCents: 250, memo: 'Bank fee reclass', idFactory },
        ctx(),
        'mock',
      );
      expect(entry.sourceType).toBe('adjustment');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, bankFees!.id, 'mock')).toBe(250);
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, cashOperating!.id, 'mock')).toBe(-250);
    });

    it('rejects an unknown account id', async () => {
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
      await expect(
        postAdjustmentTransaction(
          DEFAULT_ORGANIZATION_ID,
          { debitAccountId: 'no-such-account', creditAccountId: cashOperating!.id, amountCents: 100, memo: 'x', idFactory },
          ctx(),
          'mock',
        ),
      ).rejects.toThrow(FinancialTransactionServiceError);
    });
  });

  describe('postDepositTransaction', () => {
    it('sweeps a succeeded payment into a bank deposit, posts the entry, and marks the payment deposited', async () => {
      paymentRecordFixtures.push(buildSucceededPayment());
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');

      const { deposit } = await postDepositTransaction(
        DEFAULT_ORGANIZATION_ID,
        { bankAccountLedgerAccountId: cashOperating!.id, paymentIds: ['payment-1'], idFactory },
        ctx(),
        'mock',
      );
      expect(deposit.totalAmount).toBe(50_000);
      expect(deposit.includedPaymentRecordIds).toEqual(['payment-1']);

      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, cashOperating!.id, 'mock')).toBe(50_000);
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, undepositedFunds!.id, 'mock')).toBe(-50_000);

      const updatedPayment = paymentRecordFixtures.find((p) => p.id === 'payment-1');
      expect(updatedPayment?.depositedInBankDepositId).toBe(deposit.id);
    });

    it('rejects a deposit with zero payments', async () => {
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
      await expect(
        postDepositTransaction(DEFAULT_ORGANIZATION_ID, { bankAccountLedgerAccountId: cashOperating!.id, paymentIds: [], idFactory }, ctx(), 'mock'),
      ).rejects.toThrow(FinancialTransactionServiceError);
    });

    it('rejects a payment that is not succeeded', async () => {
      paymentRecordFixtures.push(buildSucceededPayment({ status: 'pending' }));
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
      await expect(
        postDepositTransaction(DEFAULT_ORGANIZATION_ID, { bankAccountLedgerAccountId: cashOperating!.id, paymentIds: ['payment-1'], idFactory }, ctx(), 'mock'),
      ).rejects.toThrow(FinancialTransactionServiceError);
    });

    it('rejects a payment that has already been deposited', async () => {
      paymentRecordFixtures.push(buildSucceededPayment({ depositedInBankDepositId: 'some-other-deposit' }));
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
      await expect(
        postDepositTransaction(DEFAULT_ORGANIZATION_ID, { bankAccountLedgerAccountId: cashOperating!.id, paymentIds: ['payment-1'], idFactory }, ctx(), 'mock'),
      ).rejects.toThrow(FinancialTransactionServiceError);
    });
  });

  describe('postTransferTransaction', () => {
    it('debits the destination account and credits the source account', async () => {
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');

      const entry = await postTransferTransaction(
        DEFAULT_ORGANIZATION_ID,
        { sourceAccountId: undepositedFunds!.id, destinationAccountId: cashOperating!.id, amountCents: 1_000, memo: 'Move funds', idFactory },
        ctx(),
        'mock',
      );
      expect(entry.sourceType).toBe('transfer');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, cashOperating!.id, 'mock')).toBe(1_000);
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, undepositedFunds!.id, 'mock')).toBe(-1_000);
    });
  });

  describe('postRefundTransaction', () => {
    function seedRefundableCaseOrder(caseId: string) {
      caseOrderFixtures.push({
        id: `${caseId}-order`, organizationId: DEFAULT_ORGANIZATION_ID, caseId, status: 'active',
        subtotal: 50_000, discountTotal: 0, taxTotal: 0, total: 50_000, balanceDue: 0, version: 1,
        createdAt: NOW, updatedAt: NOW,
      });
    }

    it('debits Accounts Receivable and credits Undeposited Funds when the payment was never deposited', async () => {
      seedRefundableCaseOrder('case-refund-1');
      paymentRecordFixtures.push(buildSucceededPayment({ id: 'payment-refund-1', caseId: 'case-refund-1' }));

      const entry = await postRefundTransaction(
        DEFAULT_ORGANIZATION_ID,
        { caseId: 'case-refund-1', paymentId: 'payment-refund-1', idFactory },
        ctx(),
        'mock',
      );
      expect(entry.sourceType).toBe('refund');

      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      const accountsReceivable = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, accountsReceivable!.id, 'mock')).toBe(50_000);
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, undepositedFunds!.id, 'mock')).toBe(-50_000);

      const updatedPayment = paymentRecordFixtures.find((p) => p.id === 'payment-refund-1');
      expect(updatedPayment?.status).toBe('refunded');

      const updatedOrder = caseOrderFixtures.find((o) => o.caseId === 'case-refund-1');
      expect(updatedOrder?.balanceDue).toBe(50_000);

      expect(activityEventFixtures.some((e) => e.category === 'payments' && e.resourceId === 'payment-refund-1' && e.eventType === 'payment.refunded')).toBe(true);
    });

    it('credits the linked bank Cash account instead of Undeposited Funds once the payment has been deposited', async () => {
      seedRefundableCaseOrder('case-refund-2');
      const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
      bankAccountFixtures.push({
        id: 'bank-account-1', organizationId: DEFAULT_ORGANIZATION_ID, name: 'Operating', ledgerAccountId: cashOperating!.id,
        accountNumberLast4: '1234', bankName: 'Test Bank', isActive: true, createdAt: NOW, updatedAt: NOW,
      });
      bankDepositFixtures.push({
        id: 'deposit-1', organizationId: DEFAULT_ORGANIZATION_ID, bankAccountId: 'bank-account-1', depositDate: NOW,
        totalAmount: 50_000, includedPaymentRecordIds: ['payment-refund-2'], journalEntryId: 'je-existing', memo: null,
        createdAt: NOW, createdByStaffProfileId: null,
      });
      paymentRecordFixtures.push(buildSucceededPayment({ id: 'payment-refund-2', caseId: 'case-refund-2', depositedInBankDepositId: 'deposit-1' }));

      await postRefundTransaction(
        DEFAULT_ORGANIZATION_ID,
        { caseId: 'case-refund-2', paymentId: 'payment-refund-2', idFactory },
        ctx(),
        'mock',
      );

      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, cashOperating!.id, 'mock')).toBe(-50_000);
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, undepositedFunds!.id, 'mock')).toBe(0);
    });

    it('rejects a payment that is not succeeded', async () => {
      paymentRecordFixtures.push(buildSucceededPayment({ id: 'payment-refund-3', caseId: 'case-refund-3', status: 'refunded' }));
      await expect(
        postRefundTransaction(DEFAULT_ORGANIZATION_ID, { caseId: 'case-refund-3', paymentId: 'payment-refund-3', idFactory }, ctx(), 'mock'),
      ).rejects.toThrow(FinancialTransactionServiceError);
    });

    it('rejects an unknown payment id', async () => {
      await expect(
        postRefundTransaction(DEFAULT_ORGANIZATION_ID, { caseId: 'case-x', paymentId: 'no-such-payment', idFactory }, ctx(), 'mock'),
      ).rejects.toThrow(FinancialTransactionServiceError);
    });
  });
});
