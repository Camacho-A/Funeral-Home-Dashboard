import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  createAndPostJournalEntry,
  createDraftJournalEntry,
  updateDraftJournalEntryLines,
  postJournalEntry,
  voidDraftJournalEntry,
  reverseJournalEntry,
  getJournalEntryWithLines,
  listJournalEntriesForCase,
  listJournalEntriesForOrganization,
  getAccountBalance,
  getTrialBalance,
  GeneralLedgerServiceError,
  JournalEntryReversalError,
} from './generalLedgerService';
import { UnbalancedJournalEntryError } from '../domain/ledger/balancing';
import { journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `journal-entry-test-${idCounter}`;
}

let lengths: { entries: number; lines: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { entries: journalEntryFixtures.length, lines: journalEntryLineFixtures.length };
});
afterEach(() => {
  journalEntryFixtures.length = lengths.entries;
  journalEntryLineFixtures.length = lengths.lines;
});

const UNDEPOSITED_FUNDS = 'account-1100';
const ACCOUNTS_RECEIVABLE = 'account-1200';
const BAD_DEBT_EXPENSE = 'account-5000';

describe('generalLedgerService', () => {
  describe('createAndPostJournalEntry', () => {
    it('posts a balanced two-line entry immediately', async () => {
      const { entry, lines } = await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        {
          entryDate: '2026-08-01T00:00:00.000Z',
          sourceType: 'payment',
          sourceReferenceId: 'payment-1',
          caseId: 'case-1',
          memo: 'Payment posted',
          lines: [
            { accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 1000 },
            { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 1000 },
          ],
          postedByStaffProfileId: 'staff-dana',
          idFactory,
        },
        'mock',
      );
      expect(entry.status).toBe('posted');
      expect(entry.postedAt).not.toBeNull();
      expect(entry.entryNumber).toBe('JE-000001');
      expect(lines).toHaveLength(2);
    });

    it('generates sequential entry numbers per organization', async () => {
      const first = await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'manual', memo: 'A', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory },
        'mock',
      );
      const second = await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        { entryDate: '2026-08-02T00:00:00.000Z', sourceType: 'manual', memo: 'B', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory },
        'mock',
      );
      expect(first.entry.entryNumber).toBe('JE-000001');
      expect(second.entry.entryNumber).toBe('JE-000002');
    });

    it('tracks entry numbers independently per organization', async () => {
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'manual', memo: 'A', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      const otherOrgFirst = await createAndPostJournalEntry(SECOND_MOCK_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'manual', memo: 'A', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      expect(otherOrgFirst.entry.entryNumber).toBe('JE-000001');
    });

    it('rejects an unbalanced entry before writing anything', async () => {
      const before = journalEntryFixtures.length;
      await expect(
        createAndPostJournalEntry(
          DEFAULT_ORGANIZATION_ID,
          { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'manual', memo: 'Bad', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 1000 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 999 }], idFactory },
          'mock',
        ),
      ).rejects.toThrow(UnbalancedJournalEntryError);
      expect(journalEntryFixtures.length).toBe(before);
    });

    it('supports more than two lines as long as they balance', async () => {
      const { lines } = await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        {
          entryDate: '2026-08-01T00:00:00.000Z',
          sourceType: 'deposit',
          memo: 'Multi-payment deposit',
          lines: [
            { accountId: 'account-1010', direction: 'debit', amount: 1500 },
            { accountId: UNDEPOSITED_FUNDS, direction: 'credit', amount: 1000 },
            { accountId: UNDEPOSITED_FUNDS, direction: 'credit', amount: 500 },
          ],
          idFactory,
        },
        'mock',
      );
      expect(lines).toHaveLength(3);
    });
  });

  describe('draft lifecycle: createDraftJournalEntry -> updateDraftJournalEntryLines -> postJournalEntry', () => {
    it('creates a draft with no lines, then composes and posts it', async () => {
      const draft = await createDraftJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', memo: 'Manual adjustment', idFactory }, 'mock');
      expect(draft.status).toBe('draft');
      expect(draft.sourceType).toBe('manual');

      const lines = await updateDraftJournalEntryLines(
        DEFAULT_ORGANIZATION_ID,
        draft.id,
        [
          { accountId: BAD_DEBT_EXPENSE, direction: 'debit', amount: 500 },
          { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 500 },
        ],
        'mock',
      );
      expect(lines).toHaveLength(2);

      const posted = await postJournalEntry(DEFAULT_ORGANIZATION_ID, draft.id, 'staff-dana', 'mock');
      expect(posted.status).toBe('posted');
      expect(posted.postedByStaffProfileId).toBe('staff-dana');
    });

    it('rejects posting a draft whose lines do not balance', async () => {
      const draft = await createDraftJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', memo: 'Unbalanced', idFactory }, 'mock');
      await updateDraftJournalEntryLines(DEFAULT_ORGANIZATION_ID, draft.id, [{ accountId: BAD_DEBT_EXPENSE, direction: 'debit', amount: 500 }], 'mock');
      await expect(postJournalEntry(DEFAULT_ORGANIZATION_ID, draft.id, null, 'mock')).rejects.toThrow(UnbalancedJournalEntryError);
    });

    it('rejects posting an entry that is not a draft', async () => {
      const { entry } = await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'manual', memo: 'Already posted', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      await expect(postJournalEntry(DEFAULT_ORGANIZATION_ID, entry.id, null, 'mock')).rejects.toThrow(GeneralLedgerServiceError);
    });

    it('replacing draft lines discards the previous set entirely', async () => {
      const draft = await createDraftJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', memo: 'Replace me', idFactory }, 'mock');
      await updateDraftJournalEntryLines(DEFAULT_ORGANIZATION_ID, draft.id, [{ accountId: BAD_DEBT_EXPENSE, direction: 'debit', amount: 999 }], 'mock');
      const replaced = await updateDraftJournalEntryLines(DEFAULT_ORGANIZATION_ID, draft.id, [
        { accountId: BAD_DEBT_EXPENSE, direction: 'debit', amount: 500 },
        { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 500 },
      ], 'mock');
      expect(replaced).toHaveLength(2);
      expect(replaced.some((l) => l.amount === 999)).toBe(false);
    });
  });

  describe('voidDraftJournalEntry', () => {
    it('voids a draft', async () => {
      const draft = await createDraftJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', memo: 'Discard me', idFactory }, 'mock');
      const voided = await voidDraftJournalEntry(DEFAULT_ORGANIZATION_ID, draft.id, 'mock');
      expect(voided.status).toBe('void');
    });

    it('refuses to void an already-posted entry', async () => {
      const { entry } = await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'manual', memo: 'Posted', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      await expect(voidDraftJournalEntry(DEFAULT_ORGANIZATION_ID, entry.id, 'mock')).rejects.toThrow(GeneralLedgerServiceError);
    });
  });

  describe('reverseJournalEntry', () => {
    it('posts a mirror-flipped reversing entry, never mutating the original', async () => {
      const { entry: original } = await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'payment', memo: 'Original payment', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 1000 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 1000 }], idFactory },
        'mock',
      );
      const { entry: reversal, lines: reversalLines } = await reverseJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        original.id,
        { reason: 'Payment was in error', performedByStaffProfileId: 'staff-dana', idFactory },
        'mock',
      );

      expect(reversal.sourceType).toBe('reversal');
      expect(reversal.reversesEntryId).toBe(original.id);
      expect(reversalLines).toHaveLength(2);
      expect(reversalLines.find((l) => l.accountId === UNDEPOSITED_FUNDS)?.direction).toBe('credit');
      expect(reversalLines.find((l) => l.accountId === ACCOUNTS_RECEIVABLE)?.direction).toBe('debit');

      // The original is untouched — still posted, still has reversesEntryId: null.
      const untouchedOriginal = await getJournalEntryWithLines(DEFAULT_ORGANIZATION_ID, original.id, 'mock');
      expect(untouchedOriginal?.entry.status).toBe('posted');
      expect(untouchedOriginal?.entry.reversesEntryId).toBeNull();
    });

    it('nets the account balance back to zero after a reversal', async () => {
      const { entry: original } = await createAndPostJournalEntry(
        DEFAULT_ORGANIZATION_ID,
        { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'payment', memo: 'Original payment', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 1000 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 1000 }], idFactory },
        'mock',
      );
      await reverseJournalEntry(DEFAULT_ORGANIZATION_ID, original.id, { reason: 'undo', performedByStaffProfileId: null, idFactory }, 'mock');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, UNDEPOSITED_FUNDS, 'mock')).toBe(0);
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, ACCOUNTS_RECEIVABLE, 'mock')).toBe(0);
    });

    it('refuses to reverse a draft entry', async () => {
      const draft = await createDraftJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', memo: 'Draft', idFactory }, 'mock');
      await expect(reverseJournalEntry(DEFAULT_ORGANIZATION_ID, draft.id, { reason: 'x', performedByStaffProfileId: null, idFactory }, 'mock')).rejects.toThrow(JournalEntryReversalError);
    });

    it('refuses to reverse an entry that has already been reversed', async () => {
      const { entry: original } = await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'payment', memo: 'Original', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      await reverseJournalEntry(DEFAULT_ORGANIZATION_ID, original.id, { reason: 'first', performedByStaffProfileId: null, idFactory }, 'mock');
      await expect(reverseJournalEntry(DEFAULT_ORGANIZATION_ID, original.id, { reason: 'second', performedByStaffProfileId: null, idFactory }, 'mock')).rejects.toThrow(/already been reversed/);
    });
  });

  describe('getAccountBalance', () => {
    it('derives a debit-normal account balance as debits minus credits', async () => {
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'payment', memo: 'A', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 1000 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 1000 }], idFactory }, 'mock');
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-02T00:00:00.000Z', sourceType: 'deposit', memo: 'B', lines: [{ accountId: 'account-1010', direction: 'debit', amount: 1000 }, { accountId: UNDEPOSITED_FUNDS, direction: 'credit', amount: 1000 }], idFactory }, 'mock');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, UNDEPOSITED_FUNDS, 'mock')).toBe(0);
    });

    it('never counts lines from a draft (unposted) entry', async () => {
      const draft = await createDraftJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', memo: 'Draft', idFactory }, 'mock');
      await updateDraftJournalEntryLines(DEFAULT_ORGANIZATION_ID, draft.id, [{ accountId: BAD_DEBT_EXPENSE, direction: 'debit', amount: 500 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 500 }], 'mock');
      expect(await getAccountBalance(DEFAULT_ORGANIZATION_ID, BAD_DEBT_EXPENSE, 'mock')).toBe(0);
    });

    it('scopes strictly to the given organization', async () => {
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'manual', memo: 'A', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 1000 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 1000 }], idFactory }, 'mock');
      expect(await getAccountBalance(SECOND_MOCK_ORGANIZATION_ID, UNDEPOSITED_FUNDS, 'mock')).toBe(0);
    });
  });

  describe('getTrialBalance', () => {
    it('sums debit/credit totals per account across every posted entry', async () => {
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'payment', memo: 'A', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 1000 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 1000 }], idFactory }, 'mock');
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-02T00:00:00.000Z', sourceType: 'payment', memo: 'B', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 500 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 500 }], idFactory }, 'mock');

      const trialBalance = await getTrialBalance(DEFAULT_ORGANIZATION_ID, 'mock');
      const undepositedRow = trialBalance.find((r) => r.accountId === UNDEPOSITED_FUNDS);
      const receivableRow = trialBalance.find((r) => r.accountId === ACCOUNTS_RECEIVABLE);
      expect(undepositedRow).toMatchObject({ debitTotal: 1500, creditTotal: 0 });
      expect(receivableRow).toMatchObject({ debitTotal: 0, creditTotal: 1500 });
    });

    it('the whole trial balance always balances: total debits equal total credits', async () => {
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'payment', memo: 'A', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 700 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 700 }], idFactory }, 'mock');
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-02T00:00:00.000Z', sourceType: 'write_off', memo: 'B', lines: [{ accountId: BAD_DEBT_EXPENSE, direction: 'debit', amount: 200 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 200 }], idFactory }, 'mock');

      const trialBalance = await getTrialBalance(DEFAULT_ORGANIZATION_ID, 'mock');
      const totalDebits = trialBalance.reduce((sum, r) => sum + r.debitTotal, 0);
      const totalCredits = trialBalance.reduce((sum, r) => sum + r.creditTotal, 0);
      expect(totalDebits).toBe(totalCredits);
    });
  });

  describe('listJournalEntriesForCase / listJournalEntriesForOrganization', () => {
    it('scopes listJournalEntriesForCase to the given case only', async () => {
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'payment', caseId: 'case-a', memo: 'A', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'payment', caseId: 'case-b', memo: 'B', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      const caseAEntries = await listJournalEntriesForCase(DEFAULT_ORGANIZATION_ID, 'case-a', 'mock');
      expect(caseAEntries).toHaveLength(1);
      expect(caseAEntries[0].caseId).toBe('case-a');
    });

    it('listJournalEntriesForOrganization supports date-range filtering', async () => {
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-01-01T00:00:00.000Z', sourceType: 'manual', memo: 'January', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      await createAndPostJournalEntry(DEFAULT_ORGANIZATION_ID, { entryDate: '2026-08-01T00:00:00.000Z', sourceType: 'manual', memo: 'August', lines: [{ accountId: UNDEPOSITED_FUNDS, direction: 'debit', amount: 100 }, { accountId: ACCOUNTS_RECEIVABLE, direction: 'credit', amount: 100 }], idFactory }, 'mock');
      const augustOnly = await listJournalEntriesForOrganization(DEFAULT_ORGANIZATION_ID, 'mock', { fromDate: '2026-07-01T00:00:00.000Z' });
      expect(augustOnly).toHaveLength(1);
      expect(augustOnly[0].memo).toBe('August');
    });
  });
});
