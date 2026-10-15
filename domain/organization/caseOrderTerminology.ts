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
 * 2026-10: no longer hardcoded to the Manors organization id — whether
 * an organization uses this wording is its profile's
 * `features.additionalItemsTerminology` (domain/organization/organizationProfiles.ts).
 * Manors: on. Every other organization (including Gus Camacho Jr.): off.
 */
import { getRegisteredOrganizationProfile } from './organizationProfiles';

/** 2026-10: now a profile preference (`features.additionalItemsTerminology`,
    see domain/organization/organizationProfiles.ts). */
export function usesAdditionalItemsTerminology(organizationId: string): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.additionalItemsTerminology;
}

/** @deprecated Use `usesAdditionalItemsTerminology` — kept so any
    in-flight caller keeps compiling; it no longer means "is Manors". */
export const isManorsOrganization = usesAdditionalItemsTerminology;

/** The button/modal-title label for adding a line item to an EXISTING
    Case Order — never for the first-time "Set Up Services & Charges"
    flow, which always keeps its original label regardless of
    organization (that's the original arrangement, not an addition). */
export function additionalItemsLabel(organizationId: string): string {
  return usesAdditionalItemsTerminology(organizationId) ? 'Additional Items & Services' : 'Edit Services';
}

export const ADDITIONAL_ITEMS_SUPPORTING_TEXT = 'Add items or services the family requests after the original arrangements.';
