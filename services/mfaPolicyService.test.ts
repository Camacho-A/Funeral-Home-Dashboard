import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityMustEnrollMfa } from './mfaPolicyService';
import { mockOrganizationFixtures } from './__mocks__/authFixtures';
import { identityFixtures, membershipFixtures, MANORS_ADMIN_IDENTITY_ID } from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { Identity } from '../types/identity';

function admin(): Identity {
  return identityFixtures.find((i) => i.id === MANORS_ADMIN_IDENTITY_ID)!;
}
let originalRequireMfa: boolean | undefined;

beforeEach(() => {
  const org = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID);
  originalRequireMfa = org?.requireMfa;
});
afterEach(() => {
  const org = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID);
  if (org) org.requireMfa = originalRequireMfa;
  const a = admin();
  a.mfaEnabled = false;
});

describe('mfaPolicyService.identityMustEnrollMfa', () => {
  it('returns false when the org does not require MFA (backward compatible default)', async () => {
    const org = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)!;
    org.requireMfa = false;
    expect(await identityMustEnrollMfa(admin(), 'mock')).toBe(false);
  });

  it('returns true when the org requires MFA and the identity is not enrolled', async () => {
    const org = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)!;
    org.requireMfa = true;
    admin().mfaEnabled = false;
    // sanity: the admin has an active membership in this org
    expect(membershipFixtures.some((m) => m.identityId === MANORS_ADMIN_IDENTITY_ID && m.organizationId === DEFAULT_ORGANIZATION_ID && m.status === 'active')).toBe(true);
    expect(await identityMustEnrollMfa(admin(), 'mock')).toBe(true);
  });

  it('returns false when the identity is already MFA-enrolled, even if the org requires MFA', async () => {
    const org = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)!;
    org.requireMfa = true;
    admin().mfaEnabled = true;
    expect(await identityMustEnrollMfa(admin(), 'mock')).toBe(false);
  });
});
