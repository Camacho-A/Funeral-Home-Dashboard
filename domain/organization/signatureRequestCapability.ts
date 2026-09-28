import type { Organization } from '../../types/organization';

/**
 * Handwritten item #4 (2026-09, Request Signature removal for Manors). The
 * single organization-level capability every staff-facing Signature
 * Request action resolves through — never a scattered
 * `organizationId === 'managed-cremations'` check in an unrelated
 * component/route. Deliberately pure/client-safe (no I/O, no server-only
 * imports) — mirrors domain/organization/familyPortalCapability.ts's exact
 * shape (item #3), but is a genuinely SEPARATE capability: Family Portal
 * and Signature Requests are independent platform features (an
 * organization could plausibly use Jotform for family signing while still
 * using SOLIS Signature Requests for internal-staff/witness signers, or
 * vice versa) — nothing in the current architecture makes them
 * inseparable, so this file introduces its own flag rather than reusing
 * `isFamilyPortalEnabled`. Server-side callers that only have an
 * organizationId string use `isSignatureRequestsEnabledForOrganizationId`
 * in `services/organizationSignatureRequestCapabilityService.ts` instead,
 * which fetches the Organization and delegates to this same resolution.
 *
 * Default polarity: Signature Requests are a long-established platform
 * capability every pre-existing organization already uses, so an absent/
 * undefined `Organization.signatureRequestsEnabled` must default to `true`
 * (existing behavior preserved) — never to `false`. Only an explicit
 * `false` disables it for that organization.
 *
 * TEMPORARY (2026-09): `Organization.signatureRequestsEnabled` is fully
 * wired end-to-end (type, Wix mapper) but does not exist as a live Wix
 * Data field yet — adding it live was explicitly out of scope for this
 * task (the same production collection-schema-mutation constraint item #3
 * hit), so `ORGANIZATION_OVERRIDES` below is a small, disclosed,
 * organization-ID-scoped override for the one authoritative business
 * decision this task implements (Manors: disabled).
 *
 * TODO(remove-after-wix-field-exists): once a real `signatureRequestsEnabled`
 * BOOLEAN field is added to the live `organizations` Wix Data collection
 * and set to `false` for `managed-cremations`, delete the
 * `MANORS_ORGANIZATION_ID` entry from `ORGANIZATION_OVERRIDES` below (or
 * empty the whole map). No other file needs to change — every call site
 * already reads through `isSignatureRequestsEnabled`/
 * `isSignatureRequestsEnabledForOrganizationId`.
 */
export const MANORS_ORGANIZATION_ID = 'managed-cremations';

export const ORGANIZATION_OVERRIDES: Record<string, boolean> = {
  [MANORS_ORGANIZATION_ID]: false,
};

/** For callers that already have a full (or partial) Organization record —
    e.g. client-side via useOrganizationRecord(). */
export function isSignatureRequestsEnabled(organization: (Pick<Organization, 'id' | 'signatureRequestsEnabled'> & { id: string }) | null | undefined): boolean {
  if (organization?.id && organization.id in ORGANIZATION_OVERRIDES) {
    return ORGANIZATION_OVERRIDES[organization.id];
  }
  if (!organization) return true;
  return organization.signatureRequestsEnabled !== false;
}
