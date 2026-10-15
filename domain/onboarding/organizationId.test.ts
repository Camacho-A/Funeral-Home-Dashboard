import { describe, expect, it } from 'vitest';
import { resolveOnboardingOrganizationId, isReservedOrganizationId } from './organizationId';

describe('resolveOnboardingOrganizationId', () => {
  it('omitted on an unrestricted deployment → null (caller generates a UUID)', () => {
    expect(resolveOnboardingOrganizationId(undefined, null)).toEqual({ ok: true, organizationId: null });
    expect(resolveOnboardingOrganizationId('', null)).toEqual({ ok: true, organizationId: null });
  });

  it('accepts a valid slug id and a UUID', () => {
    expect(resolveOnboardingOrganizationId('gus-camacho-jr', null)).toEqual({ ok: true, organizationId: 'gus-camacho-jr' });
    expect(resolveOnboardingOrganizationId('0b8f3c1e-2a4d-4e6b-9f10-1234567890ab', null)).toMatchObject({ ok: true });
  });

  it.each(['Gus-Camacho', 'gus_camacho', '-gus', 'gus-', 'ab', 'a'.repeat(65), 42, {}, 'gus camacho'])('rejects malformed %s', (value) => {
    expect(resolveOnboardingOrganizationId(value, null)).toMatchObject({ ok: false, code: 'invalid_organization_id' });
  });

  it.each(['managed-cremations', 'admin', 'api', 'platform', 'onboarding'])('rejects reserved %s', (value) => {
    expect(isReservedOrganizationId(value)).toBe(true);
    expect(resolveOnboardingOrganizationId(value, null)).toMatchObject({ ok: false, code: 'reserved_organization_id' });
  });

  it('enforces the deployment allowlist', () => {
    expect(resolveOnboardingOrganizationId('other-org', ['gus-camacho-jr'])).toMatchObject({ ok: false, code: 'organization_not_allowed_in_deployment' });
    expect(resolveOnboardingOrganizationId('gus-camacho-jr', ['gus-camacho-jr'])).toEqual({ ok: true, organizationId: 'gus-camacho-jr' });
  });

  it('defaults to the single allowlisted organization, but requires an explicit id when several are allowed', () => {
    expect(resolveOnboardingOrganizationId(undefined, ['gus-camacho-jr'])).toEqual({ ok: true, organizationId: 'gus-camacho-jr' });
    expect(resolveOnboardingOrganizationId(undefined, ['gus-camacho-jr', 'b-org'])).toMatchObject({ ok: false, code: 'organization_id_required' });
  });

  it('a Manors-only allowlist still cannot onboard managed-cremations (reserved)', () => {
    expect(resolveOnboardingOrganizationId(undefined, ['managed-cremations'])).toMatchObject({ ok: false, code: 'reserved_organization_id' });
  });
});
