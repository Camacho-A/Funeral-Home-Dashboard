/**
 * Phase 39 (Family Billing & FTC Compliance). Organization-level OPTIONAL
 * supplemental language for compliance documents.
 *
 * D6 boundary: mandatory federal disclosure text is SYSTEM-CONTROLLED and
 * lives only in `domain/billing/ftcComplianceRegistry.ts` — it can never be
 * edited or removed here. This config holds ONLY optional supplemental blocks
 * (e.g. a provider-specific note, a state-specific explanation the provider
 * chooses to add). Supplemental language is rendered in a clearly-separated
 * section, never replaces or qualifies a mandatory disclosure, and is never
 * required for a compliant document. Versioned so a document can record which
 * supplemental version it rendered against.
 */
export type BillingSupplementalBlock = {
  /** Stable machine key for the block. */
  key: string;
  /** Which document it appears on. */
  document: 'general_price_list' | 'statement_of_goods_and_services';
  /** Provider-authored optional text (plain text; sanitized at render). */
  text: string;
};

export type BillingSupplementalConfig = {
  id: string;
  organizationId: string;
  /** Increments on each edit (append-only history). */
  version: number;
  blocks: BillingSupplementalBlock[];
  createdAt: string;
  updatedAt: string;
};
