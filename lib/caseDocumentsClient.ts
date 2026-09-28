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

/** Task #3 (2026-09) — bulk case document actions. A short, staff-safe
    { fileName, reason } list of any document the server could not
    include (unsupported type for Print All, or a broken/unavailable
    storage record) — read from the `X-Bulk-Excluded` response header so
    the UI can surface a partial-failure warning without a second round
    trip. Never throws on a missing/malformed header — an empty array
    means "nothing was excluded," the same as the header being absent. */
export type BulkDocumentExclusion = { fileName: string; reason: string };

function readBulkExcludedHeader(response: Response): BulkDocumentExclusion[] {
  const raw = response.headers.get('X-Bulk-Excluded');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Reads the server-chosen, already-sanitized filename back out of
    Content-Disposition rather than re-deriving it client-side — the
    server (buildBulkDownloadZipFileName/buildBulkPrintPdfFileName) is the
    one source of truth for this name. Falls back to a safe default only
    if the header is ever missing/malformed. */
function readContentDispositionFileName(response: Response, fallback: string): string {
  const raw = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]*)"/.exec(raw);
  return match ? match[1] : fallback;
}

/** Fetches the on-demand ZIP of every eligible document for this case
    (never a pre-existing/persisted file) through the same
    session-cookie-gated route Download All's button triggers. */
export async function fetchBulkDownloadZip(organizationId: string, caseId: string): Promise<{ blob: Blob; fileName: string; excluded: BulkDocumentExclusion[] }> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/documents/bulk-download?${params.toString()}`);
  const body = await parseJsonOrThrowIfError(response);
  if (body) throw new Error(body); // non-OK JSON error response
  return {
    blob: await response.blob(),
    fileName: readContentDispositionFileName(response, 'case-documents.zip'),
    excluded: readBulkExcludedHeader(response),
  };
}

/** Fetches the on-demand combined, printable PDF for this case — the
    caller opens/prints it exactly like `printStoredDocument` already does
    for a single document. */
export async function fetchBulkPrintPdf(organizationId: string, caseId: string): Promise<{ blob: Blob; fileName: string; excluded: BulkDocumentExclusion[] }> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/documents/bulk-print?${params.toString()}`);
  const body = await parseJsonOrThrowIfError(response);
  if (body) throw new Error(body);
  return {
    blob: await response.blob(),
    fileName: readContentDispositionFileName(response, 'case-documents.pdf'),
    excluded: readBulkExcludedHeader(response),
  };
}

/** A binary-response route (ZIP/PDF) only ever returns a JSON body on
    failure — this returns that error message string, or null on success
    (so the body is never consumed/parsed a second time as JSON). */
async function parseJsonOrThrowIfError(response: Response): Promise<string | null> {
  if (response.ok) return null;
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
}
