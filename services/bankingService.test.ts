import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  createBankAccount,
  listBankAccounts,
  deactivateBankAccount,
  getBankAccountDerivedBalance,
  importBankStatement,
  runAutoMatch,
  manuallyMatchStatementLine,
  excludeStatementLine,
  startReconciliation,
  completeReconciliation,
  listReconciliationHistory,
  BankingServiceError,
} from './bankingService';
import { seedChartOfAccounts, getAccountByNumber } from './chartOfAccountsService';
import { createAndPostJournalEntry } from './generalLedgerService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import type { ActivityContext } from './activityService';
import {
  ledgerAccountFixtures,
  journalEntryFixtures,
  journalEntryLineFixtures,
} from './__mocks__/ledgerFixtures';
import {
  bankAccountFixtures,
  bankStatementImportFixtures,
  bankStatementLineFixtures,
  bankReconciliationFixtures,
} from './__mocks__/bankingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `banking-test-${idCounter}`;
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

let lengths: {
  ledgerAccounts: number;
  journalEntries: number;
  journalEntryLines: number;
  bankAccounts: number;
  bankStatementImports: number;
  bankStatementLines: number;
  bankReconciliations: number;
  activityEvents: number;
};

beforeEach(async () => {
  idCounter = 0;
  lengths = {
    ledgerAccounts: ledgerAccountFixtures.length,
    journalEntries: journalEntryFixtures.length,
    journalEntryLines: journalEntryLineFixtures.length,
    bankAccounts: bankAccountFixtures.length,
    bankStatementImports: bankStatementImportFixtures.length,
    bankStatementLines: bankStatementLineFixtures.length,
    bankReconciliations: bankReconciliationFixtures.length,
    activityEvents: activityEventFixtures.length,
  };
  await seedChartOfAccounts(DEFAULT_ORGANIZATION_ID, idFactory, 'mock');
});

afterEach(() => {
  ledgerAccountFixtures.length = lengths.ledgerAccounts;
  journalEntryFixtures.length = lengths.journalEntries;
  journalEntryLineFixtures.length = lengths.journalEntryLines;
  bankAccountFixtures.length = lengths.bankAccounts;
  bankStatementImportFixtures.length = lengths.bankStatementImports;
  bankStatementLineFixtures.length = lengths.bankStatementLines;
  bankReconciliationFixtures.length = lengths.bankReconciliations;
  activityEventFixtures.length = lengths.activityEvents;
});

async function seedBankAccount() {
  const cashOperating = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.CASH_OPERATING, 'mock');
  return createBankAccount(
    DEFAULT_ORGANIZATION_ID,
    { name: 'Operating', ledgerAccountId: cashOperating!.id, accountNumberLast4: '1234', bankName: 'Test Bank', idFactory },
    'mock',
  );
}

