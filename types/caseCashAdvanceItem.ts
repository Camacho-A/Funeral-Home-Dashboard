/**
 * Phase 39 (Family Billing & FTC Compliance). A single FTC "cash advance
 * item" for a case — something the funeral provider pays a third party for on
 * the family's behalf (death certificates, obituary/newspaper notices, clergy
 * honoraria, etc.).
 *
 * D4 — DISPLAY-ONLY / NON-GL in Phase 39. These rows exist ONLY to be
 * itemized on the FTC Statement of Funeral Goods and Services Selected. They
 * are deliberately NOT posted to the general ledger, NOT part of
 * `CaseOrder.total`/`balanceDue`, NOT visible to `PaymentService`, and NOT
 * counted in financial reporting or AR. The FTC "total cost of arrangements"
 * shown on the Statement includes them; Solis's authoritative AR balance does
 * not — and the Statement labels that distinction explicitly. First-class
 * GL-posted cash advances (with a pass-through clearing account) are deferred.
 */
export type CaseCashAdvanceItem = {
  id: string;
  organizationId: string;
  caseId: string;
  /** Human description of the third-party item (e.g. "Certified death certificates (5)"). */
  description: string;
  /** Integer cents — same convention as every other money field. */
  amountCents: number;
  /** FTC 453.3(f)(2): true when Solis charges the family MORE than the
      provider's actual cost — requires the cash-advance markup disclosure. */
  hasMarkup: boolean;
  /** True when `amountCents` is a good-faith ESTIMATE rather than a known
      amount — the Statement labels it as estimated (D4). */
  isEstimated: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
