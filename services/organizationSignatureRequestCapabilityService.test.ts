import { describe, expect, it } from 'vitest';
import { isSignatureRequestsEnabledForOrganizationId } from './organizationSignatureRequestCapabilityService';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';

/**
 * Handwritten item #4 (2026-09, Request Signature removal for Manors).
 * DEFAULT_ORGANIZATION_ID is the real Manor's Cremation production
 * organization id ('managed-cremations').
 */
describe('isSignatureRequestsEnabledForOrganizationId', () => {
  it('1: managed-cremations is disabled', async () => {
    expect(await isSignatureRequestsEnabledForOrganizationId(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(false);
  });

  it('4: a different organization preserves existing (enabled) behavior', async () => {
    expect(await isSignatureRequestsEnabledForOrganizationId(SECOND_MOCK_ORGANIZATION_ID, 'mock')).toBe(true);
  });

  it('an unknown organizationId (not found) defaults to enabled — never default-off globally', async () => {
    expect(await isSignatureRequestsEnabledForOrganizationId('no-such-organization', 'mock')).toBe(true);
  });
});
