import type { SignatureRecord, SignatureMethod, SignatureVerificationStatus } from '../types/signatureRecord';
import type { SignerRole } from '../types/signatureRequest';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Standard
 * mapper pair for the `signatureRecords` collection — **insert-only,
 * deliberately no `applyXToWixData` update function exists here at
 * all**, unlike every other mapper in this codebase. A `SignatureRecord`
 * is never updated or deleted once created (see
 * `types/signatureRecord.ts`'s own header comment); the absence of an
 * update function is itself part of how that invariant is enforced, not
 * just documented.
 */

export type WixSignatureRecordItem = {
  beaconSignatureRecordId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  documentId?: unknown;
  documentVersion?: unknown;
  signatureRequestId?: unknown;
  signerName?: unknown;
  signerEmail?: unknown;
  signerRole?: unknown;
  signedName?: unknown;
  initials?: unknown;
  ipAddress?: unknown;
  userAgent?: unknown;
  signatureMethod?: unknown;
  verificationStatus?: unknown;
  documentChecksumSha256?: unknown;
  recordVersion?: unknown;
  correlationId?: unknown;
  signedAt?: unknown;
};

const VALID_SIGNER_ROLES: readonly string[] = ['primary_contact', 'secondary_contact', 'next_of_kin', 'authorized_representative', 'funeral_director', 'internal_staff'];
const VALID_SIGNATURE_METHODS: readonly string[] = ['typed_name'];
const VALID_VERIFICATION_STATUSES: readonly string[] = ['verified', 'unverified'];

function isSignerRole(value: unknown): value is SignerRole {
  return typeof value === 'string' && VALID_SIGNER_ROLES.includes(value);
}

function isSignatureMethod(value: unknown): value is SignatureMethod {
  return typeof value === 'string' && VALID_SIGNATURE_METHODS.includes(value);
}

function isVerificationStatus(value: unknown): value is SignatureVerificationStatus {
  return typeof value === 'string' && VALID_VERIFICATION_STATUSES.includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function mapWixSignatureRecordItem(item: WixSignatureRecordItem | undefined): SignatureRecord | null {
  if (
    !item ||
    typeof item.beaconSignatureRecordId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.documentId !== 'string' ||
    typeof item.documentVersion !== 'number' ||
    typeof item.signatureRequestId !== 'string' ||
    typeof item.signerName !== 'string' ||
    typeof item.signerEmail !== 'string' ||
    !isSignerRole(item.signerRole) ||
    typeof item.signedName !== 'string' ||
    !isStringOrNull(item.initials) ||
    typeof item.ipAddress !== 'string' ||
    typeof item.userAgent !== 'string' ||
    !isSignatureMethod(item.signatureMethod) ||
    !isVerificationStatus(item.verificationStatus) ||
    typeof item.documentChecksumSha256 !== 'string' ||
    typeof item.recordVersion !== 'number' ||
    typeof item.correlationId !== 'string' ||
    typeof item.signedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconSignatureRecordId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    documentId: item.documentId,
    documentVersion: item.documentVersion,
    signatureRequestId: item.signatureRequestId,
    signerName: item.signerName,
    signerEmail: item.signerEmail,
    signerRole: item.signerRole,
    signedName: item.signedName,
    initials: item.initials,
    ipAddress: item.ipAddress,
    userAgent: item.userAgent,
    signatureMethod: item.signatureMethod,
    verificationStatus: item.verificationStatus,
    documentChecksumSha256: item.documentChecksumSha256,
    recordVersion: item.recordVersion,
    correlationId: item.correlationId,
    signedAt: item.signedAt,
  };
}

export function buildWixSignatureRecordData(record: SignatureRecord): WixSignatureRecordItem {
  return {
    beaconSignatureRecordId: record.id,
    organizationId: record.organizationId,
    caseId: record.caseId,
    documentId: record.documentId,
    documentVersion: record.documentVersion,
    signatureRequestId: record.signatureRequestId,
    signerName: record.signerName,
    signerEmail: record.signerEmail,
    signerRole: record.signerRole,
    signedName: record.signedName,
    initials: record.initials,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    signatureMethod: record.signatureMethod,
    verificationStatus: record.verificationStatus,
    documentChecksumSha256: record.documentChecksumSha256,
    recordVersion: record.recordVersion,
    correlationId: record.correlationId,
    signedAt: record.signedAt,
  };
}
