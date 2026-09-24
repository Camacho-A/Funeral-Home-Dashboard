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