describe('bankingService', () => {
  describe('createBankAccount / listBankAccounts / deactivateBankAccount', () => {
    it('creates a bank account linked to an asset-type ledger account', async () => {
      const account = await seedBankAccount();
      expect(account.isActive).toBe(true);
      const accounts = await listBankAccounts(DEFAULT_ORGANIZATION_ID, 'mock');
      expect(accounts.some((a) => a.id === account.id)).toBe(true);
    });

    it('rejects a ledgerAccountId that is not asset-type', async () => {
      const badDebtExpense = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.BAD_DEBT_EXPENSE, 'mock');
      await expect(
        createBankAccount(DEFAULT_ORGANIZATION_ID, { name: 'Bad', ledgerAccountId: badDebtExpense!.id, idFactory }, 'mock'),
      ).rejects.toThrow(BankingServiceError);
    });

    it('deactivates a bank account', async () => {
      const account = await seedBankAccount();
      const deactivated = await deactivateBankAccount(DEFAULT_ORGANIZATION_ID, account.id, 'mock');
      expect(deactivated.isActive).toBe(false);
    });
  });

  describe('getBankAccountDerivedBalance', () => {
    it('always reflects the linked ledger account fresh, never a stored value', async () => {
      const account = await seedBankAccount();
      expect(await getBankAccountDerivedBalance(DEFAULT_ORGANIZATION_ID, account.id, 'mock')).toBe(0);

      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        {
          entryDate: '2026-08-01T00:00:00.000Z',
          sourceType: 'deposit',
          memo: 'Test deposit',
          lines: [
            { accountId: account.ledgerAccountId, direction: 'debit', amount: 10_000 },
            { accountId: undepositedFunds!.id, direction: 'credit', amount: 10_000 },
          ],
          idFactory,
        },
        'mock',
      );
      expect(await getBankAccountDerivedBalance(DEFAULT_ORGANIZATION_ID, account.id, 'mock')).toBe(10_000);
    });
  });

  describe('importBankStatement + runAutoMatch', () => {
    it('auto-matches a single unambiguous candidate within the ±3-day window', async () => {
      const account = await seedBankAccount();
      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      const { entry } = await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        {
          entryDate: '2026-08-01T00:00:00.000Z',
          sourceType: 'deposit',
          memo: 'Deposit',
          lines: [
            { accountId: account.ledgerAccountId, direction: 'debit', amount: 5_000 },
            { accountId: undepositedFunds!.id, direction: 'credit', amount: 5_000 },
          ],
          idFactory,
        },
        'mock',
      );

      const { statementImport } = await importBankStatement(
        DEFAULT_ORGANIZATION_ID,
        {
          bankAccountId: account.id,
          fileName: 'statement.csv',
          statementPeriodStart: '2026-08-01T00:00:00.000Z',
          statementPeriodEnd: '2026-08-31T00:00:00.000Z',
          lines: [{ transactionDate: '2026-08-02T00:00:00.000Z', description: 'Deposit', amount: 5_000 }],
          createdByStaffProfileId: null,
          idFactory,
        },
        ctx(),
        'mock',
      );
      expect(activityEventFixtures.some((e) => e.category === 'financial' && e.resourceId === statementImport.id)).toBe(true);

      const { matchedCount, lines } = await runAutoMatch(DEFAULT_ORGANIZATION_ID, account.id, 'mock');
      expect(matchedCount).toBe(1);
      expect(lines[0].matchStatus).toBe('auto_matched');
      expect(lines[0].matchedJournalEntryId).toBe(entry.id);
    });

    it('leaves a line unmatched when the candidate is outside the ±3-day window', async () => {
      const account = await seedBankAccount();
      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        {
          entryDate: '2026-08-01T00:00:00.000Z',
          sourceType: 'deposit',
          memo: 'Deposit',
          lines: [
            { accountId: account.ledgerAccountId, direction: 'debit', amount: 5_000 },
            { accountId: undepositedFunds!.id, direction: 'credit', amount: 5_000 },
          ],
          idFactory,
        },
        'mock',
      );

      await importBankStatement(
        DEFAULT_ORGANIZATION_ID,
        {
          bankAccountId: account.id,
          fileName: null,
          statementPeriodStart: null,
          statementPeriodEnd: null,
          lines: [{ transactionDate: '2026-08-10T00:00:00.000Z', description: 'Deposit', amount: 5_000 }],
          createdByStaffProfileId: null,
          idFactory,
        },
        ctx(),
        'mock',
      );

      const { matchedCount, lines } = await runAutoMatch(DEFAULT_ORGANIZATION_ID, account.id, 'mock');
      expect(matchedCount).toBe(0);
      expect(lines[0].matchStatus).toBe('unmatched');
    });

    it('leaves a line unmatched when there are multiple ambiguous candidates', async () => {
      const account = await seedBankAccount();
      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      for (let i = 0; i < 2; i += 1) {
        await createAndPostJournalEntry(
          DEFAULT_ORGANIZATION_ID,
          {
            entryDate: '2026-08-01T00:00:00.000Z',
            sourceType: 'deposit',
            memo: 'Deposit',
            lines: [
              { accountId: account.ledgerAccountId, direction: 'debit', amount: 5_000 },
              { accountId: undepositedFunds!.id, direction: 'credit', amount: 5_000 },
            ],
            idFactory,
          },
          'mock',
        );
      }

      await importBankStatement(
        DEFAULT_ORGANIZATION_ID,
        {
          bankAccountId: account.id,
          fileName: null,
          statementPeriodStart: null,
          statementPeriodEnd: null,
          lines: [{ transactionDate: '2026-08-02T00:00:00.000Z', description: 'Deposit', amount: 5_000 }],
          createdByStaffProfileId: null,
          idFactory,
        },
        ctx(),
        'mock',
      );

      const { matchedCount, lines } = await runAutoMatch(DEFAULT_ORGANIZATION_ID, account.id, 'mock');
      expect(matchedCount).toBe(0);
      expect(lines[0].matchStatus).toBe('unmatched');
    });

    it('matches a negative (withdrawal) statement amount against a credit line', async () => {
      const account = await seedBankAccount();
      const bankFees = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.BANK_FEES_EXPENSE, 'mock');
      await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        {
          entryDate: '2026-08-01T00:00:00.000Z',
          sourceType: 'adjustment',
          memo: 'Bank fee',
          lines: [
            { accountId: bankFees!.id, direction: 'debit', amount: 250 },
            { accountId: account.ledgerAccountId, direction: 'credit', amount: 250 },
          ],
          idFactory,
        },
        'mock',
      );

      await importBankStatement(
        DEFAULT_ORGANIZATION_ID,
        {
          bankAccountId: account.id,
          fileName: null,
          statementPeriodStart: null,
          statementPeriodEnd: null,
          lines: [{ transactionDate: '2026-08-01T00:00:00.000Z', description: 'Fee', amount: -250 }],
          createdByStaffProfileId: null,
          idFactory,
        },
        ctx(),
        'mock',
      );

      const { matchedCount, lines } = await runAutoMatch(DEFAULT_ORGANIZATION_ID, account.id, 'mock');
      expect(matchedCount).toBe(1);
      expect(lines[0].matchStatus).toBe('auto_matched');
    });
  });

  describe('manuallyMatchStatementLine / excludeStatementLine', () => {
    it('manually matches a line to a given journal entry', async () => {
      const account = await seedBankAccount();
      const { lines } = await importBankStatement(
        DEFAULT_ORGANIZATION_ID,
        {
          bankAccountId: account.id, fileName: null, statementPeriodStart: null, statementPeriodEnd: null,
          lines: [{ transactionDate: '2026-08-01T00:00:00.000Z', description: 'X', amount: 1_000 }],
          createdByStaffProfileId: null, idFactory,
        },
        ctx(),
        'mock',
      );

      const matched = await manuallyMatchStatementLine(DEFAULT_ORGANIZATION_ID, lines[0].id, 'je-manual-1', 'mock');
      expect(matched.matchStatus).toBe('manually_matched');
      expect(matched.matchedJournalEntryId).toBe('je-manual-1');
    });

    it('excludes a bank-only line with no corresponding Beacon entry', async () => {
      const account = await seedBankAccount();
      const { lines } = await importBankStatement(
        DEFAULT_ORGANIZATION_ID,
        {
          bankAccountId: account.id, fileName: null, statementPeriodStart: null, statementPeriodEnd: null,
          lines: [{ transactionDate: '2026-08-01T00:00:00.000Z', description: 'Fee', amount: -25 }],
          createdByStaffProfileId: null, idFactory,
        },
        ctx(),
        'mock',
      );

      const excluded = await excludeStatementLine(DEFAULT_ORGANIZATION_ID, lines[0].id, 'mock');
      expect(excluded.matchStatus).toBe('excluded');
    });
  });

  describe('startReconciliation / completeReconciliation / listReconciliationHistory', () => {
    it('completes cleanly when bookBalanceAtStart + matched total equals the statement ending balance', async () => {
      const account = await seedBankAccount();
      const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');
      await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        {
          entryDate: '2026-08-01T00:00:00.000Z',
          sourceType: 'deposit',
          memo: 'Deposit',
          lines: [
            { accountId: account.ledgerAccountId, direction: 'debit', amount: 5_000 },
            { accountId: undepositedFunds!.id, direction: 'credit', amount: 5_000 },
          ],
          idFactory,
        },
        'mock',
      );

      const { statementImport } = await importBankStatement(
        DEFAULT_ORGANIZATION_ID,
        {
          bankAccountId: account.id, fileName: null, statementPeriodStart: null, statementPeriodEnd: null,
          lines: [{ transactionDate: '2026-08-02T00:00:00.000Z', description: 'Deposit', amount: 5_000 }],
          createdByStaffProfileId: null, idFactory,
        },
        ctx(),
        'mock',
      );
      await runAutoMatch(DEFAULT_ORGANIZATION_ID, account.id, 'mock');

      const reconciliation = await startReconciliation(
        DEFAULT_ORGANIZATION_ID,
        { bankAccountId: account.id, statementEndingDate: '2026-08-31T00:00:00.000Z', statementEndingBalance: 5_000, bankStatementImportId: statementImport.id, idFactory },
        ctx(),
        'mock',
      );
      expect(reconciliation.bookBalanceAtStart).toBe(0);
      expect(activityEventFixtures.some((e) => e.category === 'financial' && e.resourceId === reconciliation.id)).toBe(true);

      const result = await completeReconciliation(
        DEFAULT_ORGANIZATION_ID,
        { reconciliationId: reconciliation.id, completedByStaffProfileId: null },
        ctx(),
        'mock',
      );
      expect(result.completed).toBe(true);
      expect(result.variance).toBe(0);
      expect(result.reconciliation.status).toBe('completed');

      const history = await listReconciliationHistory(DEFAULT_ORGANIZATION_ID, account.id, 'mock');
      expect(history.some((r) => r.id === reconciliation.id)).toBe(true);
    });

    it('returns a nonzero variance instead of completing when the totals do not balance', async () => {
      const account = await seedBankAccount();
      const reconciliation = await startReconciliation(
        DEFAULT_ORGANIZATION_ID,
        { bankAccountId: account.id, statementEndingDate: '2026-08-31T00:00:00.000Z', statementEndingBalance: 9_999, idFactory },
        ctx(),
        'mock',
      );

      const result = await completeReconciliation(
        DEFAULT_ORGANIZATION_ID,
        { reconciliationId: reconciliation.id, completedByStaffProfileId: null },
        ctx(),
        'mock',
      );
      expect(result.completed).toBe(false);
      expect(result.variance).toBe(9_999);
      expect(result.reconciliation.status).toBe('in_progress');
    });

    it('rejects completing an already-completed reconciliation', async () => {
      const account = await seedBankAccount();
      const reconciliation = await startReconciliation(
        DEFAULT_ORGANIZATION_ID,
        { bankAccountId: account.id, statementEndingDate: '2026-08-31T00:00:00.000Z', statementEndingBalance: 0, idFactory },
        ctx(),
        'mock',
      );
      await completeReconciliation(DEFAULT_ORGANIZATION_ID, { reconciliationId: reconciliation.id, completedByStaffProfileId: null }, ctx(), 'mock');
      await expect(
        completeReconciliation(DEFAULT_ORGANIZATION_ID, { reconciliationId: reconciliation.id, completedByStaffProfileId: null }, ctx(), 'mock'),
      ).rejects.toThrow(BankingServiceError);
    });
  });
});
