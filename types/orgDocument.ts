/**
 * Phase 39 (Family Billing & FTC Compliance). An organization-level generated
 * document that is NOT tied to a single case — currently the General Price
 * List (D5). Mirrors `CaseDocument`'s immutable-bytes + checksum shape, minus
 * `caseId`, plus compliance provenance a price list must preserve: the
 * effective date, the source catalog snapshot provenance, and the disclosure
 * version it was rendered against. Superseded (never mutated) when a newer
 * version is generated — historical GPLs are permanent.
 */
export type OrgDocumentStatus = 'pending' | 'active' | 'superseded' | 'archived' | 'failed';

export type OrgDocument = {
  id: string;
  organizationId: string;
  documentTypeKey: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  storageKey: string;
  status: OrgDocumentStatus;
  /** Generation sequence for this (org, documentTypeKey). */
  version: number;
  supersedesId: string | null;
  /** The date this price list takes effect (FTC price lists are effective-dated). */
  effectiveDate: string;
  /** Snapshot provenance: the FTC disclosure version + a catalog-snapshot hash
      so a historical GPL is never re-derived from today's mutable catalog. */
  disclosureVersion: string;
  catalogSnapshotHash: string;
  generatedBy: string | null;
  createdAt: string;
  correlationId: string;
};
