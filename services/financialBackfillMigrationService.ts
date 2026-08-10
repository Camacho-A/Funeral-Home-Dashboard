import type { DataAdapterMode } from '../lib/env';
import type { ActivityContext } from './activityService';
import { recordJournalEntryPosted } from './activityService';
import { createAndPostJournalEntry, listJournalEntriesForOrganization } from './generalLedgerService';
import { getAccountByNumber } from './chartOfAccountsService';
import { queryWixDataItems } from '../lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '../lib/wixCaseMapper';
import { caseFixtures } from './__mocks__/fixtures';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import type { PaymentRecord } from '../types/payment';

/**
 * Phase 31 (Financial Management & General Ledger). Backfills a real,
 * posted opening `JournalEntry` (Dr Undeposited Funds / Cr Accounts
 * Receivable — the same pairing `financialTransactionService.ts#postPaymentTransaction`
 * uses going forward) for each of an organization's pre-existing
 * `succeeded` `PaymentRecord`s, so the ledger is complete from adoption
 * day one rather than merely correct from this point forward. Manor's
 * Cremation is the one live tenant with real payments predating this
 * phase — see docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * **Two-phase, dry-run-then-apply** (`options.apply`), mirroring
 * `staffProfileMigrationService.ts`'s exact shape: a dry run only
 * *resolves* what each row would become and reports it; only
 * `options.apply: true` writes anything.
 *
 * **Idempotent**: keyed by `JournalEntry.sourceReferenceId` — a payment
 * that's already been journaled (by this backfill or by the ordinary
 * real-time `postPaymentTransaction` path, e.g. because it happened after
 * Phase 31 shipped) is reported `'already-posted'` and left untouched. A
 * second full run is a no-op.
 *
 * **`legacyPayments` is caller-supplied**, not fetched internally — like
 * `identityMigrationService.ts`/`staffProfileMigrationService.ts`, this
 * takes its input as an explicit argument rather than reaching for one
 * specific query itself; there is also no `(organizationId)`-only index on
 * `paymentRecords` (its 2-regular-index budget is already spent — see
 * ADR-035's Wix collection budget), so the live-verification caller
 * enumerates payments case-by-case via `listPaymentRecordsForCase` rather
 * than this service assuming an org-wide query is available.
 *
 * **"Missing case linkage" fallback**: if a payment's own `caseId` no
 * longer resolves to a real case (e.g. the case was later deleted), the
 * row is not silently skipped — it books Dr Undeposited Funds / Cr the
 * dedicated "Legacy Opening Balance" equity account (3010) instead of
 * Accounts Receivable, with `JournalEntry.caseId: null` and a memo naming
 * the original, unresolvable case id — a named, disclosed fallback, not a
 * best-effort guess at a receivable that may no longer be real.
 */
export type FinancialBackfillRowStatus = 'already-posted' | 'not-succeeded' | 'posted' | 'legacy-fallback-posted';

export type FinancialBackfillRowReport = {
  paymentId: string;
  caseId: string;
  amountCents: number;
  status: FinancialBackfillRowStatus;
  journalEntryId: string | null;
};

export type FinancialBackfillReport = {
  apply: boolean;
  rowsProcessed: number;
  alreadyPosted: number;
  notSucceeded: number;
  posted: number;
  legacyFallbackPosted: number;
  rows: FinancialBackfillRowReport[];
};

async function resolvesToRealCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.some((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted);
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { beaconCaseId: caseId, organizationId, isArchived: false },
    paging: { limit: 1 },
  });
  return mapWixCaseItem(response.dataItems[0]?.data) !== null;
}

