import { createHash } from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { fetchSubmissionPdf, JotformClientError } from '../lib/jotform/jotformClient';
import { WixDataApiError } from '../lib/wixDataApi';
import { upload as uploadDocument, list as listCaseDocuments } from './documentService';
import * as externalFormSubmissionService from './externalFormSubmissionService';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import type { ExternalFormConfig } from '../types/externalFormConfig';
import { resolveFormLayout } from '../domain/externalForms/formRegistry';
import type { ActivityContext } from './activityService';
import { recordExternalFormPdfStored, recordExternalFormPdfFailed } from './activityService';
import { runAfterResponse } from '../lib/afterResponse';
import { ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY } from '../domain/documents/arrangementPageExtracts';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). PDF
 * preservation is deliberately independent from submission receipt and
 * from structured-field reconciliation — a submission is never "lost"
 * because its PDF retrieval failed (see ExternalFormSubmission's own
 * `pdfStatus` state, tracked separately from `status`).
 *
 * Idempotency: `ExternalFormSubmission.documentId`/`pdfStatus` ARE the
 * dedup mechanism — `pdfStatus === 'stored'` (with a non-null
 * `documentId`) means the original PDF already exists for this exact
 * submission (`organizationId + provider + externalSubmissionId`, the
 * submission's own deterministic id — see types/externalFormSubmission.ts),
 * so a retry (webhook redelivery, manual "Retry PDF" action) is always a
 * safe no-op check, never a second `documentService.upload()` call.
 *
 * (2026-10) That state lives on a DIFFERENT record from the document, so
 * it can be lost between the two writes (upload succeeded, `updatePdfStored`
 * did not), and two callers can both pass the check at once (webhook still
 * running while staff press "Retry PDF"). Either used to store a second
 * copy. So the document id is now derived from the submission
 * (`submissionPdfDocumentId`): before uploading, an existing stored copy
 * for this submission is found and adopted instead, and a concurrent
 * second upload is refused by the insert itself (duplicate id → HTTP 409).
 */

/** A `pending` attempt older than this is treated as abandoned (crashed
    mid-upload) rather than in progress, so it can never block forever. */
const ABANDONED_PENDING_ATTEMPT_MS = 10 * 60 * 1000;

/** Deterministic, fixed-length document id for a submission's PDF — hashed
    so it stays well under Wix's 128-char `_id` cap whatever the
    submission id. Retries after a failed attempt append `-{n}`. */
export function submissionPdfDocumentId(submissionId: string): string {
  return `extform-pdf-${createHash('sha256').update(submissionId).digest('hex').slice(0, 40)}`;
}

/*
 * Document type / display name per form (2026-10 multi-tenant hardening):
 * resolved from the organization-aware form registry
 * (domain/externalForms/formRegistry.ts) rather than a table keyed by
 * Manors' form ids. A form whose organization has no registered layout is
 * filed under the generic `{formId}.pdf` name with no document type —
 * exactly what an unknown form always got.
 */

export type PreservePdfOptions = {
  /** The trusted config the submission came through. When supplied, its
      `mappingKey` selects the layout and its `apiKeyReference` selects the
      Jotform account key. When omitted, the layout is the submission's own
      organization's binding for its form id, and the default key is used. */
  config?: Pick<ExternalFormConfig, 'organizationId' | 'provider' | 'externalFormId' | 'mappingKey' | 'apiKeyReference'> | null;
};

/** `in_progress`: another caller is uploading this submission's PDF right
    now — nothing was uploaded and nothing was marked failed. */
export type PreservePdfResult = { outcome: 'already_stored' | 'stored' | 'failed' | 'in_progress'; documentId: string | null };

/**
 * Retrieves, validates, and stores the original populated Smart PDF Form
 * for a matched submission, through the EXISTING document pipeline
 * (services/documentService.ts#upload) — no second storage system. Safe
 * to call repeatedly for the same submission; never uploads twice.
 */
export async function preservePdfForSubmission(
  submission: ExternalFormSubmission,
  caseId: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
  options: PreservePdfOptions = {},
): Promise<PreservePdfResult> {
  if (submission.pdfStatus === 'stored' && submission.documentId) {
    return { outcome: 'already_stored', documentId: submission.documentId };
  }

  // A supplied config is only honoured when it is genuinely this
  // submission's own config — never a way to borrow another
  // organization's layout or key.
  const config =
    options.config &&
    options.config.organizationId === submission.organizationId &&
    options.config.provider === submission.provider &&
    options.config.externalFormId === submission.externalFormId
      ? options.config
      : null;
  const typeInfo = resolveFormLayout(config ?? submission)?.pdfDocument ?? null;
  const fileName = typeInfo?.displayFileName ?? `${submission.externalFormId}.pdf`;
  const documentTypeKey = typeInfo?.documentTypeKey;

  let document: { id: string };
  try {
    // A copy already stored for this submission (its state update was lost,
    // or another caller finished first) is adopted, never uploaded again.
    const baseDocumentId = submissionPdfDocumentId(submission.id);
    const attempts = (await listCaseDocuments(ctx.organizationId, caseId, dataAdapterMode)).filter(
      (doc) => doc.id === baseDocumentId || doc.id.startsWith(`${baseDocumentId}-`),
    );
    const existing = attempts.find((doc) => doc.status !== 'pending' && doc.status !== 'failed');
    if (existing) {
      await externalFormSubmissionService.updatePdfStored(submission.id, existing.id, dataAdapterMode);
      return { outcome: 'already_stored', documentId: existing.id };
    }
    const now = Date.now();
    if (attempts.some((doc) => doc.status === 'pending' && now - Date.parse(doc.createdAt) < ABANDONED_PENDING_ATTEMPT_MS)) {
      return { outcome: 'in_progress', documentId: null };
    }
    const documentId = attempts.length === 0 ? baseDocumentId : `${baseDocumentId}-${attempts.length + 1}`;

    const buffer = config?.apiKeyReference
      ? await fetchSubmissionPdf(submission.externalFormId, submission.externalSubmissionId, { apiKeyReference: config.apiKeyReference })
      : await fetchSubmissionPdf(submission.externalFormId, submission.externalSubmissionId);

    document = await uploadDocument(
      {
        caseId,
        fileName,
        mimeType: 'application/pdf',
        documentTypeKey,
        idFactory: () => documentId,
      },
      buffer,
      ctx,
      dataAdapterMode,
    );
  } catch (error) {
    // The same id was inserted by a concurrent caller between the check
    // above and this upload: theirs is the copy. Not a failure.
    if (error instanceof WixDataApiError && error.status === 409) {
      return { outcome: 'in_progress', documentId: null };
    }
    console.error('External form PDF preservation failed:', error instanceof Error ? error.message : error);
    // Sanitized — never the raw provider error body, never PDF bytes,
    // never submission content. A JotformClientError's own `category`
    // is safe to persist/report; anything else is reduced to a fixed,
    // generic phrase.
    const sanitizedReason = error instanceof JotformClientError ? `Jotform PDF retrieval failed (${error.category}).` : 'PDF preservation failed unexpectedly.';
    await externalFormSubmissionService.updatePdfFailed(submission.id, sanitizedReason, dataAdapterMode);

    try {
      await recordExternalFormPdfFailed(ctx, caseId, submission.id, sanitizedReason, dataAdapterMode);
    } catch (activityError) {
      console.error('Failed to record external_form.pdf_failed activity event:', activityError instanceof Error ? activityError.message : activityError);
    }

    return { outcome: 'failed', documentId: null };
  }

  // The document now exists. If recording that on the submission fails,
  // it must NOT be reported as a failed retrieval: the next call adopts
  // this copy by its deterministic id instead of storing another.
  try {
    await externalFormSubmissionService.updatePdfStored(submission.id, document.id, dataAdapterMode);
  } catch (error) {
    console.error('Stored external form PDF but could not mark the submission stored:', error instanceof Error ? error.message : error);
  }

  try {
    await recordExternalFormPdfStored(ctx, caseId, submission.id, fileName, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record external_form.pdf_stored activity event:', error instanceof Error ? error.message : error);
  }

  // Send to Crematory (2026-10): an Arrangement Form now on the case —
  // page 3 and, when everything else is confirmed, the Crematory Package
  // are prepared from it, after this response. Nothing is sent.
  if (documentTypeKey === ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY) {
    runAfterResponse('crematory package preparation', async () => {
      const { prepareCrematoryDocuments } = await import('./crematory/crematoryPackageService');
      await prepareCrematoryDocuments(ctx, caseId, dataAdapterMode);
    });
  }

  return { outcome: 'stored', documentId: document.id };
}
