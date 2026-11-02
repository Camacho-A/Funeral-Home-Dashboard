import type * as Profiles from '../../domain/organization/organizationProfiles';

/**
 * Test helper (2026-11). Route tests exercise the price catalog on the
 * default mock organization because its fixtures carry every staff role.
 * The real Manors profile keeps pricing 'legacy' and unmanaged, so these
 * tests switch that one organization to the platform default — catalog
 * managed in SOLIS, 'granular' permissions, line prices locked — the way
 * any new funeral home starts. Use inside vi.mock:
 *
 *   vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) =>
 *     withGranularPricing(await importOriginal(), DEFAULT_ORGANIZATION_ID));
 */
export function withGranularPricing(actual: typeof Profiles, organizationId: string): typeof Profiles {
  return {
    ...actual,
    getRegisteredOrganizationProfile: (id: string | null | undefined) => {
      const profile = actual.getRegisteredOrganizationProfile(id);
      if (id !== organizationId) return profile;
      return {
        ...profile,
        features: { ...profile.features, priceCatalogManagement: true, pricingPermissionModel: 'granular', orderLinePriceLock: true },
      };
    },
  };
}
