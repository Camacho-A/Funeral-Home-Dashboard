import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import {
  mapWixExternalFormSubmissionItem,
  buildWixExternalFormSubmissionData,
  applyExternalFormSubmissionUpdateToWixData,
  type WixExternalFormSubmissionItem,
} from '../lib/wixExternalFormMapper';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import { externalFormSubmissionId as buildSubmissionId } from '../types/externalFormSubmission';
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