export async function backfillOpeningJournalEntries(
  organizationId: string,
  legacyPayments: readonly PaymentRecord[],
  options: { apply: boolean; idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<FinancialBackfillReport> {
  const report: FinancialBackfillReport = {
    apply: options.apply,
    rowsProcessed: 0,
    alreadyPosted: 0,
    notSucceeded: 0,
    posted: 0,
    legacyFallbackPosted: 0,
    rows: [],
  };

  const existingEntries = await listJournalEntriesForOrganization(organizationId, dataAdapterMode);
  const alreadyJournaledPaymentIds = new Set(existingEntries.map((e) => e.sourceReferenceId).filter((id): id is string => id !== null));

  const undepositedFunds = await getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, dataAdapterMode);
  const accountsReceivable = await getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode);
  const legacyOpeningBalance = await getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.LEGACY_OPENING_BALANCE, dataAdapterMode);
  if (!undepositedFunds || !accountsReceivable || !legacyOpeningBalance) {
    throw new Error('Chart of accounts has not been seeded for this organization — run seedChartOfAccounts before backfilling.');
  }

  for (const payment of legacyPayments) {
    report.rowsProcessed += 1;

    if (payment.status !== 'succeeded') {
      report.notSucceeded += 1;
      report.rows.push({ paymentId: payment.id, caseId: payment.caseId, amountCents: payment.amount, status: 'not-succeeded', journalEntryId: null });
      continue;
    }

    if (alreadyJournaledPaymentIds.has(payment.id)) {
      report.alreadyPosted += 1;
      report.rows.push({ paymentId: payment.id, caseId: payment.caseId, amountCents: payment.amount, status: 'already-posted', journalEntryId: null });
      continue;
    }

    const caseResolves = await resolvesToRealCase(organizationId, payment.caseId, dataAdapterMode);

    if (!options.apply) {
      const status: FinancialBackfillRowStatus = caseResolves ? 'posted' : 'legacy-fallback-posted';
      if (status === 'posted') report.posted += 1;
      else report.legacyFallbackPosted += 1;
      report.rows.push({ paymentId: payment.id, caseId: payment.caseId, amountCents: payment.amount, status, journalEntryId: null });
      continue;
    }

    const entryDate = payment.paidAt ?? payment.createdAt;

    if (caseResolves) {
      const { entry } = await createAndPostJournalEntry(
        organizationId,
        {
          entryDate,
          sourceType: 'opening_balance',
          sourceReferenceId: payment.id,
          caseId: payment.caseId,
          memo: `Opening balance backfill for payment ${payment.id}`,
          lines: [
            { accountId: undepositedFunds.id, direction: 'debit', amount: payment.amount, caseId: payment.caseId },
            { accountId: accountsReceivable.id, direction: 'credit', amount: payment.amount, caseId: payment.caseId },
          ],
          idFactory: options.idFactory,
          now: options.now,
        },
        dataAdapterMode,
      );
      await recordJournalEntryPosted(ctx, payment.caseId, entry.id, entry.entryNumber, dataAdapterMode);
      report.posted += 1;
      report.rows.push({ paymentId: payment.id, caseId: payment.caseId, amountCents: payment.amount, status: 'posted', journalEntryId: entry.id });
    } else {
      const { entry } = await createAndPostJournalEntry(
        organizationId,
        {
          entryDate,
          sourceType: 'opening_balance',
          sourceReferenceId: payment.id,
          caseId: null,
          memo: `Legacy Opening Balance backfill — original case ${payment.caseId} could not be resolved for payment ${payment.id}`,
          lines: [
            { accountId: undepositedFunds.id, direction: 'debit', amount: payment.amount, caseId: null },
            { accountId: legacyOpeningBalance.id, direction: 'credit', amount: payment.amount, caseId: null },
          ],
          idFactory: options.idFactory,
          now: options.now,
        },
        dataAdapterMode,
      );
      await recordJournalEntryPosted(ctx, null, entry.id, entry.entryNumber, dataAdapterMode);
      report.legacyFallbackPosted += 1;
      report.rows.push({ paymentId: payment.id, caseId: payment.caseId, amountCents: payment.amount, status: 'legacy-fallback-posted', journalEntryId: entry.id });
    }
  }

  return report;
}
