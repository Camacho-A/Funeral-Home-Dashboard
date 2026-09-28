import type { ProviderIdentity } from './billingModels';
import { MANORS_LOGO_DATA_URI } from './manorsLogoAsset';

/**
 * Item #2 (2026-09, Manors Statement branding). A single, explicit,
 * organization-ID-scoped override for the FTC Statement's business-identity
 * block and Cash Advance section — used by `billingDocumentService.ts`'s
 * Statement assembly (`generateStatement`/`buildStatementModelOnly`) and,
 * as of item #11 (2026-09, Manors billing cleanup), by
 * `components/case/BillingCard.tsx` directly, so the Billing UI and the
 * generated Statement always agree on whether an organization uses the
 * Cash Advance workflow. Never the General Price List (which keeps reading
 * live `Organization`/`OrganizationLocation` data unchanged) and never any
 * other organization.
 *
 * Why an override and not a live data edit: verified directly against
 * Production Wix data (2026-09) that this organization's `organizations`/
 * `organizationLocations` rows still hold onboarding-placeholder values
 * (name "Manor's Cremation", address "100 Memorial Drive, Springfield, IL",
 * phone "(555) 201-4432", email "staff@managedcremations.test") — not the
 * real business's info, and there is no `fax` field anywhere in the
 * organization data model to hold one. Rather than writing directly to
 * those Production rows as a side effect of a Statement-presentation task,
 * or hardcoding this content inline in the renderer, this is the one place
 * it lives — reused by both statement-model assemblers, easy to find, easy
 * to correct later if the underlying Organization/Location rows are ever
 * brought current.
 */
export const MANORS_ORGANIZATION_ID = 'managed-cremations';

/** Address is two literal lines (street, then city/state/zip) — the
    renderer splits on `\n` and joins with `<br/>`, escaping each line. */
export const MANORS_STATEMENT_PROVIDER_IDENTITY: ProviderIdentity = {
  name: 'MANORS CREMATION SERVICES',
  addressLine: '481 E Commercial Blvd\nOakland Park, FL 33334',
  phone: '954-884-5770',
  fax: '305-603-9250',
  email: 'contact@manorscremation.com',
  logoDataUri: MANORS_LOGO_DATA_URI,
};

/** Manor's Cremation does not use the Cash Advance Items section in its
    normal workflow (it has no cash-advance line items to itemize) — the
    section is omitted entirely, both from this organization's Statement
    and from BillingCard's cash-advance editor. Every other organization
    keeps its existing behavior unchanged. */
export function shouldShowCashAdvanceSection(organizationId: string): boolean {
  return organizationId !== MANORS_ORGANIZATION_ID;
}
