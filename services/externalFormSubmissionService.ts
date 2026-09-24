import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, conditionalPatchWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import {
  mapWixExternalFormSubmissionItem,
  buildWixExternalFormSubmissionData,
  applyExternalFormSubmissionUpdateToWixData,
  type WixExternalFormSubmissionItem,
} from '../lib/wixExternalFormMapper';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import {
  externalFormSubmissionId as buildSubmissionId,
  buildCaseCreationClaimToken,
  isCaseCreationClaimToken,
} from '../types/externalFormSubmission';
import { externalFormSubmissionFixtures } from './__mocks__/externalFormFixtures';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Sole
 * writer of the `externalFormSubmissions` collection. The deterministic
 * id (`organizationId + provider + externalSubmissionId`) is what makes
 * `receive()` naturally idempotent — a redelivered webhook for the same
 * submission is a duplicate-key conflict, resolved by returning the
 * existing row untouched, never a second insert. Mirrors
 * services/paymentsService.ts's claimWebhookEvent's exact "insert; on
 * conflict, read back and return the existing row" shape.
 */

function nowIso(): string {
  return new Date().toISOString();
}

function isWixConflict(error: unknown): boolean {
  return error instanceof WixDataApiError && error.status === 409;
}

async function getRawById(id: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  if (dataAdapterMode === 'mock') {
    return externalFormSubmissionFixtures.find((s) => s.id === id) ?? null;
  }
  const response = await queryWixDataItems<WixExternalFormSubmissionItem>('externalFormSubmissions', {
    filter: { _id: id },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0];
  return item ? mapWixExternalFormSubmissionItem(item.id, item.data) : null;
}

export async function getById(id: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  return getRawById(id, dataAdapterMode);
}

export type ReceiveSubmissionParams = {
  organizationId: string;
  provider: string;
  externalFormId: string;
  externalSubmissionId: string;
  caseFormLinkId: string | null;
  mappedFields: string;
  /** Only submissions carrying a mapped structured field worth
      preserving get a PDF-retrieval attempt scheduled — matched or
      unmatched, PDF preservation is always attempted independently of
      whether the structured data resolved to a case (see
      services/externalFormPdfService.ts). */
  pdfStatus: 'pending' | 'not_applicable';
};

/** Idempotent by construction — a second call with the same
    (organizationId, provider, externalSubmissionId) returns the
    already-persisted row untouched rather than creating a duplicate or
    throwing. This is the one function a webhook redelivery, or a retry
    of the same delivery, always converges on. */
export async function receive(params: ReceiveSubmissionParams, dataAdapterMode: DataAdapterMode): Promise<{ submission: ExternalFormSubmission; wasNew: boolean }> {
  const id = buildSubmissionId(params.organizationId, params.provider, params.externalSubmissionId);
  const now = nowIso();
  const submission: ExternalFormSubmission = {
    id,
    organizationId: params.organizationId,
    provider: params.provider,
    externalFormId: params.externalFormId,
    externalSubmissionId: params.externalSubmissionId,
    caseFormLinkId: params.caseFormLinkId,
    status: params.caseFormLinkId ? 'matched' : 'unmatched',
    mappedFields: params.mappedFields,
    receivedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    documentId: null,
    pdfStatus: params.pdfStatus,
    pdfFailureReason: null,
    createdCaseId: null,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    const existing = externalFormSubmissionFixtures.find((s) => s.id === id);
    if (existing) return { submission: existing, wasNew: false };
    externalFormSubmissionFixtures.push(submission);
    return { submission, wasNew: true };
  }

  try {
    const inserted = await insertWixDataItem<WixExternalFormSubmissionItem>('externalFormSubmissions', buildWixExternalFormSubmissionData(submission), id);
    const mapped = mapWixExternalFormSubmissionItem(inserted.id, inserted.data);
    if (!mapped) throw new Error('Failed to create external form submission.');
    return { submission: mapped, wasNew: true };
  } catch (error) {
    if (!isWixConflict(error)) throw error;
    const existing = await getRawById(id, dataAdapterMode);
    if (!existing) throw error;
    return { submission: existing, wasNew: false };
  }
}

export async function listUnmatched(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission[]> {
  if (dataAdapterMode === 'mock') {
    return externalFormSubmissionFixtures.filter((s) => s.organizationId === organizationId && s.status === 'unmatched');
  }
  const response = await queryWixDataItems<WixExternalFormSubmissionItem>('externalFormSubmissions', {
    filter: { organizationId, status: 'unmatched' },
  });
  return response.dataItems.map((item) => mapWixExternalFormSubmissionItem(item.id, item.data)).filter((s): s is ExternalFormSubmission => s !== null);
}

async function persistUpdate(id: string, patch: Partial<ExternalFormSubmission>, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  const withTimestamp = { ...patch, updatedAt: nowIso() };
  if (dataAdapterMode === 'mock') {
    const index = externalFormSubmissionFixtures.findIndex((s) => s.id === id);
    if (index === -1) return null;
    externalFormSubmissionFixtures[index] = { ...externalFormSubmissionFixtures[index], ...withTimestamp };
    return externalFormSubmissionFixtures[index];
  }
  const response = await queryWixDataItems<WixExternalFormSubmissionItem>('externalFormSubmissions', { filter: { _id: id }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyExternalFormSubmissionUpdateToWixData(existingItem.data, withTimestamp);
  const updated = await updateWixDataItem<WixExternalFormSubmissionItem>('externalFormSubmissions', existingItem.id, merged);
  return mapWixExternalFormSubmissionItem(updated.id, updated.data);
}

/** The manual-linking path (Unmatched Forms → Link to Case) — never
    allocates a case number, never creates a case; `caseFormLinkId` here
    always names an *existing* CaseFormLink resolved by the caller first
    (see services/caseFormLinkService.ts#linkExistingSubmission). */
export async function markLinked(id: string, caseFormLinkId: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  return persistUpdate(id, { status: 'matched', caseFormLinkId }, dataAdapterMode);
}

export async function markReviewed(id: string, reviewedBy: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  return persistUpdate(id, { status: 'reviewed', reviewedAt: nowIso(), reviewedBy }, dataAdapterMode);
}

export async function updatePdfStored(id: string, documentId: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  return persistUpdate(id, { pdfStatus: 'stored', documentId, pdfFailureReason: null }, dataAdapterMode);
}

export async function updatePdfFailed(id: string, sanitizedReason: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  return persistUpdate(id, { pdfStatus: 'failed', pdfFailureReason: sanitizedReason }, dataAdapterMode);
}

export async function updatePdfPending(id: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  return persistUpdate(id, { pdfStatus: 'pending', pdfFailureReason: null }, dataAdapterMode);
}

export type CaseCreationClaimResult =
  | { claimed: true; claimToken: string }
  | { claimed: false; existingCaseId: string | null; stillClaiming: boolean };

/**
 * Historical-case-creation (2026-09). Attempts to claim the right to
 * create a NEW Solis case for this submission — a compare-and-swap style
 * fence against `createdCaseId`, closing the race window a plain "read
 * createdCaseId, see it's null, proceed" check would leave open under two
 * concurrent requests. Live-verified against the real Wix project (see
 * lib/wixDataApi.ts#conditionalPatchWixDataItem's own doc comment for the
 * full account, including the `$eq: null` vs. `$isEmpty` finding this
 * function's filter reflects).
 *
 * Only ever call this after `receive()` has already resolved the row and
 * its `status` is confirmed `'unmatched'` — this function assumes the row
 * already exists (see the historical-import route's own resolution
 * order).
 *
 * Returns `{claimed: true, claimToken}` if this call won the race — the
 * caller may proceed to create a case, and must pass `claimToken` back to
 * `revertCaseCreationClaim` if that creation attempt fails. Returns
 * `{claimed: false, ...}` otherwise: `existingCaseId` is the real case id
 * if one already exists (resume linking with it, never create a new
 * one), or `null` with `stillClaiming: true` if another request's claim
 * is currently in flight (report "still being processed" — never an
 * error, never a second case).
 */
export async function claimForCaseCreation(id: string, dataAdapterMode: DataAdapterMode): Promise<CaseCreationClaimResult> {
  const claimToken = buildCaseCreationClaimToken(crypto.randomUUID());

  if (dataAdapterMode === 'mock') {
    // Fully synchronous check-and-set — no await between the read and the
    // write, so this is race-free within a single Node process the same
    // way every other mock-mode "concurrency" primitive in this codebase
    // is (see receive()'s own insert-or-return mock-mode branch).
    const index = externalFormSubmissionFixtures.findIndex((s) => s.id === id);
    if (index === -1) throw new Error(`No ExternalFormSubmission found for id "${id}".`);
    const current = externalFormSubmissionFixtures[index];
    if (current.createdCaseId === null) {
      externalFormSubmissionFixtures[index] = { ...current, createdCaseId: claimToken, updatedAt: nowIso() };
      return { claimed: true, claimToken };
    }
    if (isCaseCreationClaimToken(current.createdCaseId)) {
      return { claimed: false, existingCaseId: null, stillClaiming: true };
    }
    return { claimed: false, existingCaseId: current.createdCaseId, stillClaiming: false };
  }

  const result = await conditionalPatchWixDataItem<WixExternalFormSubmissionItem>(
    'externalFormSubmissions',
    id,
    'createdCaseId',
    claimToken,
    // Live-verified (2026-09): Wix's condition.filter rejects $isEmpty
    // outright (WDE0076, a hard validation error, not "condition not
    // met") — $eq: null is the operator that actually works, confirmed
    // empirically against the real Wix project (a synthetic disposable
    // row, 8 concurrent-claim rounds, exactly one winner every round).
    { filter: { createdCaseId: { $eq: null } } },
  );
  if (result.applied) return { claimed: true, claimToken };

  // Lost the race (or the field wasn't actually empty) — re-read the
  // current, authoritative value rather than trusting the failure alone.
  const reread = await queryWixDataItems<WixExternalFormSubmissionItem>('externalFormSubmissions', {
    filter: { _id: id },
    paging: { limit: 1 },
  });
  const currentValue = reread.dataItems[0]?.data.createdCaseId;
  if (typeof currentValue !== 'string') {
    return { claimed: false, existingCaseId: null, stillClaiming: true };
  }
  if (isCaseCreationClaimToken(currentValue)) {
    return { claimed: false, existingCaseId: null, stillClaiming: true };
  }
  return { claimed: false, existingCaseId: currentValue, stillClaiming: false };
}

/**
 * Reverts a claim only if it still matches the exact token this caller
 * itself set — never a blind unconditional clear, so this can never
 * clobber a different, concurrently-claimed value. Only ever called after
 * a case-creation ATTEMPT fails, so a future retry can claim again
 * cleanly rather than being permanently stuck.
 */
export async function revertCaseCreationClaim(id: string, claimToken: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = externalFormSubmissionFixtures.findIndex((s) => s.id === id);
    if (index === -1) return;
    if (externalFormSubmissionFixtures[index].createdCaseId === claimToken) {
      externalFormSubmissionFixtures[index] = { ...externalFormSubmissionFixtures[index], createdCaseId: null, updatedAt: nowIso() };
    }
    return;
  }
  await conditionalPatchWixDataItem('externalFormSubmissions', id, 'createdCaseId', null, {
    filter: { createdCaseId: { $eq: claimToken } },
  });
}

/** Persists the real, newly-created case id — the crash-recovery
    checkpoint. Called immediately after case creation succeeds, before
    anything else (linking, PDF preservation) is attempted. */
export async function markCaseCreated(id: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormSubmission | null> {
  return persistUpdate(id, { createdCaseId: caseId }, dataAdapterMode);
}
