import { describe, expect, it } from 'vitest';
import { isFamilyPortalEnabledForOrganizationId } from './organizationFamilyPortalCapabilityService';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';

/**
 * Handwritten item #3 (2026-09, Family Portal removal for Manors).
 * DEFAULT_ORGANIZATION_ID is the real Manor's Cremation production
 * organization id ('managed-cremations').
 */
describe('isFamilyPortalEnabledForOrganizationId', () => {
  it('1: managed-cremations is disabled', async () => {
    expect(await isFamilyPortalEnabledForOrganizationId(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(false);
  });

  it('7: a different organization preserves existing (enabled) behavior', async () => {
    expect(await isFamilyPortalEnabledForOrganizationId(SECOND_MOCK_ORGANIZATION_ID, 'mock')).toBe(true);
  });

  it('an unknown organizationId (not found) defaults to enabled — never default-off globally', async () => {
    expect(await isFamilyPortalEnabledForOrganizationId('no-such-organization', 'mock')).toBe(true);
  });
});
