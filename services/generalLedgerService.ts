import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, deleteWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import {
  mapWixJournalEntryItem,
  buildWixJournalEntryData,
  applyJournalEntryUpdateToWixData,
  type WixJournalEntryItem,
} from '../lib/wixJournalEntryMapper';
import { mapWixJournalEntryLineItem, buildWixJournalEntryLineData, type WixJournalEntryLineItem } from '../lib/wixJournalEntryLineMapper';
import type { JournalEntry, JournalEntryLine, JournalEntrySourceType } from '../types/journalEntry';
import { assertJournalEntryBalances, type JournalEntryLineInput } from '../domain/ledger/balancing';
import { journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';

/**
 * Phase 31 (Financial Management & General Ledger). Owns the
 * `journalEntries`/`journalEntryLines` collections exclusively — the one
 * orchestration layer every financial transaction (payment, refund,
 * write-off, adjustment, deposit, transfer) posts through via
 * `createAndPostJournalEntry`. See
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * No caching — mirrors services/permissionService.ts's own explicit
 * no-cache rule; `getAccountBalance`/`getTrialBalance` always sum posted
 * lines fresh, every call, since a balance here is never a stored field
 * (that's the whole point of this phase's "no direct balance fields"
 * principle).
 */
export class GeneralLedgerServiceError extends Error {}
export class JournalEntryReversalError extends GeneralLedgerServiceError {}

const MAX_ENTRY_NUMBER_RETRIES = 5;
const ENTRY_NUMBER_WIDTH = 6;

function nowIso(): string {
  return new Date().toISOString();
}

function entryNumberKeyFor(organizationId: string, entryNumber: string): string {
  return `${organizationId}:${entryNumber}`;
}

function isWixConflict(error: unknown): boolean {
  return error instanceof WixDataApiError && error.status === 409;
}

async function highestExistingEntryNumber(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<string | null> {
  if (dataAdapterMode === 'mock') {
    const entries = journalEntryFixtures.filter((e) => e.organizationId === organizationId);
    if (entries.length === 0) return null;
    return entries.map((e) => e.entryNumber).sort().at(-1) ?? null;
  }
  const response = await queryWixDataItems<WixJournalEntryItem>('journalEntries', {
    filter: { organizationId },
    sort: [{ fieldName: 'entryNumber', order: 'DESC' }],
    paging: { limit: 1 },
  });
  const mapped = mapWixJournalEntryItem(response.dataItems[0]?.data);
  return mapped?.entryNumber ?? null;
}

function nextEntryNumber(current: string | null): string {
  const currentSequence = current ? Number.parseInt(current.replace(/^JE-/, ''), 10) : 0;
  const next = (Number.isFinite(currentSequence) ? currentSequence : 0) + 1;
  return `JE-${String(next).padStart(ENTRY_NUMBER_WIDTH, '0')}`;
}

async function insertJournalEntryRow(entry: JournalEntry, dataAdapterMode: DataAdapterMode): Promise<JournalEntry> {
  if (dataAdapterMode === 'mock') {
    if (journalEntryFixtures.some((e) => e.organizationId === entry.organizationId && e.entryNumber === entry.entryNumber)) {
      const conflictError = new WixDataApiError('Duplicate entry number.', 409);
      throw conflictError;
    }
    journalEntryFixtures.push(entry);
    return entry;
  }
  const inserted = await insertWixDataItem<WixJournalEntryItem>('journalEntries', buildWixJournalEntryData(entry), entry.id);
  const mapped = mapWixJournalEntryItem(inserted.data);
  if (!mapped) throw new GeneralLedgerServiceError('Failed to create journal entry.');
  return mapped;
}

async function insertJournalEntryLineRow(line: JournalEntryLine, dataAdapterMode: DataAdapterMode): Promise<JournalEntryLine> {
  if (dataAdapterMode === 'mock') {
    journalEntryLineFixtures.push(line);
    return line;
  }
  await insertWixDataItem<WixJournalEntryLineItem>('journalEntryLines', buildWixJournalEntryLineData(line), line.id);
  return line;
}

/**
 * Generates a unique `entryNumber` and inserts the `JournalEntry` header
 * row, retrying on a genuine conflict (two concurrent posts both trying
 * to claim the same number) up to `MAX_ENTRY_NUMBER_RETRIES` times — see
 * types/journalEntry.ts's own comment on why `entryNumberKey`, not
 * `entryNumber` itself, is where the real Wix insert-conflict guarantee
 * lives.
 */
async function insertEntryWithRetry(
  organizationId: string,
  buildEntry: (entryNumber: string) => JournalEntry,
  dataAdapterMode: DataAdapterMode,
): Promise<JournalEntry> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ENTRY_NUMBER_RETRIES; attempt += 1) {
    const highest = await highestExistingEntryNumber(organizationId, dataAdapterMode);
    const entryNumber = nextEntryNumber(highest);
    const entry = buildEntry(entryNumber);
    try {
      return await insertJournalEntryRow(entry, dataAdapterMode);
    } catch (error) {
      if (!isWixConflict(error)) throw error;
      lastError = error;
    }
  }
  throw new GeneralLedgerServiceError(
    `Failed to generate a unique journal entry number after ${MAX_ENTRY_NUMBER_RETRIES} attempts.`,
    { cause: lastError },
  );
}

