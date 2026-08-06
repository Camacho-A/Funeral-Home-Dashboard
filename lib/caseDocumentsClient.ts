import type { CaseDocument } from '@/types/caseDocument';

/**
 * Phase 25 (Document Generation & Template Management). Client-side fetch
 * wrappers around `/api/cases/[caseId]/documents*` — same reasoning as
 * `lib/documentTemplatesClient.ts`.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchCaseDocuments(organizationId: string, caseId: string): Promise<CaseDocument[]> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/documents?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.documents as CaseDocument[]) ?? [];
}

export async function generateCaseDocument(params: {
  organizationId: string;
  caseId: string;
  templateId: string;
  templateVersion?: number;
  existingDocumentId?: string;
}): Promise<CaseDocument> {
  const { caseId, ...rest } = params;
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/documents/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const body = await parseJsonOrThrow(response);
  return body.document as CaseDocument;
}

export async function uploadCaseDocument(params: {
  organizationId: string;
  caseId: string;
  file: File;
  documentTypeKey?: string;
  category?: string;
}): Promise<CaseDocument> {
  const formData = new FormData();
  formData.set('organizationId', params.organizationId);
  formData.set('file', params.file);
  if (params.documentTypeKey) formData.set('documentTypeKey', params.documentTypeKey);
  if (params.category) formData.set('category', params.category);

  const response = await fetch(`/api/cases/${encodeURIComponent(params.caseId)}/documents/upload`, { method: 'POST', body: formData });
  const body = await parseJsonOrThrow(response);
  return body.document as CaseDocument;
}

export async function archiveCaseDocument(params: { organizationId: string; caseId: string; documentId: string }): Promise<void> {
  const response = await fetch(`/api/cases/${encodeURIComponent(params.caseId)}/documents/${encodeURIComponent(params.documentId)}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId }),
  });
  await parseJsonOrThrow(response);
}

/** Phase 29 (Family Portal & External Collaboration). The only client-side
    caller of the one route that can ever flip `CaseDocument.familyVisible`
    — see `app/api/cases/[caseId]/documents/[documentId]/family-visibility/route.ts`'s
    own header comment. */
export async function setCaseDocumentFamilyVisibility(params: {
  organizationId: string;
  caseId: string;
  documentId: string;
  familyVisible: boolean;
}): Promise<CaseDocument> {
  const response = await fetch(`/api/cases/${encodeURIComponent(params.caseId)}/documents/${encodeURIComponent(params.documentId)}/family-visibility`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId, familyVisible: params.familyVisible }),
  });
  const body = await parseJsonOrThrow(response);
  return body.document as CaseDocument;
}

/** Not a fetch wrapper — the download route streams a real file
    (`Content-Disposition: attachment`), so the simplest correct trigger is
    navigating the browser there directly, matching
    `lib/activityClient.ts`'s `buildActivityExportUrl` precedent. */
export function buildCaseDocumentDownloadUrl(organizationId: string, caseId: string, documentId: string): string {
  const params = new URLSearchParams({ organizationId });
  return `/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/download?${params.toString()}`;
}
