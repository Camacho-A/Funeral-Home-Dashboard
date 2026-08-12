import { describe, it, expect } from 'vitest';
import { getForOrganization } from './organizationsService';
import { mockOrganizationFixtures } from './__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

describe('getForOrganization (Phase 33 — server-safe counterpart to the client-only get())', () => {
  it('returns the matching organization in mock mode', async () => {
    const result = await getForOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(result?.id).toBe(DEFAULT_ORGANIZATION_ID);
    expect(result).toEqual(mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID));
  });

  it('returns null for an unknown organizationId', async () => {
    expect(await getForOrganization('does-not-exist', 'mock')).toBeNull();
  });
});
