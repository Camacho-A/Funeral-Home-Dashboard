import { describe, it, expect } from 'vitest';
import { resolveLoginOrganizationId } from './loginBranding';

describe('resolveLoginOrganizationId', () => {
  it('shows the single active organization when a deployment holds exactly one', () => {
    // Today's production shape: one tenant, no configuration needed.
    expect(
      resolveLoginOrganizationId({
        configuredOrganizationId: null,
        activeOrganizationIds: ['managed-cremations'],
      }),
    ).toBe('managed-cremations');
  });

  it('prefers the configured organization over the single-tenant fallback', () => {
    expect(
      resolveLoginOrganizationId({
        configuredOrganizationId: 'gus-camacho-jr',
        activeOrganizationIds: ['managed-cremations'],
      }),
    ).toBe('gus-camacho-jr');
  });

  it('uses the configured organization once a second one exists', () => {
    expect(
      resolveLoginOrganizationId({
        configuredOrganizationId: 'managed-cremations',
        activeOrganizationIds: ['managed-cremations', 'gus-camacho-jr'],
      }),
    ).toBe('managed-cremations');
  });

  it('shows no organization logo rather than guessing between tenants', () => {
    // One funeral home's branding must never greet another's staff.
    expect(
      resolveLoginOrganizationId({
        configuredOrganizationId: null,
        activeOrganizationIds: ['managed-cremations', 'gus-camacho-jr'],
      }),
    ).toBeNull();
  });

  it('shows no organization logo when the deployment has none active', () => {
    expect(
      resolveLoginOrganizationId({ configuredOrganizationId: null, activeOrganizationIds: [] }),
    ).toBeNull();
  });

  it('treats a blank or whitespace-only configured value as unset', () => {
    // An env var set to "" in a dashboard must not resolve to an
    // organization whose id is the empty string.
    expect(
      resolveLoginOrganizationId({ configuredOrganizationId: '', activeOrganizationIds: ['managed-cremations'] }),
    ).toBe('managed-cremations');
    expect(
      resolveLoginOrganizationId({ configuredOrganizationId: '   ', activeOrganizationIds: ['a', 'b'] }),
    ).toBeNull();
    expect(
      resolveLoginOrganizationId({ configuredOrganizationId: undefined, activeOrganizationIds: ['a', 'b'] }),
    ).toBeNull();
  });

  it('trims a configured id so a stray newline does not break the lookup', () => {
    expect(
      resolveLoginOrganizationId({ configuredOrganizationId: ' managed-cremations\n', activeOrganizationIds: [] }),
    ).toBe('managed-cremations');
  });
});
