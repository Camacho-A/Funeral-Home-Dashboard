/**
 * Manors Jotform integration (case-first architecture, 2026-09). One row
 * per organization + external form the organization has configured Solis
 * to know about. Deliberately provider-neutral — `provider` is a plain
 * string (e.g. 'jotform'), not a fixed enum, so a future provider (or a
 * future organization's different form) never requires an application-
 * code change, only a new row. Distinct from the older, dormant
 * `types/externalFormIntegration.ts` (Phase 11's checklist-item display
 * metadata, never wired to any real submission pipeline) — this is the
 * real, functional configuration behind the Jotform ↔ Solis integration.
 *
 * No Manors-specific form IDs appear anywhere else in application code —
 * every place that needs to know "which forms does this organization
 * have" reads this collection.
 */
export type ExternalFormAudience = 'family' | 'staff';

export type ExternalFormConfig = {
  id: string;
  organizationId: string;
  provider: string; // 'jotform'
  externalFormId: string; // provider's own form identifier
  label: string; // e.g. "Vital Statistics"
  audience: ExternalFormAudience;
  /** JSON-stringified Record<string, string> — provider field key (e.g.
      Jotform's `{qid}_{name}` convention) -> Solis field name. Never
      parsed/trusted as executable logic, only as a lookup table. */
  fieldMap: string;
  /** The logical hidden-field name Solis expects the provider form to
      carry the opaque link token under (see types/caseFormLink.ts) —
      e.g. 'solisLinkToken'. Purely descriptive until the live form
      actually has this field; nothing breaks if it doesn't yet — a
      submission simply arrives with no resolvable token and lands in
      the Unmatched Forms queue (see externalFormSubmissionService.ts). */
  linkTokenFieldName: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};
