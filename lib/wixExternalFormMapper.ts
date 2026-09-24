/**
 * Manors Jotform integration (case-first architecture, 2026-09). Wix
 * validate/build mappers for the three new collections this integration
 * introduces — `externalFormConfigs`, `caseFormLinks`,
 * `externalFormSubmissions`. Mirrors lib/wixWebhookEventMapper.ts's exact
 * shape (fail-closed mapping: a malformed row maps to `null` rather than
 * throwing, matching every other Wix mapper in this codebase).
 */
import type { ExternalFormConfig, ExternalFormAudience } from '../types/externalFormConfig';
import type { CaseFormLink, CaseFormLinkStatus } from '../types/caseFormLink';
import type { ExternalFormSubmission, ExternalFormSubmissionStatus, ExternalFormPdfStatus } from '../types/externalFormSubmission';

// ---------------------------------------------------------------------------
// ExternalFormConfig
// ---------------------------------------------------------------------------

export type WixExternalFormConfigItem = {
  organizationId?: unknown;
  provider?: unknown;
  externalFormId?: unknown;
  label?: unknown;
  audience?: unknown;
  fieldMap?: unknown;
  linkTokenFieldName?: unknown;
  linkTokenFieldQid?: unknown;
  webhookAuthFieldQid?: unknown;
  isEnabled?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_AUDIENCES: ExternalFormAudience[] = ['family', 'staff'];

export function mapWixExternalFormConfigItem(id: string, item: WixExternalFormConfigItem | undefined): ExternalFormConfig | null {
  if (
    !item ||
    typeof item.organizationId !== 'string' ||
    typeof item.provider !== 'string' ||
    typeof item.externalFormId !== 'string' ||
    typeof item.label !== 'string' ||
    typeof item.audience !== 'string' ||
    !(VALID_AUDIENCES as string[]).includes(item.audience) ||
    typeof item.fieldMap !== 'string' ||
    typeof item.linkTokenFieldName !== 'string' ||
    typeof item.linkTokenFieldQid !== 'string' ||
    typeof item.webhookAuthFieldQid !== 'string' ||
    typeof item.isEnabled !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id,
    organizationId: item.organizationId,
    provider: item.provider,
    externalFormId: item.externalFormId,
    label: item.label,
    audience: item.audience as ExternalFormAudience,
    fieldMap: item.fieldMap,
    linkTokenFieldName: item.linkTokenFieldName,
    linkTokenFieldQid: item.linkTokenFieldQid,
    webhookAuthFieldQid: item.webhookAuthFieldQid,
    isEnabled: item.isEnabled,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixExternalFormConfigData(config: ExternalFormConfig): WixExternalFormConfigItem {
  return { ...config };
}

// ---------------------------------------------------------------------------
// CaseFormLink
// ---------------------------------------------------------------------------

export type WixCaseFormLinkItem = {
  organizationId?: unknown;
  caseId?: unknown;
  provider?: unknown;
  formConfigId?: unknown;
  linkTokenHash?: unknown;
  status?: unknown;
  sentAt?: unknown;
  submissionId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_LINK_STATUSES: CaseFormLinkStatus[] = ['not_sent', 'sent', 'received', 'reviewed'];

export function mapWixCaseFormLinkItem(id: string, item: WixCaseFormLinkItem | undefined): CaseFormLink | null {
  if (
    !item ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.provider !== 'string' ||
    typeof item.formConfigId !== 'string' ||
    typeof item.linkTokenHash !== 'string' ||
    typeof item.status !== 'string' ||
    !(VALID_LINK_STATUSES as string[]).includes(item.status) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id,
    organizationId: item.organizationId,
    caseId: item.caseId,
    provider: item.provider,
    formConfigId: item.formConfigId,
    linkTokenHash: item.linkTokenHash,
    status: item.status as CaseFormLinkStatus,
    sentAt: typeof item.sentAt === 'string' ? item.sentAt : null,
    submissionId: typeof item.submissionId === 'string' ? item.submissionId : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixCaseFormLinkData(link: CaseFormLink): WixCaseFormLinkItem {
  return { ...link };
}

export function applyCaseFormLinkUpdateToWixData(existing: WixCaseFormLinkItem, patch: Partial<CaseFormLink>): WixCaseFormLinkItem {
  const next: WixCaseFormLinkItem = { ...existing };
  if (patch.linkTokenHash !== undefined) next.linkTokenHash = patch.linkTokenHash;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.sentAt !== undefined) next.sentAt = patch.sentAt;
  if (patch.submissionId !== undefined) next.submissionId = patch.submissionId;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}

// ---------------------------------------------------------------------------
// ExternalFormSubmission
// ---------------------------------------------------------------------------

export type WixExternalFormSubmissionItem = {
  organizationId?: unknown;
  provider?: unknown;
  externalFormId?: unknown;
  externalSubmissionId?: unknown;
  caseFormLinkId?: unknown;
  status?: unknown;
  mappedFields?: unknown;
  receivedAt?: unknown;
  reviewedAt?: unknown;
  reviewedBy?: unknown;
  documentId?: unknown;
  pdfStatus?: unknown;
  pdfFailureReason?: unknown;
  createdCaseId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const VALID_SUBMISSION_STATUSES: ExternalFormSubmissionStatus[] = ['unmatched', 'matched', 'reviewed'];
const VALID_PDF_STATUSES: ExternalFormPdfStatus[] = ['not_applicable', 'pending', 'stored', 'failed'];

export function mapWixExternalFormSubmissionItem(id: string, item: WixExternalFormSubmissionItem | undefined): ExternalFormSubmission | null {
  if (
    !item ||
    typeof item.organizationId !== 'string' ||
    typeof item.provider !== 'string' ||
    typeof item.externalFormId !== 'string' ||
    typeof item.externalSubmissionId !== 'string' ||
    typeof item.status !== 'string' ||
    !(VALID_SUBMISSION_STATUSES as string[]).includes(item.status) ||
    typeof item.mappedFields !== 'string' ||
    typeof item.receivedAt !== 'string' ||
    typeof item.pdfStatus !== 'string' ||
    !(VALID_PDF_STATUSES as string[]).includes(item.pdfStatus) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id,
    organizationId: item.organizationId,
    provider: item.provider,
    externalFormId: item.externalFormId,
    externalSubmissionId: item.externalSubmissionId,
    caseFormLinkId: typeof item.caseFormLinkId === 'string' ? item.caseFormLinkId : null,
    status: item.status as ExternalFormSubmissionStatus,
    mappedFields: item.mappedFields,
    receivedAt: item.receivedAt,
    reviewedAt: typeof item.reviewedAt === 'string' ? item.reviewedAt : null,
    reviewedBy: typeof item.reviewedBy === 'string' ? item.reviewedBy : null,
    documentId: typeof item.documentId === 'string' ? item.documentId : null,
    pdfStatus: item.pdfStatus as ExternalFormPdfStatus,
    pdfFailureReason: typeof item.pdfFailureReason === 'string' ? item.pdfFailureReason : null,
    // Optional/defaulted, like caseFormLinkId/reviewedAt above — this
    // field is newly added and won't exist yet on rows persisted before
    // its live schema addition.
    createdCaseId: typeof item.createdCaseId === 'string' ? item.createdCaseId : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixExternalFormSubmissionData(submission: ExternalFormSubmission): WixExternalFormSubmissionItem {
  return { ...submission };
}

export function applyExternalFormSubmissionUpdateToWixData(
  existing: WixExternalFormSubmissionItem,
  patch: Partial<ExternalFormSubmission>,
): WixExternalFormSubmissionItem {
  const next: WixExternalFormSubmissionItem = { ...existing };
  if (patch.caseFormLinkId !== undefined) next.caseFormLinkId = patch.caseFormLinkId;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.reviewedAt !== undefined) next.reviewedAt = patch.reviewedAt;
  if (patch.reviewedBy !== undefined) next.reviewedBy = patch.reviewedBy;
  if (patch.documentId !== undefined) next.documentId = patch.documentId;
  if (patch.pdfStatus !== undefined) next.pdfStatus = patch.pdfStatus;
  if (patch.pdfFailureReason !== undefined) next.pdfFailureReason = patch.pdfFailureReason;
  if (patch.createdCaseId !== undefined) next.createdCaseId = patch.createdCaseId;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
