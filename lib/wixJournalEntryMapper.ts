import type { JournalEntry, JournalEntrySourceType, JournalEntryStatus } from '../types/journalEntry';

/**
 * Phase 31 (Financial Management & General Ledger). The one place a raw
 * Wix `journalEntries` item is ever touched. `beaconJournalEntryId` is set
 * as the item's own system `_id` at insert time — `entryNumber`
 * uniqueness is enforced via a composed `{organizationId}:{entryNumber}`
 * value stored on `entryNumber` itself, the same technique
 * `paymentRecords.idempotencyKey` already uses.
 */
export type WixJournalEntryItem = {
  beaconJournalEntryId?: unknown;
  organizationId?: unknown;
  entryNumber?: unknown;
  entryNumberKey?: unknown;
  entryDate?: unknown;
  status?: unknown;
  sourceType?: unknown;
  sourceReferenceId?: unknown;
  caseId?: unknown;
  memo?: unknown;
  reversesEntryId?: unknown;
  postedAt?: unknown;
  postedByStaffProfileId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_STATUSES: readonly string[] = ['draft', 'posted', 'void'];
const VALID_SOURCE_TYPES: readonly string[] = [
  'payment',
  'refund',
  'write_off',
  'adjustment',
  'deposit',
  'transfer',
  'manual',
  'opening_balance',
  'reversal',
  'revenue_recognition',
  // Phase 35 (Merchandise, Inventory & Commerce) — must stay in lockstep with
  // the JournalEntrySourceType union, or a posted merchandise entry silently
  // maps to null and vanishes from every ledger read.
  'inventory_receipt',
  'cogs',
  'inventory_adjustment',
];

function isStatus(value: unknown): value is JournalEntryStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isSourceType(value: unknown): value is JournalEntrySourceType {
  return typeof value === 'string' && VALID_SOURCE_TYPES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixJournalEntryItem(item: WixJournalEntryItem | undefined): JournalEntry | null {
  if (
    !item ||
    typeof item.beaconJournalEntryId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.entryNumber !== 'string' ||
    typeof item.entryNumberKey !== 'string' ||
    typeof item.entryDate !== 'string' ||
    !isStatus(item.status) ||
    !isSourceType(item.sourceType) ||
    !isStringOrNull(item.sourceReferenceId) ||
    !isStringOrNull(item.caseId) ||
    typeof item.memo !== 'string' ||
    !isStringOrNull(item.reversesEntryId) ||
    !isStringOrNull(item.postedAt) ||
    !isStringOrNull(item.postedByStaffProfileId) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconJournalEntryId,
    organizationId: item.organizationId,
    entryNumber: item.entryNumber,
    entryNumberKey: item.entryNumberKey,
    entryDate: item.entryDate,
    status: item.status,
    sourceType: item.sourceType,
    sourceReferenceId: item.sourceReferenceId,
    caseId: item.caseId,
    memo: item.memo,
    reversesEntryId: item.reversesEntryId,
    postedAt: item.postedAt,
    postedByStaffProfileId: item.postedByStaffProfileId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixJournalEntryData(entry: JournalEntry): WixJournalEntryItem {
  return {
    beaconJournalEntryId: entry.id,
    organizationId: entry.organizationId,
    entryNumber: entry.entryNumber,
    entryNumberKey: entry.entryNumberKey,
    entryDate: entry.entryDate,
    status: entry.status,
    sourceType: entry.sourceType,
    sourceReferenceId: entry.sourceReferenceId,
    caseId: entry.caseId,
    memo: entry.memo,
    reversesEntryId: entry.reversesEntryId,
    postedAt: entry.postedAt,
    postedByStaffProfileId: entry.postedByStaffProfileId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/** `status`/`postedAt`/`postedByStaffProfileId`/`updatedAt` are the only
    fields ever changed after creation — only while `status === 'draft'`
    (draft→posted or draft→void); a posted entry is never touched again.
    See types/journalEntry.ts's own comment. */
export function applyJournalEntryUpdateToWixData(
  existing: WixJournalEntryItem,
  patch: Partial<Pick<JournalEntry, 'status' | 'postedAt' | 'postedByStaffProfileId' | 'updatedAt'>>,
): WixJournalEntryItem {
  return { ...existing, ...patch };
}
