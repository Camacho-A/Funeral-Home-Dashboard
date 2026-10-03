import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import type { OrganizationContext } from '../types/organization';
import type { CaseLogEntry, NewCaseLogEntryInput } from '../types/caseLogEntry';
import { queryWixDataItems, insertWixDataItem } from '../lib/wixDataApi';
import { mapWixCaseLogEntryItem, buildWixCaseLogEntryData, type WixCaseLogEntryItem } from '../lib/wixCaseLogEntryMapper';
import { caseLogFixtures } from './__mocks__/fixtures';

const CASE_LOG_COLLECTION = 'caseLogEntries';

/**
 * Raw-field-name leak fix follow-up (2026-10) — this service was
 * mock-only (an in-memory array wiped on every server restart — see the
 * removed comment this replaces, and `types/activityEvent.ts`'s own
 * `CASE_NOTE_ADDED` comment documenting the exact same gap). Now
 * server-only and dual-mode, matching `services/activityService.ts`'s own
 * `record()`/list pattern: `mock` keeps using `caseLogFixtures` (tests,
 * local dev without Wix creds), `wix` persists to the real `caseLogEntries`
 * collection. This file imports `lib/wixDataApi.ts` (server-only, holds
 * WIX_API_KEY) and must never be imported into a Client Component — see
 * `lib/caseLogClient.ts` for the browser-side fetch wrappers that replace
 * every direct import this file used to have from `hooks/useCaseLog.ts`
 * and `components/modals/NewCaseModal.tsx`.
 *
 * SOLIS-wide ALL-CAPS data standard (2026-09). `text`/`contactedWho`/
 * `contactSummary` are staff-entered prose; `author` is the session-derived
 * staff display name and is deliberately never touched here (see the SOLIS
 * ALL-CAPS audit's "staff identity names" exclusion).
 */
function uppercaseIfString(value: string | undefined): string | undefined {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

export async function list(context: OrganizationContext, caseId: string, dataAdapterMode: DataAdapterMode): Promise<CaseLogEntry[]> {
  if (dataAdapterMode === 'mock') {
    return caseLogFixtures.filter((e) => e.organizationId === context.organizationId && e.caseId === caseId);
  }

  const response = await queryWixDataItems<WixCaseLogEntryItem>(CASE_LOG_COLLECTION, {
    filter: { organizationId: context.organizationId, caseId },
    sort: [{ fieldName: 'createdAt', order: 'ASC' }],
  });
  return response.dataItems.map((item) => mapWixCaseLogEntryItem(item.data)).filter((e): e is CaseLogEntry => e !== null);
}

export async function create(
  context: OrganizationContext,
  caseId: string,
  input: NewCaseLogEntryInput,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseLogEntry> {
  const entry: CaseLogEntry = {
    id: crypto.randomUUID(),
    organizationId: context.organizationId,
    caseId,
    type: input.type,
    text: uppercaseIfString(input.text) ?? null,
    contactedWho: uppercaseIfString(input.contactedWho) ?? null,
    contactedSpoke: input.contactedSpoke ?? null,
    contactSummary: uppercaseIfString(input.contactSummary) ?? null,
    author: input.author,
    createdAt: new Date().toISOString(),
  };

  if (dataAdapterMode === 'mock') {
    caseLogFixtures.push(entry);
    return entry;
  }

  await insertWixDataItem<WixCaseLogEntryItem>(CASE_LOG_COLLECTION, buildWixCaseLogEntryData(entry), entry.id);
  return entry;
}

export const caseLogService = { list, create };
