import type { CaseDocument, CaseDocumentOrigin, CaseDocumentSignatureStatus, CaseDocumentStatus } from '../types/caseDocument';
import type { DocumentTemplateCategory } from '../types/documentTemplate';

/**
 * Phase 25 (Document Generation & Template Management). Standard mapper
 * pair for the `caseDocuments` collection — a single, flat collection
 * covering both origins (generated/uploaded), matching every existing
 * mapper's shape/validation convention (see e.g. `lib/wixCaseOrderMapper.ts`).
 */

export type WixCaseDocumentItem = {
  beaconCaseDocumentId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  origin?: unknown;
  documentTypeKey?: unknown;
  category?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  fileSizeBytes?: unknown;
  checksumSha256?: unknown;
  storageKey?: unknown;
  status?: unknown;
  templateId?: unknown;
  templateVersion?: unknown;
  version?: unknown;
  supersedesId?: unknown;
  signatureStatus?: unknown;
  familyVisible?: unknown;
  generatedBy?: unknown;
  uploadedBy?: unknown;
  createdAt?: unknown;
  correlationId?: unknown;
};

const VALID_CATEGORIES: readonly string[] = [
  'contract',
  'authorization',
  'cremation_form',
  'burial_form',
  'financial',
  'receipt',
  'statement',
  'letter',
  'internal_form',
  'miscellaneous',
];

function isCategoryOrNull(value: unknown): value is DocumentTemplateCategory | null {
  return value === null || (typeof value === 'string' && VALID_CATEGORIES.includes(value));
}

function isOrigin(value: unknown): value is CaseDocumentOrigin {
  return value === 'generated' || value === 'uploaded';
}

function isStatus(value: unknown): value is CaseDocumentStatus {
  return value === 'pending' || value === 'active' || value === 'superseded' || value === 'archived' || value === 'failed';
}

function isSignatureStatusOrNull(value: unknown): value is CaseDocumentSignatureStatus | null {
  return value === null || value === 'unsigned' || value === 'pending_signature' || value === 'signed';
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

export function mapWixCaseDocumentItem(item: WixCaseDocumentItem | undefined): CaseDocument | null {
  if (
    !item ||
    typeof item.beaconCaseDocumentId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    !isOrigin(item.origin) ||
    !isStringOrNull(item.documentTypeKey) ||
    !isCategoryOrNull(item.category) ||
    typeof item.fileName !== 'string' ||
    typeof item.mimeType !== 'string' ||
    typeof item.fileSizeBytes !== 'number' ||
    typeof item.checksumSha256 !== 'string' ||
    typeof item.storageKey !== 'string' ||
    !isStatus(item.status) ||
    !isStringOrNull(item.templateId) ||
    !isNumberOrNull(item.templateVersion) ||
    !isNumberOrNull(item.version) ||
    !isStringOrNull(item.supersedesId) ||
    !isSignatureStatusOrNull(item.signatureStatus) ||
    (item.familyVisible !== undefined && typeof item.familyVisible !== 'boolean') ||
    !isStringOrNull(item.generatedBy) ||
    !isStringOrNull(item.uploadedBy) ||
    typeof item.createdAt !== 'string' ||
    typeof item.correlationId !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconCaseDocumentId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    origin: item.origin,
    documentTypeKey: item.documentTypeKey,
    category: item.category,
    fileName: item.fileName,
    mimeType: item.mimeType,
    fileSizeBytes: item.fileSizeBytes,
    checksumSha256: item.checksumSha256,
    storageKey: item.storageKey,
    status: item.status,
    templateId: item.templateId,
    templateVersion: item.templateVersion,
    version: item.version,
    supersedesId: item.supersedesId,
    signatureStatus: item.signatureStatus,
    // Phase 29: absent on any row written before this field existed —
    // fails closed to `false`, never assumed `true` for a pre-existing row.
    familyVisible: typeof item.familyVisible === 'boolean' ? item.familyVisible : false,
    generatedBy: item.generatedBy,
    uploadedBy: item.uploadedBy,
    createdAt: item.createdAt,
    correlationId: item.correlationId,
  };
}

export function buildWixCaseDocumentData(document: CaseDocument): WixCaseDocumentItem {
  return {
    beaconCaseDocumentId: document.id,
    organizationId: document.organizationId,
    caseId: document.caseId,
    origin: document.origin,
    documentTypeKey: document.documentTypeKey,
    category: document.category,
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    checksumSha256: document.checksumSha256,
    storageKey: document.storageKey,
    status: document.status,
    templateId: document.templateId,
    templateVersion: document.templateVersion,
    version: document.version,
    supersedesId: document.supersedesId,
    signatureStatus: document.signatureStatus,
    familyVisible: document.familyVisible,
    generatedBy: document.generatedBy,
    uploadedBy: document.uploadedBy,
    createdAt: document.createdAt,
    correlationId: document.correlationId,
  };
}

/** A `pending` row (inserted the instant generation/upload starts, so a
    mid-request crash leaves a diagnosable row rather than losing the
    attempt silently) has its `status`/`storageKey`/`checksumSha256`/
    `fileSizeBytes` filled in together, exactly once, when the async
    render-and-store work completes or fails — mirrors `PaymentRecord`'s
    own `pending -> succeeded/failed` update, which likewise fills in more
    than a bare status flag once the provider responds. A `pending` row
    has no real content yet, so this is not a violation of "generated
    documents are immutable" (see this phase's Invariants) — that
    guarantee begins once a row reaches `active`/`failed`, after which
    only a later `status` flip (superseded/archived) ever touches it
    again, via `applyCaseDocumentStatusToWixData` below. */
export function applyCaseDocumentGenerationResultToWixData(
  existing: WixCaseDocumentItem,
  result: { status: CaseDocumentStatus; storageKey: string; checksumSha256: string; fileSizeBytes: number },
): WixCaseDocumentItem {
  return { ...existing, status: result.status, storageKey: result.storageKey, checksumSha256: result.checksumSha256, fileSizeBytes: result.fileSizeBytes };
}

/** The only field a fully-`active` row ever has changed afterward:
    `status`, for supersession (regeneration), archive, or restore. */
export function applyCaseDocumentStatusToWixData(existing: WixCaseDocumentItem, status: CaseDocumentStatus): WixCaseDocumentItem {
  return { ...existing, status };
}

/** Phase 26 (Electronic Signatures & Authorization Workflows). The one
    other field ever changed on an already-`active` row: `signatureStatus`,
    written only from `services/documentService.ts`'s `markDocumentSigned` —
    see that function's own header comment. */
export function applyCaseDocumentSignatureStatusToWixData(existing: WixCaseDocumentItem, signatureStatus: CaseDocumentSignatureStatus): WixCaseDocumentItem {
  return { ...existing, signatureStatus };
}

/** Phase 29 (Family Portal & External Collaboration). The only field ever
    changed by `services/documentService.ts`'s `setFamilyVisible` — the
    sole path by which `familyVisible` can ever flip away from its
    fail-closed `false` default. */
export function applyCaseDocumentFamilyVisibleToWixData(existing: WixCaseDocumentItem, familyVisible: boolean): WixCaseDocumentItem {
  return { ...existing, familyVisible };
}
