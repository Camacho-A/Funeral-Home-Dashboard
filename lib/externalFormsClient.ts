/**
 * Manors Jotform integration (case-first architecture, 2026-09). Client-side
 * fetch wrappers around this integration's own Route Handlers — mirrors
 * lib/identityAuthClient.ts's exact shape and error-surfacing convention.
 */
import type { ExternalFormConfig } from '@/types/externalFormConfig';
import type { CaseFormLinkStatus } from '@/types/caseFormLink';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import type { ReconciliationRow } from '@/domain/externalForms/reconciliation';

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export type CaseFormRow = {
  config: ExternalFormConfig;
  status: CaseFormLinkStatus;
  sentAt: string | null;
  submissionId: string | null;
};

export async function fetchCaseForms(organizationId: string, caseId: string): Promise<CaseFormRow[]> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/forms?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.forms as CaseFormRow[]) ?? [];
}

export async function generateFormLink(organizationId: string, caseId: string, formConfigId: string): Promise<{ prefillUrl: string }> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/forms/${encodeURIComponent(formConfigId)}/generate-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return { prefillUrl: body.prefillUrl as string };
}

export async function fetchUnmatchedSubmissions(organizationId: string): Promise<ExternalFormSubmission[]> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/external-form-submissions?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.submissions as ExternalFormSubmission[]) ?? [];
}

export async function linkSubmissionToCase(organizationId: string, submissionId: string, caseId: string): Promise<void> {
  const response = await fetch(`/api/external-form-submissions/${encodeURIComponent(submissionId)}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, caseId }),
  });
  await parseJsonOrThrow(response);
}

export async function fetchReconciliation(
  organizationId: string,
  submissionId: string,
  caseId: string,
): Promise<{ rows: ReconciliationRow[] }> {
  const params = new URLSearchParams({ organizationId, caseId });
  const response = await fetch(`/api/external-form-submissions/${encodeURIComponent(submissionId)}/review?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return { rows: (body.rows as ReconciliationRow[]) ?? [] };
}

export async function applyReconciliation(
  organizationId: string,
  submissionId: string,
  caseId: string,
  fieldsToApply: string[],
): Promise<void> {
  const response = await fetch(`/api/external-form-submissions/${encodeURIComponent(submissionId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, caseId, fieldsToApply }),
  });
  await parseJsonOrThrow(response);
}

export type HistoricalImportPreview = { formLabel: string; submittedAt: string | null; matchesConfig: boolean };

/** Historical-submission ingestion (2026-09) — safe-metadata-only lookup,
    never answers/PII, used by the import-confirmation UI before committing. */
export async function previewHistoricalImport(
  organizationId: string,
  caseId: string,
  formConfigId: string,
  externalSubmissionId: string,
): Promise<HistoricalImportPreview> {
  const params = new URLSearchParams({ organizationId, externalSubmissionId });
  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}/forms/${encodeURIComponent(formConfigId)}/import-submission?${params.toString()}`,
  );
  const body = await parseJsonOrThrow(response);
  return body as unknown as HistoricalImportPreview;
}

export async function importHistoricalSubmission(
  organizationId: string,
  caseId: string,
  formConfigId: string,
  externalSubmissionId: string,
): Promise<{ alreadyImported: boolean }> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/forms/${encodeURIComponent(formConfigId)}/import-submission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, externalSubmissionId }),
  });
  const body = await parseJsonOrThrow(response);
  return { alreadyImported: Boolean(body.alreadyImported) };
}

export type MinimalExternalFormConfig = { id: string; label: string; audience: 'family' | 'staff' };

export async function fetchExternalFormConfigs(organizationId: string): Promise<MinimalExternalFormConfig[]> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/external-form-configs?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.configs as MinimalExternalFormConfig[]) ?? [];
}

export type HistoricalCasePreview = {
  formLabel: string;
  submittedAt: string | null;
  matchesConfig: boolean;
  alreadyAssociated: boolean;
  existingCaseId: string | null;
  /** Historical case-number preservation (2026-09) — the legitimate
      Manors number (qid 1, normalized to B{year}-{seq}) that will be
      preserved onto the new Case, or null if it couldn't be derived
      (see historicalCaseNumberBlockedReason). */
  historicalCaseNumber: string | null;
  historicalCaseNumberBlockedReason: string | null;
  historicalDuplicateCaseId: string | null;
  decedentName?: string;
  dateOfBirth?: string;
  dateOfDeath?: string;
  placeOfDeath?: string;
  informantName?: string;
  informantRelationship?: string;
  informantPhone?: string;
  informantIsNextOfKin?: string;
};

/** Historical case creation (2026-09) — safe-preview-only, never mutates.
    Informant fields are reference-only; see the route's own doc comment
    for why they must never be treated as Next of Kin. */
export async function previewHistoricalCase(
  organizationId: string,
  formConfigId: string,
  externalSubmissionId: string,
): Promise<HistoricalCasePreview> {
  const params = new URLSearchParams({ organizationId, formConfigId, externalSubmissionId });
  const response = await fetch(`/api/cases/historical-jotform-import?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return body as unknown as HistoricalCasePreview;
}

export async function createHistoricalCase(
  organizationId: string,
  formConfigId: string,
  externalSubmissionId: string,
  nextOfKinName: string,
  nextOfKinPhone: string,
): Promise<{ alreadyImported: boolean; caseId: string | null; caseNumber: string | null }> {
  const response = await fetch('/api/cases/historical-jotform-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, formConfigId, externalSubmissionId, nextOfKinName, nextOfKinPhone }),
  });
  const body = await parseJsonOrThrow(response);
  return {
    alreadyImported: Boolean(body.alreadyImported),
    caseId: typeof body.caseId === 'string' ? body.caseId : null,
    caseNumber: typeof body.caseNumber === 'string' ? body.caseNumber : null,
  };
}