async function insertLinesCompensatingOnFailure(
  entry: JournalEntry,
  lineInputs: readonly NewJournalEntryLineInput[],
  dataAdapterMode: DataAdapterMode,
  now: string,
): Promise<JournalEntryLine[]> {
  const inserted: JournalEntryLine[] = [];
  try {
    for (let i = 0; i < lineInputs.length; i += 1) {
      const input = lineInputs[i];
      const line: JournalEntryLine = {
        id: `${entry.id}-line-${i + 1}`,
        organizationId: entry.organizationId,
        journalEntryId: entry.id,
        lineNumber: i + 1,
        accountId: input.accountId,
        direction: input.direction,
        amount: input.amount,
        caseId: input.caseId ?? null,
        description: input.description ?? null,
        createdAt: now,
      };
      inserted.push(await insertJournalEntryLineRow(line, dataAdapterMode));
    }
    return inserted;
  } catch (error) {
    // Honest, disclosed limitation (mirrors organizationLockService.ts's own
    // disclosed residual gap): Wix Data has no multi-item transaction. If a
    // line insert fails partway through, we compensate by posting a
    // reversing entry for whatever succeeded, rather than pretending a true
    // rollback occurred — never leaving the ledger in a silently
    // half-written state without at least attempting to net it back to
    // zero and recording that this happened.
    if (inserted.length > 0) {
      const reversalNow = nowIso();
      for (let i = 0; i < inserted.length; i += 1) {
        const original = inserted[i];
        const reversalLine: JournalEntryLine = {
          id: `${entry.id}-compensation-${i + 1}`,
          organizationId: entry.organizationId,
          journalEntryId: entry.id,
          lineNumber: inserted.length + i + 1,
          accountId: original.accountId,
          direction: original.direction === 'debit' ? 'credit' : 'debit',
          amount: original.amount,
          caseId: original.caseId,
          description: `Compensating line — original entry ${entry.entryNumber} failed to post completely.`,
          createdAt: reversalNow,
        };
        await insertJournalEntryLineRow(reversalLine, dataAdapterMode);
      }
    }
    throw new GeneralLedgerServiceError(
      `Journal entry ${entry.entryNumber} failed to post all lines; any lines that did succeed have been compensated.`,
      { cause: error },
    );
  }
}

export type NewJournalEntryLineInput = JournalEntryLineInput & {
  accountId: string;
  caseId?: string | null;
  description?: string | null;
};

