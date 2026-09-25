/**
 * Manors Additional Items & Services (2026-09). Manors does not routinely
 * purchase third-party items on behalf of families — "Cash Advance Items"
 * (services/cashAdvanceService.ts, components/case/BillingCard.tsx) is a
 * distinct, FTC-governed mechanism this checkpoint deliberately leaves
 * untouched, since other funeral homes on this platform may genuinely use
 * it. What Manors staff actually need is friendlier terminology for
 * adding an ordinary service/merchandise line item to an already-existing
 * Case Order AFTER the original arrangements — the exact thing
 * `EditServicesModal`/`recalculateOrder` already do correctly; only the
 * staff-facing label changes, never the underlying billing mechanism or
 * its FTC classification (see domain/billing/ftcClassification.ts,
 * unchanged).
 *
 * Hardcoded to the one real Manors organization id, matching every other
 * Manors-specific constant in this codebase (e.g. the case-numbering
 * cutover route's own `MANORS_ORGANIZATION_ID`) — deliberately not a new
 * org-level feature-flag/config system for what is, today, a single
 * customer's terminology preference.
 */
const MANORS_ORGANIZATION_ID = 'managed-cremations';

export function isManorsOrganization(organizationId: string): boolean {
  return organizationId === MANORS_ORGANIZATION_ID;
}

/** The button/modal-title label for adding a line item to an EXISTING
    Case Order — never for the first-time "Set Up Services & Charges"
    flow, which always keeps its original label regardless of
    organization (that's the original arrangement, not an addition). */
export function additionalItemsLabel(organizationId: string): string {
  return isManorsOrganization(organizationId) ? 'Additional Items & Services' : 'Edit Services';
}

export const ADDITIONAL_ITEMS_SUPPORTING_TEXT = 'Add items or services the family requests after the original arrangements.';
