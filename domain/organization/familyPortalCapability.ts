import type { Organization } from '../../types/organization';
import { getOrganizationProfile, registeredProfileMap } from './organizationProfiles';

/**
 * Handwritten item #3 (2026-09, Family Portal removal for Manors). The
 * single organization-level capability every staff-facing and family-
 * facing Family Portal surface resolves through — never a scattered
 * `organizationId === 'managed-cremations'` check in an unrelated
 * component/route. Deliberately pure/client-safe (no I/O, no server-only
 * imports) — server-side callers that only have an organizationId string
 * use `isFamilyPortalEnabledForOrganizationId` in
 * `services/organizationFamilyPortalCapabilityService.ts` instead, which
 * fetches the Organization and delegates to this same resolution.
 *
 * Default polarity is the OPPOSITE of domain/organization/moduleVisibility.ts's
 * `ADVANCED_MODULE_KEYS` allowlist (which defaults an unconfigured
 * organization to *hidden*): Family Portal is a long-established platform
 * capability every pre-existing organization already uses, so an absent/
 * undefined `Organization.familyPortalEnabled` must default to `true`
 * (existing behavior preserved) — never to `false`. Only an explicit
 * `false` disables it for that organization.
 *
 * TEMPORARY (2026-09): `Organization.familyPortalEnabled` is fully wired
 * end-to-end (type, Wix mapper) but does not exist as a live Wix Data
 * field yet — adding it was attempted during this task and blocked by
 * this environment's own write-safety tooling (a production collection-
 * schema mutation), so the user chose a disclosed, single-file,
 * organization-ID-scoped override below as the immediate mechanism for
 * the one authoritative business decision this task implements (Manors:
 * disabled). `isFamilyPortalEnabled` checks the override FIRST, then
 * falls back to the real field — once the Wix field is added and set for
 * Manors, `ORGANIZATION_OVERRIDES` can simply be emptied; no other file
 * needs to change.
 */
export { MANORS_ORGANIZATION_ID } from './organizationProfiles';

/**
 * 2026-10: the override now lives in domain/organization/organizationProfiles.ts
 * as a PINNED profile feature (profile wins over the record). This map is
 * derived from that registry and kept only for existing importers
 * (services/organizationFamilyPortalCapabilityService.ts short-circuits on
 * it without fetching the Organization). To drop Manors' override, unpin
 * `familyPortalEnabled` in its profile — no other file changes.
 */
export const ORGANIZATION_OVERRIDES: Record<string, boolean> = registeredProfileMap(
  (profile) => profile.features.familyPortalEnabled,
  (profile) => profile.pinnedFeatures.includes('familyPortalEnabled'),
);

/** For callers that already have a full (or partial) Organization record —
    e.g. client-side via useOrganizationRecord(). */
export function isFamilyPortalEnabled(organization: (Pick<Organization, 'id' | 'familyPortalEnabled'> & { id: string }) | null | undefined): boolean {
  if (!organization) return true;
  // Pinned profile value > explicit record field > profile > platform default.
  return getOrganizationProfile(organization.id, organization).features.familyPortalEnabled;
}
