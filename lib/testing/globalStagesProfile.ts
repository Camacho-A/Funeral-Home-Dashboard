import type * as Profiles from '../../domain/organization/organizationProfiles';

/**
 * Test helper (2026-11). The fictional second organization's case fixtures
 * (services/__mocks__) are copies of Manors' cases, carrying Manors'
 * workflow snapshots — not cases created from that organization's own
 * templates. Tests built on those copies that exercise the case list,
 * counts and dashboard architecture pin it to the fixed platform stage list
 * (Manors' behaviour), which those copies were written for. Real
 * organizations' stage lists come from their own templates
 * (`features.stagesFromWorkflowTemplates`). Use inside vi.mock:
 *
 *   vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) =>
 *     withGlobalStages(await importOriginal(), SECOND_MOCK_ORGANIZATION_ID));
 */
export function withGlobalStages(actual: typeof Profiles, ...organizationIds: string[]): typeof Profiles {
  return {
    ...actual,
    getRegisteredOrganizationProfile: (id: string | null | undefined) => {
      const profile = actual.getRegisteredOrganizationProfile(id);
      if (!id || !organizationIds.includes(id)) return profile;
      return { ...profile, features: { ...profile.features, stagesFromWorkflowTemplates: false } };
    },
  };
}
