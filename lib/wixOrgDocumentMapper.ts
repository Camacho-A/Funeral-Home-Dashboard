import type { OrgDocument, OrgDocumentStatus } from '../types/orgDocument';

/**
 * Phase 39 (Family Billing & FTC Compliance). Maps an `orgDocuments` row —
 * the organization-level generated-document collection (currently the GPL).
 */
const VALID_STATUS: OrgDocumentStatus[] = ['pending', 'active', 'superseded', 'archived', 'failed'];

export type WixOrgDocumentItem = {
  beaconOrgDocumentId?: unknown;
  organizationId?: unknown;
  documentTypeKey?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  fileSizeBytes?: unknown;
  checksumSha256?: unknown;
  storageKey?: unknown;
  status?: unknown;
  version?: unknown;
  supersedesId?: unknown;
  effectiveDate?: unknown;
  disclosureVersion?: unknown;
  catalogSnapshotHash?: unknown;
  generatedBy?: unknown;
  createdAt?: unknown;
  correlationId?: unknown;
};

export function mapWixOrgDocumentItem(item: WixOrgDocumentItem | undefined): OrgDocument | null {
  if (
    !item ||
    typeof item.beaconOrgDocumentId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.documentTypeKey !== 'string' ||
    typeof item.fileName !== 'string' ||
    typeof item.status !== 'string' ||
    !(VALID_STATUS as string[]).includes(item.status) ||
    typeof item.version !== 'number' ||
    typeof item.effectiveDate !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconOrgDocumentId,
    organizationId: item.organizationId,
    documentTypeKey: item.documentTypeKey,
    fileName: item.fileName,
    mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'application/pdf',
    fileSizeBytes: typeof item.fileSizeBytes === 'number' ? item.fileSizeBytes : 0,
    checksumSha256: typeof item.checksumSha256 === 'string' ? item.checksumSha256 : '',
    storageKey: typeof item.storageKey === 'string' ? item.storageKey : '',
    status: item.status as OrgDocumentStatus,
    version: item.version,
    supersedesId: typeof item.supersedesId === 'string' ? item.supersedesId : null,
    effectiveDate: item.effectiveDate,
    disclosureVersion: typeof item.disclosureVersion === 'string' ? item.disclosureVersion : '',
    catalogSnapshotHash: typeof item.catalogSnapshotHash === 'string' ? item.catalogSnapshotHash : '',
    generatedBy: typeof item.generatedBy === 'string' ? item.generatedBy : null,
    createdAt: item.createdAt,
    correlationId: typeof item.correlationId === 'string' ? item.correlationId : '',
  };
}

export function buildWixOrgDocumentData(doc: OrgDocument): WixOrgDocumentItem {
  return {
    beaconOrgDocumentId: doc.id,
    organizationId: doc.organizationId,
    documentTypeKey: doc.documentTypeKey,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSizeBytes: doc.fileSizeBytes,
    checksumSha256: doc.checksumSha256,
    storageKey: doc.storageKey,
    status: doc.status,
    version: doc.version,
    supersedesId: doc.supersedesId,
    effectiveDate: doc.effectiveDate,
    disclosureVersion: doc.disclosureVersion,
    catalogSnapshotHash: doc.catalogSnapshotHash,
    generatedBy: doc.generatedBy,
    createdAt: doc.createdAt,
    correlationId: doc.correlationId,
  };
}
