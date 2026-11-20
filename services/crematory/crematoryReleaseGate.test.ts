import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The Send to Crematory release gate end to end (Gus Phase 5K), with the
 * gate turned on for Gus IN THIS FILE ONLY. It is off in the real profile.
 * Mock mode, fictional cases; nothing is sent.
 */
vi.mock('@/domain/organization/organizationProfiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/organization/organizationProfiles')>();
  return {
    ...actual,
    getRegisteredOrganizationProfile: (organizationId: string) => {
      const profile = actual.getRegisteredOrganizationProfile(organizationId);
      if (organizationId !== actual.GUS_CAMACHO_ORGANIZATION_ID) return profile;
      return { ...profile, features: { ...profile.features, sendToCrematory: { ...profile.features.sendToCrematory!, requireReleaseAfterService: true } } };
    },
  };
});

const { getCrematoryCaseSummary } = await import('./crematoryPackageService');
const { caseFixtures } = await import('../__mocks__/fixtures');
const { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } = await import('@/domain/organization/organizationProfiles');

const GUS = GUS_CAMACHO_ORGANIZATION_ID;
const originals = caseFixtures.map((c) => c);
afterEach(() => originals.forEach((c, i) => (caseFixtures[i] = c)));
const gate = async (organizationId: string, caseId: string) =>
  (await getCrematoryCaseSummary(organizationId, caseId, true, 'mock')).readiness.requirements.find((r) => r.key === 'released_for_cremation');

describe('release gate on (test only)', () => {
  it('a Gus Viewing case lists the release as a sending requirement until it is recorded', async () => {
    expect(await gate(GUS, 'gus-case-010')).toMatchObject({ ok: false });
    const i = caseFixtures.findIndex((c) => c.id === 'gus-case-010' && c.organizationId === GUS);
    caseFixtures[i] = {
      ...caseFixtures[i],
      servicePreparation: {
        definitionKey: 'prep.viewing',
        definitionVersion: 2,
        serviceAppointmentId: null,
        choices: {},
        details: {},
        items: {},
        release: { releasedAt: '2026-12-11T15:00:00.000Z', releasedBy: 'identity-gus-director', releasedByName: 'Jordan Demo', roleKey: 'funeralDirector' },
      },
    };
    expect(await gate(GUS, 'gus-case-010')).toMatchObject({ ok: true });
  });

  it('a Gus Direct Cremation case and every Manors case are unaffected', async () => {
    const direct = caseFixtures.find((c) => c.organizationId === GUS && !c.workflowSnapshot?.serviceTypeCode?.includes('WITH'))!;
    expect(await gate(GUS, direct.id)).toBeUndefined();
    const manors = caseFixtures.find((c) => c.organizationId === MANORS_ORGANIZATION_ID && c.caseType === 'cremation')!;
    expect(await gate(MANORS_ORGANIZATION_ID, manors.id)).toBeUndefined();
  });
});
