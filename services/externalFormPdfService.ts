import type { DataAdapterMode } from '../lib/env';
import { fetchSubmissionPdf, JotformClientError } from '../lib/jotform/jotformClient';
import { upload as uploadDocument } from './documentService';
import * as externalFormSubmissionService from './externalFormSubmissionService';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import type { ExternalFormConfig } from '../types/externalFormConfig';
import { resolveFormLayout } from '../domain/externalForms/formRegistry';
import type { ActivityContext } from './activityService';
import { recordExternalFormPdfStored, recordExternalFormPdfFailed } from './activityService';

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
 */

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

export type PreservePdfResult = { outcome: 'already_stored' | 'stored' | 'failed'; documentId: string | null };

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

  try {
    const buffer = config?.apiKeyReference
      ? await fetchSubmissionPdf(submission.externalFormId, submission.externalSubmissionId, { apiKeyReference: config.apiKeyReference })
      : await fetchSubmissionPdf(submission.externalFormId, submission.externalSubmissionId);

    const document = await uploadDocument(
      {
        caseId,
        fileName,
        mimeType: 'application/pdf',
        documentTypeKey,
        idFactory: () => crypto.randomUUID(),
      },
      buffer,
      ctx,
      dataAdapterMode,
    );

    await externalFormSubmissionService.updatePdfStored(submission.id, document.id, dataAdapterMode);

    try {
      await recordExternalFormPdfStored(ctx, caseId, submission.id, fileName, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record external_form.pdf_stored activity event:', error instanceof Error ? error.message : error);
    }

    return { outcome: 'stored', documentId: document.id };
  } catch (error) {
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
}
