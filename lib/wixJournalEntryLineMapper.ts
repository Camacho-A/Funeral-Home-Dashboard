import type { JournalEntryLine } from '../types/journalEntry';

/**
 * Phase 31 (Financial Management & General Ledger). The one place a raw
 * Wix `journalEntryLines` item is ever touched. Lines are write-once —
 * created alongside their JournalEntry and never edited or deleted
 * afterward (a correction is always a new reversing entry with its own
 * fresh lines) — so there is no update helper here at all, only map/build,
 * mirroring lib/wixCaseOrderLineItemMapper.ts's own identical convention.
 */
export type WixJournalEntryLineItem = {
  beaconJournalEntryLineId?: unknown;
  organizationId?: unknown;
  journalEntryId?: unknown;
  lineNumber?: unknown;
  accountId?: unknown;
  direction?: unknown;
  amount?: unknown;
  caseId?: unknown;
  description?: unknown;
  createdAt?: unknown;
};

function isDirection(value: unknown): value is 'debit' | 'credit' {
  return value === 'debit' || value === 'credit';
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixJournalEntryLineItem(item: WixJournalEntryLineItem | undefined): JournalEntryLine | null {
  if (
    !item ||
    typeof item.beaconJournalEntryLineId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.journalEntryId !== 'string' ||
    typeof item.lineNumber !== 'number' ||
    typeof item.accountId !== 'string' ||
    !isDirection(item.direction) ||
    typeof item.amount !== 'number' ||
    !isStringOrNull(item.caseId) ||
    !isStringOrNull(item.description) ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconJournalEntryLineId,
    organizationId: item.organizationId,
    journalEntryId: item.journalEntryId,
    lineNumber: item.lineNumber,
    accountId: item.accountId,
    direction: item.direction,
    amount: item.amount,
    caseId: item.caseId,
    description: item.description,
    createdAt: item.createdAt,
  };
}

export function buildWixJournalEntryLineData(line: JournalEntryLine): WixJournalEntryLineItem {
  return {
    beaconJournalEntryLineId: line.id,
    organizationId: line.organizationId,
    journalEntryId: line.journalEntryId,
    lineNumber: line.lineNumber,
    accountId: line.accountId,
    direction: line.direction,
    amount: line.amount,
    caseId: line.caseId,
    description: line.description,
    createdAt: line.createdAt,
  };
}
