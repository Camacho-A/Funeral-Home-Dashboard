import type { SignatureRequest } from '../../types/signatureRequest';

/**
 * Phase 29 (Family Portal & External Collaboration). An explicit
 * allowlisting DTO — the family-facing shape of a `SignatureRequest`,
 * gated by `signature.complete`. Never a raw `SignatureRequest`: excludes
 * `tokenHash` (never exposed to any client), `signerName`/`signerEmail`/
 * `signerRole` (the portal session itself already proves who the signer
 * is — no reason to echo it back), `requestVersion`/`sequenceOrder`
 * (internal), `requestedBy` (staff-Identity-space), and
 * `organizationId`/`caseId` (redundant — already scoped by the route).
 */
export type PortalSignatureRequestView = {
  id: string;
  documentId: string;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
};

export function buildPortalSignatureRequestView(request: SignatureRequest): PortalSignatureRequestView {
  return {
    id: request.id,
    documentId: request.documentId,
    status: request.status,
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
  };
}
