import type { ProviderIdentity } from './billingModels';
import { MANORS_LOGO_DATA_URI } from './manorsLogoAsset';
import {
  MANORS_ORGANIZATION_ID,
  getRegisteredOrganizationProfile,
  type OrganizationLetterhead,
} from '../organization/organizationProfiles';

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
 *
 * 2026-10 (multi-tenant hardening): the Manors letterhead, receipt footer
 * and Cash Advance preference now live in Manors' organization profile
 * (domain/organization/organizationProfiles.ts). This module turns ANY
 * organization's profile letterhead into a `ProviderIdentity`, falling back
 * field-by-field to the identity built from that organization's own
 * Organization/Location record. An organization with no profile letterhead
 * (e.g. Gus Camacho Jr. Funeral Home, until configured) therefore gets an
 * entirely record-driven header — never another tenant's data. Manors'
 * rendered output is byte-identical to before.
 */
export { MANORS_ORGANIZATION_ID };

/**
 * Logo assets by profile `letterhead.logoAssetKey`. Server-side only in
 * practice (the Statement renderer); keyed so organizationProfiles.ts can
 * stay free of the base64 bytes. Only the Manors profile references
 * `'manors-logo'`.
 */
const LETTERHEAD_LOGO_ASSETS: Readonly<Record<string, string>> = {
  'manors-logo': MANORS_LOGO_DATA_URI,
};

export function letterheadLogoDataUri(logoAssetKey: string | null | undefined): string | undefined {
  return logoAssetKey ? LETTERHEAD_LOGO_ASSETS[logoAssetKey] : undefined;
}

/**
 * Overlays a profile letterhead onto a record-derived fallback identity.
 * Optional keys (fax/email/logo) are only present when there is a value, so
 * the renderer's "no value → no line" convention holds.
 */
export function providerIdentityFromLetterhead(
  letterhead: OrganizationLetterhead | null,
  fallback: ProviderIdentity,
): ProviderIdentity {
  if (!letterhead) return fallback;
  const identity: ProviderIdentity = {
    name: letterhead.name ?? fallback.name,
    // Two literal lines (street, then city/state/zip) — the renderer
    // splits on `\n` and joins with `<br/>`, escaping each line.
    addressLine: letterhead.addressLines && letterhead.addressLines.length > 0 ? letterhead.addressLines.join('\n') : fallback.addressLine,
    phone: letterhead.phone ?? fallback.phone,
  };
  const fax = letterhead.fax ?? fallback.fax;
  if (fax) identity.fax = fax;
  const email = letterhead.email ?? fallback.email;
  if (email) identity.email = email;
  const logoDataUri = letterheadLogoDataUri(letterhead.logoAssetKey) ?? fallback.logoDataUri;
  if (logoDataUri) identity.logoDataUri = logoDataUri;
  return identity;
}

/**
 * Statement/Receipt identity for one organization: its profile letterhead
 * (when it has one) over `recordIdentity`, the identity built from its own
 * Organization/Location record.
 */
export function resolveStatementProviderIdentity(organizationId: string, recordIdentity: ProviderIdentity): ProviderIdentity {
  return providerIdentityFromLetterhead(getRegisteredOrganizationProfile(organizationId).letterhead, recordIdentity);
}

/** Manors' letterhead as a `ProviderIdentity` — derived from its profile;
    kept as a named export for existing importers/tests. */
export const MANORS_STATEMENT_PROVIDER_IDENTITY: ProviderIdentity = providerIdentityFromLetterhead(
  getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).letterhead,
  { name: '', addressLine: '', phone: '' },
);

/** Whether an organization uses the Cash Advance Items section — its
    profile's `features.cashAdvanceOnStatement`. Manor's Cremation does not
    (it has no cash-advance line items to itemize), so the section is
    omitted both from its Statement and from BillingCard's cash-advance
    editor. Every other organization keeps the existing behavior. */
export function shouldShowCashAdvanceSection(organizationId: string): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.cashAdvanceOnStatement;
}

/**
 * Receipt of Payment footer (2026-10).
 *
 * An organization whose legal entity differs from its trading name (Manors:
 * "Cremations America of Broward, LLC DBA MANORS CREMATION") configures
 * `receiptFooter` in its profile; that text must never appear on anybody
 * else's document. Every other organization gets a footer built from its
 * OWN provider identity.
 */
export type ReceiptFooter = {
  thanksLine: string;
  legalEntityLine: string | null;
};

export function receiptFooterFor(organizationId: string, providerName: string): ReceiptFooter {
  const configured = getRegisteredOrganizationProfile(organizationId).receiptFooter;
  if (configured) return { thanksLine: configured.thanksLine, legalEntityLine: configured.legalEntityLine };
  return {
    thanksLine: `Thank you for your trust in ${providerName}`,
    legalEntityLine: null,
  };
}
