import type { CaseLogEntry, CaseLogEntryType } from '../types/caseLogEntry';

const VALID_TYPES: CaseLogEntryType[] = ['note', 'contact'];

function isValidCaseLogEntryType(value: unknown): value is CaseLogEntryType {
  return typeof value === 'string' && (VALID_TYPES as string[]).includes(value);
}

export type WixCaseLogEntryItem = {
  beaconCaseLogEntryId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  type?: unknown;
  text?: unknown;
  contactedWho?: unknown;
  contactedSpoke?: unknown;
  contactSummary?: unknown;
  author?: unknown;
  createdAt?: unknown;
};

/**
 * Raw-field-name leak fix follow-up (2026-10) — real Wix persistence for
 * `CaseLogEntries`, matching `docs/CMS_SCHEMA.md`'s own field list and
 * `lib/wixActivityEventMapper.ts`'s own "beacon<Thing>Id field + Wix
 * system _id both carry the same app-generated id" convention.
 */
export function mapWixCaseLogEntryItem(item: WixCaseLogEntryItem | undefined): CaseLogEntry | null {
  if (
    !item ||
    typeof item.beaconCaseLogEntryId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.type !== 'string' ||
    !isValidCaseLogEntryType(item.type) ||
    typeof item.author !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconCaseLogEntryId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    type: item.type,
    text: typeof item.text === 'string' ? item.text : null,
    contactedWho: typeof item.contactedWho === 'string' ? item.contactedWho : null,
    contactedSpoke: typeof item.contactedSpoke === 'string' ? item.contactedSpoke : null,
    contactSummary: typeof item.contactSummary === 'string' ? item.contactSummary : null,
    author: item.author,
    createdAt: item.createdAt,
  };
}

export function buildWixCaseLogEntryData(entry: CaseLogEntry): WixCaseLogEntryItem {
  return {
    beaconCaseLogEntryId: entry.id,
    organizationId: entry.organizationId,
    caseId: entry.caseId,
    type: entry.type,
    text: entry.text,
    contactedWho: entry.contactedWho,
    contactedSpoke: entry.contactedSpoke,
    contactSummary: entry.contactSummary,
    author: entry.author,
    createdAt: entry.createdAt,
  };
}
