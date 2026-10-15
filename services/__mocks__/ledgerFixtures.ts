import type { LedgerAccount } from '../../types/ledgerAccount';
import type { JournalEntry, JournalEntryLine } from '../../types/journalEntry';
import type { CaseWriteOff } from '../../types/caseWriteOff';
import { mockCollection } from './mockStore';
import { GUS_ORGANIZATION_ID } from './organizationIds';
import { STARTER_CHART_OF_ACCOUNTS } from '../../domain/ledger/starterChartOfAccounts';

/**
 * Phase 31 (Financial Management & General Ledger). Mock-mode, in-process
 * fixtures for the general ledger's four collections — same convention as
 * `services/__mocks__/notificationFixtures.ts`: plain, empty typed arrays,
 * mutated directly by each service's mock-mode branch, reset between
 * tests by each test file itself (`fixtures.length = 0`). The only rows
 * seeded here are the fictional Gus organization's starter chart (below).
 */
export const ledgerAccountFixtures: LedgerAccount[] = mockCollection('ledgerAccountFixtures', gusStarterChartOfAccounts);

/**
 * Gus Camacho local demo (2026-10): the fictional Gus organization starts
 * with the same starter chart onboarding seeds for every new organization
 * (services/chartOfAccountsService.ts#seedChartOfAccounts), so the
 * Accounting screens render in local development. Only Gus rows are
 * seeded — the Manors mock ledger stays empty, exactly as before.
 */
function gusStarterChartOfAccounts(): LedgerAccount[] {
  const createdAt = '2026-01-01T00:00:00.000Z';
  return STARTER_CHART_OF_ACCOUNTS.map((entry) => ({
    id: `gus-ledger-account-${entry.accountNumber}`,
    organizationId: GUS_ORGANIZATION_ID,
    accountNumber: entry.accountNumber,
    accountNumberKey: `${GUS_ORGANIZATION_ID}:${entry.accountNumber}`,
    name: entry.name,
    accountType: entry.accountType,
    normalBalance: entry.normalBalance,
    parentAccountId: null,
    isSystemAccount: true,
    isActive: true,
    description: entry.description,
    createdAt,
    updatedAt: createdAt,
  }));
}
export const journalEntryFixtures: JournalEntry[] = mockCollection('journalEntryFixtures', (): JournalEntry[] => []);
export const journalEntryLineFixtures: JournalEntryLine[] = mockCollection('journalEntryLineFixtures', (): JournalEntryLine[] => []);
export const caseWriteOffFixtures: CaseWriteOff[] = mockCollection('caseWriteOffFixtures', (): CaseWriteOff[] => []);