export type CreateAndPostJournalEntryParams = {
  entryDate: string;
  sourceType: JournalEntrySourceType;
  sourceReferenceId?: string | null;
  caseId?: string | null;
  memo: string;
  lines: NewJournalEntryLineInput[];
  postedByStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

/**
 * The one-shot path every system-generated transaction (payment, refund,
 * write-off, adjustment, deposit, transfer, reversal, opening balance)
 * uses — validates balancing BEFORE any write is attempted, then creates
 * an already-`posted` entry with its lines. Never used for a `manual`
 * entry, which goes through `createDraftJournalEntry` +
 * `updateDraftJournalEntryLines` + `postJournalEntry` instead, so a
 * preparer can review before posting.
 */
export async function createAndPostJournalEntry(
  organizationId: string,
  params: CreateAndPostJournalEntryParams,
  dataAdapterMode: DataAdapterMode,
): Promise<{ entry: JournalEntry; lines: JournalEntryLine[] }> {
  assertJournalEntryBalances(params.lines);

  const now = params.now ?? nowIso();
  const entry = await insertEntryWithRetry(
    organizationId,
    (entryNumber) => ({
      id: params.idFactory(),
      organizationId,
      entryNumber,
      entryNumberKey: entryNumberKeyFor(organizationId, entryNumber),
      entryDate: params.entryDate,
      status: 'posted',
      sourceType: params.sourceType,
      sourceReferenceId: params.sourceReferenceId ?? null,
      caseId: params.caseId ?? null,
      memo: params.memo,
      reversesEntryId: null,
      postedAt: now,
      postedByStaffProfileId: params.postedByStaffProfileId ?? null,
      createdAt: now,
      updatedAt: now,
    }),
    dataAdapterMode,
  );

  const lines = await insertLinesCompensatingOnFailure(entry, params.lines, dataAdapterMode, now);
  return { entry, lines };
}

export type CreateDraftJournalEntryParams = {
  entryDate: string;
  memo: string;
  caseId?: string | null;
  idFactory: () => string;
  now?: string;
};

/** Only entry point for a `manual` entry — created as `draft`, with no
    lines yet; use `updateDraftJournalEntryLines` to compose them, then
    `postJournalEntry` to finalize. */
export async function createDraftJournalEntry(
  organizationId: string,
  params: CreateDraftJournalEntryParams,
  dataAdapterMode: DataAdapterMode,
): Promise<JournalEntry> {
  const now = params.now ?? nowIso();
  return insertEntryWithRetry(
    organizationId,
    (entryNumber) => ({
      id: params.idFactory(),
      organizationId,
      entryNumber,
      entryNumberKey: entryNumberKeyFor(organizationId, entryNumber),
      entryDate: params.entryDate,
      status: 'draft',
      sourceType: 'manual',
      sourceReferenceId: null,
      caseId: params.caseId ?? null,
      memo: params.memo,
      reversesEntryId: null,
      postedAt: null,
      postedByStaffProfileId: null,
      createdAt: now,
      updatedAt: now,
    }),
    dataAdapterMode,
  );
}

async function getEntryRow(organizationId: string, entryId: string, dataAdapterMode: DataAdapterMode): Promise<JournalEntry | null> {
  if (dataAdapterMode === 'mock') {
    return journalEntryFixtures.find((e) => e.id === entryId && e.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixJournalEntryItem>('journalEntries', {
    filter: { organizationId, beaconJournalEntryId: entryId },
    paging: { limit: 1 },
  });
  return mapWixJournalEntryItem(response.dataItems[0]?.data);
}

async function listLinesForEntry(organizationId: string, entryId: string, dataAdapterMode: DataAdapterMode): Promise<JournalEntryLine[]> {
  if (dataAdapterMode === 'mock') {
    return journalEntryLineFixtures
      .filter((l) => l.organizationId === organizationId && l.journalEntryId === entryId)
      .sort((a, b) => a.lineNumber - b.lineNumber);
  }
  const response = await queryWixDataItems<WixJournalEntryLineItem>('journalEntryLines', {
    filter: { organizationId, journalEntryId: entryId },
  });
  return response.dataItems
    .map((item) => mapWixJournalEntryLineItem(item.data))
    .filter((l): l is JournalEntryLine => l !== null)
    .sort((a, b) => a.lineNumber - b.lineNumber);
}

async function replaceDraftLines(
  organizationId: string,
  entryId: string,
  lineInputs: readonly NewJournalEntryLineInput[],
  dataAdapterMode: DataAdapterMode,
  now: string,
): Promise<JournalEntryLine[]> {
  if (dataAdapterMode === 'mock') {
    for (let i = journalEntryLineFixtures.length - 1; i >= 0; i -= 1) {
      if (journalEntryLineFixtures[i].organizationId === organizationId && journalEntryLineFixtures[i].journalEntryId === entryId) {
        journalEntryLineFixtures.splice(i, 1);
      }
    }
  }
  const lines: JournalEntryLine[] = lineInputs.map((input, i) => ({
    id: `${entryId}-line-${i + 1}-${now}`,
    organizationId,
    journalEntryId: entryId,
    lineNumber: i + 1,
    accountId: input.accountId,
    direction: input.direction,
    amount: input.amount,
    caseId: input.caseId ?? null,
    description: input.description ?? null,
    createdAt: now,
  }));

  if (dataAdapterMode === 'mock') {
    journalEntryLineFixtures.push(...lines);
    return lines;
  }

  // wix mode: draft lines this phase are only ever replaced before the
  // entry is ever posted, so a delete-then-reinsert (rather than an
  // in-place update) is safe — no other reader has ever seen the old set.
  const existingResponse = await queryWixDataItems<WixJournalEntryLineItem>('journalEntryLines', {
    filter: { organizationId, journalEntryId: entryId },
  });
  for (const item of existingResponse.dataItems) {
    await deleteWixDataItem('journalEntryLines', item.id);
  }
  for (const line of lines) {
    await insertJournalEntryLineRow(line, dataAdapterMode);
  }
  return lines;
}

/** Replaces a draft entry's lines wholesale — the only mutation ever
    allowed on `journalEntryLines`, and only while the parent entry's
    `status === 'draft'`. Does NOT validate balancing (that happens at
    `postJournalEntry` time, so a preparer can save incomplete work
    mid-edit without being blocked). */
export async function updateDraftJournalEntryLines(
  organizationId: string,
  entryId: string,
  lines: NewJournalEntryLineInput[],
  dataAdapterMode: DataAdapterMode,
): Promise<JournalEntryLine[]> {
  const entry = await getEntryRow(organizationId, entryId, dataAdapterMode);
  if (!entry) throw new GeneralLedgerServiceError(`No journal entry "${entryId}" exists in this organization.`);
  if (entry.status !== 'draft') {
    throw new GeneralLedgerServiceError(`Journal entry ${entry.entryNumber} is not a draft and can no longer be edited.`);
  }
  return replaceDraftLines(organizationId, entryId, lines, dataAdapterMode, nowIso());
}

async function updateEntryRow(
  organizationId: string,
  entryId: string,
  patch: Partial<Pick<JournalEntry, 'status' | 'postedAt' | 'postedByStaffProfileId' | 'updatedAt'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<JournalEntry> {
  if (dataAdapterMode === 'mock') {
    const index = journalEntryFixtures.findIndex((e) => e.id === entryId && e.organizationId === organizationId);
    if (index === -1) throw new GeneralLedgerServiceError(`No journal entry "${entryId}" exists in this organization.`);
    journalEntryFixtures[index] = { ...journalEntryFixtures[index], ...patch };
    return journalEntryFixtures[index];
  }
  const response = await queryWixDataItems<WixJournalEntryItem>('journalEntries', {
    filter: { organizationId, beaconJournalEntryId: entryId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new GeneralLedgerServiceError(`No journal entry "${entryId}" exists in this organization.`);
  const merged = applyJournalEntryUpdateToWixData(existingItem.data, patch);
  const updated = await updateWixDataItem<WixJournalEntryItem>('journalEntries', existingItem.id, merged);
  const mapped = mapWixJournalEntryItem(updated.data);
  if (!mapped) throw new GeneralLedgerServiceError('Failed to update journal entry.');
  return mapped;
}

/** Posts a draft entry — validates balancing against its current lines
    first; the entry and every line become permanently immutable the
    moment this succeeds. */
export async function postJournalEntry(
  organizationId: string,
  entryId: string,
  postedByStaffProfileId: string | null,
  dataAdapterMode: DataAdapterMode,
): Promise<JournalEntry> {
  const entry = await getEntryRow(organizationId, entryId, dataAdapterMode);
  if (!entry) throw new GeneralLedgerServiceError(`No journal entry "${entryId}" exists in this organization.`);
  if (entry.status !== 'draft') {
    throw new GeneralLedgerServiceError(`Journal entry ${entry.entryNumber} is not a draft and cannot be posted again.`);
  }

  const lines = await listLinesForEntry(organizationId, entryId, dataAdapterMode);
  assertJournalEntryBalances(lines);

  const now = nowIso();
  return updateEntryRow(organizationId, entryId, { status: 'posted', postedAt: now, postedByStaffProfileId, updatedAt: now }, dataAdapterMode);
}

/** Voids a draft entry — the only way to discard one; a posted entry is
    never voided, only reversed (see `reverseJournalEntry`). */
export async function voidDraftJournalEntry(organizationId: string, entryId: string, dataAdapterMode: DataAdapterMode): Promise<JournalEntry> {
  const entry = await getEntryRow(organizationId, entryId, dataAdapterMode);
  if (!entry) throw new GeneralLedgerServiceError(`No journal entry "${entryId}" exists in this organization.`);
  if (entry.status !== 'draft') {
    throw new GeneralLedgerServiceError(`Journal entry ${entry.entryNumber} is not a draft and cannot be voided.`);
  }
  return updateEntryRow(organizationId, entryId, { status: 'void', updatedAt: nowIso() }, dataAdapterMode);
}

/**
 * Reverses a posted entry — the only way to correct one, per this phase's
 * "financial history is immutable, corrections are reversing entries"
 * principle. Never mutates the original; posts a new entry whose lines
 * are an exact mirror with `direction` flipped, referencing the original
 * via `reversesEntryId` (a forward-only reference — see
 * types/journalEntry.ts's own comment). Refuses to reverse an entry that
 * isn't posted, or one that's already been reversed (one reversal per
 * entry; re-reversing an already-reversed entry is a named, deferred edge
 * case — see docs/adr/ADR-035's Deferred section).
 */
export async function reverseJournalEntry(
  organizationId: string,
  entryId: string,
  params: { reason: string; performedByStaffProfileId: string | null; idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ entry: JournalEntry; lines: JournalEntryLine[] }> {
  const original = await getEntryRow(organizationId, entryId, dataAdapterMode);
  if (!original) throw new GeneralLedgerServiceError(`No journal entry "${entryId}" exists in this organization.`);
  if (original.status !== 'posted') {
    throw new JournalEntryReversalError(`Journal entry ${original.entryNumber} is not posted and cannot be reversed.`);
  }

  const existingReversal =
    dataAdapterMode === 'mock'
      ? journalEntryFixtures.find((e) => e.organizationId === organizationId && e.reversesEntryId === entryId)
      : mapWixJournalEntryItem(
          (
            await queryWixDataItems<WixJournalEntryItem>('journalEntries', {
              filter: { organizationId, reversesEntryId: entryId },
              paging: { limit: 1 },
            })
          ).dataItems[0]?.data,
        );
  if (existingReversal) {
    throw new JournalEntryReversalError(`Journal entry ${original.entryNumber} has already been reversed.`);
  }

  const originalLines = await listLinesForEntry(organizationId, entryId, dataAdapterMode);
  const reversedLineInputs: NewJournalEntryLineInput[] = originalLines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction === 'debit' ? 'credit' : 'debit',
    amount: line.amount,
    caseId: line.caseId,
    description: `Reversal of ${original.entryNumber}: ${line.description ?? ''}`.trim(),
  }));

  const result = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: params.now ?? nowIso(),
      sourceType: 'reversal',
      sourceReferenceId: original.id,
      caseId: original.caseId,
      memo: `Reversal of ${original.entryNumber}: ${params.reason}`,
      lines: reversedLineInputs,
      postedByStaffProfileId: params.performedByStaffProfileId,
      idFactory: params.idFactory,
      now: params.now,
    },
    dataAdapterMode,
  );

  // `reversesEntryId` can only be known once the new entry itself has been
  // assigned an id (createAndPostJournalEntry doesn't accept it as an
  // input), so it's stamped on in this one extra, immediately-following
  // update — the entry is otherwise fully posted and correct the instant
  // createAndPostJournalEntry above returns; this only records the
  // forward-only reversal linkage (see types/journalEntry.ts's own
  // comment on why that reference lives only on the reversing entry).
  if (dataAdapterMode === 'mock') {
    const index = journalEntryFixtures.findIndex((e) => e.id === result.entry.id);
    journalEntryFixtures[index] = { ...journalEntryFixtures[index], reversesEntryId: original.id };
    return { entry: journalEntryFixtures[index], lines: result.lines };
  }

  const response = await queryWixDataItems<WixJournalEntryItem>('journalEntries', {
    filter: { organizationId, beaconJournalEntryId: result.entry.id },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new GeneralLedgerServiceError('Failed to record reversal linkage.');
  const merged: WixJournalEntryItem = { ...existingItem.data, reversesEntryId: original.id };
  const updated = await updateWixDataItem<WixJournalEntryItem>('journalEntries', existingItem.id, merged);
  const mapped = mapWixJournalEntryItem(updated.data);
  if (!mapped) throw new GeneralLedgerServiceError('Failed to record reversal linkage.');
  return { entry: mapped, lines: result.lines };
}

export async function getJournalEntryWithLines(
  organizationId: string,
  entryId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ entry: JournalEntry; lines: JournalEntryLine[] } | null> {
  const entry = await getEntryRow(organizationId, entryId, dataAdapterMode);
  if (!entry) return null;
  const lines = await listLinesForEntry(organizationId, entryId, dataAdapterMode);
  return { entry, lines };
}

export async function listJournalEntriesForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<JournalEntry[]> {
  if (dataAdapterMode === 'mock') {
    return journalEntryFixtures
      .filter((e) => e.organizationId === organizationId && e.caseId === caseId)
      .sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
  }
  const response = await queryWixDataItems<WixJournalEntryItem>('journalEntries', { filter: { organizationId, caseId } });
  return response.dataItems
    .map((item) => mapWixJournalEntryItem(item.data))
    .filter((e): e is JournalEntry => e !== null)
    .sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
}

export async function listJournalEntriesForOrganization(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options?: { fromDate?: string; toDate?: string },
): Promise<JournalEntry[]> {
  let entries: JournalEntry[];
  if (dataAdapterMode === 'mock') {
    entries = journalEntryFixtures.filter((e) => e.organizationId === organizationId);
  } else {
    const response = await queryWixDataItems<WixJournalEntryItem>('journalEntries', { filter: { organizationId } });
    entries = response.dataItems.map((item) => mapWixJournalEntryItem(item.data)).filter((e): e is JournalEntry => e !== null);
  }
  return entries
    .filter((e) => (options?.fromDate ? e.entryDate >= options.fromDate : true))
    .filter((e) => (options?.toDate ? e.entryDate <= options.toDate : true))
    .sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
}

/** Every `JournalEntryLine` posted against one account, regardless of
    date — used both by `getAccountBalance` below and by
    `services/bankingService.ts#runAutoMatch`, which cross-references
    these against each line's own parent `JournalEntry.entryDate` (via
    `listJournalEntriesForOrganization`) for its ±3-day matching window,
    rather than this file growing a second, entry-date-aware query. */
export async function listAllLinesForAccount(
  organizationId: string,
  accountId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<JournalEntryLine[]> {
  if (dataAdapterMode === 'mock') {
    return journalEntryLineFixtures.filter((l) => l.organizationId === organizationId && l.accountId === accountId);
  }
  const response = await queryWixDataItems<WixJournalEntryLineItem>('journalEntryLines', { filter: { organizationId, accountId } });
  return response.dataItems.map((item) => mapWixJournalEntryLineItem(item.data)).filter((l): l is JournalEntryLine => l !== null);
}

/**
 * The one derived-balance primitive every report reuses — always sums
 * `journalEntryLines` belonging to *posted* entries fresh, every call,
 * never a stored/cached figure (never uses the documented-unsafe Wix
 * `COUNT` endpoint either — always a real fetch-and-sum). `asOfDate`
 * restricts to entries dated on/before it, for a point-in-time balance
 * (e.g. a prior month's Trial Balance); omitted, it's the current balance.
 */
export async function getAccountBalance(
  organizationId: string,
  accountId: string,
  dataAdapterMode: DataAdapterMode,
  asOfDate?: string,
): Promise<number> {
  const lines = await listAllLinesForAccount(organizationId, accountId, dataAdapterMode);
  const postedEntryIds = new Set(
    (await listJournalEntriesForOrganization(organizationId, dataAdapterMode))
      .filter((e) => e.status === 'posted')
      .filter((e) => (asOfDate ? e.entryDate <= asOfDate : true))
      .map((e) => e.id),
  );
  let balance = 0;
  for (const line of lines) {
    if (!postedEntryIds.has(line.journalEntryId)) continue;
    balance += line.direction === 'debit' ? line.amount : -line.amount;
  }
  return balance;
}

export type TrialBalanceRow = { accountId: string; debitTotal: number; creditTotal: number };

/**
 * Sums every posted line, grouped by account, split into debit/credit
 * column totals (not netted) — the raw shape a Trial Balance report
 * displays directly. `services/financialReportsService.ts#getTrialBalance`
 * joins this against `chartOfAccountsService.ts` for account
 * numbers/names; this function itself never reads the chart of accounts.
 */
export async function getTrialBalance(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  asOfDate?: string,
): Promise<TrialBalanceRow[]> {
  const entries = (await listJournalEntriesForOrganization(organizationId, dataAdapterMode))
    .filter((e) => e.status === 'posted')
    .filter((e) => (asOfDate ? e.entryDate <= asOfDate : true));
  const postedEntryIds = new Set(entries.map((e) => e.id));

  const allLines =
    dataAdapterMode === 'mock'
      ? journalEntryLineFixtures.filter((l) => l.organizationId === organizationId)
      : (
          await queryWixDataItems<WixJournalEntryLineItem>('journalEntryLines', { filter: { organizationId } })
        ).dataItems.map((item) => mapWixJournalEntryLineItem(item.data)).filter((l): l is JournalEntryLine => l !== null);

  const totals = new Map<string, TrialBalanceRow>();
  for (const line of allLines) {
    if (!postedEntryIds.has(line.journalEntryId)) continue;
    const row = totals.get(line.accountId) ?? { accountId: line.accountId, debitTotal: 0, creditTotal: 0 };
    if (line.direction === 'debit') row.debitTotal += line.amount;
    else row.creditTotal += line.amount;
    totals.set(line.accountId, row);
  }
  return Array.from(totals.values());
}
