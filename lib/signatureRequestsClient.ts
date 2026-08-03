import type { SignatureRequest, SignerRole } from '@/types/signatureRequest';
import type { SignatureRecord } from '@/types/signatureRecord';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Client-side
 * fetch wrappers around the staff-facing `/api/cases/[caseId]/documents/
 * [documentId]/signature-requests*` routes — same shape and conventions as
 * `lib/caseDocumentsClient.ts`.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchSignatureRequests(
  organizationId: string,
  caseId: string,
  documentId: string,
): Promise<{ requests: SignatureRequest[]; records: SignatureRecord[] }> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/signature-requests?organizationId=${encodeURIComponent(organizationId)}`,
  );
  const body = await parseJsonOrThrow(response);
  return { requests: (body.requests as SignatureRequest[]) ?? [], records: (body.records as SignatureRecord[]) ?? [] };
}

export async function createSignatureRequest(params: {
  organizationId: string;
  caseId: string;
  documentId: string;
  signerName: string;
  signerEmail: string;
  signerRole: SignerRole;
  expiresAt?: string;
}): Promise<SignatureRequest> {
  const { caseId, documentId, ...rest } = params;
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/signature-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const body = await parseJsonOrThrow(response);
  return body.request as SignatureRequest;
}

export async function resendSignatureRequest(params: { organizationId: string; caseId: string; documentId: string; requestId: string }): Promise<SignatureRequest> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(params.caseId)}/documents/${encodeURIComponent(params.documentId)}/signature-requests/${encodeURIComponent(params.requestId)}/resend`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: params.organizationId }) },
  );
  const body = await parseJsonOrThrow(response);
  return body.request as SignatureRequest;
}

export async function cancelSignatureRequest(params: { organizationId: string; caseId: string; documentId: string; requestId: string }): Promise<void> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(params.caseId)}/documents/${encodeURIComponent(params.documentId)}/signature-requests/${encodeURIComponent(params.requestId)}/cancel`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: params.organizationId }) },
  );
  await parseJsonOrThrow(response);
}
