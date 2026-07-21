/**
 * Not consumed by any service or hook yet — built for Phase 6's
 * DocumentsCard, backed eventually by the Postgres/object-storage service
 * (docs/ARCHITECTURE.md), not Wix Data. Matches docs/CMS_SCHEMA.md's
 * Document model.
 */
export type DocumentType =
  | 'death_certificate'
  | 'burial_cremation_permit'
  | 'authorization_form'
  | 'signed_contract'
  | 'other';

export type DocumentStatus = 'pending' | 'active' | 'superseded' | 'archived';

export type CaseDocument = {
  id: string;
  organizationId: string;
  caseId: string;
  documentType: DocumentType;
  fileName: string;
  status: DocumentStatus;
  uploadedBy: string;
  uploadedAt: string;
};
