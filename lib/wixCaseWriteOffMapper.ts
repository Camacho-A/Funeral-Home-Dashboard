import type { CaseWriteOff } from '../types/caseWriteOff';

/**
 * Phase 31 (Financial Management & General Ledger). The one place a raw
 * Wix `caseWriteOffs` item is ever touched. Write-once, append-only —
 * reversing a write-off is a new JournalEntry, never an edit or deletion
 * of this row — so there is no update helper here at all, only map/build.
 */
export type WixCaseWriteOffItem = {
  beaconCaseWriteOffId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  amount?: unknown;
  journalEntryId?: unknown;
  reason?: unknown;
  performedByStaffProfileId?: unknown;
  createdAt?: unknown;
};

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixCaseWriteOffItem(item: WixCaseWriteOffItem | undefined): CaseWriteOff | null {
  if (
    !item ||
    typeof item.beaconCaseWriteOffId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.amount !== 'number' ||
    typeof item.journalEntryId !== 'string' ||
    typeof item.reason !== 'string' ||
    !isStringOrNull(item.performedByStaffProfileId) ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconCaseWriteOffId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    amount: item.amount,
    journalEntryId: item.journalEntryId,
    reason: item.reason,
    performedByStaffProfileId: item.performedByStaffProfileId,
    createdAt: item.createdAt,
  };
}

export function buildWixCaseWriteOffData(writeOff: CaseWriteOff): WixCaseWriteOffItem {
  return {
    beaconCaseWriteOffId: writeOff.id,
    organizationId: writeOff.organizationId,
    caseId: writeOff.caseId,
    amount: writeOff.amount,
    journalEntryId: writeOff.journalEntryId,
    reason: writeOff.reason,
    performedByStaffProfileId: writeOff.performedByStaffProfileId,
    createdAt: writeOff.createdAt,
  };
}
