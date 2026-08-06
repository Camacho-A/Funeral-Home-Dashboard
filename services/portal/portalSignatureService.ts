import type { DataAdapterMode } from '../../lib/env';
import { list as listCaseDocuments, downloadFile as downloadCaseDocumentFile } from '../documentService';
import { listRequests, getRequestById, completeSignatureRequest, declineSignatureRequest, SignatureServiceError } from '../signatureService';
import type { SignatureRequest } from '../../types/signatureRequest';
import { portalActivityContext } from './portalActivityContext';
import { recordPortalSignatureCompleted } from '../activityService';
import { buildPortalSignatureRequestView, type PortalSignatureRequestView } from '../../domain/portal/portalSignatureView';

/**
 * Phase 29 (Family Portal & External Collaboration). A thin wrapper —
 * completion/decline logic still lives entirely in
 * `services/signatureService.ts` (this file never duplicates it, per the
 * structural-test requirement); this file only resolves which requests
 * belong to this family member and attributes their actions via
 * `portalActivityContext()`.
 *
 * A request is "for" this portal user by `signerEmail` match
 * (case-insensitive) — `SignatureRequest` predates the Portal User
 * concept and has no `portalUserId` field of its own, so email is the
 * only correlation available, mirroring how the public `/sign` flow
 * itself has always worked (the token, plus the signer's own claimed
 * identity, is the entire authorization model there too).
 */
export class PortalSignatureServiceError extends Error {}

const ACTIVE_STATUSES = new Set(['pending', 'viewed']);

function belongsToPortalUser(request: SignatureRequest, portalUserEmail: string): boolean {
  return request.signerEmail.toLowerCase() === portalUserEmail.toLowerCase();
}

export async function listFamilySignatureRequests(
  organizationId: string,
  caseId: string,
  portalUserEmail: string,
  dataAdapterMode: DataAdapterMode,
): Promise<PortalSignatureRequestView[]> {
  const documents = await listCaseDocuments(organizationId, caseId, dataAdapterMode);
  const perDocumentRequests = await Promise.all(documents.map((doc) => listRequests(organizationId, caseId, doc.id, dataAdapterMode)));

  return perDocumentRequests
    .flat()
    .filter((r) => ACTIVE_STATUSES.has(r.status) && belongsToPortalUser(r, portalUserEmail))
    .map(buildPortalSignatureRequestView);
}

async function resolveOwnRequest(organizationId: string, caseId: string, requestId: string, portalUserEmail: string, dataAdapterMode: DataAdapterMode): Promise<SignatureRequest> {
  const request = await getRequestById(organizationId, caseId, requestId, dataAdapterMode);
  if (!request || !belongsToPortalUser(request, portalUserEmail)) {
    // Existence-hiding — a request belonging to someone else is reported
    // identically to one that doesn't exist at all.
    throw new PortalSignatureServiceError('Signature request not found.');
  }
  return request;
}

export async function completeFamilySignature(
  params: {
    organizationId: string;
    caseId: string;
    requestId: string;
    portalUserId: string;
    portalUserEmail: string;
    signedName: string;
    ipAddress: string;
    userAgent: string;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<PortalSignatureRequestView> {
  const request = await resolveOwnRequest(params.organizationId, params.caseId, params.requestId, params.portalUserEmail, dataAdapterMode);
  const ctx = portalActivityContext(params.organizationId, request.correlationId);

  try {
    const { request: updated } = await completeSignatureRequest(
      request,
      { signedName: params.signedName, ipAddress: params.ipAddress, userAgent: params.userAgent, idFactory: params.idFactory },
      dataAdapterMode,
      ctx,
    );

    try {
      await recordPortalSignatureCompleted(ctx, params.caseId, request.documentId, request.id, params.portalUserId, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record portal.signature.completed activity event:', error instanceof Error ? error.message : error);
    }

    return buildPortalSignatureRequestView(updated);
  } catch (error) {
    if (error instanceof SignatureServiceError) throw new PortalSignatureServiceError(error.message);
    throw error;
  }
}

export async function declineFamilySignature(
  params: { organizationId: string; caseId: string; requestId: string; portalUserEmail: string; reason?: string; ipAddress: string; userAgent: string },
  dataAdapterMode: DataAdapterMode,
): Promise<PortalSignatureRequestView> {
  const request = await resolveOwnRequest(params.organizationId, params.caseId, params.requestId, params.portalUserEmail, dataAdapterMode);
  const ctx = portalActivityContext(params.organizationId, request.correlationId);

  try {
    const updated = await declineSignatureRequest(request, { reason: params.reason, ipAddress: params.ipAddress, userAgent: params.userAgent }, dataAdapterMode, ctx);
    return buildPortalSignatureRequestView(updated);
  } catch (error) {
    if (error instanceof SignatureServiceError) throw new PortalSignatureServiceError(error.message);
    throw error;
  }
}

/** Streams the document bytes for a family member to review before
    signing — reuses `documentService.downloadFile()` directly, mirroring
    `services/signatureService.ts`'s own `getDocumentBytesForSigning`
    exactly but attributed via `portalActivityContext()` instead of the
    anonymous-external-signer context (a signed-in family member is not
    the same as a one-shot token-only signer). */
export async function getFamilySignatureDocumentBytes(
  params: { organizationId: string; caseId: string; requestId: string; portalUserEmail: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const request = await resolveOwnRequest(params.organizationId, params.caseId, params.requestId, params.portalUserEmail, dataAdapterMode);
  const ctx = portalActivityContext(params.organizationId, request.correlationId);
  return downloadCaseDocumentFile(params.organizationId, params.caseId, request.documentId, ctx, dataAdapterMode);
}
