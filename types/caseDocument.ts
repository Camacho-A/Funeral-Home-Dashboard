/**
 * Phase 25 (Document Generation & Template Management). Replaces the
 * original, mock-only `types/document.ts` (its `documentFixtures`/
 * `documentFilesById` in-memory arrays are retired — see
 * `services/documentService.ts`) with a real, persisted shape covering
 * both origins the Documents tab needs: a document generated from a
 * `DocumentTemplate` (types/documentTemplate.ts), and a file a staff
 * member uploads directly. Reconciled against docs/CMS_SCHEMA.md's
 * already-written (never-built) richer Prisma `Document` model — this
 * type adopts its `fileKey`/`mimeType`/`fileSizeBytes`/`version`/
 * `supersedesId` fields (as `storageKey`/`mimeType`/`fileSizeBytes`/
 * `version`/`supersedesId`) now that real storage exists to back them.
 * See docs/adr/ADR-029-document-generation-and-template-management.md.
 */

export type CaseDocumentOrigin = 'generated' | 'uploaded';

/**
 * Reuses (and finally activates) the original types/document.ts's
 * `DocumentStatus` enum values, plus 'failed' for the async
 * render-then-store two-phase flow — mirrors `PaymentRecord.status`'s own
 * `pending -> succeeded/failed` pattern exactly (see types/payment.ts).
 * Display labels are a separate concern, never derived from these
 * machine values: pending -> "Draft", active -> "Generated",
 * superseded -> "Superseded", archived -> "Archived",
 * failed -> "Generation Failed". A document (of either origin) is
 * inserted as 'pending' the instant an action starts (so the UI can show
 * it immediately as in-progress), and is the only field ever updated in
 * place afterward — every other field on a CaseDocument row, once
 * written, is permanent (see this phase's Invariants).
 */
export type CaseDocumentStatus = 'pending' | 'active' | 'superseded' | 'archived' | 'failed';

/**
 * Reserved for Phase 26 (e-signatures) — always `null` this phase; no
 * route or service here ever sets it to anything else. Included now,
 * rather than added later, so a future signature integration can
 * reference the exact `checksumSha256` + `storageKey` a signature applies
 * to without any storage redesign or schema migration beyond widening
 * this field's own meaning. Explicitly NOT implemented this phase — see
 * this phase's own "explicitly out of scope" list.
 */
export type CaseDocumentSignatureStatus = 'unsigned' | 'pending_signature' | 'signed';

export type CaseDocument = {
  id: string;
  organizationId: string;
  caseId: string;
  origin: CaseDocumentOrigin;
  /** A domain/documents/documentTypeRegistry.ts DOCUMENT_TYPES[...].key —
      null for an uploaded file with no type chosen. */
  documentTypeKey: string | null;
  category: import('./documentTemplate').DocumentTemplateCategory | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  /** SHA-256 hex digest of the exact stored bytes, computed once at
      storage time by services/documentService.ts — never recomputed from
      or trusted from a client-supplied value. Supports future tamper/
      corruption detection (re-hash the downloaded bytes, compare) without
      any schema change. */
  checksumSha256: string;
  /** Opaque reference into lib/documentStorageProvider.ts's
      DocumentStorageProvider — never a raw, permanent public URL. See
      GET .../documents/[documentId]/download, the only route that ever
      turns this into an actual URL, minted short-lived and per-request. */
  storageKey: string;
  status: CaseDocumentStatus;

  // Generated-only fields — null for origin: 'uploaded'.
  templateId: string | null;
  /** The EXACT DocumentTemplateVersion.version used to generate this
      document — permanent, never changes after creation, even if the
      template is edited (or the row itself is later superseded) —
      see this phase's Invariants and types/documentTemplate.ts. */
  templateVersion: number | null;
  /** This document's own generation number, scoped to (caseId,
      templateId) — 1 for the first generation, incrementing on each
      regeneration. Distinct from templateVersion: regenerating without a
      template edit still increments `version` while `templateVersion` may
      stay the same (an explicit user choice — see Invariants). */
  version: number | null;
  /** The CaseDocument.id this row replaces, if any — set the moment this
      row is inserted as the result of a regeneration; the row it names
      has its own `status` flipped to 'superseded' in the same operation
      (mirrors CaseOrder's markCaseOrderSuperseded exactly), never deleted. */
  supersedesId: string | null;

  signatureStatus: CaseDocumentSignatureStatus | null;

  /** Phase 29 (Family Portal & External Collaboration). Fails closed
      unconditionally — `false` on every new row, regardless of document
      type, generation path, or signature completion. No code path other
      than a staff-gated `PATCH .../documents/[documentId]/family-visibility`
      route (`services/documentService.ts`'s `setFamilyVisible`) may ever
      flip it to `true`. `services/portal/portalDocumentService.ts` reads
      this field directly (never re-derives it) and additionally requires
      `status === 'active'` before a family member can see or download the
      document. */
  familyVisible: boolean;

  generatedBy: string | null;
  uploadedBy: string | null;
  createdAt: string;
  /** Shared with the ActivityEvent(s) this action produced — one
      correlationId per request, matching every Phase 24 integration
      point's own convention. */
  correlationId: string;
};

export type NewGeneratedDocumentInput = {
  caseId: string;
  templateId: string;
  /** Omit to resolve the template's current latest active version at
      call time; provide an explicit number to regenerate against the
      same (or any other) version on purpose — never silently "whichever
      is latest" (see this phase's Invariants). */
  templateVersion?: number;
  /** Set only when this call is a regeneration of an existing document —
      the row it names gets superseded once the new row is persisted. */
  existingDocumentId?: string;
};

export type NewUploadedDocumentInput = {
  caseId: string;
  fileName: string;
  mimeType: string;
  documentTypeKey?: string;
  category?: import('./documentTemplate').DocumentTemplateCategory;
};
