/**
 * Phase 25 (Document Generation & Template Management). Organization-owned,
 * versioned document templates — the direct structural mirror of
 * `types/workflowTemplate.ts`'s `WorkflowTemplate`/`WorkflowTemplateVersion`
 * split: template identity and version identity are two separate concerns
 * (backed by two separate Wix collections — `documentTemplates` and
 * `documentTemplateVersions`, joined at read time), versions are append-only
 * and never mutated in place, and a document generated from a template
 * permanently records the exact version it used (`CaseDocument.templateVersion`
 * — see types/caseDocument.ts), so editing a template later can never
 * retroactively change what a past generated document says. See
 * docs/adr/ADR-029-document-generation-and-template-management.md.
 */

/**
 * Broad UI-facing grouping — the ten categories named in this phase's own
 * spec (Contracts, Authorizations, Cremation Forms, Burial Forms, Financial
 * Documents, Receipts, Statements, Letters, Internal Forms, Miscellaneous).
 * Distinct from `documentTypeKey` (domain/documents/documentTypeRegistry.ts),
 * which is a more granular, stable, machine-readable identifier — a
 * template's `category` is what the Template Library's filter dropdown
 * groups by; `documentTypeKey` is what future code (e.g. a Phase 26
 * signature integration, or a report that counts "how many cremation
 * authorizations were generated this month") keys off of.
 */
export type DocumentTemplateCategory =
  | 'contract'
  | 'authorization'
  | 'cremation_form'
  | 'burial_form'
  | 'financial'
  | 'receipt'
  | 'statement'
  | 'letter'
  | 'internal_form'
  | 'miscellaneous';

export type DocumentTemplateStatus = 'active' | 'archived';

export type DocumentTemplateVersion = {
  templateId: string;
  /** Starts at 1, increments on every edit — append-only, never mutated in
      place (see the header comment above and this phase's Invariants). A
      CaseDocument stores the exact version it was generated against
      (CaseDocument.templateVersion), so editing this later never changes
      how an already-generated document reads. */
  version: number;
  /** HTML fragment containing `{{namespace.field.path}}` merge tokens —
      sanitized (script tags, inline event handlers, javascript: URLs,
      iframe/object/embed stripped) before being persisted, never trusted
      as-authored even though template authors are always org staff. See
      domain/documents/mergeEngine.ts for token validation and substitution. */
  body: string;
  /** The subset of domain/documents/mergeEngine.ts's MERGE_FIELD_CATALOG
      keys this version's body actually references — computed and
      validated at save time (an unrecognized token here is rejected
      outright, never silently accepted). Used by the Merge-Field Browser
      to highlight which fields a template already uses. */
  mergeFieldsUsed: string[];
  createdAt: string;
  createdBy: string;
};

export type DocumentTemplate = {
  id: string;
  /** null only for a future system template (isSystemTemplate: true) —
      mirrors WorkflowTemplate's own organization-nullability convention.
      No system templates are seeded this phase; the field exists so a
      later phase can add one without a schema change. */
  organizationId: string | null;
  isSystemTemplate: boolean;
  /** Display name — deliberately separate from documentTypeKey (a stable
      identifier is never derived from, or a substitute for, a human-
      editable display string). */
  name: string;
  /** A domain/documents/documentTypeRegistry.ts DOCUMENT_TYPES[...].key
      value — what this template *is*, machine-readably. */
  documentTypeKey: string;
  category: DocumentTemplateCategory;
  /** 'archived' (not WorkflowTemplate's 'isEnabled' boolean) — "archived"
      reads more honestly than "disabled" for a document template an
      organization may deliberately bring back later (Restore), and
      matches this phase's own spec wording ("archive template", "restore
      template"). */
  status: DocumentTemplateStatus;
  /** Append-only; the latest version is versions[versions.length - 1],
      assembled at read time from the documentTemplateVersions collection —
      never a nested array field on the Wix row itself (matches
      WorkflowTemplate's exact precedent). */
  versions: DocumentTemplateVersion[];
};
