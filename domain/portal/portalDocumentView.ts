import type { CaseDocument } from '../../types/caseDocument';

/**
 * Phase 29 (Family Portal & External Collaboration). An explicit
 * allowlisting DTO — the family-facing shape of a `CaseDocument`, gated
 * by `document.read`/`document.download`. Never a raw `CaseDocument`:
 * excludes `storageKey` (never exposed to any client — the download
 * route mints its own short-lived reference), `checksumSha256`,
 * `templateId`/`templateVersion`/`version`/`supersedesId` (internal
 * versioning detail), `generatedBy`/`uploadedBy` (staff-Identity-space),
 * `organizationId`/`caseId` (redundant — the route already scopes by
 * case), `correlationId`, and `familyVisible` itself (the gate, not
 * something the family needs echoed back once already filtered to
 * visible-only). `status` is likewise omitted — every DTO instance this
 * phase ever produces is already filtered to `status === 'active'` by
 * `portalDocumentService.ts`, so the field would carry no variance.
 */
export type PortalDocumentView = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  category: string | null;
  documentTypeKey: string | null;
  signatureStatus: string | null;
  createdAt: string;
};

export function buildPortalDocumentView(document: CaseDocument): PortalDocumentView {
  return {
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    category: document.category,
    documentTypeKey: document.documentTypeKey,
    signatureStatus: document.signatureStatus,
    createdAt: document.createdAt,
  };
}
