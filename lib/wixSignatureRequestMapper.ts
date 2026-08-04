import type { SignatureRequest, SignatureRequestStatus, SignerRole } from '../types/signatureRequest';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Standard
 * mapper pair for the `signatureRequests` collection, matching
 * `lib/wixCaseDocumentMapper.ts`'s exact conventions (full runtime
 * type-guarding, returns `null` never throws on malformed data).
 */

export type WixSignatureRequestItem = {
  beaconSignatureRequestId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  documentId?: unknown;
  documentVersion?: unknown;
  signerName?: unknown;
  signerEmail?: unknown;
  signerRole?: unknown;
  status?: unknown;
  tokenHash?: unknown;
  issuedAt?: unknown;
  expiresAt?: unknown;
  requestVersion?: unknown;
  sequenceOrder?: unknown;
  requestedBy?: unknown;
  viewedAt?: unknown;
  signedAt?: unknown;
  declinedAt?: unknown;
  declineReason?: unknown;
  cancelledAt?: unknown;
  cancelledBy?: unknown;
  lastRemindedAt?: unknown;
  reminderCount?: unknown;
  correlationId?: unknown;
};

const VALID_SIGNER_ROLES: readonly string[] = ['primary_contact', 'secondary_contact', 'next_of_kin', 'authorized_representative', 'funeral_director', 'internal_staff', 'witness'];
const VALID_STATUSES: readonly string[] = ['draft', 'pending', 'viewed', 'signed', 'declined', 'expired', 'cancelled'];

function isSignerRole(value: unknown): value is SignerRole {
  return typeof value === 'string' && VALID_SIGNER_ROLES.includes(value);
}

function isSignatureRequestStatus(value: unknown): value is SignatureRequestStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixSignatureRequestItem(item: WixSignatureRequestItem | undefined): SignatureRequest | null {
  if (
    !item ||
    typeof item.beaconSignatureRequestId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.documentId !== 'string' ||
    typeof item.documentVersion !== 'number' ||
    typeof item.signerName !== 'string' ||
    typeof item.signerEmail !== 'string' ||
    !isSignerRole(item.signerRole) ||
    !isSignatureRequestStatus(item.status) ||
    typeof item.tokenHash !== 'string' ||
    typeof item.issuedAt !== 'string' ||
    !isStringOrNull(item.expiresAt) ||
    typeof item.requestVersion !== 'number' ||
    typeof item.sequenceOrder !== 'number' ||
    typeof item.requestedBy !== 'string' ||
    !isStringOrNull(item.viewedAt) ||
    !isStringOrNull(item.signedAt) ||
    !isStringOrNull(item.declinedAt) ||
    !isStringOrNull(item.declineReason) ||
    !isStringOrNull(item.cancelledAt) ||
    !isStringOrNull(item.cancelledBy) ||
    !isStringOrNull(item.lastRemindedAt) ||
    typeof item.reminderCount !== 'number' ||
    typeof item.correlationId !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconSignatureRequestId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    documentId: item.documentId,
    documentVersion: item.documentVersion,
    signerName: item.signerName,
    signerEmail: item.signerEmail,
    signerRole: item.signerRole,
    status: item.status,
    tokenHash: item.tokenHash,
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt,
    requestVersion: item.requestVersion,
    sequenceOrder: item.sequenceOrder,
    requestedBy: item.requestedBy,
    viewedAt: item.viewedAt,
    signedAt: item.signedAt,
    declinedAt: item.declinedAt,
    declineReason: item.declineReason,
    cancelledAt: item.cancelledAt,
    cancelledBy: item.cancelledBy,
    lastRemindedAt: item.lastRemindedAt,
    reminderCount: item.reminderCount,
    correlationId: item.correlationId,
  };
}

export function buildWixSignatureRequestData(request: SignatureRequest): WixSignatureRequestItem {
  return {
    beaconSignatureRequestId: request.id,
    organizationId: request.organizationId,
    caseId: request.caseId,
    documentId: request.documentId,
    documentVersion: request.documentVersion,
    signerName: request.signerName,
    signerEmail: request.signerEmail,
    signerRole: request.signerRole,
    status: request.status,
    tokenHash: request.tokenHash,
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
    requestVersion: request.requestVersion,
    sequenceOrder: request.sequenceOrder,
    requestedBy: request.requestedBy,
    viewedAt: request.viewedAt,
    signedAt: request.signedAt,
    declinedAt: request.declinedAt,
    declineReason: request.declineReason,
    cancelledAt: request.cancelledAt,
    cancelledBy: request.cancelledBy,
    lastRemindedAt: request.lastRemindedAt,
    reminderCount: request.reminderCount,
    correlationId: request.correlationId,
  };
}

/** `SignatureRequest.status` is the one field that changes over the
    request's lifecycle (see this phase's Invariants) — but unlike
    `CaseDocument`'s simple status-only transitions, a workflow
    transition here routinely also sets one companion timestamp/field
    (viewedAt, declinedAt+declineReason, cancelledAt+cancelledBy) or, on
    resend, rotates the token entirely (tokenHash/expiresAt/reminderCount/
    lastRemindedAt). A single scoped patch function — rather than seven
    near-identical narrow ones — is used for exactly this reason; it is
    still never a fully generic "any field" patch: only the fields this
    type declares can ever be passed. */
export function applySignatureRequestPatchToWixData(existing: WixSignatureRequestItem, patch: Partial<WixSignatureRequestItem>): WixSignatureRequestItem {
  return { ...existing, ...patch };
}
