import type { ManateeApplicationInput, ManateeDraft } from '@/domain/documents/manateeDeathCertificateApplication';
import type { CaseDocument } from '@/types/caseDocument';

/** Manatee County — Death Certificate Application (2026-10): browser calls. */

const url = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/documents/manatee-application`;

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
}

export async function fetchManateeDraft(organizationId: string, caseId: string): Promise<ManateeDraft> {
  const response = await fetch(`${url(caseId)}?organizationId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as ManateeDraft;
}

/** The filled PDF, as a Blob — shown, never stored. */
export async function previewManateeApplication(organizationId: string, caseId: string, values: ManateeApplicationInput): Promise<Blob> {
  const response = await fetch(url(caseId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, action: 'preview', values }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.blob();
}

export async function saveManateeApplication(organizationId: string, caseId: string, values: ManateeApplicationInput): Promise<CaseDocument> {
  const response = await fetch(url(caseId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, action: 'save', values }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return ((await response.json()) as { document: CaseDocument }).document;
}
