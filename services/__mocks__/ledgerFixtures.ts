import type { LedgerAccount } from '../../types/ledgerAccount';
import type { JournalEntry, JournalEntryLine } from '../../types/journalEntry';
import type { CaseWriteOff } from '../../types/caseWriteOff';

/**
 * Phase 31 (Financial Management & General Ledger). Mock-mode, in-process
 * fixtures for the general ledger's four collections — same convention as
 * `services/__mocks__/notificationFixtures.ts`: plain, empty typed arrays,
 * mutated directly by each service's mock-mode branch, reset between
 * tests by each test file itself (`fixtures.length = 0`), never seeded
 * inside this module.
 */
export const ledgerAccountFixtures: LedgerAccount[] = [];
export const journalEntryFixtures: JournalEntry[] = [];
export const journalEntryLineFixtures: JournalEntryLine[] = [];
export const caseWriteOffFixtures: CaseWriteOff[] = [];
